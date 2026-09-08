// Installed local PostgreSQL only. The physical provider is an explicit stub;
// these checks do not claim to exercise S3 or the deployed Storage API.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
if(process.argv.length!==2)throw Error('This local fixture accepts no arguments.');
if(process.getuid?.()===0)throw Error('Run this disposable PostgreSQL fixture as a non-root user.');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
Object.assign(env,{LANG:'C',LC_ALL:'C'});
for(const command of ['initdb','pg_ctl','psql']){const result=spawnSync(command,['--version'],{env,encoding:'utf8'});if(result.error||result.status!==0)throw Error(`Installed ${command} is required; nothing was installed or contacted.`);}
const temp=mkdtempSync('/tmp/survey-account-closing-'),data=join(temp,'data'),socket=temp,port='6543';
const psqlArgs=['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq'];
let started=false,checks=0;const children=new Set();
function run(command,args,required=true){const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:20_000});if(required&&(result.error||result.status!==0))throw Error(result.error?.message||result.stderr||result.stdout);return{status:result.status,stdout:String(result.stdout||'').trim(),stderr:String(result.stderr||'').trim()};}
const sql=(statement,required=true)=>run('psql',[...psqlArgs,'-c',statement],required);
const scalar=statement=>sql(statement).stdout;
const source=file=>readFileSync(join(root,'supabase/migrations',file),'utf8');
const apply=file=>run('psql',[...psqlArgs,'-f',join(root,'supabase/migrations',file)]);
const uuid=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const quote=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const actorContext=(actor,role='authenticated')=>`SET ROLE ${role}; SET request.jwt.claim.sub=${quote(actor||'')}; SET request.jwt.claim.role=${quote(role)};`;
const asRole=(actor,statement,role='authenticated',required=true)=>sql(`${actorContext(actor,role)} ${statement}`,required);
const errorState=(value,state)=>{assert.notEqual(value.status,0,value.stdout);assert.match(value.stderr,new RegExp(`\\b${state}:`));};
const check=async(label,work)=>{await work();checks++;console.log(`PASS ${label}`);};
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
  // Minimal original DDL models auth/project cascade ownership and preserves
  // foreign document/annotation rows. Provider metadata is local fixture data.
  sql(`CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE ROLE storage_admin NOLOGIN BYPASSRLS;CREATE ROLE closing_member LOGIN IN ROLE authenticated;
    CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE TABLE projects(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,name text,archived boolean DEFAULT false,user_archived_at timestamptz,archive_group_id uuid,updated_at timestamptz DEFAULT now());
    CREATE TABLE templates(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,name text,archived boolean DEFAULT false,user_archived_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE documents(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,name text,file_path text,file_size bigint,archived boolean DEFAULT false,user_archived_at timestamptz,archive_group_id uuid,user_archive_expires_at timestamptz,user_archived_by uuid,annotations jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now());
    CREATE TABLE project_collaborators(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text,status text,PRIMARY KEY(project_id,user_id));
    CREATE TABLE document_collaborators(document_id uuid REFERENCES documents(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text,status text,PRIMARY KEY(document_id,user_id));
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL,name text NOT NULL,version text,metadata jsonb,updated_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role,storage_admin;
    GRANT ALL ON projects,templates,documents,project_collaborators,document_collaborators,storage.objects TO anon,authenticated,service_role,storage_admin;
    ALTER TABLE documents ENABLE ROW LEVEL SECURITY;ALTER TABLE projects ENABLE ROW LEVEL SECURITY;ALTER TABLE templates ENABLE ROW LEVEL SECURITY;ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_document_read ON documents FOR SELECT USING(true);CREATE POLICY fixture_document_update ON documents FOR UPDATE USING(true) WITH CHECK(true);CREATE POLICY fixture_document_delete ON documents FOR DELETE USING(true);
    CREATE POLICY "Users can upload documents within limits" ON documents FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
    CREATE POLICY fixture_projects ON projects FOR ALL USING(true) WITH CHECK(true);CREATE POLICY fixture_templates ON templates FOR ALL USING(true) WITH CHECK(true);CREATE POLICY fixture_storage ON storage.objects FOR ALL USING(true) WITH CHECK(true);
    -- Synthetic ample entitlement isolates account admission from tier changes.
    CREATE FUNCTION get_document_limit(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 100000 $$;
    CREATE FUNCTION get_storage_limit(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT 1000000000::bigint $$;
    CREATE FUNCTION get_actual_storage_usage(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;`);
  for(const migration of ['20260908160000_document_quota_guard.sql','20260908200000_document_identity_tombstones.sql','20260908201000_document_publication_authorization.sql','20260908220000_document_storage_retirement.sql'])apply(migration);
  const storageIndex=source('20260907213935_storage_lookup_and_function_hardening.sql').match(/CREATE INDEX IF NOT EXISTS idx_documents_file_path[^;]*;/)?.[0];assert.ok(storageIndex);sql(storageIndex);
  const user=n=>uuid(n),filePath=(actor,n)=>`${actor}/fixture-${n}.pdf`;
  const createUser=actor=>sql(`INSERT INTO auth.users VALUES('${actor}')`);
  const createProject=(id,actor)=>`INSERT INTO projects(id,user_id,name) VALUES('${uuid(id)}','${actor}','fixture project')`;
  const createTemplate=(id,actor)=>`INSERT INTO templates(id,user_id,name) VALUES('${uuid(id)}','${actor}','fixture template')`;
  const createDocument=(id,actor,project=null,path=filePath(actor,id))=>`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${uuid(id)}','${actor}',${quote(project)},'fixture document',${quote(path)},4)`;
  const upload=(path,bucket='documents')=>`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES(${quote(bucket)},${quote(path)},'v1','{"size":4,"etag":"fixture"}')`;
  const snapshot=(tables=['auth.users','projects','templates','documents','project_collaborators','document_collaborators','storage.objects'])=>tables.map(table=>scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t`));
  await check('BEFORE account admission fence: unseen upload paths can appear after the final cleanup page',()=>{
    const actor=user(1);createUser(actor);const existing=filePath(actor,1),late=filePath(actor,2);asRole(null,upload(existing),'storage_admin');
    assert.deepEqual(JSON.parse(scalar(`SELECT jsonb_agg(name) FROM storage.objects WHERE name LIKE '${actor}/%'`)),[existing]);
    asRole(null,`SELECT public.retire_document_storage_paths(ARRAY['${existing}'])`,'service_role');asRole(null,`DELETE FROM storage.objects WHERE name='${existing}'`,'storage_admin');
    asRole(null,upload(late),'storage_admin');assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name='${late}'`),'1');
  });
  const migration='20260908230000_account_storage_closing.sql';apply(migration);
  const scanMigration='20260909000000_account_storage_cleanup_scan.sql';apply(scanMigration);
  const guards='survey_private.account_write_guards',pathGuards='survey_private.document_storage_path_guards',queue='survey_private.document_storage_cleanup';
  const tables=['auth.users','projects','templates','documents','project_collaborators','document_collaborators','storage.objects',guards,pathGuards,queue,'survey_private.account_storage_cleanup_scans'];
  const allSnapshot=()=>snapshot(tables);
  const closeSql=actor=>`SELECT public.delete_account_owned_rows(${quote(actor)}::uuid)`;
  const close=actor=>asRole(null,closeSql(actor),'service_role');
  const isClosing=actor=>scalar(`SELECT closing FROM ${guards} WHERE user_id='${actor}'`);
  const retired=path=>JSON.parse(asRole(null,`SELECT public.retire_document_storage_paths(ARRAY[${quote(path)}])`,'service_role').stdout);
  const fixtureActor=n=>{const actor=user(n);createUser(actor);return actor;};
  await check('closure is service-only even for a forged service claim or direct authenticated member',()=>{
    const actor=fixtureActor(10),before=allSnapshot();for(const role of ['anon','authenticated','closing_member'])errorState(asRole(actor,closeSql(actor),role,false),'42501');
    errorState(sql(`${actorContext(actor)}SET request.jwt.claim.role='service_role';${closeSql(actor)}`,false),'42501');
    const args=[...psqlArgs];args[args.indexOf('-U')+1]='closing_member';errorState(run('psql',[...args,'-c',`SET request.jwt.claim.sub='${actor}';SET request.jwt.claim.role='service_role';${closeSql(actor)}`],false),'42501');
    for(const role of ['anon','authenticated','service_role'])errorState(asRole(actor,`SELECT * FROM ${guards}`,role,false),'42501');assert.deepEqual(allSnapshot(),before);
  });
  await check('null target is refused; missing UUID is permanently fenced and closure replay is idempotent',()=>{
    const before=allSnapshot();errorState(asRole(null,closeSql(null),'service_role',false),'22023');assert.deepEqual(allSnapshot(),before);
    const missing=user(999);close(missing);assert.equal(isClosing(missing),'t');const closed=allSnapshot();close(missing);assert.deepEqual(allSnapshot(),closed);
    errorState(asRole(null,upload(filePath(missing,1)),'storage_admin',false),'23514');
    const admin=fixtureActor(11);asRole(null,closeSql(admin),'postgres');assert.equal(isClosing(admin),'t');
  });
  await check('core purge closes first, preserves auth and bytes, and queues deleted owned document paths',()=>{
    const actor=fixtureActor(12),proj=uuid(1200),path=filePath(actor,1201);asRole(actor,createProject(1200,actor));asRole(actor,createDocument(1201,actor,proj,path));asRole(actor,createTemplate(1202,actor));asRole(null,upload(path),'storage_admin');
    const storageBefore=snapshot(['storage.objects']);close(actor);assert.equal(isClosing(actor),'t');assert.equal(scalar(`SELECT count(*) FROM auth.users WHERE id='${actor}'`),'1');
    for(const table of ['projects','templates','documents'])assert.equal(scalar(`SELECT count(*) FROM ${table} WHERE user_id='${actor}'`),'0');assert.deepEqual(snapshot(['storage.objects']),storageBefore);assert.equal(scalar(`SELECT count(*) FROM ${queue} WHERE path='${path}'`),'1');
    const before=allSnapshot();close(actor);assert.deepEqual(allSnapshot(),before);
  });
  await check('caller rollback undoes closure, row deletion and cleanup candidates together',()=>{
    const actor=fixtureActor(13);asRole(actor,createDocument(1300,actor));asRole(actor,createProject(1301,actor));asRole(actor,createTemplate(1302,actor));const before=allSnapshot();
    errorState(asRole(null,`BEGIN;${closeSql(actor)};SELECT 1/0;COMMIT`,'service_role',false),'22012');assert.deepEqual(allSnapshot(),before);assert.equal(isClosing(actor),'f');asRole(actor,createTemplate(1303,actor));
  });
  await check('suppressed guard update cannot falsely acknowledge closure or delete owned rows',()=>{
    const actor=fixtureActor(14);asRole(actor,createTemplate(1400,actor));
    sql(`CREATE FUNCTION fixture_suppress_closure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${actor}' AND NEW.closing THEN RETURN NULL;END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_suppress_closure BEFORE UPDATE ON ${guards} FOR EACH ROW EXECUTE FUNCTION fixture_suppress_closure()`);
    const before=allSnapshot();errorState(asRole(null,closeSql(actor),'service_role',false),'40001');assert.deepEqual(allSnapshot(),before);sql(`DROP TRIGGER fixture_suppress_closure ON ${guards};DROP FUNCTION fixture_suppress_closure()`);
  });
  await check('healthy writers share admission locks without rewriting an existing account guard',async()=>{
    const actor=fixtureActor(15);asRole(actor,createTemplate(1500,actor));const before=scalar(`SELECT xmin::text||':'||to_jsonb(g)::text FROM ${guards} g WHERE user_id='${actor}'`);
    const first=session('healthy-account-first','authenticated',actor);first.send(createTemplate(1501,actor)+";SELECT 'WRITTEN';");await first.wait('WRITTEN');
    const second=session('healthy-account-second','authenticated',actor);second.send(createTemplate(1502,actor)+";SELECT 'WRITTEN';");await second.wait('WRITTEN');assert.equal((await second.finish()).status,0);assert.equal((await first.finish()).status,0);
    assert.equal(scalar(`SELECT xmin::text||':'||to_jsonb(g)::text FROM ${guards} g WHERE user_id='${actor}'`),before);
  });
  const kinds=['document','project','template','storage'];
  const write=(kind,id,actor)=>kind==='document'?createDocument(id,actor):kind==='project'?createProject(id,actor):kind==='template'?createTemplate(id,actor):upload(filePath(actor,id));
  for(const [index,kind] of kinds.entries())await check(`${kind} write first makes closure wait and then sees the committed owned row`,async()=>{
    const actor=fixtureActor(20+index),id=2000+index;asRole(actor,createTemplate(2100+index,actor));
    const first=session('account-write-first-'+kind,kind==='storage'?'storage_admin':'authenticated',actor);first.send(write(kind,id,actor)+";SELECT 'WRITTEN';");await first.wait('WRITTEN');
    const second=session('account-close-second-'+kind);second.send(closeSql(actor)+';');await blocked(second.name);assert.equal((await first.finish()).status,0);assert.equal((await second.finish()).status,0);assert.equal(isClosing(actor),'t');
    if(kind==='storage')assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name='${filePath(actor,id)}'`),'1');else assert.equal(scalar(`SELECT count(*) FROM ${kind==='document'?'documents':kind==='project'?'projects':'templates'} WHERE id='${uuid(id)}'`),'0');
  });
  for(const [index,kind] of kinds.entries())await check(`closure first blocks late ${kind} publication even at an unseen path or ID`,async()=>{
    const actor=fixtureActor(30+index),id=3000+index;asRole(actor,createTemplate(3100+index,actor));
    const first=session('account-close-first-'+kind);first.send(closeSql(actor)+";SELECT 'CLOSED';");await first.wait('CLOSED');
    const second=session('account-write-second-'+kind,kind==='storage'?'storage_admin':'authenticated',actor);second.send(write(kind,id,actor)+';');await blocked(second.name);assert.equal((await first.finish()).status,0);const result=await second.finish();errorState(result,'23514');assert.match(result.stderr,/ACCOUNT_CLOSING/);
  });
  await check('closing projects detach every foreign child with archive state, markups and shares intact',()=>{
    const actor=fixtureActor(40),foreign=fixtureActor(41),sharedPath=filePath(actor,4000),proj=uuid(4000);asRole(actor,createProject(4000,actor));sql(`INSERT INTO project_collaborators VALUES('${proj}','${foreign}','editor','active')`);
    for(const id of [4001,4002,4003])asRole(foreign,createDocument(id,foreign,proj));asRole(null,createDocument(4004,foreign,proj,sharedPath),'service_role');asRole(actor,createDocument(4005,actor,proj,sharedPath));asRole(null,upload(sharedPath),'storage_admin');
    sql(`UPDATE documents SET archived=true WHERE id='${uuid(4002)}';UPDATE documents SET user_archived_at='2026-01-01',archive_group_id='${uuid(4040)}',user_archive_expires_at='2026-02-01',user_archived_by='${foreign}' WHERE id='${uuid(4003)}';UPDATE documents SET annotations='{"pending":"foreign fixture edit"}' WHERE user_id='${foreign}';INSERT INTO document_collaborators VALUES('${uuid(4001)}','${user(10)}','viewer','active')`);
    const before=scalar(`SELECT jsonb_agg(to_jsonb(d)-'project_id' ORDER BY id) FROM documents d WHERE user_id='${foreign}'`),shares=snapshot(['document_collaborators']);close(actor);
    assert.equal(scalar(`SELECT jsonb_agg(to_jsonb(d)-'project_id' ORDER BY id) FROM documents d WHERE user_id='${foreign}'`),before);assert.equal(scalar(`SELECT bool_and(project_id IS NULL) FROM documents WHERE user_id='${foreign}'`),'t');assert.deepEqual(snapshot(['document_collaborators']),shares);
    assert.deepEqual(retired(sharedPath),{retired_paths:[],referenced_paths:[sharedPath]});errorState(asRole(null,`DELETE FROM storage.objects WHERE name='${sharedPath}'`,'storage_admin',false),'23514');asRole(foreign,createDocument(4006,foreign));
  });
  await check('a locked foreign child makes closure fail atomically before project cascade',async()=>{
    const actor=fixtureActor(42),foreign=fixtureActor(43),proj=uuid(4200);asRole(actor,createProject(4200,actor));asRole(actor,createDocument(4201,actor,proj));asRole(null,createDocument(4202,foreign,proj),'service_role');asRole(actor,createTemplate(4203,actor));
    const first=session('foreign-child-locked');first.send(`SELECT id FROM documents WHERE id='${uuid(4202)}' FOR UPDATE;SELECT 'LOCKED';`);await first.wait('LOCKED');const before=allSnapshot();errorState(asRole(null,closeSql(actor),'service_role',false),'55P03');assert.deepEqual(allSnapshot(),before);assert.equal((await first.finish()).status,0);close(actor);assert.equal(scalar(`SELECT project_id IS NULL FROM documents WHERE id='${uuid(4202)}'`),'t');
  });
  for(const [index,table] of ['projects','documents','templates'].entries())await check(`locked owned ${table} rolls back the closing fence and every earlier delete`,async()=>{
    const actor=fixtureActor(80+index),id=8000+index;asRole(actor,createProject(id,actor));asRole(actor,createDocument(id,actor,uuid(id)));asRole(actor,createTemplate(id,actor));
    const first=session('owned-lock-'+table);first.send(`SELECT id FROM ${table} WHERE id='${uuid(id)}' FOR UPDATE;SELECT 'LOCKED';`);await first.wait('LOCKED');const before=allSnapshot();errorState(asRole(null,closeSql(actor),'service_role',false),'55P03');assert.deepEqual(allSnapshot(),before);assert.equal((await first.finish()).status,0);close(actor);assert.equal(isClosing(actor),'t');
  });
  await check('new shared attachment checks closing project owner even for a privileged writer',async()=>{
    const actor=fixtureActor(44),foreign=fixtureActor(45),proj=uuid(4400);asRole(actor,createProject(4400,actor));asRole(foreign,createDocument(4401,foreign));
    const first=session('closing-shared-project');first.send(closeSql(actor)+";SELECT 'CLOSED';");await first.wait('CLOSED');errorState(asRole(null,`UPDATE documents SET project_id='${proj}' WHERE id='${uuid(4401)}'`,'service_role',false),'55P03');assert.equal((await first.finish()).status,0);
    errorState(asRole(null,`UPDATE documents SET project_id='${proj}' WHERE id='${uuid(4401)}'`,'service_role',false),'23503');assert.equal(scalar(`SELECT project_id IS NULL FROM documents WHERE id='${uuid(4401)}'`),'t');
  });
  await check('foreign attachment first serializes closure and survives as a detached document',async()=>{
    const actor=fixtureActor(46),foreign=fixtureActor(47),proj=uuid(4600);asRole(actor,createProject(4600,actor));asRole(foreign,createDocument(4601,foreign));
    const first=session('shared-attach-first');first.send(`UPDATE documents SET project_id='${proj}' WHERE id='${uuid(4601)}';SELECT 'ATTACHED';`);await first.wait('ATTACHED');
    const second=session('shared-attach-close');second.send(closeSql(actor)+';');await blocked(second.name);assert.equal((await first.finish()).status,0);assert.equal((await second.finish()).status,0);assert.equal(scalar(`SELECT project_id IS NULL FROM documents WHERE id='${uuid(4601)}'`),'t');
  });
  await check('privileged metadata-only storage updates are fenced but retirement and removal still work',()=>{
    const actor=fixtureActor(50),path=filePath(actor,5000);asRole(null,upload(path),'storage_admin');close(actor);
    for(const role of ['authenticated','service_role','storage_admin','postgres']){errorState(asRole(actor,`UPDATE storage.objects SET metadata='{"size":5}' WHERE name='${path}'`,role,false),'23514');errorState(asRole(actor,upload(filePath(actor,5001)),role,false),'23514');}
    assert.deepEqual(retired(path),{retired_paths:[path],referenced_paths:[]});asRole(null,`DELETE FROM storage.objects WHERE name='${path}'`,'storage_admin');const answer=JSON.parse(asRole(null,`SELECT public.ack_document_storage_cleanup(ARRAY['${path}'])`,'service_role').stdout);assert.deepEqual(answer,{acknowledged_paths:[path],pending_paths:[]});
  });
  await check('permanent closure survives auth deletion and every UUID-prefix alias',()=>{
    const actor='7abcdef0-1234-4abc-8def-123456abcdef';createUser(actor);close(actor);sql(`DELETE FROM auth.users WHERE id='${actor}'`);assert.equal(isClosing(actor),'t');
    for(const prefix of [actor,actor.toUpperCase(),actor.replaceAll('-',''),`{${actor}}`])errorState(asRole(null,upload(`${prefix}/late.pdf`),'storage_admin',false),'23514');
    close(actor);assert.equal(isClosing(actor),'t');assert.equal(scalar(`SELECT count(*) FROM pg_constraint WHERE conrelid='${guards}'::regclass AND contype='f'`),'0');
  });
  await check('unrelated owners and non-account legacy namespaces keep existing write behavior',()=>{
    const actor=fixtureActor(51);asRole(actor,createProject(5100,actor));asRole(actor,createTemplate(5101,actor));asRole(actor,createDocument(5102,actor));asRole(null,upload(filePath(actor,5103)),'storage_admin');asRole(null,upload('legacy-unattributed/fixture.pdf'),'storage_admin');asRole(null,upload(`${user(50)}/non-document-bucket.pdf`,'other'),'storage_admin');assert.equal(isClosing(actor),'f');
  });
  await check('trusted cross-owner new and changed file references cannot bind a closing account path',()=>{
    const closing=fixtureActor(90),open=fixtureActor(91);asRole(open,createDocument(9000,open));close(closing);const before=allSnapshot();
    for(const statement of [createDocument(9001,open,null,filePath(closing,1)),`UPDATE documents SET file_path='${filePath(closing,2)}' WHERE id='${uuid(9000)}'`]){
      const result=asRole(null,statement,'service_role',false);errorState(result,'23514');assert.match(result.stderr,/ACCOUNT_CLOSING/);
    }
    assert.deepEqual(allSnapshot(),before);
  });
  await check('ownership transfers validate both old and new owners for documents, projects and templates',()=>{
    const closing=fixtureActor(92),open=fixtureActor(93);for(const actor of [closing,open]){const id=actor===closing?9200:9300;asRole(actor,createDocument(id,actor));asRole(actor,createProject(id,actor));asRole(actor,createTemplate(id,actor));}
    // Explicit branch fixture: leave rows while closing=true. A successful real
    // closure would delete these owned rows, so this is not a post-RPC state claim.
    sql(`UPDATE ${guards} SET closing=true WHERE user_id='${closing}'`);const before=allSnapshot();
    for(const table of ['documents','projects','templates'])for(const [id,newOwner] of [[9200,open],[9300,closing]]){
      const result=asRole(null,`UPDATE ${table} SET user_id='${newOwner}' WHERE id='${uuid(id)}'`,'service_role',false);errorState(result,'23514');assert.match(result.stderr,/ACCOUNT_CLOSING/);
    }
    assert.deepEqual(allSnapshot(),before);
  });
  await check('pure foreign detach does not wait on a closing owner, but identity, owner or path changes cannot use it',async()=>{
    const projectOwner=fixtureActor(94),foreign=fixtureActor(95),open=fixtureActor(96),proj=uuid(9400);asRole(projectOwner,createProject(9400,projectOwner));
    for(const id of [9500,9501,9502,9503])asRole(null,createDocument(id,foreign,proj),'service_role');
    // Explicit branch fixture holds the private closing flag with foreign rows
    // present. It tests lock bypass only, not reachability after successful purge.
    const first=session('pure-detach-owner-lock','postgres');first.send(`UPDATE ${guards} SET closing=true WHERE user_id='${foreign}';SELECT 'LOCKED';`);await first.wait('LOCKED');
    const before=scalar(`SELECT to_jsonb(d)-'project_id' FROM documents d WHERE id='${uuid(9500)}'`);
    const detach=session('pure-detach-no-wait');detach.send(`UPDATE documents SET project_id=NULL WHERE id='${uuid(9500)}';SELECT 'DETACHED';`);await detach.wait('DETACHED');assert.equal((await detach.finish()).status,0);assert.equal((await first.finish()).status,0);
    assert.equal(scalar(`SELECT to_jsonb(d)-'project_id' FROM documents d WHERE id='${uuid(9500)}'`),before);
    const allBefore=allSnapshot();for(const [id,patch] of [[9501,`id='${uuid(9511)}'`],[9502,`user_id='${open}'`],[9503,`file_path='${filePath(open,9513)}'`]]){
      const result=asRole(null,`UPDATE documents SET project_id=NULL,${patch} WHERE id='${uuid(id)}'`,'service_role',false);errorState(result,'23514');assert.match(result.stderr,/ACCOUNT_CLOSING/);
    }
    assert.deepEqual(allSnapshot(),allBefore);
  });
  await check('incoming Storage rename and bucket move reject a closing namespace after source retirement',()=>{
    const closing=fixtureActor(97),open=fixtureActor(98),source=filePath(open,9800),target=filePath(closing,9700);asRole(null,upload(source),'storage_admin');asRole(null,upload(target,'other'),'storage_admin');close(closing);retired(source);retired(target);
    const before=allSnapshot();for(const statement of [`UPDATE storage.objects SET name='${target}' WHERE bucket_id='documents' AND name='${source}'`,`UPDATE storage.objects SET bucket_id='documents' WHERE bucket_id='other' AND name='${target}'`]){
      const result=asRole(null,statement,'storage_admin',false);errorState(result,'23514');assert.match(result.stderr,/ACCOUNT_CLOSING/);
    }
    assert.deepEqual(allSnapshot(),before);
  });
  for(const [index,isolation] of ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'].entries())for(const existed of [false,true])await check(`${isolation} stale writer cannot bypass ${existed?'existing':'initially absent'} account fence`,async()=>{
    const actor=fixtureActor(60+index*2+Number(existed));if(existed)asRole(actor,createTemplate(6000+index*2+Number(existed),actor));
    const first=session('stale-account-'+index+'-'+existed,'storage_admin',null,isolation);first.send("SELECT count(*) FROM storage.objects;SELECT 'SNAPSHOT';");await first.wait('SNAPSHOT');
    const core=session('stale-core-'+index+'-'+existed,'authenticated',actor,isolation);core.send("SELECT count(*) FROM templates;SELECT 'SNAPSHOT';");await core.wait('SNAPSHOT');
    close(actor);first.send(upload(filePath(actor,1))+';');errorState(await first.finish(),index===0?'23514':'40001');core.send(createTemplate(6100+index*2+Number(existed),actor)+';');errorState(await core.finish(),index===0?'23514':'40001');assert.equal(isClosing(actor),'t');
  });
  for(const [index,isolation] of ['REPEATABLE READ','SERIALIZABLE'].entries())await check(`${isolation} closure is refused before any fence or row change`,async()=>{
    const actor=fixtureActor(70+index);asRole(actor,createTemplate(7000+index,actor));const first=session('old-close-'+index,'service_role',null,isolation);first.send("SELECT count(*) FROM templates;SELECT 'SNAPSHOT';");await first.wait('SNAPSHOT');asRole(actor,createTemplate(7010+index,actor));const before=allSnapshot();first.send(closeSql(actor)+';');errorState(await first.finish(),'25001');assert.deepEqual(allSnapshot(),before);close(actor);assert.equal(scalar(`SELECT count(*) FROM templates WHERE user_id='${actor}'`),'0');
  });
  await check('migration replay preserves closing fences, foreign data and pending cleanup exactly',()=>{
    const before=allSnapshot();apply(migration);apply(scanMigration);assert.deepEqual(allSnapshot(),before);
  });
  console.log(`Account storage closing PostgreSQL checks passed: ${checks}`);
}finally{
  for(const child of children)child.kill('SIGKILL');
  if(started){if(run('pg_ctl',['-D',data,'status'],false).status===0)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);assert.equal(run('pg_ctl',['-D',data,'status'],false).status,3,'owned local server stopped before cleanup');}
  assert.ok(temp.startsWith('/tmp/survey-account-closing-')&&data===join(temp,'data'));rmSync(temp,{recursive:true,force:true});
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
