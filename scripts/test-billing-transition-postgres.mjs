// Installed local PostgreSQL only: disposable data, private Unix socket, no TCP.
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const migration='20260908190000_atomic_billing_subscription_transition.sql';
if(process.argv.length!==2)throw Error('This local fixture accepts no arguments.');
if(process.getuid?.()===0)throw Error('Run this disposable PostgreSQL fixture as a non-root user.');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
Object.assign(env,{LANG:'C',LC_ALL:'C'});
for(const command of ['initdb','pg_ctl','psql']){const result=spawnSync(command,['--version'],{env,encoding:'utf8'});if(result.error||result.status!==0)throw Error(`Installed ${command} is required; nothing was installed or contacted.`);}
const temp=mkdtempSync('/tmp/survey-billing-transition-'),data=join(temp,'data'),socket=temp,port='6543';
const psqlArgs=['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq'];
let started=false,checks=0;const children=new Set();
function run(command,args,required=true){const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:20_000});if(required&&(result.error||result.status!==0))throw Error(result.error?.message||result.stderr||result.stdout);return{status:result.status,stdout:String(result.stdout||'').trim(),stderr:String(result.stderr||'').trim()};}
const sql=(statement,required=true)=>run('psql',[...psqlArgs,'-c',statement],required);
const scalar=statement=>sql(statement).stdout;
const source=file=>readFileSync(join(root,'supabase/migrations',file),'utf8');
const apply=file=>run('psql',[...psqlArgs,'-f',join(root,'supabase/migrations',file)]);
const uuid=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const quote=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${quote(JSON.stringify(value))}::jsonb`;
const digest='a'.repeat(64),eventType='customer.subscription.updated';
const signature='public.apply_billing_subscription_transition(uuid,text,text,jsonb,jsonb,text,text,text)';
const receipt='survey_private.billing_transition_receipts';
const actorContext=(actor,role='service_role')=>`SET ROLE ${role}; SET request.jwt.claim.sub=${quote(actor||'')}; SET request.jwt.claim.role=${quote(role)};`;
const asRole=(actor,statement,role='service_role',required=true)=>sql(`${actorContext(actor,role)} ${statement}`,required);
const expected=actor=>JSON.parse(scalar(`SELECT to_jsonb(s) FROM user_subscriptions s WHERE user_id='${actor}'`));
const patch=(overrides={})=>({tier:'free',status:'active',stripe_subscription_id:'sub_1',stripe_price_id:'price_free',trial_ends_at:null,current_period_start:'2026-09-01T00:00:00Z',current_period_end:'2026-10-01T00:00:00Z',cancel_at:null,...overrides});
const statement=(n,snapshot,update,evt=`evt_${n}`,overrides={})=>{
  const values={user:uuid(n),customer:`cus_${n}`,subscription:`sub_${n}`,snapshot,update,evt,type:eventType,digest,...overrides};
  return `SELECT public.apply_billing_subscription_transition(${quote(values.user)}::uuid,${quote(values.customer)},${quote(values.subscription)},${json(values.snapshot)},${json(values.update)},${quote(values.evt)},${quote(values.type)},${quote(values.digest)})`;
};
const result=(n,snapshot,update,evt,overrides)=>JSON.parse(asRole(null,statement(n,snapshot,update,evt,overrides)).stdout);
const fullTables=['auth.users','public.user_subscriptions','public.projects','public.documents','public.project_status','public.project_collaborators','public.document_collaborators','storage.objects',receipt];
const snapshot=(tables=fullTables)=>tables.map(table=>scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t`));
const errorState=(value,state)=>{assert.notEqual(value.status,0,value.stdout);assert.match(value.stderr,new RegExp(`\\b${state}:`));};
const check=async(label,work)=>{await work();checks++;console.log(`PASS ${label}`);};
function actor(n,{projects=0,documents=0}={}){
  const user=uuid(n);sql(`INSERT INTO auth.users VALUES('${user}'); UPDATE user_subscriptions SET tier='pro',status='active',stripe_customer_id='cus_${n}',stripe_subscription_id='sub_${n}',stripe_price_id='price_pro',metadata='{"keep":"fixture","cancel_at":"old"}',storage_used_bytes=23 WHERE user_id='${user}';`);
  if(projects)sql(`INSERT INTO projects(id,user_id,name,updated_at,metadata) SELECT ('30000000-0000-4000-8000-'||lpad((${n}*100+g)::text,12,'0'))::uuid,'${user}','project-'||g,'2026-01-01',jsonb_build_object('keep',g) FROM generate_series(1,${projects}) g`);
  if(documents)sql(`INSERT INTO documents(id,user_id,name,file_path,file_size,updated_at,annotations) SELECT ('30000000-0000-4000-8000-'||lpad((${n}*1000+g)::text,12,'0'))::uuid,'${user}','document-'||g,'${user}/fixture-'||g||'.pdf',10,'2026-01-01',jsonb_build_object('keep',g) FROM generate_series(1,${documents}) g;
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
  const a=actor(1,{projects:4,documents:8}),b=actor(2,{projects:2,documents:6});
  sql(`UPDATE projects SET user_archived_at='2025-01-01' WHERE id='${uuid(101)}'; UPDATE documents SET user_archived_at='2025-01-02' WHERE id='${uuid(1001)}';
    INSERT INTO project_status SELECT id,true,'{"keep":"status"}' FROM projects;
    INSERT INTO project_collaborators VALUES('${uuid(101)}','${b}','editor'); INSERT INTO document_collaborators VALUES('${uuid(1001)}','${b}','viewer');`);
  const initial=expected(a),free=patch();
  await check('API ACL denies anon/authenticated/direct-login member and forged service claim',()=>{
    const before=snapshot();for(const role of ['anon','authenticated'])errorState(asRole(a,statement(1,initial,free),role,false),'42501');
    const args=[...psqlArgs];args[args.indexOf('-U')+1]='billing_direct_member';errorState(run('psql',[...args,'-c',`SET request.jwt.claim.sub='${a}'; ${statement(1,initial,free)}`],false),'42501');
    // Exercise the body guard even if a future accidental grant exposes the RPC.
    sql(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated`);
    errorState(sql(`${actorContext(a,'authenticated')} SET request.jwt.claim.role='service_role'; ${statement(1,initial,free)}`,false),'42501');
    sql(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated`);assert.deepEqual(snapshot(),before);
    for(const role of ['anon','authenticated','service_role'])errorState(asRole(a,`SELECT * FROM ${receipt}`,role,false),'42501');
  });
  await check('full snapshot CAS rejects stale metadata, counter, timestamp and binding without publishing receipt',()=>{
    for(const field of ['metadata','storage_used_bytes','updated_at','id']){
      const stale={...initial,[field]:field==='metadata'?{other:true}:field==='storage_used_bytes'?999:field==='updated_at'?'2020-01-01T00:00:00Z':uuid(999)};
      const before=snapshot();assert.equal(result(1,stale,free,'evt_stale_'+field).outcome,'stale');assert.deepEqual(snapshot(),before);
    }
    for(const overrides of [{user:b},{customer:'cus_wrong'},{subscription:'sub_wrong'}]){const before=snapshot();errorState(asRole(null,statement(1,initial,free,'evt_binding',overrides),'service_role',false),'22023');assert.deepEqual(snapshot(),before);}
  });
  await check('patch allowlist, subscription unlink and finite timestamp guards reject atomically',()=>{
    const invalid=[{...free,metadata:{}},{...free,tier:null},{...free,stripe_subscription_id:'sub_foreign'},{...free,status:'canceled'},
      {...free,stripe_subscription_id:null},{...free,cancel_at:22},{...free,cancel_at:'infinity'},{...free,trial_ends_at:'-infinity'},
      {...free,current_period_start:'infinity'},{...free,current_period_end:'infinity'}];
    const missing={...free};delete missing.cancel_at;invalid.push(missing);
    for(const value of invalid){const before=snapshot();errorState(asRole(null,statement(1,initial,value),'service_role',false),'22023');assert.deepEqual(snapshot(),before);}
    for(const overrides of [{evt:'bad'},{digest:'A'.repeat(64)},{type:'unknown.event'}])errorState(asRole(null,statement(1,initial,free,undefined,overrides),'service_role',false),'22023');
  });
  const protectedBefore=snapshot(['auth.users','storage.objects','public.project_status','public.project_collaborators','public.document_collaborators']);
  const archiveFields=()=>['projects','documents'].map(table=>scalar(`SELECT jsonb_agg(to_jsonb(t)-'archived' ORDER BY id) FROM ${table} t`));
  const archivePreserved=archiveFields(),otherBefore=expected(b);
  await check('service applies plan, deterministic free caps 1/5 and receipt in one commit',()=>{
    const value=result(1,initial,free);assert.equal(value.outcome,'applied');assert.equal(value.projects_archived_count,3);assert.equal(value.documents_archived_count,3);
    assert.deepEqual(value.archived_project_ids,[uuid(101),uuid(102),uuid(103)]);assert.deepEqual(value.archived_document_ids,[uuid(1001),uuid(1002),uuid(1003)]);
    assert.equal(scalar(`SELECT count(*) FROM projects WHERE user_id='${a}' AND NOT archived`),'1');assert.equal(scalar(`SELECT count(*) FROM documents WHERE user_id='${a}' AND NOT archived`),'5');
    assert.equal(expected(a).tier,'free');assert.deepEqual(expected(a).metadata,{keep:'fixture'});assert.equal(expected(a).storage_used_bytes,23);
    assert.deepEqual(archiveFields(),archivePreserved);assert.deepEqual(snapshot(['auth.users','storage.objects','public.project_status','public.project_collaborators','public.document_collaborators']),protectedBefore);assert.deepEqual(expected(b),otherBefore);
  });
  await check('exact event replay never repeats updates or archives; changed receipt binding is rejected',()=>{
    const before=snapshot();assert.equal(result(1,null,null).outcome,'duplicate');assert.deepEqual(snapshot(),before);
    for(const overrides of [{user:b},{customer:'cus_wrong'},{subscription:'sub_wrong'},{digest:'b'.repeat(64)},{type:'invoice.payment_failed'}]){
      errorState(asRole(null,statement(1,initial,free,undefined,overrides),'service_role',false),'22023');assert.deepEqual(snapshot(),before);
    }
  });
  await check('upgrade preserves existing archives and replaces only cancellation metadata key',()=>{
    const before=archiveFields(),flags=scalar('SELECT jsonb_agg(archived ORDER BY id) FROM projects');
    const upgrade=patch({tier:'pro',stripe_price_id:'price_pro',cancel_at:'2026-10-01T03:00:00+03:00'});
    assert.equal(result(1,expected(a),upgrade,'evt_upgrade').outcome,'applied');
    assert.equal(scalar('SELECT jsonb_agg(archived ORDER BY id) FROM projects'),flags);assert.deepEqual(archiveFields(),before);
    assert.deepEqual(expected(a).metadata,{keep:'fixture',cancel_at:'2026-10-01T00:00:00+00:00'});
  });
  await check('subscription unlink is atomic and exact receipt replay succeeds after link is gone',()=>{
    const canceled=patch({tier:'free',status:'canceled',stripe_subscription_id:null,stripe_price_id:null,trial_ends_at:null});
    assert.equal(result(1,expected(a),canceled,'evt_unlink').outcome,'applied');assert.equal(expected(a).stripe_subscription_id,null);
    const before=snapshot();assert.equal(result(1,initial,canceled,'evt_unlink').outcome,'duplicate');assert.deepEqual(snapshot(),before);
    assert.equal(result(1,initial,free,'evt_after_unlink').outcome,'stale');assert.deepEqual(snapshot(),before);
  });
  await check('archive error rolls back tier/link/metadata/guard writes/receipt and every archive flag',()=>{
    const user=actor(3,{projects:3,documents:7}),original=expected(user);
    sql(`CREATE FUNCTION fixture_archive_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${user}' AND NEW.archived AND NOT OLD.archived THEN RAISE EXCEPTION 'fixture archive failure'; END IF;RETURN NEW;END $$;
      CREATE TRIGGER fixture_archive_failure BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION fixture_archive_failure()`);
    const before=snapshot([...fullTables,'survey_private.project_quota_guards','survey_private.document_quota_guards','survey_private.storage_quota_guards']);
    errorState(asRole(null,statement(3,original,patch({status:'canceled',stripe_subscription_id:null,stripe_price_id:null})),'service_role',false),'P0001');
    assert.deepEqual(snapshot([...fullTables,'survey_private.project_quota_guards','survey_private.document_quota_guards','survey_private.storage_quota_guards']),before);
    sql('DROP TRIGGER fixture_archive_failure ON documents; DROP FUNCTION fixture_archive_failure()');
    assert.equal(result(3,original,patch({stripe_subscription_id:'sub_3'})).outcome,'applied');
  });
  await check('postgres accepts the service boundary without JWT; non-object existing metadata is refused',()=>{
    const user=actor(4);const command=statement(4,expected(user),patch({stripe_subscription_id:'sub_4'}));assert.equal(JSON.parse(sql(command).stdout).outcome,'applied');
    sql(`UPDATE user_subscriptions SET metadata='[]' WHERE user_id='${user}'`);const before=snapshot();
    errorState(asRole(null,statement(4,expected(user),patch({stripe_subscription_id:'sub_4'}),'evt_bad_metadata'),'service_role',false),'22023');assert.deepEqual(snapshot(),before);
  });
  await check('a suppressed subscription UPDATE aborts archives and receipt instead of claiming success',()=>{
    const user=actor(5,{projects:2,documents:6});
    sql(`CREATE FUNCTION fixture_suppress_billing_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${user}' THEN RETURN NULL; END IF;RETURN NEW;END $$;
      CREATE TRIGGER fixture_suppress_billing_update BEFORE UPDATE ON user_subscriptions FOR EACH ROW EXECUTE FUNCTION fixture_suppress_billing_update()`);
    const before=snapshot([...fullTables,'survey_private.project_quota_guards','survey_private.document_quota_guards','survey_private.storage_quota_guards']);
    errorState(asRole(null,statement(5,expected(user),patch({stripe_subscription_id:'sub_5'})),'service_role',false),'40001');
    assert.deepEqual(snapshot([...fullTables,'survey_private.project_quota_guards','survey_private.document_quota_guards','survey_private.storage_quota_guards']),before);
    sql('DROP TRIGGER fixture_suppress_billing_update ON user_subscriptions; DROP FUNCTION fixture_suppress_billing_update()');
  });
  await check('a missing auth user returns stale without creating any guard or event receipt',()=>{
    const missing={...initial,user_id:uuid(999),stripe_customer_id:'cus_999',stripe_subscription_id:'sub_999'};
    const before=snapshot([...fullTables,'survey_private.project_quota_guards','survey_private.document_quota_guards','survey_private.storage_quota_guards']);
    assert.equal(result(999,missing,patch({stripe_subscription_id:'sub_999'})).outcome,'stale');
    assert.deepEqual(snapshot([...fullTables,'survey_private.project_quota_guards','survey_private.document_quota_guards','survey_private.storage_quota_guards']),before);
  });
  await check('an old request cannot overwrite a newer paid customer/subscription link',()=>{
    const n=6,user=actor(n,{projects:2,documents:6}),old=expected(user);
    sql(`UPDATE user_subscriptions SET stripe_customer_id='cus_new_6',stripe_subscription_id='sub_new_6',stripe_price_id='price_new',metadata='{"keep":"newer-paid"}' WHERE user_id='${user}'`);
    const before=snapshot();assert.equal(result(n,old,patch({stripe_subscription_id:'sub_6'}),'evt_old_link').outcome,'stale');
    assert.deepEqual(snapshot(),before);assert.equal(expected(user).tier,'pro');
  });
  await check('different event IDs racing from one snapshot cannot overwrite the first applied event',async()=>{
    const n=7,user=actor(n,{projects:2,documents:6}),before=expected(user);
    const first=session('different-event-first'),second=session('different-event-second');
    first.send(statement(n,before,patch({stripe_subscription_id:'sub_7'}),'evt_race_first')+"; SELECT 'APPLIED';");await first.wait('APPLIED');
    second.send(statement(n,before,patch({tier:'pro',stripe_subscription_id:'sub_7',stripe_price_id:'price_stale'}),'evt_race_second')+';');
    await blocked(second.name);assert.equal((await first.finish()).status,0);const value=await second.finish();
    assert.equal(value.status,0,value.stderr);assert.match(value.stdout,/stale/);assert.equal(expected(user).tier,'free');
    assert.equal(scalar(`SELECT count(*) FROM ${receipt} WHERE event_id IN ('evt_race_first','evt_race_second')`),'1');
    assert.equal(scalar(`SELECT count(*) FROM ${receipt} WHERE event_id='evt_race_second'`),'0');
  });
  await check('a distinct unchanged-state event saves its receipt and reconciles caps without any subscription UPDATE',()=>{
    const n=8,user=actor(n,{projects:2,documents:6}),same=patch({stripe_subscription_id:'sub_8'});
    assert.equal(result(n,expected(user),same,'evt_same_first').subscription_changed,true);
    const before=expected(user);
    // Synthetic service allocation simulates an excess row needing reconciliation.
    sql(`INSERT INTO projects(user_id,name) VALUES('${user}','late-service-allocation');
      CREATE FUNCTION fixture_forbid_unchanged_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${user}' THEN RAISE EXCEPTION 'unexpected subscription UPDATE'; END IF;RETURN NEW;END $$;
      CREATE TRIGGER fixture_forbid_unchanged_update BEFORE UPDATE ON user_subscriptions FOR EACH ROW EXECUTE FUNCTION fixture_forbid_unchanged_update()`);
    const value=result(n,before,same,'evt_same_second');assert.equal(value.outcome,'applied');assert.equal(value.subscription_changed,false);
    assert.deepEqual(expected(user),before);assert.equal(value.projects_archived_count,1);
    assert.equal(scalar(`SELECT count(*) FROM ${receipt} WHERE event_id='evt_same_second'`),'1');
    sql('DROP TRIGGER fixture_forbid_unchanged_update ON user_subscriptions; DROP FUNCTION fixture_forbid_unchanged_update()');
  });
  // Explicit transaction barriers, not timing guesses: the second connection
  // must wait on the real guard before the first is permitted to commit.
  for(const kind of ['project','document','storage'])await check(`billing-first ${kind} allocation waits and then sees the free cap`,async()=>{
    const n={project:10,document:11,storage:12}[kind],user=actor(n,{projects:1,documents:5});
    const before=expected(user),first=session('billing-first-'+kind);first.send(`${statement(n,before,patch({stripe_subscription_id:`sub_${n}`}))}; SELECT 'APPLIED';`);await first.wait('APPLIED');
    const second=session('allocation-second-'+kind,kind==='storage'?'service_role':'authenticated',user);
    const allocation=kind==='project'?`INSERT INTO projects(user_id,name) VALUES('${user}','blocked')`:kind==='document'?`INSERT INTO documents(user_id,name) VALUES('${user}','blocked')`:
      `INSERT INTO storage.objects(bucket_id,name,metadata,bytes) VALUES('documents','${user}/large.pdf','{"size":104857601}',decode('aa','hex'))`;
    second.send(allocation+';');await blocked(second.name);assert.equal((await first.finish()).status,0);
    errorState(await second.finish(),'42501');assert.equal(expected(user).tier,'free');
  });
  for(const kind of ['project','document','storage'])await check(`allocation-first ${kind} commits before billing and is retained or counted in the new cap`,async()=>{
    const n={project:30,document:31,storage:32}[kind],user=actor(n,{projects:1,documents:5}),before=expected(user);
    const first=session('allocation-first-'+kind,kind==='storage'?'service_role':'authenticated',user);
    const allocation=kind==='project'?`INSERT INTO projects(user_id,name) VALUES('${user}','allocated-first')`:kind==='document'?`INSERT INTO documents(user_id,name) VALUES('${user}','allocated-first')`:
      `INSERT INTO storage.objects(bucket_id,name,metadata,bytes) VALUES('documents','${user}/allocated-first.pdf','{"size":104857601}',decode('aa','hex'))`;
    first.send(allocation+"; SELECT 'ALLOCATED';");await first.wait('ALLOCATED');
    const second=session('billing-second-'+kind);second.send(statement(n,before,patch({stripe_subscription_id:`sub_${n}`}))+';');
    await blocked(second.name);assert.equal((await first.finish()).status,0);const value=await second.finish();
    assert.equal(value.status,0,value.stderr);assert.match(value.stdout,/applied/);assert.equal(expected(user).tier,'free');
    assert.equal(scalar(`SELECT count(*) FROM projects WHERE user_id='${user}' AND NOT archived`),'1');
    assert.equal(scalar(`SELECT count(*) FROM documents WHERE user_id='${user}' AND NOT archived`),'5');
    if(kind==='storage')assert.equal(scalar(`SELECT encode(bytes,'hex') FROM storage.objects WHERE name='${user}/allocated-first.pdf'`),'aa');
    else assert.equal(scalar(`SELECT count(*) FROM ${kind==='project'?'projects':'documents'} WHERE user_id='${user}' AND name='allocated-first'`),'1');
  });
  for(const isolation of ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'])await check(`${isolation} concurrent duplicate transition cannot repeat archive writes`,async()=>{
    const n={'READ COMMITTED':20,'REPEATABLE READ':21,SERIALIZABLE:22}[isolation],user=actor(n,{projects:2,documents:6}),before=expected(user);
    const first=session('delivery-first-'+n),second=session('delivery-second-'+n,'service_role',null,isolation);
    second.send('SELECT count(*) FROM user_subscriptions; SELECT \'SNAPSHOT\';');await second.wait('SNAPSHOT');
    const command=statement(n,before,patch({stripe_subscription_id:`sub_${n}`}));first.send(command+"; SELECT 'APPLIED';");await first.wait('APPLIED');
    second.send(command+';');await blocked(second.name);assert.equal((await first.finish()).status,0);const value=await second.finish();
    if(isolation==='READ COMMITTED'){assert.equal(value.status,0,value.stderr);assert.match(value.stdout,/duplicate/);}else errorState(value,'40001');
    assert.equal(scalar(`SELECT count(*) FROM ${receipt} WHERE event_id='evt_${n}'`),'1');assert.equal(scalar(`SELECT count(*) FROM projects WHERE user_id='${user}' AND NOT archived`),'1');
  });
  await check('migration replay preserves receipts/data, quota trigger bodies and every existing policy',()=>{
    const before=snapshot();apply(migration);assert.deepEqual(snapshot(),before);
    assert.equal(scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p'),policyBefore);
    assert.equal(scalar(`SELECT jsonb_agg(pg_get_functiondef(oid) ORDER BY oid) FROM pg_proc WHERE oid IN ('survey_private.enforce_project_quota()'::regprocedure,'survey_private.enforce_document_quota()'::regprocedure,'public.enforce_documents_storage_quota()'::regprocedure)`),guardBefore);
  });
  console.log(`Billing transition PostgreSQL checks passed: ${checks}`);
}finally{
  for(const child of children)child.kill('SIGKILL');
  if(started){if(run('pg_ctl',['-D',data,'status'],false).status===0)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);assert.equal(run('pg_ctl',['-D',data,'status'],false).status,3,'owned local server stopped before cleanup');}
  assert.ok(temp.startsWith('/tmp/survey-billing-transition-')&&data===join(temp,'data'));rmSync(temp,{recursive:true,force:true});
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
