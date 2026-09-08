// Installed local PostgreSQL only: disposable data, private Unix socket, no TCP.
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { reconcileBillingEvent } from '../supabase/functions/_shared/billingReconciliation.ts';
const root=resolve(import.meta.dirname,'..');
const migration='20260908190000_atomic_billing_subscription_transition.sql';
const reconciliationMigration='20260908191000_billing_reconciliation_outbox.sql';
if(process.argv.length!==2)throw Error('This local fixture accepts no arguments.');
if(process.getuid?.()===0)throw Error('Run this disposable PostgreSQL fixture as a non-root user.');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
Object.assign(env,{LANG:'C',LC_ALL:'C'});
for(const command of ['initdb','pg_ctl','psql']){const result=spawnSync(command,['--version'],{env,encoding:'utf8'});if(result.error||result.status!==0)throw Error(`Installed ${command} is required; nothing was installed or contacted.`);}
const temp=mkdtempSync('/tmp/survey-billing-reconciliation-'),data=join(temp,'data'),socket=temp,port='6543';
const psqlArgs=['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq'];
let started=false,checks=0;const children=new Set();
function run(command,args,required=true){const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:20_000});if(required&&(result.error||result.status!==0))throw Error(result.error?.message||result.stderr||result.stdout);return{status:result.status,stdout:String(result.stdout||'').trim(),stderr:String(result.stderr||'').trim()};}
const sql=(statement,required=true)=>run('psql',[...psqlArgs,'-c',statement],required);
const scalar=statement=>sql(statement).stdout;
const source=file=>readFileSync(join(root,'supabase/migrations',file),'utf8');
const apply=file=>run('psql',[...psqlArgs,'-f',join(root,'supabase/migrations',file)]);
const uuid=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const quote=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${quote(JSON.stringify(value))}::jsonb`;
const digest='a'.repeat(64),eventType='customer.subscription.updated';
const signature='public.reconcile_billing_subscription_event(uuid,text,text,jsonb,jsonb,text,text,text,jsonb,bigint)';
const receipt='survey_private.billing_transition_receipts';
const outbox='survey_private.billing_notification_outbox';
const heads='survey_private.billing_reconciliation_heads';
const actorContext=(actor,role='service_role')=>`SET ROLE ${role}; SET request.jwt.claim.sub=${quote(actor||'')}; SET request.jwt.claim.role=${quote(role)};`;
const asRole=(actor,statement,role='service_role',required=true)=>sql(`${actorContext(actor,role)} ${statement}`,required);
const expectedRevisions=new WeakMap();
const expected=actor=>{
  const customer=scalar(`SELECT stripe_customer_id FROM user_subscriptions WHERE user_id='${actor}'`);
  const value=JSON.parse(asRole(null,`SELECT public.read_billing_subscription_snapshot(${quote(customer)})`).stdout);
  assert.equal(typeof value.revision,'string');expectedRevisions.set(value.subscription,value.revision);return value.subscription;
};
const patch=(overrides={})=>({tier:'free',status:'active',stripe_subscription_id:'sub_1',stripe_price_id:'price_free',trial_ends_at:null,current_period_start:'2026-09-01T00:00:00Z',current_period_end:'2026-10-01T00:00:00Z',cancel_at:null,...overrides});
const statement=(n,snapshot,update,evt=`evt_${n}`,overrides={})=>{
  const values={user:uuid(n),customer:`cus_${n}`,subscription:`sub_${n}`,snapshot,update,evt,type:eventType,digest,notification:null,revision:expectedRevisions.get(snapshot)||'0',...overrides};
  return `SELECT public.reconcile_billing_subscription_event(${quote(values.user)}::uuid,${quote(values.customer)},${quote(values.subscription)},${json(values.snapshot)},${values.update===null?'NULL':json(values.update)},${quote(values.evt)},${quote(values.type)},${quote(values.digest)},${values.notification===null?'NULL':json(values.notification)},${quote(values.revision)}::bigint)`;
};
const result=(n,snapshot,update,evt,overrides)=>JSON.parse(asRole(null,statement(n,snapshot,update,evt,overrides)).stdout);
const fullTables=['auth.users','public.user_subscriptions','public.projects','public.documents','public.project_status','public.project_collaborators','public.document_collaborators','storage.objects',receipt,outbox,heads];
const notification=(key,overrides={})=>({key,template:'payment-succeeded',to:'fixture@example.invalid',subject:'Synthetic fixture receipt',data:{amount:'19.00',currency:'USD'},...overrides});
const lookupStatement=(n,evt=`evt_${n}`,overrides={})=>{const v={evt,customer:`cus_${n}`,subscription:`sub_${n}`,type:eventType,digest,...overrides};return `SELECT public.lookup_billing_event(${quote(v.evt)},${quote(v.customer)},${quote(v.subscription)},${quote(v.type)},${quote(v.digest)})`;};
const lookup=(n,evt,overrides)=>JSON.parse(asRole(null,lookupStatement(n,evt,overrides)).stdout||'null');
const claimStatement=(evt,token)=>`SELECT public.claim_billing_notification(${quote(evt)},${quote(token)}::uuid)`;
const claim=(evt,token)=>JSON.parse(asRole(null,claimStatement(evt,token)).stdout);
const completeStatement=(evt,token,message)=>`SELECT public.complete_billing_notification(${quote(evt)},${quote(token)}::uuid,${quote(message)})`;
const complete=(evt,token,message)=>JSON.parse(asRole(null,completeStatement(evt,token,message)).stdout);
const snapshot=(tables=fullTables)=>tables.map(table=>scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t`));
const errorState=(value,state)=>{assert.notEqual(value.status,0,value.stdout);assert.match(value.stderr,new RegExp(`\\b${state}:`));};
const check=async(label,work)=>{await work();checks++;console.log(`PASS ${label}`);};
function actor(n,{projects=0,documents=0}={}){
  const user=uuid(n);sql(`INSERT INTO auth.users VALUES('${user}'); UPDATE user_subscriptions SET tier='pro',status='active',stripe_customer_id='cus_${n}',stripe_subscription_id='sub_${n}',stripe_price_id='price_pro',metadata='{"keep":"fixture","cancel_at":"old"}',storage_used_bytes=23 WHERE user_id='${user}';`);
  if(projects)sql(`INSERT INTO projects(id,user_id,name,updated_at,metadata) SELECT ('40000000-0000-4000-8000-'||lpad((${n}*100+g)::text,12,'0'))::uuid,'${user}','project-'||g,'2026-01-01',jsonb_build_object('keep',g) FROM generate_series(1,${projects}) g`);
  if(documents)sql(`INSERT INTO documents(id,user_id,name,file_path,file_size,updated_at,annotations) SELECT ('40000000-0000-4000-8000-'||lpad((${n}*1000+g)::text,12,'0'))::uuid,'${user}','document-'||g,'${user}/fixture-'||g||'.pdf',10,'2026-01-01',jsonb_build_object('keep',g) FROM generate_series(1,${documents}) g;
    INSERT INTO storage.objects(bucket_id,name,metadata,bytes) SELECT 'documents',file_path,'{"size":10}',decode('255044462d66697874757265','hex') FROM documents WHERE user_id='${user}'`);
  return user;
}
function session(name,role='service_role',actorId=null,isolation='READ COMMITTED'){
  const child=spawn('psql',psqlArgs,{cwd:root,env,stdio:['pipe','pipe','pipe']});children.add(child);let stdout='',stderr='',exited=false;
  child.stdout.on('data',value=>{stdout+=value;});child.stderr.on('data',value=>{stderr+=value;});child.stdin.on('error',error=>{if(error.code!=='EPIPE')stderr+=error.message;});
  const done=new Promise((resolveDone,reject)=>{child.once('error',reject);child.once('close',status=>{children.delete(child);exited=true;resolveDone({status,stdout,stderr});});});
  const send=text=>{if(!exited&&!child.stdin.destroyed)child.stdin.write(text+'\n');};
  const wait=async marker=>{const until=Date.now()+10000;while(!stdout.includes(marker)){if(exited||Date.now()>until)throw Error(`Owned session ${name} failed to reach ${marker}: ${stderr}`);await new Promise(resolveWait=>setTimeout(resolveWait,10));}};
  send(`${actorContext(actorId,role)} SET application_name='${name}'; SET statement_timeout='12s'; BEGIN ISOLATION LEVEL ${isolation};`);
  return{name,send,wait,done,finish(commit=true){send(commit?'COMMIT;':'ROLLBACK;');child.stdin.end();return done;}};
}
async function blocked(name){const until=Date.now()+5000;while(Date.now()<until){if(scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock'`)==='1')return;await new Promise(resolveWait=>setTimeout(resolveWait,10));}throw Error('Owned concurrent session did not block: '+name);}
try{
  run('initdb',['-D',data,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);started=true;
  run('pg_ctl',['-D',data,'-l',join(temp,'postgres.log'),'-o',`-c listen_addresses='' -k ${socket} -p ${port}`,'-w','start']);console.log(scalar('SELECT version()'));
  sql(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE billing_direct_member LOGIN IN ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
    CREATE TABLE projects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES auth.users(id),name text,archived boolean DEFAULT false,user_archived_at timestamptz,updated_at timestamptz DEFAULT now(),metadata jsonb);
    CREATE TABLE documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES auth.users(id),project_id uuid REFERENCES projects(id),name text,file_path text,file_size bigint,archived boolean DEFAULT false,user_archived_at timestamptz,updated_at timestamptz DEFAULT now(),annotations jsonb);
    CREATE TABLE project_status(project_id uuid PRIMARY KEY REFERENCES projects(id),is_active boolean DEFAULT true,metadata jsonb);
    CREATE TABLE project_collaborators(project_id uuid REFERENCES projects(id),user_id uuid REFERENCES auth.users(id),role text);
    CREATE TABLE document_collaborators(document_id uuid REFERENCES documents(id),user_id uuid REFERENCES auth.users(id),role text);
    CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb,bytes bytea,PRIMARY KEY(bucket_id,name));
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    -- Synthetic owner-only policies and byte fixtures isolate quota/billing SQL;
    -- no platform storage service, external provider, or sharing UI is emulated.
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY; ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_project_read ON projects FOR SELECT TO authenticated USING(user_id=auth.uid());
    CREATE POLICY fixture_project_update ON projects FOR UPDATE TO authenticated USING(user_id=auth.uid());
    CREATE POLICY "Users can create projects within limit" ON projects FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
    CREATE POLICY fixture_document_read ON documents FOR SELECT TO authenticated USING(user_id=auth.uid());
    CREATE POLICY fixture_document_update ON documents FOR UPDATE TO authenticated USING(user_id=auth.uid());
    CREATE POLICY "Users can upload documents within limits" ON documents FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
    GRANT SELECT,INSERT,UPDATE ON projects,documents TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON projects,documents,storage.objects TO service_role;`);
  apply('20241223000001_create_user_subscriptions.sql');
  sql('GRANT SELECT ON user_subscriptions TO service_role');
  for(const name of ['get_user_tier','get_project_limit','get_document_limit','get_storage_limit']){
    const body=source('20260215170000_fix_subscription_type_dependency.sql').match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$ LANGUAGE plpgsql SECURITY DEFINER;`))?.[0];assert.ok(body);sql(body);sql(`ALTER FUNCTION ${name}(uuid) SET search_path=public`);
  }
  sql(`ALTER FUNCTION handle_new_user_subscription() SET search_path=public; ALTER FUNCTION update_user_subscriptions_updated_at() SET search_path=public;
    CREATE FUNCTION get_actual_storage_usage(p_user_id uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT coalesce(sum((metadata->>'size')::bigint),0) FROM storage.objects WHERE bucket_id='documents' AND name LIKE p_user_id::text||'/%' $$;`);
  const storageBody=source('20260818010000_kal390_storage_quota_trigger.sql').match(/CREATE OR REPLACE FUNCTION public\.enforce_documents_storage_quota\(\)[\s\S]*?\n\$\$;/)?.[0];assert.ok(storageBody);sql(storageBody);
  sql('CREATE TRIGGER enforce_documents_storage_quota BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.enforce_documents_storage_quota()');
  for(const file of ['20260908130000_project_quota_guard.sql','20260908160000_document_quota_guard.sql','20260908161000_storage_quota_guard.sql'])apply(file);
  const policyBefore=scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p');
  const guardBefore=scalar(`SELECT jsonb_agg(pg_get_functiondef(oid) ORDER BY oid) FROM pg_proc WHERE oid IN ('survey_private.enforce_project_quota()'::regprocedure,'survey_private.enforce_document_quota()'::regprocedure,'public.enforce_documents_storage_quota()'::regprocedure)`);
  apply(migration);
  apply(reconciliationMigration);
  const atomicTables=[...fullTables,'survey_private.project_quota_guards','survey_private.document_quota_guards','survey_private.storage_quota_guards'];
  const a=actor(1,{projects:3,documents:7}),b=actor(2,{projects:2,documents:6});
  sql(`UPDATE projects SET user_archived_at='2025-01-01' WHERE id='${uuid(101)}'; UPDATE documents SET user_archived_at='2025-01-02' WHERE id='${uuid(1001)}';
    INSERT INTO project_status SELECT id,true,'{"keep":"status"}' FROM projects;
    INSERT INTO project_collaborators VALUES('${uuid(101)}','${b}','editor'); INSERT INTO document_collaborators VALUES('${uuid(1001)}','${b}','viewer')`);
  await check('all public billing RPCs deny client roles and direct-login members',()=>{
    const commands=[statement(1,expected(a),patch()),lookupStatement(1),claimStatement('evt_1',uuid(900)),completeStatement('evt_1',uuid(900),'message_1'),"SELECT public.read_billing_subscription_snapshot('cus_1')"];
    const before=snapshot();
    for(const role of ['anon','authenticated'])for(const command of commands)errorState(asRole(a,command,role,false),'42501');
    const args=[...psqlArgs];args[args.indexOf('-U')+1]='billing_direct_member';
    for(const command of commands)errorState(run('psql',[...args,'-c',command],false),'42501');
    sql(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated`);
    errorState(sql(`${actorContext(a,'authenticated')} SET request.jwt.claim.role='service_role'; ${commands[0]}`,false),'42501');
    sql(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated`);assert.deepEqual(snapshot(),before);
    for(const table of [receipt,outbox,heads])for(const role of ['anon','authenticated','service_role'])errorState(asRole(a,`SELECT * FROM ${table}`,role,false),'42501');
  });
  await check('an unbound customer read returns null and does not provision any subscription or private row',()=>{
    const before=snapshot(atomicTables);assert.equal(JSON.parse(asRole(null,"SELECT public.read_billing_subscription_snapshot('cus_unbound_fixture')").stdout||'null'),null);assert.deepEqual(snapshot(atomicTables),before);
  });
  await check('saved customer plus exact full snapshot permits the first paid subscription binding',()=>{
    const n=3,user=actor(n);sql(`UPDATE user_subscriptions SET tier='free',stripe_subscription_id=NULL,stripe_price_id=NULL WHERE user_id='${user}'`);
    const initial=expected(user),paid=patch({tier:'pro',stripe_subscription_id:'sub_3',stripe_price_id:'price_pro'});
    const stale={...initial,metadata:{stale:true}};assert.equal(result(n,stale,paid,'evt_initial_stale').outcome,'stale');
    assert.equal(expected(user).stripe_subscription_id,null);assert.equal(lookup(n,'evt_initial_stale'),null);
    const before=snapshot();errorState(asRole(null,statement(n,initial,paid,'evt_wrong_customer',{customer:'cus_wrong'}),'service_role',false),'22023');assert.deepEqual(snapshot(),before);
    const applied=result(n,initial,paid,'evt_initial_paid');assert.equal(applied.outcome,'applied');assert.equal(expected(user).stripe_subscription_id,'sub_3');assert.equal(expected(user).tier,'pro');
  });
  await check('first binding cannot start a free subscription or replace a newer linked paid subscription',()=>{
    const n=4,user=actor(n);sql(`UPDATE user_subscriptions SET stripe_subscription_id=NULL WHERE user_id='${user}'`);const initial=expected(user);
    const before=snapshot();errorState(asRole(null,statement(n,initial,patch({stripe_subscription_id:'sub_4'}),'evt_initial_free'),'service_role',false),'22023');assert.deepEqual(snapshot(),before);
    for(const status of ['incomplete','past_due']){
      errorState(asRole(null,statement(n,initial,patch({tier:'pro',status,stripe_subscription_id:'sub_4'}),`evt_initial_${status}`),'service_role',false),'22023');assert.deepEqual(snapshot(),before);
    }
    sql(`UPDATE user_subscriptions SET stripe_subscription_id='sub_new_4',stripe_price_id='price_new' WHERE user_id='${user}'`);
    const newer=snapshot();assert.equal(result(n,initial,patch({tier:'pro',stripe_subscription_id:'sub_4'}),'evt_initial_old').outcome,'stale');assert.deepEqual(snapshot(),newer);
  });
  await check('terminal events for old or null links save an ignored receipt without archives or notifications',()=>{
    for(const n of [5,6]){
      const user=actor(n,{projects:2,documents:6});sql(`UPDATE user_subscriptions SET stripe_subscription_id=${n===5?quote('sub_new_5'):'NULL'} WHERE user_id='${user}'`);
      const before=snapshot(fullTables.filter(table=>![receipt,outbox,heads].includes(table)));
      assert.equal(result(n,expected(user),null,`evt_terminal_${n}`,{type:'customer.subscription.deleted'}).outcome,'ignored');
      assert.deepEqual(snapshot(fullTables.filter(table=>![receipt,outbox,heads].includes(table))),before);
      assert.equal(scalar(`SELECT count(*) FROM ${receipt} WHERE event_id='evt_terminal_${n}'`),'1');
      assert.equal(claim(`evt_terminal_${n}`,uuid(900+n)).outcome,'none');
    }
  });
  await check('malformed notification or patch cannot publish partial state, receipt or outbox',()=>{
    const n=7,user=actor(n),before=snapshot(atomicTables),valid=notification('malformed_fixture');
    for(const value of [{...valid,extra:true},{...valid,template:'unknown-template'},{...valid,to:null},{...valid,data:[]},{...valid,key:''},[valid,valid,valid,valid]]){
      errorState(asRole(null,statement(n,expected(user),patch({stripe_subscription_id:'sub_7'}),'evt_bad_notice',{notification:value}),'service_role',false),'22023');assert.deepEqual(snapshot(atomicTables),before);
    }
    errorState(asRole(null,statement(n,expected(user),{...patch({stripe_subscription_id:'sub_7'}),metadata:{}},'evt_bad_patch'),'service_role',false),'22023');assert.deepEqual(snapshot(atomicTables),before);
    errorState(asRole(null,statement(n,expected(user),patch({stripe_subscription_id:'sub_7',cancel_at:'infinity'}),'evt_bad_time'),'service_role',false),'22023');assert.deepEqual(snapshot(atomicTables),before);
  });
  await check('subscription, exact receipt and notification insertion roll back together on outbox failure',()=>{
    const n=8,user=actor(n,{projects:3,documents:7});
    sql(`CREATE FUNCTION fixture_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture outbox failure'; END $$;
      CREATE TRIGGER fixture_outbox_failure BEFORE INSERT ON ${outbox} FOR EACH ROW EXECUTE FUNCTION fixture_outbox_failure()`);
    const before=snapshot(atomicTables);errorState(asRole(null,statement(n,expected(user),patch({stripe_subscription_id:'sub_8'}),'evt_atomic_notice',{notification:notification('atomic_notice')}),'service_role',false),'P0001');
    assert.deepEqual(snapshot(atomicTables),before);sql(`DROP TRIGGER fixture_outbox_failure ON ${outbox};DROP FUNCTION fixture_outbox_failure()`);
  });
  await check('free archive and notification commit preserve bytes, shares, user archives and the other actor',()=>{
    const preserved=['auth.users','storage.objects','project_status','project_collaborators','document_collaborators'];const before=snapshot(preserved),other=expected(b);
    const fields=()=>['projects','documents'].map(table=>scalar(`SELECT jsonb_agg(to_jsonb(t)-'archived' ORDER BY id) FROM ${table} t`));const oldFields=fields();
    const payload=notification('free_fixture',{template:'subscription-canceled'});
    const applied=result(1,expected(a),patch(),'evt_free',{notification:payload});assert.equal(applied.outcome,'applied');assert.equal(applied.projects_archived_count,2);assert.equal(applied.documents_archived_count,2);
    assert.deepEqual(snapshot(preserved),before);assert.deepEqual(fields(),oldFields);assert.deepEqual(expected(b),other);
    assert.equal(scalar(`SELECT count(*) FROM ${outbox} WHERE user_id='${a}'`),'1');
    assert.equal(lookup(1,'evt_free').outcome,'duplicate');
  });
  await check('no-op distinct event creates its receipt without issuing a subscription UPDATE',()=>{
    const before=expected(a);sql(`CREATE FUNCTION fixture_no_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${a}' THEN RAISE EXCEPTION 'unexpected UPDATE';END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_no_update BEFORE UPDATE ON user_subscriptions FOR EACH ROW EXECUTE FUNCTION fixture_no_update()`);
    const applied=result(1,before,patch(),'evt_noop');assert.equal(applied.outcome,'applied');assert.equal(applied.subscription_changed,false);assert.deepEqual(expected(a),before);
    assert.equal(lookup(1,'evt_noop').outcome,'duplicate');assert.equal(claim('evt_noop',uuid(950)).outcome,'none');
    sql('DROP TRIGGER fixture_no_update ON user_subscriptions;DROP FUNCTION fixture_no_update()');
  });
  await check('duplicate lookup survives unlink and later customer change but rejects changed signed binding',()=>{
    const terminal=patch({status:'canceled',stripe_subscription_id:null,stripe_price_id:null});
    assert.equal(result(1,expected(a),terminal,'evt_unlink',{type:'customer.subscription.deleted'}).outcome,'applied');
    sql(`UPDATE user_subscriptions SET stripe_customer_id='cus_new_1' WHERE user_id='${a}'`);const before=snapshot();
    assert.equal(lookup(1,'evt_unlink',{type:'customer.subscription.deleted'}).outcome,'duplicate');
    assert.equal(result(1,null,null,'evt_unlink',{type:'customer.subscription.deleted'}).outcome,'duplicate');assert.deepEqual(snapshot(),before);
    for(const overrides of [{digest:'b'.repeat(64)},{customer:'cus_wrong'},{subscription:'sub_wrong'},{type:'invoice.payment_failed'}])errorState(asRole(null,lookupStatement(1,'evt_unlink',{type:'customer.subscription.deleted',...overrides}),'service_role',false),'22023');
  });
  await check('same-user event race with one expected snapshot never overwrites the first event',async()=>{
    const n=9,user=actor(n),before=expected(user),first=session('reconcile-first'),second=session('reconcile-second');
    first.send(statement(n,before,patch({stripe_subscription_id:'sub_9'}),'evt_race_a',{notification:notification('race_a')})+";SELECT 'APPLIED';");await first.wait('APPLIED');
    second.send(statement(n,before,patch({tier:'pro',stripe_subscription_id:'sub_9'}),'evt_race_b',{notification:notification('race_b')})+';');await blocked(second.name);assert.equal((await first.finish()).status,0);
    const value=await second.finish();assert.equal(value.status,0,value.stderr);assert.match(value.stdout,/stale/);assert.equal(expected(user).tier,'free');
    assert.equal(lookup(n,'evt_race_b'),null);assert.equal(scalar(`SELECT count(*) FROM ${outbox} WHERE user_id='${user}'`),'1');
  });
  await check('a newer no-op event fences a delayed older provider result without updating subscription bytes',()=>{
    const n=14,user=actor(n),active=patch({tier:'pro',stripe_subscription_id:'sub_14',stripe_price_id:'price_pro'});
    result(n,expected(user),active,'evt_revision_setup');const delayed=expected(user),oldRevision=expectedRevisions.get(delayed);
    const newer=result(n,expected(user),active,'evt_newer_active');assert.equal(newer.subscription_changed,false);assert.deepEqual(expected(user),delayed);
    assert.notEqual(expectedRevisions.get(expected(user)),oldRevision);
    const before=snapshot();assert.equal(result(n,delayed,{...active,status:'past_due'},'evt_delayed_past_due').outcome,'stale');assert.deepEqual(snapshot(),before);assert.equal(lookup(n,'evt_delayed_past_due'),null);
    assert.equal(result(n,expected(user),active,'evt_delayed_past_due').outcome,'applied');assert.equal(expected(user).status,'active');
  });
  await check('one event freezes two notices and completes them in order without losing the second',()=>{
    const n=15,user=actor(n),notices=[notification('two_canceled',{template:'subscription-canceled'}),notification('two_paid')];
    result(n,expected(user),patch({stripe_subscription_id:'sub_15'}),'evt_two_notices',{notification:notices});
    assert.equal(scalar(`SELECT count(*) FROM ${outbox} WHERE user_id='${user}'`),'2');
    const first=claim('evt_two_notices',uuid(995));assert.equal(first.outcome,'claimed');assert.deepEqual(first.payload,notices[0]);complete('evt_two_notices',uuid(995),'message_first');
    const second=claim('evt_two_notices',uuid(996));assert.equal(second.outcome,'claimed');assert.deepEqual(second.payload,notices[1]);assert.notEqual(second.provider_key,first.provider_key);complete('evt_two_notices',uuid(996),'message_second');
    assert.equal(claim('evt_two_notices',uuid(997)).outcome,'sent');
  });
  await check('semantic notification dedupe freezes the first payload and supports a sibling event claim',()=>{
    const n=10,user=actor(n),firstPayload=notification('semantic_fixture'),same=patch({stripe_subscription_id:'sub_10'});
    result(n,expected(user),same,'evt_semantic_a',{notification:firstPayload});
    result(n,expected(user),same,'evt_semantic_b',{notification:notification('semantic_fixture',{subject:'Changed retry subject',data:{changed:true}})});
    assert.equal(scalar(`SELECT count(*) FROM ${outbox} WHERE user_id='${user}'`),'1');
    const value=claim('evt_semantic_b',uuid(960));assert.equal(value.outcome,'claimed');assert.deepEqual(value.payload,firstPayload);assert.ok(value.provider_key);
    assert.equal(claim('evt_semantic_a',uuid(961)).outcome,'busy');assert.equal(claim('evt_semantic_b',uuid(960)).outcome,'busy');
    errorState(asRole(null,completeStatement('evt_semantic_b',uuid(961),'message_wrong'),'service_role',false),'40001');
    assert.equal(complete('evt_semantic_b',uuid(960),'message_ok').outcome,'sent');const before=snapshot();
    assert.equal(complete('evt_semantic_a',uuid(960),'message_ok').outcome,'sent');assert.deepEqual(snapshot(),before);
    errorState(asRole(null,completeStatement('evt_semantic_b',uuid(960),'message_changed'),'service_role',false),'40001');assert.equal(claim('evt_semantic_b',uuid(962)).outcome,'sent');
  });
  await check('two concurrent claims have one winner and one busy reply',async()=>{
    const n=11,user=actor(n);result(n,expected(user),patch({stripe_subscription_id:'sub_11'}),'evt_claim_race',{notification:notification('claim_race')});
    const first=session('claim-first'),second=session('claim-second');first.send(claimStatement('evt_claim_race',uuid(970))+";SELECT 'CLAIMED';");await first.wait('CLAIMED');
    second.send(claimStatement('evt_claim_race',uuid(971))+";SELECT 'BUSY';");await second.wait('BUSY');const value=await second.finish();assert.equal(value.status,0,value.stderr);assert.match(value.stdout,/busy/);assert.equal((await first.finish()).status,0);
    assert.equal(complete('evt_claim_race',uuid(970),'message_race').outcome,'sent');
  });
  await check('expired lease retries within 25 minutes with stable payload/key and fences the old token',()=>{
    const n=12,user=actor(n);const payload=notification('retry_fixture');result(n,expected(user),patch({stripe_subscription_id:'sub_12'}),'evt_retry',{notification:payload});
    const first=claim('evt_retry',uuid(980));assert.equal(first.outcome,'claimed');
    sql(`UPDATE ${outbox} SET first_attempt_at=clock_timestamp()-interval '24 minutes',lease_expires_at=clock_timestamp()-interval '1 second' WHERE user_id='${user}'`);
    const retry=claim('evt_retry',uuid(981));assert.equal(retry.outcome,'claimed');assert.equal(retry.provider_key,first.provider_key);assert.deepEqual(retry.payload,payload);
    const deadline=Date.parse(retry.send_by);assert.ok(Number.isFinite(deadline)&&deadline>Date.now()&&deadline<=Date.now()+61_000,'retry deadline remains inside the original 25-minute provider-key window');
    errorState(asRole(null,completeStatement('evt_retry',uuid(980),'message_old'),'service_role',false),'40001');assert.equal(complete('evt_retry',uuid(981),'message_retry').outcome,'sent');
  });
  await check('uncertain sends older than 25 minutes require review and never receive a new automatic claim',()=>{
    const n=13,user=actor(n);result(n,expected(user),patch({stripe_subscription_id:'sub_13'}),'evt_review',{notification:notification('review_fixture')});claim('evt_review',uuid(990));
    sql(`UPDATE ${outbox} SET first_attempt_at=clock_timestamp()-interval '26 minutes',lease_expires_at=clock_timestamp()-interval '1 minute' WHERE user_id='${user}'`);
    assert.equal(claim('evt_review',uuid(991)).outcome,'needs_review');assert.equal(claim('evt_review',uuid(992)).outcome,'needs_review');
    errorState(asRole(null,completeStatement('evt_review',uuid(991),'message_no_claim'),'service_role',false),'40001');
    assert.equal(complete('evt_review',uuid(990),'message_late_confirmed').outcome,'sent');
  });
  await check('a retry with less than the send budget left is refused before the 25-minute cutoff',()=>{
    const n=18,user=actor(n);result(n,expected(user),patch({stripe_subscription_id:'sub_18'}),'evt_short_window',{notification:notification('short_window')});claim('evt_short_window',uuid(993));
    sql(`UPDATE ${outbox} SET first_attempt_at=clock_timestamp()-interval '24 minutes 40 seconds',lease_expires_at=clock_timestamp()-interval '1 minute' WHERE user_id='${user}'`);
    assert.equal(claim('evt_short_window',uuid(994)).outcome,'needs_review');
    assert.equal(scalar(`SELECT claim_token FROM ${outbox} WHERE user_id='${user}'`),uuid(993));
  });
  await check('identical semantic keys never share another actor notification or recipient',()=>{
    const user=actor(16),payload=notification('semantic_fixture',{to:'other-actor@example.invalid'});
    result(16,expected(user),patch({stripe_subscription_id:'sub_16'}),'evt_other_actor_notice',{notification:payload});
    const value=claim('evt_other_actor_notice',uuid(998));assert.equal(value.outcome,'claimed');assert.deepEqual(value.payload,payload);
    assert.equal(scalar(`SELECT count(*) FROM ${outbox} WHERE notification_key='semantic_fixture'`),'2');
  });
  // Real shared caller + real SQL RPCs. Only current-provider replies, Auth user
  // records and email delivery are synthetic; no HTTP/signature claim is made.
  const callerUser=actor(20,{projects:3,documents:7});
  sql(`UPDATE user_subscriptions SET tier='free',stripe_subscription_id=NULL,stripe_price_id=NULL WHERE user_id='${callerUser}'`);
  let providerReads=0,sends=[];
  let provider={id:'sub_20',customer:'cus_20',livemode:false,status:'active',metadata:{user_id:callerUser},
    current_period_start:1788220800,current_period_end:1790812800,trial_end:null,cancel_at:null,
    items:{has_more:false,data:[{price:{id:'price_pro',recurring:{interval:'month'}}}]}};
  const rpcNames=new Set(['read_billing_subscription_snapshot','lookup_billing_event','reconcile_billing_subscription_event','claim_billing_notification','complete_billing_notification']);
  const db={
    async rpc(name,args){
      assert.ok(rpcNames.has(name),name);
      const params=Object.entries(args).map(([key,value])=>{assert.match(key,/^p_[a-z_]+$/);return `${key} => ${value===null?'NULL':typeof value==='object'?json(value):quote(value)}`;});
      const response=asRole(null,`SELECT public.${name}(${params.join(',')})`,'service_role',false);
      return response.status===0?{data:JSON.parse(response.stdout||'null'),error:null}:{data:null,error:{code:response.stderr.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1]||'fixture_sql_error'}};
    },
    auth:{admin:{async getUserById(id){assert.equal(id,callerUser);return{data:{user:{id,email:'caller@example.invalid',user_metadata:{firstName:'Fixture'}}},error:null};}}},
  };
  const deps={db,prices:{monthly:'price_pro'},liveMode:false,sleep:async()=>{},
    stripe:{subscriptions:{async retrieve(id){assert.equal(id,'sub_20');providerReads++;return structuredClone(provider);}}},
    async send(payload,key){sends.push({payload,key});return `fixture_message_${sends.length}`;}};
  const checkout={id:'evt_caller_checkout',type:'checkout.session.completed',livemode:false,created:1788825600,
    data:{object:{id:'cs_fixture',mode:'subscription',subscription:'sub_20',customer:'cus_20',livemode:false,metadata:{user_id:callerUser}}}};
  const cancellation={id:'evt_caller_cancel',type:'customer.subscription.deleted',livemode:false,created:1788825700,
    data:{object:{id:'sub_20',customer:'cus_20',livemode:false,metadata:{user_id:callerUser}}}};
  await check('actual shared caller binds initial checkout through real snapshot/reconciliation RPCs',async()=>{
    const value=await reconcileBillingEvent(checkout,deps);assert.equal(value.outcome,'applied');assert.equal(expected(callerUser).stripe_subscription_id,'sub_20');assert.equal(expected(callerUser).tier,'pro');
    assert.equal(providerReads,1);assert.equal(sends.length,0);
  });
  await check('actual shared caller cancels, archives, claims and completes the frozen account notice',async()=>{
    provider={...provider,status:'canceled'};const value=await reconcileBillingEvent(cancellation,deps);assert.equal(value.outcome,'applied');
    assert.equal(expected(callerUser).stripe_subscription_id,null);assert.equal(expected(callerUser).tier,'free');assert.equal(value.projects_archived_count,2);assert.equal(value.documents_archived_count,2);
    assert.equal(sends.length,1);assert.equal(sends[0].payload.template,'subscription-canceled');assert.equal(sends[0].payload.to,'caller@example.invalid');
    assert.equal(scalar(`SELECT state FROM ${outbox} WHERE user_id='${callerUser}'`),'sent');
  });
  await check('actual shared caller duplicate after unlink/customer change does not fetch provider or send again',async()=>{
    sql(`UPDATE user_subscriptions SET stripe_customer_id='cus_after_caller' WHERE user_id='${callerUser}'`);const before=snapshot(),reads=providerReads;
    const value=await reconcileBillingEvent(cancellation,deps);assert.equal(value.outcome,'duplicate');assert.equal(providerReads,reads);assert.equal(sends.length,1);assert.deepEqual(snapshot(),before);
  });
  await check('migration replay keeps stored receipts, frozen payloads, quota bodies and policies unchanged',()=>{
    const before=snapshot();apply(reconciliationMigration);assert.deepEqual(snapshot(),before);
    assert.equal(scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p'),policyBefore);
    assert.equal(scalar(`SELECT jsonb_agg(pg_get_functiondef(oid) ORDER BY oid) FROM pg_proc WHERE oid IN ('survey_private.enforce_project_quota()'::regprocedure,'survey_private.enforce_document_quota()'::regprocedure,'public.enforce_documents_storage_quota()'::regprocedure)`),guardBefore);
  });
  console.log(`Billing reconciliation PostgreSQL checks passed: ${checks}`);
}finally{
  for(const child of children)child.kill('SIGKILL');
  if(started){if(run('pg_ctl',['-D',data,'status'],false).status===0)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);assert.equal(run('pg_ctl',['-D',data,'status'],false).status,3,'owned local server stopped before cleanup');}
  assert.ok(temp.startsWith('/tmp/survey-billing-reconciliation-')&&data===join(temp,'data'));rmSync(temp,{recursive:true,force:true});
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
