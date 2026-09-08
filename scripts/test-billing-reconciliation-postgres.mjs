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
  // Match current client RLS, not the original self-write policies. Explicit
  // table privileges let the test reach RLS instead of passing on a missing GRANT.
  apply('20260703010000_secure_user_subscriptions_rls.sql');
  sql('GRANT SELECT,INSERT,UPDATE ON user_subscriptions TO authenticated');
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
  // Existing pre-ledger bindings must receive immutable ownership receipts.
  sql(`INSERT INTO auth.users VALUES('${uuid(800)}'); UPDATE user_subscriptions SET stripe_customer_id='cus_LegacyBeforeMigration' WHERE user_id='${uuid(800)}'`);
  // Install the actual account and billing lifecycle guards before exercising
  // the existing webhook/revision/outbox cases. No provider or auth API runs.
  sql('CREATE TABLE templates(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),name text)');
  apply('20260908230000_account_storage_closing.sql');
  apply('20260909010000_billing_account_lifecycle.sql');
  const recoveryMigration='20260909020000_billing_operation_recovery.sql';apply(recoveryMigration);
  // Pre-reuse-migration history: the first exact customer was once bound and
  // cleared while a creation remained pending. The second creation succeeded
  // without a recorded bind. Neither history proves a never-bound customer.
  const legacyReuseScope={mode:'test',account:'platform',api_version:'2026-02-25.clover'};
  const legacyReuseSpec={email:'fixture@example.invalid'};
  for(const n of [801,802]){
    const user=actor(n);sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${user}'`);
    asRole(null,`SELECT public.begin_billing_operation('${uuid(18000+n)}','${user}','customer_create',${json(legacyReuseScope)},${json(legacyReuseSpec)},NULL)`);
    if(n===802)asRole(null,`SELECT public.settle_billing_operation('${uuid(18000+n)}','${user}','customer_create',${json(legacyReuseScope)},${json(legacyReuseSpec)},NULL,${json({outcome:'succeeded',customer_id:'cus_Untracked802',data:{id:'cus_Untracked802'}})})`);
  }
  const reuseMigration='20260909030000_billing_customer_reuse.sql';apply(reuseMigration);
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
  // Billing lifecycle contract: SQL receipts only. Provider outcomes below are
  // synthetic attestations; these tests never create or delete Stripe objects.
  const scope={mode:'test',account:'platform',api_version:'2026-02-25.clover'};
  const requestSpec={metadata:{purpose:'synthetic-local-fixture'}};
  const operation=(n,user,kind='customer_create',customer=null,overrides={})=>({id:uuid(10000+n),user,kind,customer,scope,requestSpec,...overrides});
  const operationArgs=o=>[quote(o.id),quote(o.user),quote(o.kind),json(o.scope),json(o.requestSpec),quote(o.customer)].join(',');
  const beginSql=o=>`SELECT public.begin_billing_operation(${operationArgs(o)})`;
  const begin=o=>JSON.parse(asRole(null,beginSql(o)).stdout);
  const startCreate=o=>{
    const prior=scalar(`SELECT stripe_customer_id FROM user_subscriptions WHERE user_id=${quote(o.user)}`);
    sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id=${quote(o.user)}`);
    const value=begin(o);
    // A different already-admitted creator may win customer binding before
    // this pending creator returns. Closure must retain both exact customers.
    if(prior)sql(`UPDATE user_subscriptions SET stripe_customer_id=${quote(prior)} WHERE user_id=${quote(o.user)}`);
    return value;
  };
  const settleSql=(o,value)=>`SELECT public.settle_billing_operation(${operationArgs(o)},${json(value)})`;
  const settle=(o,value)=>JSON.parse(asRole(null,settleSql(o,value)).stdout);
  const closeSql=(user,providerScope=scope)=>`SELECT public.begin_billing_account_closure(${quote(user)},${json(providerScope)})`;
  const closeBilling=user=>JSON.parse(asRole(null,closeSql(user)).stdout);
  const cleanupSql=(user,limit=100)=>`SELECT public.claim_billing_customer_cleanup(${quote(user)},${limit})`;
  const cleanup=(user,limit=100)=>JSON.parse(asRole(null,cleanupSql(user,limit)).stdout);
  const ackSql=(user,customer,providerScope=scope)=>`SELECT public.ack_billing_customer_cleanup(${quote(user)},${json(providerScope)},${quote(customer)})`;
  const ack=(user,customer,providerScope=scope)=>JSON.parse(asRole(null,ackSql(user,customer,providerScope)).stdout);
  const readClosure=user=>JSON.parse(asRole(null,`SELECT public.read_billing_account_closure(${quote(user)})`).stdout);
  const succeeded=customer=>({outcome:'succeeded',customer_id:customer,data:{id:'synthetic-provider-result'}});
  // Historic successful but unbound creations predate reuse disposition. Seed
  // only their exact saved metadata for cleanup pagination, not new admission.
  const seedSettledCustomerHistory=(o,customer)=>sql(`INSERT INTO survey_private.billing_operations(operation_id,user_id,kind,provider_scope,request_spec,expected_customer_id,state,result) VALUES(${operationArgs(o)},'settled',${json(succeeded(customer))});SELECT survey_private.register_billing_customer_owner('${o.user}',${quote(customer)});INSERT INTO survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id) VALUES('${o.user}',${json(o.scope)},${quote(customer)})`);
  const failed={outcome:'failed',customer_id:null,data:{code:'synthetic-confirmed-no-create'}};
  const rejects=command=>assert.notEqual(asRole(null,command,'service_role',false).status,0,command);
  let lifecycleChecks=0;
  const lifecycleCheck=async(label,work)=>{await check('LIFECYCLE '+label,work);lifecycleChecks++;};

  await lifecycleCheck('admission is single-use and exact replay never authorizes another provider call',()=>{
    const user=actor(50),o=operation(50,user);
    const admitted=startCreate(o);assert.equal(admitted.outcome,'admitted');
    assert.ok(Number.isFinite(Date.parse(admitted.admitted_at)));
    const replay=begin(o);assert.equal(replay.outcome,'pending');assert.equal(replay.admitted_at,admitted.admitted_at);
    for(const change of [{user:b},{kind:'portal_create'},{customer:'cus_changed'},{scope:{...scope,mode:'live'}},{requestSpec:{changed:true}}])rejects(beginSql({...o,...change}));
    settle(o,succeeded('cus_New50'));assert.equal(begin(o).outcome,'settled');
    rejects(beginSql({...o,requestSpec:{changed:true}}));rejects(settleSql(o,succeeded('cus_Other50')));
    const settled=settle(o,succeeded('cus_New50'));assert.equal(settled.outcome,'settled');assert.equal(settled.admitted_at,admitted.admitted_at);
  });
  await lifecycleCheck('closure preserves pending creation and late success becomes separate cleanup work',()=>{
    const user=actor(51),o=operation(51,user);startCreate(o);closeBilling(user);
    assert.equal(cleanup(user).complete,false);assert.deepEqual(cleanup(user).customers.map(c=>c.customer_id),['cus_51']);
    assert.equal(ack(user,'cus_51').complete,false);assert.equal(begin(o).state,'pending');rejects(beginSql(operation(510,user)));
    settle(o,succeeded('cus_Late51'));
    const page=cleanup(user);assert.equal(page.complete,false);
    assert.deepEqual(page.customers.map(c=>c.customer_id),['cus_Late51']);
    ack(user,'cus_51');assert.equal(readClosure(user).complete,false);
    ack(user,'cus_Late51');assert.equal(readClosure(user).complete,true);
    // Replaying a committed settlement cannot reopen a removed customer's job.
    settle(o,succeeded('cus_Late51'));assert.equal(cleanup(user).complete,true);
  });
  await lifecycleCheck('known-customer operations register before provider work and cannot change result binding',()=>{
    const user=actor(52),checkoutOp=operation(52,user,'checkout_create','cus_52');
    begin(checkoutOp);closeBilling(user);
    rejects(settleSql(checkoutOp,succeeded('cus_foreign')));
    assert.equal(readClosure(user).complete,false);
    settle(checkoutOp,succeeded('cus_52'));
    assert.deepEqual(cleanup(user).customers.map(c=>c.customer_id),['cus_52']);
    rejects(ackSql(user,'cus_foreign'));rejects(ackSql(user,'cus_52',{...scope,mode:'live'}));
    ack(user,'cus_52');assert.equal(readClosure(user).complete,true);
  });
  await lifecycleCheck('timeout is not a no-create receipt and confirmed failures cannot invent a customer',()=>{
    const user=actor(53),o=operation(53,user);startCreate(o);closeBilling(user);
    sql(`UPDATE survey_private.billing_operations SET admitted_at='2000-01-01' WHERE operation_id='${o.id}'`);
    assert.equal(begin(o).outcome,'pending'); // Time alone never renews admission.
    rejects(settleSql(o,{outcome:'timeout',customer_id:null,data:{}}));
    rejects(settleSql(o,{...failed,customer_id:'cus_unknown'}));
    rejects(settleSql(o,succeeded(null)));assert.equal(cleanup(user).complete,false);
    settle(o,failed);ack(user,'cus_53');assert.equal(readClosure(user).complete,true);
  });
  await lifecycleCheck('closure blocks changed binding but preserves real cancellation reconciliation and counters',()=>{
    const user=actor(54,{projects:2,documents:6});closeBilling(user);
    rejects(`UPDATE user_subscriptions SET stripe_customer_id='cus_replacement' WHERE user_id='${user}'`);
    // Owner-role writes reach the trigger as well, rather than failing only ACL.
    errorState(sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${user}'`,false),'23514');
    sql(`UPDATE user_subscriptions SET storage_used_bytes=999 WHERE user_id='${user}'`);
    const cancellationResult=result(54,expected(user),patch({status:'canceled',stripe_subscription_id:null,stripe_price_id:null}),'evt_lifecycle_cancel_54',{type:'customer.subscription.deleted'});
    assert.equal(cancellationResult.outcome,'applied');assert.equal(expected(user).tier,'free');
    assert.equal(expected(user).stripe_subscription_id,null);assert.equal(expected(user).stripe_customer_id,'cus_54');
    assert.equal(cancellationResult.projects_archived_count,1);assert.equal(cancellationResult.documents_archived_count,1);
  });
  await lifecycleCheck('permanent receipts survive direct auth removal and late settlement without reopening admission',()=>{
    const user=actor(55),o=operation(55,user);startCreate(o);closeBilling(user);
    // An admin can still bypass the application protocol; no auth-schema
    // trigger is installed. Its deletion must not erase unknown provider work.
    sql(`DELETE FROM auth.users WHERE id='${user}'`);
    settle(o,succeeded('cus_AfterAuth55'));
    assert.deepEqual(cleanup(user).customers.map(c=>c.customer_id).sort(),['cus_55','cus_AfterAuth55']);
    rejects(beginSql(operation(550,user)));ack(user,'cus_55');ack(user,'cus_AfterAuth55');
    assert.equal(readClosure(user).complete,true);
  });
  await lifecycleCheck('independent core closure denies new operations but does not pretend billing is canceled',()=>{
    const user=actor(56),o=operation(56,user);startCreate(o);
    asRole(null,`SELECT public.delete_account_owned_rows('${user}')`);
    rejects(beginSql(operation(560,user)));assert.equal(readClosure(user).complete,false);
    settle(o,failed);closeBilling(user);assert.equal(cleanup(user).complete,false);
    ack(user,'cus_56');assert.equal(readClosure(user).complete,true);
  });
  await lifecycleCheck('client roles cannot read ledgers or call lifecycle service RPCs',()=>{
    const user=actor(57),o=operation(57,user);
    const commands=[beginSql(o),settleSql(o,failed),closeSql(user),cleanupSql(user),ackSql(user,'cus_57'),`SELECT public.read_billing_account_closure('${user}')`];
    for(const role of ['anon','authenticated'])for(const command of commands)errorState(asRole(user,command,role,false),'42501');
    rejects(beginSql(operation(570,uuid(999999))));
  });
  await lifecycleCheck('input validation rejects malformed scopes, specs, kind and page limits',()=>{
    const user=actor(58),o=operation(58,user);
    for(const scopeValue of [null,{},[],{...scope,mode:'unknown'},{...scope,extra:'bad'},{...scope,account:'cus_not_account'}])rejects(beginSql({...o,scope:scopeValue}));
    for(const spec of [null,[],{large:'x'.repeat(20000)}])rejects(beginSql({...o,requestSpec:spec}));
    rejects(beginSql({...o,kind:'unknown'}));rejects(beginSql({...o,kind:'portal_create'}));
    closeBilling(user);for(const limit of ['NULL',0,101,-1])rejects(cleanupSql(user,limit));
    rejects(closeSql(user,{...scope,mode:'live'}));
  });
  await lifecycleCheck('concurrent admission permits one provider call and retry only reads its receipt',async()=>{
    const user=actor(59),o=operation(59,user,'checkout_create','cus_59');
    const first=session('lifecycle-first-admission');first.send(`${beginSql(o)}; SELECT 'admission-held';`);await first.wait('admission-held');
    errorState(asRole(null,beginSql(o),'service_role',false),'55P03');
    const firstResult=await first.finish();assert.equal(firstResult.status,0,firstResult.stderr);
    assert.match(firstResult.stdout,/"outcome": "admitted"/);assert.equal(begin(o).outcome,'pending');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.billing_operations WHERE operation_id='${o.id}'`),'1');
  });
  await lifecycleCheck('closure racing an admitted operation fails fast and retries as pending',async()=>{
    const user=actor(60),o=operation(60,user,'portal_create','cus_60');
    const first=session('lifecycle-admit-before-close');first.send(`${beginSql(o)}; SELECT 'admission-held';`);await first.wait('admission-held');
    errorState(asRole(null,closeSql(user),'service_role',false),'55P03');
    const done=await first.finish();assert.equal(done.status,0,done.stderr);
    assert.equal(closeBilling(user).complete,false);assert.deepEqual(cleanup(user).customers.map(c=>c.customer_id),['cus_60']);
    settle(o,succeeded('cus_60'));ack(user,'cus_60');assert.equal(readClosure(user).complete,true);
  });
  await lifecycleCheck('committing closure defeats both concurrent and later new admission',async()=>{
    const user=actor(61),o=operation(61,user,'checkout_create','cus_61');
    const closer=session('lifecycle-close-before-admit');closer.send(`${closeSql(user)}; SELECT 'closure-held';`);await closer.wait('closure-held');
    errorState(asRole(null,beginSql(o),'service_role',false),'55P03');
    const done=await closer.finish();assert.equal(done.status,0,done.stderr);
    errorState(asRole(null,beginSql(o),'service_role',false),'23514');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.billing_operations WHERE operation_id='${o.id}'`),'0');
  });
  await lifecycleCheck('rolled-back admission and closure leave no execution or cleanup receipt',async()=>{
    const user=actor(62),o=operation(62,user,'checkout_create','cus_62');
    const tx=session('lifecycle-rollback-admit');tx.send(`${beginSql(o)}; SELECT 'admission-held';`);await tx.wait('admission-held');await tx.finish(false);
    assert.equal(begin(o).outcome,'admitted');settle(o,succeeded('cus_62'));
    const closer=session('lifecycle-rollback-close');closer.send(`${closeSql(user)}; SELECT 'closure-held';`);await closer.wait('closure-held');await closer.finish(false);
    assert.equal(readClosure(user).closing,false);rejects(cleanupSql(user));
  });
  await lifecycleCheck('same transaction or savepoint cannot authorize provider cleanup before closure commits',()=>{
    for(const [n,savepoint] of [[63,false],[64,true]]){
      const user=actor(n);
      const prefix=`BEGIN; ${savepoint?'SAVEPOINT nested;':''} ${closeSql(user)}; ${savepoint?'RELEASE SAVEPOINT nested;':''}`;
      errorState(asRole(null,`${prefix} ${cleanupSql(user)}; COMMIT;`,'service_role',false),'23514');
      assert.equal(readClosure(user).closing,false);
      errorState(asRole(null,`${prefix} ${ackSql(user,`cus_${n}`)}; COMMIT;`,'service_role',false),'23514');
      assert.equal(readClosure(user).closing,false);closeBilling(user);ack(user,`cus_${n}`);assert.equal(readClosure(user).complete,true);
    }
    const user=actor(65);sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${user}'`);
    const receipt=asRole(null,`BEGIN; ${closeSql(user)}; COMMIT;`).stdout;
    assert.match(receipt,/"complete": false/);assert.equal(readClosure(user).complete,true);
  });
  await lifecycleCheck('repeatable-read and serializable lifecycle calls fail rather than trust stale snapshots',()=>{
    const user=actor(66),o=operation(66,user,'checkout_create','cus_66');
    for(const isolation of ['REPEATABLE READ','SERIALIZABLE']){
      errorState(asRole(null,`BEGIN ISOLATION LEVEL ${isolation}; ${beginSql(o)}; COMMIT;`,'service_role',false),'25001');
      errorState(asRole(null,`BEGIN ISOLATION LEVEL ${isolation}; ${closeSql(user)}; COMMIT;`,'service_role',false),'25001');
    }
  });
  await lifecycleCheck('subscription tuple then account lock uses NOWAIT rather than a reverse deadlock',async()=>{
    const user=actor(67),holder=session('lifecycle-account-lock','postgres');
    holder.send(`SELECT user_id FROM survey_private.account_write_guards WHERE user_id='${user}' FOR UPDATE; SELECT 'guard-held';`);await holder.wait('guard-held');
    errorState(sql(`UPDATE user_subscriptions SET stripe_customer_id='cus_New67' WHERE user_id='${user}'`,false),'55P03');
    const done=await holder.finish();assert.equal(done.status,0,done.stderr);
    assert.equal(expected(user).stripe_customer_id,'cus_67');
    sql(`UPDATE user_subscriptions SET stripe_customer_id='cus_New67' WHERE user_id='${user}'`);
    assert.equal(expected(user).stripe_customer_id,'cus_New67');
  });
  await lifecycleCheck('old customers cannot be transferred to another actor before or after cleanup claim',()=>{
    const user=actor(68),other=actor(69),o=operation(68,user,'checkout_create','cus_68');
    begin(o);settle(o,succeeded('cus_68'));
    sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${user}'`);
    assert.notEqual(sql(`UPDATE user_subscriptions SET stripe_customer_id='cus_68' WHERE user_id='${other}'`,false).status,0);
    closeBilling(user);assert.deepEqual(cleanup(user).customers.map(c=>c.customer_id),['cus_68']);
    assert.notEqual(sql(`UPDATE user_subscriptions SET stripe_customer_id='cus_68' WHERE user_id='${other}'`,false).status,0);
    ack(user,'cus_68');sql(`DELETE FROM auth.users WHERE id='${user}'`);
    assert.notEqual(sql(`UPDATE user_subscriptions SET stripe_customer_id='cus_68' WHERE user_id='${other}'`,false).status,0);
    assert.equal(expected(other).stripe_customer_id,'cus_69');
  });
  await lifecycleCheck('late customer results cannot claim another actor customer or erase pending work',()=>{
    const user=actor(70),other=actor(71),o=operation(70,user);startCreate(o);closeBilling(user);
    rejects(settleSql(o,succeeded('cus_71')));assert.equal(readClosure(user).complete,false);
    settle(o,succeeded('cus_New70'));assert.equal(expected(other).stripe_customer_id,'cus_71');
    assert.deepEqual(cleanup(user).customers.map(c=>c.customer_id).sort(),['cus_70','cus_New70']);
  });
  await lifecycleCheck('cleanup pages are bounded and acknowledgments do not mix provider modes',()=>{
    const user=actor(72);sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${user}'`);
    for(let n=0;n<6;n++){
      const o=operation(720+n,user,'customer_create',null,{scope:{...scope,mode:n%2?'live':'test'}});
      seedSettledCustomerHistory(o,`cus_Page${n}`);
    }
    closeBilling(user);const seen=new Set();
    for(let page=0;page<3;page++){
      const batch=cleanup(user,2);assert.equal(batch.customers.length,2);assert.equal(batch.complete,false);
      for(const customer of batch.customers){assert.ok(!seen.has(customer.customer_id));seen.add(customer.customer_id);ack(user,customer.customer_id,customer.provider_scope);}
    }
    assert.equal(seen.size,6);assert.equal(cleanup(user,2).complete,true);
  });
  await lifecycleCheck('role-claim spoofing and direct private-table access cannot bypass the body guard',()=>{
    const user=actor(73),o=operation(73,user,'checkout_create','cus_73');
    const signature='public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text)';
    sql(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated`);
    errorState(sql(`${actorContext(user,'authenticated')} SET request.jwt.claim.role='service_role'; ${beginSql(o)}`,false),'42501');
    sql(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated`);
    for(const role of ['anon','authenticated','service_role'])for(const table of ['billing_operations','billing_customer_cleanup','billing_account_lifecycles','billing_customer_owners']){
      errorState(asRole(user,`SELECT * FROM survey_private.${table}`,role,false),'42501');
    }
  });
  await lifecycleCheck('failed and lost cleanup pages advance fairly and recur in a later cycle',()=>{
    const user=actor(74);sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${user}'`);
    for(let n=0;n<6;n++){const o=operation(740+n,user);seedSettledCustomerHistory(o,`cus_Fair${n}`);}
    closeBilling(user);const pages=[];
    for(let n=0;n<4;n++){
      const value=cleanup(user,2);assert.equal(value.complete,false);assert.equal(value.has_pending_operations,false);
      assert.equal(value.has_pending_customers,true);assert.equal(value.customers.length,2);pages.push(value.customers.map(c=>c.customer_id));
    }
    assert.equal(new Set(pages.slice(0,3).flat()).size,6);assert.deepEqual(pages[3],pages[0]);
    for(const customer of pages.slice(0,3).flat())ack(user,customer);
    const empty=cleanup(user,2);assert.equal(empty.complete,true);assert.deepEqual(empty.customers,[]);
  });
  await lifecycleCheck('pre-migration customer ownership survives clear and rejects later transfer',()=>{
    const user=uuid(800),other=actor(75);
    assert.equal(scalar(`SELECT user_id FROM survey_private.billing_customer_owners WHERE customer_id='cus_LegacyBeforeMigration'`),user);
    sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${user}'`);
    assert.notEqual(sql(`UPDATE user_subscriptions SET stripe_customer_id='cus_LegacyBeforeMigration' WHERE user_id='${other}'`,false).status,0);
    assert.equal(expected(other).stripe_customer_id,'cus_75');
  });
  await lifecycleCheck('pending lookups use partial indexes without scanning retired receipt history',()=>{
    const user=actor(76);
    // Synthetic private history isolates access paths; it is not provider proof
    // and never authorizes cleanup of external objects.
    sql(`INSERT INTO survey_private.billing_operations(operation_id,user_id,kind,provider_scope,request_spec,state,result)
      SELECT md5('lifecycle-history-'||n)::uuid,'${user}','customer_create',${json(scope)},'{}','settled','{"outcome":"failed","customer_id":null,"data":{}}'
      FROM generate_series(1,50000) n;
      INSERT INTO survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id,removed)
      SELECT '${user}',${json(scope)},'cus_History'||n,true FROM generate_series(1,50000) n;
      INSERT INTO survey_private.billing_customer_owners(customer_id,user_id)
      SELECT 'cus_History'||n,'${user}' FROM generate_series(1,50000) n;
      ANALYZE survey_private.billing_operations; ANALYZE survey_private.billing_customer_cleanup;`);
    const queries=[
      [`SELECT 1 FROM survey_private.billing_operations WHERE user_id='${user}' AND state='pending' LIMIT 1`,'billing_operations_unresolved'],
      [`SELECT 1 FROM survey_private.billing_customer_cleanup WHERE user_id='${user}' AND NOT removed LIMIT 1`,'billing_customer_cleanup_pending'],
    ];
    const flatten=node=>[node,...(node.Plans||[]).flatMap(flatten)];
    for(const [query,index] of queries){
      const plan=JSON.parse(scalar(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`))[0].Plan;
      const nodes=flatten(plan),allowed=index==='billing_operations_unresolved'?[index,'billing_operations_pending_kind']:[index];const access=nodes.find(n=>allowed.includes(n['Index Name']));assert.ok(access,JSON.stringify(plan));
      assert.ok(access['Index Cond'].includes(user),JSON.stringify(plan));assert.ok(access['Actual Rows']<=1);
      assert.ok(nodes.every(n=>!(n['Rows Removed by Filter']>0)),JSON.stringify(plan));
      console.log(`PLAN lifecycle pending: ${access['Index Name']}; 50000 retired receipts excluded`);
    }
  });
  await lifecycleCheck('migration replay preserves all exact admitted and removed receipts',()=>{
    const tables=['survey_private.billing_operations','survey_private.billing_customer_cleanup','survey_private.billing_account_lifecycles','survey_private.billing_customer_owners'];
    // Digests avoid materializing the synthetic history as tool output.
    const compactSnapshot=()=>tables.map(table=>scalar(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM ${table} t`));
    const before=compactSnapshot();apply('20260909010000_billing_account_lifecycle.sql');apply(recoveryMigration);apply(reuseMigration);assert.deepEqual(compactSnapshot(),before);
    assert.equal(scalar(`SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid IN (${tables.map(t=>`${quote(t)}::regclass`).join(',')})`),'0');
  });
  await lifecycleCheck('conflicting historic customer ownership aborts migration replay atomically',()=>{
    const user=actor(77),other=actor(78);
    // Exact synthetic corrupt legacy receipt; no provider deletion occurs.
    sql(`INSERT INTO survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id,removed) VALUES('${other}',${json(scope)},'cus_77',true)`);
    const before=snapshot(['survey_private.billing_account_lifecycles']);
    const replay=run('psql',[...psqlArgs,'-f',join(root,'supabase/migrations/20260909010000_billing_account_lifecycle.sql')],false);
    errorState(replay,'23514');assert.deepEqual(snapshot(['survey_private.billing_account_lifecycles']),before);
    assert.equal(scalar(`SELECT user_id FROM survey_private.billing_customer_owners WHERE customer_id='cus_77'`),user);
    sql(`DELETE FROM survey_private.billing_customer_cleanup WHERE user_id='${other}' AND provider_scope=${json(scope)} AND customer_id='cus_77'`);
  });
  const readOperationSql=(user,id)=>`SELECT public.read_billing_operation(${quote(user)},${quote(id)})`;
  const readOperation=(user,id)=>JSON.parse(asRole(null,readOperationSql(user,id)).stdout||'null');
  const scanSql=(user,limit=20)=>`SELECT public.scan_pending_billing_operations(${quote(user)},${limit})`;
  const scan=(user,limit=20)=>JSON.parse(asRole(null,scanSql(user,limit)).stdout).operations;
  const rotateSql=(user,customer,id=null,providerScope=scope)=>`SELECT public.rotate_billing_customer(${quote(user)},${json(providerScope)},${quote(customer)},${quote(id)})`;
  const rotate=(user,customer,id=null,providerScope=scope)=>JSON.parse(asRole(null,rotateSql(user,customer,id,providerScope)).stdout);
  const operationsFor=user=>scalar(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY operation_id),'[]') FROM survey_private.billing_operations o WHERE user_id='${user}'`);
  // Pre-cap pending history is synthetic fixture input. New admission is now
  // limited per kind; recovery still must handle every older unresolved row.
  const seedPendingHistory=ops=>sql(ops.map(o=>`INSERT INTO survey_private.billing_operations(operation_id,user_id,kind,provider_scope,request_spec,expected_customer_id) VALUES(${operationArgs(o)});${o.customer?`SELECT survey_private.register_billing_customer_owner(${quote(o.user)},${quote(o.customer)});INSERT INTO survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id) VALUES(${quote(o.user)},${json(o.scope)},${quote(o.customer)}) ON CONFLICT DO NOTHING;`:''}`).join('\n'));
  const advanceSql=(user,id,previous,next)=>`SELECT public.advance_billing_operation_recovery_cursor(${quote(user)},${quote(id)},${quote(previous)},${quote(next)})`;
  const advance=(user,id,previous,next)=>JSON.parse(asRole(null,advanceSql(user,id,previous,next)).stdout);
  let recoveryChecks=0;
  const recoveryCheck=async(label,work)=>{await check('RECOVERY '+label,work);recoveryChecks++;};
  await recoveryCheck('exact actor operation read retains full scope and never creates or admits work',()=>{
    const user=actor(90),other=actor(91),o=operation(9000,user,'checkout_create','cus_90',{scope:{...scope,account:'acct_Fixture'}});begin(o);
    const before=operationsFor(user),value=readOperation(user,o.id);assert.equal(value.operation_id,o.id);assert.equal(value.user_id,user);assert.deepEqual(value.provider_scope,o.scope);assert.deepEqual(value.request_spec,o.requestSpec);assert.equal(value.state,'pending');assert.equal(value.customer_removed,false);
    assert.equal(readOperation(other,o.id),null);assert.equal(readOperation(user,uuid(999999)),null);assert.equal(operationsFor(user),before);assert.equal(begin(o).outcome,'pending');
  });
  await recoveryCheck('pending pages advance on lost replies and preserve all unresolved receipts through wraparound',()=>{
    const user=actor(92),ops=Array.from({length:45},(_,n)=>operation(9200+n,user,'checkout_create','cus_92'));seedPendingHistory(ops);
    const before=operationsFor(user),pages=Array.from({length:4},()=>scan(user));assert.deepEqual(pages.map(p=>p.length),[20,20,5,20]);assert.deepEqual(pages[3],pages[0]);assert.equal(new Set(pages.slice(0,3).flat().map(o=>o.operation_id)).size,45);assert.equal(operationsFor(user),before);
    const cursor=scalar(`SELECT pending_operation_cursor FROM survey_private.billing_account_lifecycles WHERE user_id='${user}'`);
    errorState(asRole(null,`BEGIN;${scanSql(user)};SELECT 1/0;COMMIT`,'service_role',false),'22012');assert.equal(scalar(`SELECT pending_operation_cursor FROM survey_private.billing_account_lifecycles WHERE user_id='${user}'`),cursor);
  });
  await recoveryCheck('customer rotation uses exact CAS and a settled scoped creation while retaining the old customer',()=>{
    const user=actor(93),o=operation(9300,user);startCreate(o);settle(o,succeeded('cus_Rotated93'));const before=expected(user);
    assert.equal(rotate(user,'cus_stale',o.id).outcome,'stale');assert.deepEqual(expected(user),before);
    errorState(asRole(null,rotateSql(user,'cus_93',o.id,{...scope,mode:'live'}),'service_role',false),'22023');assert.deepEqual(expected(user),before);
    assert.deepEqual(rotate(user,'cus_93',o.id),{outcome:'applied',customer_id:'cus_Rotated93'});assert.equal(expected(user).stripe_customer_id,'cus_Rotated93');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.billing_customer_cleanup WHERE user_id='${user}' AND provider_scope=${json(scope)} AND customer_id IN ('cus_93','cus_Rotated93')`),'2');
    assert.equal(scalar(`SELECT user_id FROM survey_private.billing_customer_owners WHERE customer_id='cus_93'`),user);
    assert.equal(rotate(user,'cus_93',o.id).outcome,'stale');const unchanged=expected(user);assert.equal(rotate(user,'cus_Rotated93',o.id).outcome,'applied');assert.deepEqual(expected(user),unchanged);
    assert.deepEqual(rotate(user,'cus_Rotated93'),{outcome:'applied',customer_id:null});assert.equal(scalar(`SELECT stripe_customer_id IS NULL FROM user_subscriptions WHERE user_id='${user}'`),'t');
  });
  await recoveryCheck('rotation refuses foreign pending wrong-kind removed and closed candidates without changing bindings',()=>{
    const user=actor(94),other=actor(95),foreign=operation(9500,other),pending=operation(9400,user),known=operation(9401,user,'portal_create','cus_94');startCreate(foreign);settle(foreign,succeeded('cus_Foreign95'));startCreate(pending);begin(known);settle(known,succeeded('cus_94'));
    const before=expected(user);for(const id of [foreign.id,pending.id,known.id,uuid(999991)])errorState(asRole(null,rotateSql(user,'cus_94',id),'service_role',false),'22023');assert.deepEqual(expected(user),before);
    settle(pending,succeeded('cus_Removed94'));sql(`UPDATE survey_private.billing_customer_cleanup SET removed=true WHERE user_id='${user}' AND customer_id='cus_Removed94'`);errorState(asRole(null,rotateSql(user,'cus_94',pending.id),'service_role',false),'23514');assert.deepEqual(expected(user),before);
    closeBilling(user);assert.equal(rotate(user,'cus_94').outcome,'closing');assert.deepEqual(expected(user),before);sql(`DELETE FROM auth.users WHERE id='${user}'`);assert.equal(rotate(user,'cus_94').outcome,'stale');
  });
  await recoveryCheck('known deletion revokes only exact scope and customer while unknown creation remains pending',()=>{
    const user=actor(96),known=operation(9600,user,'checkout_create','cus_96'),portal=operation(9601,user,'portal_create','cus_96'),otherMode=operation(9602,user,'portal_create','cus_96',{scope:{...scope,mode:'live'}}),unknown=operation(9603,user);
    begin(known);begin(portal);seedPendingHistory([otherMode]);startCreate(unknown);closeBilling(user);
    const page=cleanup(user);assert.equal(page.has_pending_operations,true);assert.equal(page.customers.length,2);
    const status=ack(user,'cus_96');assert.equal(status.complete,false);assert.equal(status.has_pending_operations,true);assert.equal(status.has_pending_customer_operations,false);
    for(const o of [known,portal]){assert.equal(readOperation(user,o.id).result.outcome,'customer_removed');assert.equal(settle(o,succeeded('cus_96')).result.outcome,'customer_removed');assert.equal(begin(o).outcome,'settled');}
    assert.equal(readOperation(user,otherMode.id).state,'pending');assert.equal(readOperation(user,otherMode.id).customer_removed,false);assert.equal(readOperation(user,unknown.id).state,'pending');assert.equal(readOperation(user,unknown.id).customer_removed,false);
    ack(user,'cus_96',otherMode.scope);assert.equal(readClosure(user).complete,false);assert.deepEqual(cleanup(user).customers,[]);settle(unknown,failed);assert.equal(readClosure(user).complete,true);
  });
  await recoveryCheck('more than 100 known operations drain by bounded ACK and removed flags fence late results',()=>{
    const user=actor(97),ops=Array.from({length:205},(_,n)=>operation(9700+n,user,n%2?'portal_create':'checkout_create','cus_97')),unknown=operation(9990,user);seedPendingHistory(ops);startCreate(unknown);closeBilling(user);
    let status=ack(user,'cus_97');assert.equal(status.has_pending_customer_operations,true);assert.equal(status.complete,false);
    const settledCount=()=>Number(scalar(`SELECT count(*) FROM survey_private.billing_operations WHERE user_id='${user}' AND result->>'outcome'='customer_removed'`));assert.equal(settledCount(),100);
    const late=ops.at(-1);assert.equal(readOperation(user,late.id).state,'pending');assert.equal(readOperation(user,late.id).customer_removed,true);assert.ok(scan(user).filter(o=>o.kind!=='customer_create').every(o=>o.customer_removed));
    assert.equal(settle(late,succeeded('cus_97')).result.outcome,'customer_removed');assert.equal(settledCount(),101);
    status=ack(user,'cus_97');assert.equal(status.has_pending_customer_operations,true);assert.equal(settledCount(),201);status=ack(user,'cus_97');assert.equal(status.has_pending_customer_operations,false);assert.equal(settledCount(),205);
    assert.equal(status.complete,false);assert.equal(readOperation(user,unknown.id).state,'pending');assert.equal(ack(user,'cus_97').complete,false);settle(unknown,failed);assert.equal(readClosure(user).complete,true);
  });
  await recoveryCheck('recovery service ACL body checks input and isolation guards reject unauthorized calls',()=>{
    const user=actor(98),o=operation(14000,user,'checkout_create','cus_98');begin(o);
    const commands=[readOperationSql(user,o.id),scanSql(user),rotateSql(user,'cus_98')];for(const role of ['anon','authenticated'])for(const command of commands)errorState(asRole(user,command,role,false),'42501');
    const args=[...psqlArgs];args[args.indexOf('-U')+1]='billing_direct_member';for(const command of commands)errorState(run('psql',[...args,'-c',command],false),'42501');
    for(const [name,command] of [['read_billing_operation(uuid,uuid)',commands[0]],['scan_pending_billing_operations(uuid,integer)',commands[1]],['rotate_billing_customer(uuid,jsonb,text,uuid)',commands[2]]]){
      sql(`GRANT EXECUTE ON FUNCTION public.${name} TO authenticated`);errorState(sql(`${actorContext(user,'authenticated')} SET request.jwt.claim.role='service_role';${command}`,false),'42501');sql(`REVOKE EXECUTE ON FUNCTION public.${name} FROM authenticated`);
    }
    for(const limit of ['NULL',0,21,-1])errorState(asRole(null,scanSql(user,limit),'service_role',false),'22023');errorState(asRole(null,readOperationSql(user,null),'service_role',false),'22023');
    for(const isolation of ['REPEATABLE READ','SERIALIZABLE'])for(const command of commands)errorState(asRole(null,`BEGIN ISOLATION LEVEL ${isolation};${command};COMMIT`,'service_role',false),'25001');
  });
  await recoveryCheck('concurrent recovery scan and rotation respect lifecycle lock and rollback unchanged',async()=>{
    const user=actor(99),o=operation(14100,user,'checkout_create','cus_99');begin(o);const tx=session('recovery-cursor-held');tx.send(`${scanSql(user)};SELECT 'scan-held';`);await tx.wait('scan-held');
    errorState(asRole(null,scanSql(user),'service_role',false),'55P03');errorState(asRole(null,rotateSql(user,'cus_99'),'service_role',false),'55P03');await tx.finish(false);assert.equal(scalar(`SELECT pending_operation_cursor IS NULL FROM survey_private.billing_account_lifecycles WHERE user_id='${user}'`),'t');assert.equal(expected(user).stripe_customer_id,'cus_99');
  });
  await recoveryCheck('revocation failure rolls back customer removal and every selected operation',()=>{
    const user=actor(100),o=operation(10000,user,'checkout_create','cus_100');begin(o);closeBilling(user);
    sql(`CREATE FUNCTION fixture_suppress_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${user}' THEN RETURN NULL;END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_suppress_revocation BEFORE UPDATE ON survey_private.billing_operations FOR EACH ROW EXECUTE FUNCTION fixture_suppress_revocation()`);
    const before=operationsFor(user);errorState(asRole(null,ackSql(user,'cus_100'),'service_role',false),'40001');assert.equal(operationsFor(user),before);assert.equal(scalar(`SELECT removed FROM survey_private.billing_customer_cleanup WHERE user_id='${user}' AND customer_id='cus_100'`),'f');sql('DROP TRIGGER fixture_suppress_revocation ON survey_private.billing_operations;DROP FUNCTION fixture_suppress_revocation()');ack(user,'cus_100');assert.equal(readClosure(user).complete,true);
  });
  await recoveryCheck('recovery migration replay preserves prior function contracts and exact ledger and cursor bytes',()=>{
    const tables=['survey_private.billing_operations','survey_private.billing_customer_cleanup','survey_private.billing_account_lifecycles','survey_private.billing_customer_owners'];const compact=()=>tables.map(table=>scalar(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM ${table} t`));
    const before=compact(),policies=scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p');apply(recoveryMigration);apply(recoveryMigration);apply(reuseMigration);assert.deepEqual(compact(),before);assert.equal(scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p'),policies);
  });
  await recoveryCheck('per-operation recovery cursor uses exact CAS and never settles missing provider results',()=>{
    const user=actor(101),other=actor(102),o=operation(10100,user,'checkout_create','cus_101'),portal=operation(10101,user,'portal_create','cus_101'),unknown=operation(10102,user);begin(o);begin(portal);startCreate(unknown);
    assert.equal(advance(user,o.id,null,'cs_test_Page1').outcome,'advanced');assert.equal(readOperation(user,o.id).recovery_cursor,'cs_test_Page1');assert.equal(scan(user).find(v=>v.operation_id===o.id).recovery_cursor,'cs_test_Page1');
    assert.deepEqual(advance(user,o.id,null,'cs_test_Stale'),{outcome:'stale',state:'pending',recovery_cursor:'cs_test_Page1'});
    for(const args of [[other,o.id,null,'cs_test_Other'],[user,unknown.id,null,'cs_test_Page'],[user,o.id,'cs_test_Page1','evt_WrongKind'],[user,portal.id,null,'cs_test_WrongKind'],[user,o.id,'cs_test_Page1','arbitrary/path']])errorState(asRole(null,advanceSql(...args),'service_role',false),'22023');
    assert.equal(advance(user,o.id,'cs_test_Page1',null).outcome,'advanced');assert.equal(readOperation(user,o.id).state,'pending');assert.equal(begin(o).outcome,'pending');assert.equal(advance(user,portal.id,null,'evt_Page1').outcome,'advanced');
    const before=readOperation(user,o.id);errorState(asRole(null,`BEGIN;${advanceSql(user,o.id,null,'cs_test_Rollback')};SELECT 1/0;COMMIT`,'service_role',false),'22012');assert.deepEqual(readOperation(user,o.id),before);
    settle(o,succeeded('cus_101'));const settled=readOperation(user,o.id);assert.equal(advance(user,o.id,null,'cs_test_AfterSettled').outcome,'settled');assert.deepEqual(readOperation(user,o.id),settled);
    const command=advanceSql(user,portal.id,'evt_Page1',null),sig='public.advance_billing_operation_recovery_cursor(uuid,uuid,text,text)';for(const role of ['anon','authenticated'])errorState(asRole(user,command,role,false),'42501');sql(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated`);errorState(sql(`${actorContext(user,'authenticated')} SET request.jwt.claim.role='service_role';${command}`,false),'42501');sql(`REVOKE EXECUTE ON FUNCTION ${sig} FROM authenticated`);
  });
  await recoveryCheck('pending page and known customer revocation queries seek partial indexes through retired history',()=>{
    const user=uuid(76);seedPendingHistory(Array.from({length:30},(_,n)=>operation(12000+n,user,'checkout_create','cus_76')));sql('ANALYZE survey_private.billing_operations');
    const queries=[
      [`SELECT * FROM survey_private.billing_operations WHERE user_id='${user}' AND state='pending' AND operation_id>'${uuid(22000)}' ORDER BY operation_id LIMIT 20`,'billing_operations_unresolved',20],
      [`SELECT operation_id FROM survey_private.billing_operations WHERE user_id='${user}' AND provider_scope=${json(scope)} AND expected_customer_id='cus_76' AND state='pending' AND kind IN ('checkout_create','portal_create') ORDER BY operation_id LIMIT 100 FOR UPDATE NOWAIT`,'billing_operations_pending_customer',100],
    ];const flatten=node=>[node,...(node.Plans||[]).flatMap(flatten)];
    for(const [query,index,limit] of queries){const plan=JSON.parse(scalar(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`))[0].Plan,nodes=flatten(plan),access=nodes.find(n=>n['Index Name']===index);assert.ok(access,JSON.stringify(plan));assert.ok(access['Actual Rows']<=limit);assert.ok(nodes.every(n=>!(n['Rows Removed by Filter']>0)),JSON.stringify(plan));console.log(`PLAN recovery pending: ${index}; rows=${access['Actual Rows']}; 50000 retired receipts excluded`);}
  });
  await recoveryCheck('distinct operation IDs race through one pending-per-kind admission and exact retry stays read-only',async()=>{
    const user=actor(103),first=operation(15000,user,'checkout_create','cus_103'),second=operation(15001,user,'checkout_create','cus_103'),portal=operation(15002,user,'portal_create','cus_103');
    const tx=session('recovery-distinct-admission');tx.send(`${beginSql(first)};SELECT 'first-admitted';`);await tx.wait('first-admitted');errorState(asRole(null,beginSql(second),'service_role',false),'55P03');assert.equal((await tx.finish()).status,0);
    const denied=asRole(null,beginSql(second),'service_role',false);errorState(denied,'40001');assert.match(denied.stderr,/BILLING_OPERATION_PENDING/);assert.equal(readOperation(user,second.id),null);assert.equal(begin(first).outcome,'pending');assert.equal(begin(portal).outcome,'admitted');
    sql(`UPDATE survey_private.billing_operations SET admitted_at='2000-01-01' WHERE operation_id='${first.id}'`);errorState(asRole(null,beginSql(second),'service_role',false),'40001');
    settle(first,succeeded('cus_103'));assert.equal(begin(first).outcome,'settled');assert.equal(begin(second).outcome,'admitted');assert.equal(scan(user).length,2);
    const creator=actor(104),unknown=operation(15003,creator),otherUnknown=operation(15004,creator);startCreate(unknown);sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${creator}'`);errorState(asRole(null,beginSql(otherUnknown),'service_role',false),'40001');settle(unknown,failed);assert.equal(begin(otherUnknown).outcome,'admitted');
  });
  const reuseSql=(user,providerScope=scope)=>`SELECT public.read_reusable_billing_customer(${quote(user)},${json(providerScope)})`;
  const reusable=(user,providerScope=scope)=>JSON.parse(asRole(null,reuseSql(user,providerScope)).stdout);
  const retireReuseSql=(user,id,customer,providerScope=scope)=>`SELECT public.retire_reusable_billing_customer(${quote(user)},${json(providerScope)},${quote(id)},${quote(customer)})`;
  const retireReuse=(user,id,customer,providerScope=scope)=>JSON.parse(asRole(null,retireReuseSql(user,id,customer,providerScope)).stdout);
  const freshCreation=(n,finish=true)=>{const user=actor(n);sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${user}'`);const o=operation(30000+n,user),customer=`cus_Reusable${n}`;begin(o);if(finish)settle(o,succeeded(customer));return{user,o,customer};};
  let reuseChecks=0;const reuseCheck=async(label,work)=>{await check('REUSE '+label,work);reuseChecks++;};
  await reuseCheck('settled creation survives crash before binding and blocks another creation indefinitely',()=>{
    const {user,o,customer}=freshCreation(200),candidate=reusable(user);assert.deepEqual(Object.keys(candidate).sort(),['customer_id','operation','outcome']);assert.equal(candidate.outcome,'candidate');assert.equal(candidate.customer_id,null);assert.equal(candidate.operation.operation_id,o.id);assert.equal(candidate.operation.customer_binding_state,'available');assert.equal(candidate.operation.result.customer_id,customer);assert.equal(scalar(`SELECT ever_bound FROM survey_private.billing_customer_owners WHERE customer_id='${customer}'`),'f');
    const before=operationsFor(user);assert.deepEqual(reusable(user),candidate);assert.equal(operationsFor(user),before);errorState(asRole(null,beginSql(operation(40000,user)),'service_role',false),'40001');assert.equal(begin(o).outcome,'settled');
    sql(`UPDATE survey_private.billing_operations SET admitted_at='2000-01-01' WHERE operation_id='${o.id}'`);assert.equal(reusable(user).outcome,'candidate');errorState(asRole(null,beginSql(operation(40001,user)),'service_role',false),'40001');
  });
  await reuseCheck('rotation atomically binds disposition and a lost reply cannot repeat customer creation',()=>{
    const {user,o,customer}=freshCreation(201);assert.equal(rotate(user,null,o.id).outcome,'applied');assert.equal(readOperation(user,o.id).customer_binding_state,'bound');assert.equal(scalar(`SELECT ever_bound FROM survey_private.billing_customer_owners WHERE customer_id='${customer}'`),'t');
    assert.deepEqual(reusable(user),{outcome:'bound',operation:null,customer_id:customer});assert.deepEqual(rotate(user,null,o.id),{outcome:'stale',customer_id:customer});const before=expected(user);assert.equal(rotate(user,customer,o.id).outcome,'applied');assert.deepEqual(expected(user),before);assert.equal(begin(o).outcome,'settled');
    assert.equal(rotate(user,customer).outcome,'applied');assert.deepEqual(reusable(user),{outcome:'none',operation:null,customer_id:null});errorState(asRole(null,rotateSql(user,null,o.id),'service_role',false),'23514');assert.equal(readOperation(user,o.id).customer_binding_state,'bound');
  });
  await reuseCheck('direct subscription bind and clear also make the creation permanently ineligible',()=>{
    const {user,o,customer}=freshCreation(202);sql(`UPDATE user_subscriptions SET stripe_customer_id='${customer}' WHERE user_id='${user}'`);assert.equal(readOperation(user,o.id).customer_binding_state,'bound');sql(`UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${user}'`);assert.equal(reusable(user).outcome,'none');errorState(asRole(null,rotateSql(user,null,o.id),'service_role',false),'23514');settle(o,succeeded(customer));assert.equal(readOperation(user,o.id).customer_binding_state,'bound');
  });
  await reuseCheck('historical owner facts and old pending results never become automatically reusable',()=>{
    const user=uuid(801),o=operation(8801,user,'customer_create',null,{requestSpec:legacyReuseSpec});o.id=uuid(18801);
    assert.equal(scalar("SELECT ever_bound FROM survey_private.billing_customer_owners WHERE customer_id='cus_801'"),'t');settle(o,succeeded('cus_801'));assert.equal(readOperation(user,o.id).customer_binding_state,'untracked');assert.equal(reusable(user).outcome,'review');errorState(asRole(null,rotateSql(user,null,o.id),'service_role',false),'23514');
    const old=uuid(802),value=reusable(old);assert.equal(value.outcome,'review');assert.equal(value.operation.customer_binding_state,'untracked');errorState(asRole(null,beginSql(operation(40002,old)),'service_role',false),'40001');
  });
  await reuseCheck('scope mismatch and missing provenance require review without scanning past the first candidate',()=>{
    const {user,o,customer}=freshCreation(203);assert.equal(reusable(user,{...scope,mode:'live'}).outcome,'review');assert.equal(reusable(actor(204)).outcome,'bound');
    sql(`DELETE FROM survey_private.billing_customer_cleanup WHERE user_id='${user}' AND customer_id='${customer}'`);assert.equal(reusable(user).outcome,'review');errorState(asRole(null,retireReuseSql(user,o.id,customer),'service_role',false),'23514');
    sql(`INSERT INTO survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id) VALUES('${user}',${json(scope)},'${customer}');UPDATE survey_private.billing_customer_owners SET ever_bound=true WHERE customer_id='${customer}'`);assert.equal(reusable(user).outcome,'review');
  });
  await reuseCheck('exact service-attested retirement is atomic idempotent and permits a later new creation',()=>{
    const {user,o,customer}=freshCreation(205);const before=operationsFor(user);for(const [id,key,providerScope] of [[uuid(49999),customer,scope],[o.id,'cus_Wrong',scope],[o.id,customer,{...scope,mode:'live'}]])errorState(asRole(null,retireReuseSql(user,id,key,providerScope),'service_role',false),'22023');assert.equal(operationsFor(user),before);
    assert.deepEqual(retireReuse(user,o.id,customer),{outcome:'retired',customer_id:customer});assert.equal(readOperation(user,o.id).customer_binding_state,'retired');assert.equal(scalar(`SELECT removed FROM survey_private.billing_customer_cleanup WHERE user_id='${user}' AND customer_id='${customer}'`),'t');assert.equal(retireReuse(user,o.id,customer).outcome,'retired');assert.equal(reusable(user).outcome,'none');errorState(sql(`UPDATE user_subscriptions SET stripe_customer_id='${customer}' WHERE user_id='${user}'`,false),'23514');assert.equal(begin(operation(40005,user)).outcome,'admitted');
    const bound=freshCreation(206);rotate(bound.user,null,bound.o.id);assert.equal(retireReuse(bound.user,bound.o.id,bound.customer).outcome,'stale');assert.equal(readOperation(bound.user,bound.o.id).customer_binding_state,'bound');assert.equal(scalar(`SELECT removed FROM survey_private.billing_customer_cleanup WHERE user_id='${bound.user}' AND customer_id='${bound.customer}'`),'f');
    // Existing removed-link fixture: clearing is allowed, reattachment is not.
    sql(`UPDATE survey_private.billing_customer_cleanup SET removed=true WHERE user_id='${bound.user}' AND customer_id='${bound.customer}';UPDATE user_subscriptions SET stripe_customer_id=NULL WHERE user_id='${bound.user}'`);assert.equal(reusable(bound.user).outcome,'none');errorState(sql(`UPDATE user_subscriptions SET stripe_customer_id='${bound.customer}' WHERE user_id='${bound.user}'`,false),'23514');
  });
  await reuseCheck('closure and auth deletion reject reuse while preserving every exact customer receipt',()=>{
    const {user,o,customer}=freshCreation(207);closeBilling(user);assert.equal(reusable(user).outcome,'closing');assert.equal(retireReuse(user,o.id,customer).outcome,'closing');assert.equal(rotate(user,null,o.id).outcome,'closing');assert.equal(readOperation(user,o.id).customer_binding_state,'available');sql(`DELETE FROM auth.users WHERE id='${user}'`);assert.equal(reusable(user).outcome,'closing');assert.equal(retireReuse(user,o.id,customer).outcome,'closing');assert.equal(readOperation(user,o.id).result.customer_id,customer);
  });
  await reuseCheck('reuse read serializes with rotation admission and closure then rejects stale decisions',async()=>{
    const {user,o,customer}=freshCreation(208),tx=session('reuse-read-held');tx.send(`${reuseSql(user)};SELECT 'reuse-held';`);await tx.wait('reuse-held');for(const command of [rotateSql(user,null,o.id),beginSql(operation(40008,user)),closeSql(user)])errorState(asRole(null,command,'service_role',false),'55P03');assert.equal((await tx.finish()).status,0);errorState(asRole(null,beginSql(operation(40008,user)),'service_role',false),'40001');assert.equal(rotate(user,null,o.id).customer_id,customer);
    const closed=freshCreation(209),closer=session('reuse-close-held');closer.send(`${closeSql(closed.user)};SELECT 'closed-held';`);await closer.wait('closed-held');errorState(asRole(null,reuseSql(closed.user),'service_role',false),'55P03');assert.equal((await closer.finish()).status,0);assert.equal(reusable(closed.user).outcome,'closing');
  });
  await reuseCheck('direct binding and reuse locks fail safely in both orders without stale candidates',async()=>{
    const {user,o,customer}=freshCreation(210),writer=session('reuse-direct-first','postgres');writer.send(`UPDATE user_subscriptions SET stripe_customer_id='${customer}' WHERE user_id='${user}';SELECT 'binding-held';`);await writer.wait('binding-held');errorState(asRole(null,reuseSql(user),'service_role',false),'55P03');assert.equal((await writer.finish()).status,0);assert.equal(reusable(user).outcome,'bound');assert.equal(readOperation(user,o.id).customer_binding_state,'bound');
    const second=freshCreation(211),reader=session('reuse-read-first');reader.send(`${reuseSql(second.user)};SELECT 'candidate-held';`);await reader.wait('candidate-held');const update=session('reuse-direct-second','postgres');update.send(`UPDATE user_subscriptions SET stripe_customer_id='${second.customer}' WHERE user_id='${second.user}';`);await blocked(update.name);assert.equal((await reader.finish()).status,0);assert.equal((await update.finish()).status,0);assert.equal(reusable(second.user).outcome,'bound');
  });
  await reuseCheck('suppressed binding and retirement updates roll back subscription owner fact and cleanup together',()=>{
    const {user,o,customer}=freshCreation(212);sql(`CREATE FUNCTION fixture_suppress_binding_state() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${user}' THEN RETURN NULL;END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_suppress_binding_state BEFORE UPDATE ON survey_private.billing_operations FOR EACH ROW EXECUTE FUNCTION fixture_suppress_binding_state()`);const before=operationsFor(user);
    errorState(asRole(null,rotateSql(user,null,o.id),'service_role',false),'40001');assert.equal(operationsFor(user),before);assert.equal(scalar(`SELECT stripe_customer_id IS NULL FROM user_subscriptions WHERE user_id='${user}'`),'t');assert.equal(scalar(`SELECT ever_bound FROM survey_private.billing_customer_owners WHERE customer_id='${customer}'`),'f');errorState(asRole(null,retireReuseSql(user,o.id,customer),'service_role',false),'40001');assert.equal(scalar(`SELECT removed FROM survey_private.billing_customer_cleanup WHERE user_id='${user}' AND customer_id='${customer}'`),'f');sql('DROP TRIGGER fixture_suppress_binding_state ON survey_private.billing_operations;DROP FUNCTION fixture_suppress_binding_state()');
  });
  await reuseCheck('reuse role input row and isolation guards reject malformed or foreign authority',()=>{
    const {user,o,customer}=freshCreation(213),other=actor(214),commands=[reuseSql(user),retireReuseSql(user,o.id,customer)];for(const role of ['anon','authenticated'])for(const command of commands)errorState(asRole(user,command,role,false),'42501');const args=[...psqlArgs];args[args.indexOf('-U')+1]='billing_direct_member';for(const command of commands)errorState(run('psql',[...args,'-c',command],false),'42501');
    for(const [signature,command] of [['read_reusable_billing_customer(uuid,jsonb)',commands[0]],['retire_reusable_billing_customer(uuid,jsonb,uuid,text)',commands[1]]]){sql(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`);errorState(sql(`${actorContext(user,'authenticated')} SET request.jwt.claim.role='service_role';${command}`,false),'42501');sql(`REVOKE EXECUTE ON FUNCTION public.${signature} FROM authenticated`);}
    errorState(asRole(null,retireReuseSql(other,o.id,customer),'service_role',false),'22023');errorState(asRole(null,reuseSql(user,{}),'service_role',false),'22023');for(const isolation of ['REPEATABLE READ','SERIALIZABLE'])for(const command of commands)errorState(asRole(null,`BEGIN ISOLATION LEVEL ${isolation};${command};COMMIT`,'service_role',false),'25001');errorState(sql(`UPDATE survey_private.billing_operations SET customer_binding_state='invalid' WHERE operation_id='${o.id}'`,false),'23514');
  });
  await reuseCheck('raw candidate lookup is indexed and bounded through fifty thousand retired successes',()=>{
    const {user,o}=freshCreation(215);sql(`INSERT INTO survey_private.billing_operations(operation_id,user_id,kind,provider_scope,request_spec,state,result,customer_binding_state) SELECT md5('retired-reuse-'||n)::uuid,'${user}','customer_create',${json(scope)},'{}','settled',jsonb_build_object('outcome','succeeded','customer_id','cus_Retired'||n,'data','{}'::jsonb),'retired' FROM generate_series(1,50000)n;ANALYZE survey_private.billing_operations`);
    const query=source(reuseMigration).match(/SELECT \* INTO candidate FROM survey_private\.billing_operations WHERE user_id=p_user_id[\s\S]*?LIMIT 1 FOR SHARE NOWAIT;/)?.[0];assert.ok(query);const exact=query.replace('INTO candidate ','').replace('p_user_id',quote(user));const plan=JSON.parse(scalar(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${exact}`))[0].Plan,flatten=node=>[node,...(node.Plans||[]).flatMap(flatten)],nodes=flatten(plan),access=nodes.find(n=>n['Index Name']==='billing_customer_reuse_candidates');assert.ok(access,JSON.stringify(plan));assert.equal(access['Actual Rows'],1);assert.ok(nodes.every(n=>!(n['Rows Removed by Filter']>0)),JSON.stringify(plan));assert.equal(reusable(user).operation.operation_id,o.id);console.log('PLAN reusable customer: billing_customer_reuse_candidates; one raw row; 50000 retired successes excluded');
  });
  await reuseCheck('migration replay preserves every disposition permanent fence and prior policy',()=>{
    const tables=['survey_private.billing_operations','survey_private.billing_customer_owners','survey_private.billing_customer_cleanup'];const compact=()=>tables.map(table=>scalar(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM ${table} t`));const before=compact(),policies=scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p');apply(reuseMigration);apply(reuseMigration);assert.deepEqual(compact(),before);assert.equal(scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p'),policies);
  });
  await reuseCheck('current subscription RLS blocks own client binding writes without touching private facts',()=>{
    const {user,o,customer}=freshCreation(216);const protectedState=()=>['public.user_subscriptions','survey_private.billing_customer_owners','survey_private.billing_operations'].map(table=>scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM ${table} t WHERE user_id='${user}'`));const before=protectedState();
    const updated=asRole(user,`WITH changed AS (UPDATE user_subscriptions SET stripe_customer_id='cus_ClientUpdate216' WHERE user_id='${user}' RETURNING id) SELECT count(*) FROM changed`,'authenticated');assert.equal(updated.stdout,'0');assert.deepEqual(protectedState(),before);
    errorState(asRole(user,`INSERT INTO user_subscriptions(user_id,stripe_customer_id) VALUES('${user}','cus_ClientInsert216')`,'authenticated',false),'42501');assert.deepEqual(protectedState(),before);
    assert.equal(scalar("SELECT count(*) FROM survey_private.billing_customer_owners WHERE customer_id IN ('cus_ClientUpdate216','cus_ClientInsert216')"),'0');
    assert.equal(rotate(user,null,o.id).outcome,'applied');assert.equal(reusable(user).customer_id,customer);assert.equal(readOperation(user,o.id).customer_binding_state,'bound');
  });
  console.log(`Billing reuse PostgreSQL checks passed: ${reuseChecks}`);
  console.log(`Billing recovery PostgreSQL checks passed: ${recoveryChecks}`);
  console.log(`Billing lifecycle PostgreSQL checks passed: ${lifecycleChecks}`);
  console.log(`Billing reconciliation PostgreSQL checks passed: ${checks}`);
}finally{
  for(const child of children)child.kill('SIGKILL');
  if(started){if(run('pg_ctl',['-D',data,'status'],false).status===0)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);assert.equal(run('pg_ctl',['-D',data,'status'],false).status,3,'owned local server stopped before cleanup');}
  assert.ok(temp.startsWith('/tmp/survey-billing-reconciliation-')&&data===join(temp,'data'));rmSync(temp,{recursive:true,force:true});
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
