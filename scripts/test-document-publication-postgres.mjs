// Installed local PostgreSQL only: disposable data, private Unix socket, no TCP.
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');

if(process.argv.length!==2)throw Error('This local fixture accepts no arguments.');
if(process.getuid?.()===0)throw Error('Run this disposable PostgreSQL fixture as a non-root user.');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
Object.assign(env,{LANG:'C',LC_ALL:'C'});
for(const command of ['initdb','pg_ctl','psql']){const result=spawnSync(command,['--version'],{env,encoding:'utf8'});if(result.error||result.status!==0)throw Error(`Installed ${command} is required; nothing was installed or contacted.`);}
const temp=mkdtempSync('/tmp/survey-document-publication-'),data=join(temp,'data'),socket=temp,port='6543';
const psqlArgs=['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq'];
let started=false,checks=0;const children=new Set();
function run(command,args,required=true){const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:20_000});if(required&&(result.error||result.status!==0))throw Error(result.error?.message||result.stderr||result.stdout);return{status:result.status,stdout:String(result.stdout||'').trim(),stderr:String(result.stderr||'').trim()};}
const sql=(statement,required=true)=>run('psql',[...psqlArgs,'-c',statement],required);
const scalar=statement=>sql(statement).stdout;
const source=file=>readFileSync(join(root,'supabase/migrations',file),'utf8');
const apply=file=>run('psql',[...psqlArgs,'-f',join(root,'supabase/migrations',file)]);
const uuid=n=>`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const quote=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${quote(JSON.stringify(value))}::jsonb`;
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
  // The original documents/projects DDL predates tracked migrations. These
  // minimal tables model its required columns and cascade FKs, not live data.
  sql(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE ROLE publication_member LOGIN IN ROLE authenticated;
    CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
    CREATE TABLE projects(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,name text,archived boolean DEFAULT false,user_archived_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE templates(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,name text);
    CREATE TABLE documents(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,name text,file_path text,file_size bigint,content_sha256 text,archived boolean DEFAULT false,user_archived_at timestamptz,updated_at timestamptz DEFAULT now(),annotations jsonb DEFAULT '{}');
    CREATE TABLE project_collaborators(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text,status text,PRIMARY KEY(project_id,user_id));
    CREATE TABLE document_collaborators(document_id uuid REFERENCES documents(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text,status text,PRIMARY KEY(document_id,user_id));
    CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb,bytes bytea,version text,PRIMARY KEY(bucket_id,name));
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY;ALTER TABLE documents ENABLE ROW LEVEL SECURITY;ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON projects,documents TO authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON project_collaborators,document_collaborators TO service_role;
    GRANT SELECT ON storage.objects TO authenticated;GRANT ALL ON storage.objects TO service_role;
    CREATE POLICY "Users can upload documents within limits" ON documents FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
    CREATE POLICY fixture_document_read ON documents FOR SELECT TO authenticated USING(user_id=auth.uid());
    ALTER TABLE documents ADD COLUMN archive_group_id uuid,ADD COLUMN user_archive_expires_at timestamptz,ADD COLUMN user_archived_by uuid;ALTER TABLE projects ADD COLUMN archive_group_id uuid;`);
  apply('20241223000001_create_user_subscriptions.sql');
  for(const name of ['get_user_tier','get_document_limit','get_storage_limit']){
    const body=source('20260215170000_fix_subscription_type_dependency.sql').match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$ LANGUAGE plpgsql SECURITY DEFINER;`))?.[0];assert.ok(body);sql(body);sql(`ALTER FUNCTION ${name}(uuid) SET search_path=public`);
  }
  sql(`CREATE FUNCTION get_actual_storage_usage(p_user_id uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT coalesce(sum((metadata->>'size')::bigint),0) FROM storage.objects WHERE bucket_id='documents' AND name LIKE p_user_id::text||'/%' $$`);
  for(const name of ['user_can_access_document','user_can_access_project']){
    const body=source('20260802000000_kal426_user_archive_foundation.sql').match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0];assert.ok(body);sql(body);
  }
  // Current sharing policy bodies, with a synthetic always-accessible project
  // status helper (status/quota swap is not under test in this fixture).
  sql(`CREATE FUNCTION is_project_accessible(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;DROP POLICY fixture_document_read ON documents;
    CREATE POLICY fixture_document_read ON documents FOR SELECT TO authenticated USING(public.user_can_access_document(id,'viewer'))`);
  for(const name of ['Users can view own projects','Users can update own projects','Users can delete own projects','Users can update own documents','Users can delete own documents']){
    const body=source('20260701120000_project_template_sharing.sql').match(new RegExp(`CREATE POLICY "${name}"[\\s\\S]*?;`))?.[0];assert.ok(body);sql(body);
  }
  apply('20260513003000_allow_collaborators_to_read_document_storage.sql');
  apply('20260703030000_codify_documents_bucket_write_policies.sql');
  apply('20260703020000_documents_file_path_immutable.sql');
  apply('20260908160000_document_quota_guard.sql');
  const purgeBody=source('20260802000000_kal426_user_archive_foundation.sql').match(/CREATE OR REPLACE FUNCTION public\.purge_archived_project\([\s\S]*?\n\$\$;/)?.[0];assert.ok(purgeBody);sql(purgeBody);
  const purgeReceiptMigration='20260908210000_project_purge_deleted_document_receipt.sql';apply(purgeReceiptMigration);
  const restoreBody=source('20260802000000_kal426_user_archive_foundation.sql').match(/CREATE OR REPLACE FUNCTION public\.restore_document\([\s\S]*?\n\$\$;/)?.[0];assert.ok(restoreBody);sql(restoreBody);
  const hashIndex=source('20260606120000_rebuild_yjs_source_of_truth.sql').match(/CREATE UNIQUE INDEX IF NOT EXISTS documents_user_project_sha_uidx[\s\S]*?;/)?.[0];assert.ok(hashIndex);sql(hashIndex);
  const owner=uuid(1),editor=uuid(2),viewer=uuid(3),other=uuid(4),project=uuid(100);
  sql(`INSERT INTO auth.users VALUES('${owner}'),('${editor}'),('${viewer}'),('${other}');UPDATE user_subscriptions SET tier='pro';
    INSERT INTO projects(id,user_id,name) VALUES('${project}','${owner}','Shared fixture');
    INSERT INTO project_collaborators VALUES('${project}','${editor}','editor','active'),('${project}','${viewer}','viewer','active');
    INSERT INTO storage.objects(bucket_id,name,metadata,bytes) VALUES('documents','${owner}/private.pdf','{"size":4}',decode('25504446','hex'))`);
  const insert=(id,actor=editor,proj=project,path=`${actor}/nested/fixture-${id}.pdf`,extra='')=>`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size${extra?',content_sha256':''}) VALUES('${id}','${actor}',${quote(proj)},'fixture',${quote(path)},4${extra?','+quote(extra):''})`;
  const snapshot=(tables=['projects','documents','project_collaborators','document_collaborators','storage.objects'])=>tables.map(table=>scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t`));
  await check('BEFORE guards: a deleted UUID can be inserted again',()=>{
    const id=uuid(200);asRole(editor,insert(id));asRole(editor,`DELETE FROM documents WHERE id='${id}'`);asRole(editor,insert(id));assert.equal(scalar(`SELECT count(*) FROM documents WHERE id='${id}'`),'1');sql(`DELETE FROM documents WHERE id='${id}'`);
  });
  await check('BEFORE guards: viewer can insert into a shared project and foreign path creates Storage read authority',()=>{
    asRole(viewer,insert(uuid(201),viewer));asRole(other,insert(uuid(202),other,null,`${owner}/private.pdf`));
    assert.equal(asRole(other,`SELECT encode(bytes,'hex') FROM storage.objects WHERE name='${owner}/private.pdf'`).stdout,'25504446');sql(`DELETE FROM documents WHERE id IN ('${uuid(201)}','${uuid(202)}')`);
  });
  const identityMigration='20260908200000_document_identity_tombstones.sql',authorizationMigration='20260908201000_document_publication_authorization.sql',storageMigration='20260908220000_document_storage_retirement.sql',accountMigration='20260908230000_account_storage_closing.sql';
  // Synthetic permissive baseline: prove the migration removes table grants
  // that would bypass row DELETE triggers, including inherited PUBLIC access.
  sql('GRANT TRUNCATE ON public.documents TO PUBLIC,anon,authenticated,service_role');
  assert.equal(scalar("SELECT bool_and(has_table_privilege(role_name,'public.documents','TRUNCATE')) FROM unnest(ARRAY['anon','authenticated','service_role','publication_member']) role_name"),'t');
  const policies=scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p');
  const before=snapshot();apply(identityMigration);apply(authorizationMigration);apply(storageMigration);apply(accountMigration);assert.deepEqual(snapshot(),before);
  const identities='survey_private.document_identity_guards';
  await check('application roles cannot TRUNCATE documents and bypass row tombstones',()=>{
    const before=snapshot(['documents',identities]);
    for(const role of ['anon','authenticated','service_role','publication_member']){
      assert.equal(scalar(`SELECT has_table_privilege('${role}','public.documents','TRUNCATE')`),'f');
      errorState(asRole(editor,'TRUNCATE public.documents CASCADE',role,false),'42501');
    }
    assert.deepEqual(snapshot(['documents',identities]),before);
  });
  await check('private identity storage retains only opaque fields, has no lifecycle FK and is not client-readable',()=>{
    assert.equal(scalar("SELECT string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='survey_private' AND table_name='document_identity_guards'"),'document_id,revision,deleted');
    assert.equal(scalar(`SELECT count(*) FROM pg_constraint WHERE conrelid='${identities}'::regclass AND contype='f'`),'0');
    for(const role of ['anon','authenticated','service_role'])errorState(asRole(editor,`SELECT * FROM ${identities}`,role,false),'42501');
  });
  await check('owner, editor and projectless own-folder files still insert, including legacy nested names',()=>{
    asRole(owner,insert(uuid(210),owner));asRole(editor,insert(uuid(211),editor,project,`${editor}/older folder/drawing one.PDF`));asRole(other,insert(uuid(212),other,null));
    assert.equal(scalar(`SELECT count(*) FROM documents WHERE id IN ('${uuid(210)}','${uuid(211)}','${uuid(212)}')`),'3');
  });
  await check('viewer, revoked member, outsider, missing project and archived projects cannot publish',()=>{
    for(const actor of [viewer,other])errorState(asRole(actor,insert(uuid(220),actor),'authenticated',false),'42501');
    sql(`UPDATE project_collaborators SET status='revoked' WHERE project_id='${project}' AND user_id='${editor}'`);errorState(asRole(editor,insert(uuid(221)),'authenticated',false),'42501');sql(`UPDATE project_collaborators SET status='active' WHERE project_id='${project}' AND user_id='${editor}'`);
    // The earlier account admission trigger now reports the missing destination
    // as a reference error; role/archive refusals below retain their 42501 gate.
    const beforeMissing=snapshot(['documents',identities,'survey_private.account_write_guards']);
    errorState(asRole(owner,insert(uuid(222),owner,uuid(999)),'authenticated',false),'23503');
    assert.deepEqual(snapshot(['documents',identities,'survey_private.account_write_guards']),beforeMissing);
    for(const field of ['archived','user_archived_at']){
      sql(`UPDATE projects SET ${field}=${field==='archived'?'true':"'2026-01-01'"} WHERE id='${project}'`);errorState(asRole(owner,insert(uuid(223),owner),'authenticated',false),'42501');sql(`UPDATE projects SET ${field}=${field==='archived'?'false':'NULL'} WHERE id='${project}'`);
    }
  });
  await check('foreign owner/path and unsafe path forms fail with no injected Storage access',()=>{
    errorState(asRole(editor,insert(uuid(230),owner),'authenticated',false),'42501');
    for(const path of [`${owner}/private.pdf`,`https://example.invalid/file.pdf`,`${editor}/a%2fb.pdf`,`${editor}/a?b.pdf`,`${editor}/a\\b.pdf`,`${editor}/../a.pdf`,`${editor}/./a.pdf`,`${editor}/a\nb.pdf`])errorState(asRole(editor,insert(uuid(231),editor,null,path),'authenticated',false),'42501');
    assert.equal(asRole(other,`SELECT count(*) FROM storage.objects WHERE name='${owner}/private.pdf'`).stdout,'0');
  });
  await check('direct authenticated member and forged service JWT do not bypass publication checks',()=>{
    const args=[...psqlArgs];args[args.indexOf('-U')+1]='publication_member';errorState(run('psql',[...args,'-c',`SET request.jwt.claim.sub='${viewer}';SET request.jwt.claim.role='service_role';${insert(uuid(240),viewer)}`],false),'42501');
    errorState(sql(`${actorContext(viewer)}SET request.jwt.claim.role='service_role';${insert(uuid(241),viewer)}`,false),'42501');
  });
  await check('hard deletion and every role leave a permanent retired UUID',()=>{
    const id=uuid(250);asRole(editor,insert(id));asRole(editor,`DELETE FROM documents WHERE id='${id}'`);
    for(const role of ['authenticated','service_role','postgres']){
      const response=asRole(editor,insert(id),role,false);errorState(response,'23514');assert.match(response.stderr,/DOCUMENT_ID_RETIRED/);
    }
    assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${id}'`),'t');
  });
  await check('project/account cascades retire child IDs and identity rows survive account removal',()=>{
    const user=uuid(5),proj=uuid(260);sql(`INSERT INTO auth.users VALUES('${user}');INSERT INTO projects(id,user_id) VALUES('${proj}','${user}');${insert(uuid(261),user,proj)};${insert(uuid(262),user,null)};DELETE FROM projects WHERE id='${proj}';DELETE FROM auth.users WHERE id='${user}'`);
    for(const id of [uuid(261),uuid(262)]){errorState(asRole(other,insert(id,other,null),'service_role',false),'23514');assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${id}'`),'t');}
  });
  await check('identity changes are forbidden even for service/admin while metadata and archives remain editable',()=>{
    const identityBefore=scalar(`SELECT to_jsonb(t) FROM ${identities} t WHERE document_id='${uuid(211)}'`);
    for(const role of ['authenticated','service_role','postgres']){const response=asRole(editor,`UPDATE documents SET id='${uuid(270)}' WHERE id='${uuid(211)}'`,role,false);errorState(response,'23514');assert.match(response.stderr,/DOCUMENT_ID_IMMUTABLE/);}
    asRole(editor,`UPDATE documents SET name='renamed',annotations='{"kept":true}',archived=true,user_archived_at='2026-01-01' WHERE id='${uuid(211)}'`);
    assert.equal(scalar(`SELECT name FROM documents WHERE id='${uuid(211)}'`),'renamed');asRole(editor,`UPDATE documents SET archived=false,user_archived_at=NULL WHERE id='${uuid(211)}'`);
    asRole(editor,`UPDATE documents SET id=id WHERE id='${uuid(211)}'`);assert.equal(scalar(`SELECT to_jsonb(t) FROM ${identities} t WHERE document_id='${uuid(211)}'`),identityBefore);
  });
  await check('trusted SQL service can create migration fixtures but still cannot reuse retired IDs',()=>{
    asRole(null,insert(uuid(280),other,project,`${owner}/admin-only.pdf`),'service_role');assert.equal(scalar(`SELECT count(*) FROM documents WHERE id='${uuid(280)}'`),'1');
  });
  await check('multi-row failure rolls back documents and private identity claims together',()=>{
    const before=snapshot(['documents',identities]);const first=insert(uuid(290)),second=insert(uuid(291),viewer);
    errorState(asRole(editor,first+','+second.slice(second.indexOf('VALUES')+6),'authenticated',false),'42501');assert.deepEqual(snapshot(['documents',identities]),before);
  });
  await check('existing shared document read/editor checks remain intact',()=>{
    assert.equal(asRole(viewer,`SELECT user_can_access_document('${uuid(210)}','viewer')`).stdout,'t');assert.equal(asRole(viewer,`SELECT user_can_access_document('${uuid(210)}','editor')`).stdout,'f');
    assert.equal(asRole(editor,`SELECT user_can_access_document('${uuid(210)}','editor')`).stdout,'t');assert.equal(asRole(other,`SELECT user_can_access_document('${uuid(210)}','viewer')`).stdout,'f');
  });
  await check('revocation first causes a prompt lock failure then a fresh permission refusal',async()=>{
    const first=session('revoke-first');first.send(`UPDATE project_collaborators SET role='viewer' WHERE project_id='${project}' AND user_id='${editor}';SELECT 'REVOKED';`);await first.wait('REVOKED');
    errorState(asRole(editor,insert(uuid(300)),'authenticated',false),'55P03');assert.equal((await first.finish()).status,0);errorState(asRole(editor,insert(uuid(300)),'authenticated',false),'42501');
    sql(`UPDATE project_collaborators SET role='editor' WHERE project_id='${project}' AND user_id='${editor}'`);
  });
  await check('publication first holds membership until commit; later revoked publication is denied',async()=>{
    const first=session('publish-first','authenticated',editor);first.send(insert(uuid(301))+";SELECT 'INSERTED';");await first.wait('INSERTED');const second=session('revoke-second');second.send(`UPDATE project_collaborators SET role='viewer' WHERE project_id='${project}' AND user_id='${editor}';`);await blocked(second.name);
    assert.equal((await first.finish()).status,0);assert.equal((await second.finish()).status,0);errorState(asRole(editor,insert(uuid(302)),'authenticated',false),'42501');
    sql(`UPDATE project_collaborators SET role='editor' WHERE project_id='${project}' AND user_id='${editor}'`);
  });
  await check('a failed delete transaction leaves the document and identity usable',()=>{
    const id=uuid(310);asRole(editor,insert(id));const before=snapshot(['documents',identities]);errorState(asRole(editor,`BEGIN;DELETE FROM documents WHERE id='${id}';SELECT 1/0;COMMIT`,'authenticated',false),'22012');assert.deepEqual(snapshot(['documents',identities]),before);
  });
  await check('moving a projectless document rechecks destination rights and preserves its owner/path',()=>{
    asRole(other,insert(uuid(320),other,null));errorState(asRole(other,`UPDATE documents SET project_id='${project}' WHERE id='${uuid(320)}'`,'authenticated',false),'42501');
    asRole(editor,insert(uuid(321),editor,null));asRole(editor,`UPDATE documents SET project_id='${project}' WHERE id='${uuid(321)}'`);
    assert.equal(scalar(`SELECT project_id FROM documents WHERE id='${uuid(321)}'`),project);
    for(const patch of [`user_id='${owner}'`,`file_path='${owner}/private.pdf'`])errorState(sql(`${actorContext(editor)}SET request.jwt.claim.role='service_role';UPDATE documents SET ${patch} WHERE id='${uuid(321)}'`,false),'42501');
    asRole(editor,`UPDATE documents SET project_id=NULL WHERE id='${uuid(321)}'`);assert.equal(scalar(`SELECT project_id IS NULL FROM documents WHERE id='${uuid(321)}'`),'t');
  });
  await check('actual project purge detaches live collaborator children and tombstones only deleted children',()=>{
    const proj=uuid(330),live=uuid(331),removed=uuid(332);sql(`INSERT INTO projects(id,user_id,name) VALUES('${proj}','${owner}','purge fixture');INSERT INTO project_collaborators VALUES('${proj}','${editor}','editor','active')`);
    asRole(editor,insert(live,editor,proj));asRole(owner,insert(removed,owner,proj));sql(`UPDATE projects SET user_archived_at='2026-01-01' WHERE id='${proj}';UPDATE documents SET user_archived_at='2026-01-01' WHERE id='${removed}'`);
    const answer=JSON.parse(asRole(owner,`SELECT public.purge_archived_project('${proj}')`).stdout);assert.equal(answer.ok,true);
    assert.deepEqual(answer.deleted_document_ids,[removed]);assert.equal(answer.document_count,1);
    assert.equal(scalar(`SELECT project_id IS NULL FROM documents WHERE id='${live}'`),'t');assert.equal(scalar(`SELECT user_id FROM documents WHERE id='${live}'`),editor);
    assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${live}'`),'f');assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${removed}'`),'t');
    const retry=JSON.parse(asRole(owner,`SELECT public.purge_archived_project('${proj}')`).stdout);assert.equal(retry.already,true);assert.deepEqual(retry.deleted_document_ids,[]);assert.deepEqual(retry.orphaned_paths,[]);
  });
  await check('purge receipt includes only archived deleted IDs, keeps shared paths and preserves live pending state',()=>{
    const proj=uuid(380),live=uuid(381),shared=uuid(382),unique=uuid(383),outside=uuid(384),sharedPath=`${owner}/shared-purge.pdf`,uniquePath=`${owner}/unique-purge.pdf`;
    sql(`INSERT INTO projects(id,user_id,name) VALUES('${proj}','${owner}','shared paths fixture');INSERT INTO project_collaborators VALUES('${proj}','${editor}','editor','active')`);
    asRole(editor,insert(live,editor,proj));asRole(owner,insert(shared,owner,proj,sharedPath));asRole(owner,insert(unique,owner,proj,uniquePath));asRole(owner,insert(outside,owner,null,sharedPath));
    sql(`UPDATE documents SET annotations='{"pending":"unsynced fixture edit"}' WHERE id='${live}';UPDATE documents SET user_archived_at='2026-01-01' WHERE id IN ('${shared}','${unique}');UPDATE projects SET user_archived_at='2026-01-01' WHERE id='${proj}'`);
    const liveBefore=scalar(`SELECT to_jsonb(d)-'project_id' FROM documents d WHERE id='${live}'`),outsideBefore=scalar(`SELECT to_jsonb(d) FROM documents d WHERE id='${outside}'`);
    const answer=JSON.parse(asRole(owner,`SELECT public.purge_archived_project('${proj}')`).stdout);assert.equal(answer.ok,true);assert.equal(answer.document_count,2);assert.deepEqual(answer.deleted_document_ids,[shared,unique]);assert.deepEqual(answer.orphaned_paths,[uniquePath]);
    assert.equal(scalar(`SELECT to_jsonb(d)-'project_id' FROM documents d WHERE id='${live}'`),liveBefore);assert.equal(scalar(`SELECT project_id IS NULL FROM documents WHERE id='${live}'`),'t');assert.equal(scalar(`SELECT to_jsonb(d) FROM documents d WHERE id='${outside}'`),outsideBefore);
    assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${live}'`),'f');
  });
  await check('restore holding a child lock makes purge fail atomically; fresh purge preserves the restored child',async()=>{
    const proj=uuid(390),restored=uuid(391),removed=uuid(392),live=uuid(393);
    sql(`INSERT INTO projects(id,user_id,name) VALUES('${proj}','${owner}','restore race fixture');INSERT INTO project_collaborators VALUES('${proj}','${editor}','editor','active')`);
    asRole(owner,insert(restored,owner,proj));asRole(owner,insert(removed,owner,proj));asRole(editor,insert(live,editor,proj));
    sql(`UPDATE documents SET user_archived_at='2026-01-01',annotations='{"keep":"restore fixture"}' WHERE id IN ('${restored}','${removed}');UPDATE projects SET user_archived_at='2026-01-01' WHERE id='${proj}'`);
    const first=session('restore-before-purge','authenticated',owner);first.send(`SELECT public.restore_document('${restored}');SELECT 'RESTORED';`);await first.wait('RESTORED');
    const before=snapshot(['projects','documents',identities,'project_collaborators','document_collaborators','storage.objects']);
    errorState(asRole(owner,`SELECT public.purge_archived_project('${proj}')`,'authenticated',false),'55P03');assert.deepEqual(snapshot(['projects','documents',identities,'project_collaborators','document_collaborators','storage.objects']),before);
    assert.equal((await first.finish()).status,0);
    const answer=JSON.parse(asRole(owner,`SELECT public.purge_archived_project('${proj}')`).stdout);assert.equal(answer.ok,true);assert.deepEqual(answer.deleted_document_ids,[removed]);assert.equal(answer.document_count,1);
    for(const id of [restored,live]){assert.equal(scalar(`SELECT project_id IS NULL AND user_archived_at IS NULL FROM documents WHERE id='${id}'`),'t');assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${id}'`),'f');}
    assert.equal(scalar(`SELECT annotations->>'keep' FROM documents WHERE id='${restored}'`),'restore fixture');
  });
  await check('project purge denies anon execution and missing caller identity without mutating archived data',()=>{
    const proj=uuid(394),child=uuid(395);sql(`INSERT INTO projects(id,user_id,name) VALUES('${proj}','${owner}','authorization fixture')`);asRole(owner,insert(child,owner,proj));sql(`UPDATE projects SET user_archived_at='2026-01-01' WHERE id='${proj}';UPDATE documents SET user_archived_at='2026-01-01' WHERE id='${child}'`);
    const before=snapshot(['projects','documents',identities,'project_collaborators','document_collaborators','storage.objects']);
    errorState(asRole(null,`SELECT public.purge_archived_project('${proj}')`,'anon',false),'42501');
    const refused=JSON.parse(asRole(null,`SELECT public.purge_archived_project('${proj}')`).stdout);assert.equal(refused.ok,false);assert.equal(refused.reason,'not_owner');assert.deepEqual(snapshot(['projects','documents',identities,'project_collaborators','document_collaborators','storage.objects']),before);
  });
  await check('scheduled privileged caller retains owner-claim access after public RPC execution is revoked',()=>{
    const sweep=source('20260811000000_kal431_archive_purge_sweep.sql');
    const claims=sweep.match(/PERFORM set_config\('request\.jwt\.claim\.sub', v_rec\.owner_id::TEXT, true\);\s*PERFORM set_config\('request\.jwt\.claims',[\s\S]*?json_build_object\('sub', v_rec\.owner_id::TEXT\)::TEXT, true\);/)?.[0];
    const call=sweep.match(/v_result := public\.purge_archived_project\(v_rec\.item_id\);/)?.[0];assert.ok(claims);assert.ok(call);
    // Only the tracked sweep's owner-claims and nested RPC call run here. This
    // synthetic postgres-owned wrapper does not model cron, candidate expiry,
    // logging, or scheduling, and is not callable by application clients.
    sql(`CREATE FUNCTION public.fixture_scheduled_project_purge(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v_rec record;v_result jsonb;BEGIN SELECT id AS item_id,user_id AS owner_id INTO v_rec FROM public.projects WHERE id=p_id;${claims}${call}RETURN v_result;END $$;REVOKE ALL ON FUNCTION public.fixture_scheduled_project_purge(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.fixture_scheduled_project_purge(uuid) TO service_role`);
    const proj=uuid(396),child=uuid(397);sql(`INSERT INTO projects(id,user_id,name) VALUES('${proj}','${owner}','scheduled fixture')`);asRole(owner,insert(child,owner,proj));sql(`UPDATE projects SET user_archived_at='2026-01-01' WHERE id='${proj}';UPDATE documents SET user_archived_at='2026-01-01' WHERE id='${child}'`);
    errorState(asRole(null,`SELECT public.purge_archived_project('${proj}')`,'anon',false),'42501');
    assert.equal(scalar("SELECT proowner='postgres'::regrole AND prosecdef FROM pg_proc WHERE oid='public.fixture_scheduled_project_purge(uuid)'::regprocedure"),'t');
    const result=JSON.parse(asRole(null,`SELECT public.fixture_scheduled_project_purge('${proj}')`,'service_role').stdout);assert.equal(result.ok,true);assert.deepEqual(result.deleted_document_ids,[child]);assert.equal(scalar(`SELECT count(*) FROM documents WHERE id='${child}'`),'0');assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${child}'`),'t');
    sql('DROP FUNCTION public.fixture_scheduled_project_purge(uuid)');
  });
  await check('purge first makes a concurrent restore wait then report not_found without resurrecting the child',async()=>{
    const proj=uuid(398),child=uuid(399);sql(`INSERT INTO projects(id,user_id,name) VALUES('${proj}','${owner}','purge first fixture')`);asRole(owner,insert(child,owner,proj));sql(`UPDATE projects SET user_archived_at='2026-01-01' WHERE id='${proj}';UPDATE documents SET user_archived_at='2026-01-01' WHERE id='${child}'`);
    const first=session('purge-before-restore','authenticated',owner);first.send(`SELECT public.purge_archived_project('${proj}');SELECT 'PURGED';`);await first.wait('PURGED');
    const second=session('restore-after-purge','authenticated',owner);second.send(`SELECT public.restore_document('${child}');`);await blocked(second.name);
    const purged=await first.finish();assert.equal(purged.status,0);const receipt=JSON.parse(purged.stdout.split('\n').find(line=>line.startsWith('{')));assert.deepEqual(receipt.deleted_document_ids,[child]);
    const restored=await second.finish();assert.equal(restored.status,0);assert.deepEqual(JSON.parse(restored.stdout.trim()),{ok:false,reason:'not_found'});
    assert.equal(scalar(`SELECT count(*) FROM documents WHERE id='${child}'`),'0');assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${child}'`),'t');
  });
  await check('document quota still rejects the sixth active free document with no stray identity row',()=>{
    const actor=uuid(6);sql(`INSERT INTO auth.users VALUES('${actor}')`);for(let n=0;n<5;n++)asRole(actor,insert(uuid(340+n),actor,null));const before=snapshot(['documents',identities]);
    errorState(asRole(actor,insert(uuid(345),actor,null),'authenticated',false),'42501');assert.deepEqual(snapshot(['documents',identities]),before);
  });
  await check('concurrent same-UUID creation fails fast then remains a duplicate, not a retired identity',async()=>{
    const id=uuid(350),first=session('identity-first','authenticated',editor);first.send(insert(id)+";SELECT 'CREATED';");await first.wait('CREATED');
    const busy=asRole(editor,insert(id),'authenticated',false);errorState(busy,'55P03');assert.match(busy.stderr,/DOCUMENT_ID_BUSY/);assert.equal((await first.finish()).status,0);
    errorState(asRole(editor,insert(id),'authenticated',false),'23505');assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${id}'`),'f');
  });
  await check('DELETE tuple-first versus INSERT identity-first aborts promptly instead of deadlocking',async()=>{
    const id=uuid(351);asRole(editor,insert(id));
    // A committed duplicate INSERT can reject immediately without waiting on
    // its row lock. Pause AFTER the real identity trigger to force the overlap;
    // this synthetic barrier changes no production guard or row data.
    sql(`CREATE FUNCTION fixture_hold_identity_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${id}' THEN PERFORM pg_advisory_xact_lock(50000351);END IF;RETURN NEW;END $$;
      CREATE TRIGGER aa_fixture_hold_identity_insert BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION fixture_hold_identity_insert()`);
    const barrier=session('identity-overlap-barrier');barrier.send("SELECT pg_advisory_xact_lock(50000351);SELECT 'BARRIER';");await barrier.wait('BARRIER');
    const first=session('delete-tuple-first');first.send(`SELECT id FROM documents WHERE id='${id}' FOR UPDATE;SELECT 'LOCKED';`);await first.wait('LOCKED');
    const second=session('insert-identity-first','authenticated',editor);second.send(insert(id)+';');await blocked(second.name);
    first.send(`DELETE FROM documents WHERE id='${id}';`);const deletion=await first.finish();errorState(deletion,'55P03');assert.match(deletion.stderr,/DOCUMENT_ID_BUSY/);
    assert.equal((await barrier.finish()).status,0);
    errorState(await second.finish(),'23505');assert.equal(scalar(`SELECT count(*) FROM documents WHERE id='${id}'`),'1');assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${id}'`),'f');
    sql('DROP TRIGGER aa_fixture_hold_identity_insert ON documents;DROP FUNCTION fixture_hold_identity_insert()');
  });
  for(const isolation of ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'])await check(`${isolation} old snapshot cannot recreate a committed retired UUID`,async()=>{
    const id=uuid({'READ COMMITTED':360,'REPEATABLE READ':361,SERIALIZABLE:362}[isolation]),stale=session('stale-'+id.slice(-3),'service_role',null,isolation);
    stale.send("SELECT count(*) FROM documents;SELECT 'SNAPSHOT';");await stale.wait('SNAPSHOT');asRole(editor,insert(id));asRole(editor,`DELETE FROM documents WHERE id='${id}'`);
    stale.send(insert(id)+';');errorState(await stale.finish(),isolation==='READ COMMITTED'?'23514':'40001');assert.equal(scalar(`SELECT count(*) FROM documents WHERE id='${id}'`),'0');assert.equal(scalar(`SELECT deleted FROM ${identities} WHERE document_id='${id}'`),'t');
  });
  for(const isolation of ['REPEATABLE READ','SERIALIZABLE'])await check(`${isolation} old membership snapshot cannot publish after a committed role downgrade`,async()=>{
    const id=uuid(isolation==='REPEATABLE READ'?370:371),stale=session('stale-member-'+id.slice(-3),'authenticated',editor,isolation);
    stale.send("SELECT count(*) FROM documents;SELECT 'SNAPSHOT';");await stale.wait('SNAPSHOT');
    sql(`UPDATE project_collaborators SET role='viewer' WHERE project_id='${project}' AND user_id='${editor}'`);
    stale.send(insert(id)+';');errorState(await stale.finish(),'40001');assert.equal(scalar(`SELECT count(*) FROM documents WHERE id='${id}'`),'0');assert.equal(scalar(`SELECT count(*) FROM ${identities} WHERE document_id='${id}'`),'0');
    errorState(asRole(editor,insert(id),'authenticated',false),'42501');
    sql(`UPDATE project_collaborators SET role='editor' WHERE project_id='${project}' AND user_id='${editor}'`);
  });
  await check('migration replay keeps documents, identities, policies and shared data unchanged',()=>{
    const tables=['documents',identities,'projects','project_collaborators','storage.objects','survey_private.document_storage_path_guards','survey_private.document_storage_cleanup','survey_private.account_write_guards'];
    const before=snapshot(tables);apply(identityMigration);apply(authorizationMigration);apply(purgeReceiptMigration);apply(storageMigration);apply(accountMigration);assert.deepEqual(snapshot(tables),before);
    assert.equal(scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p'),policies);
  });
  console.log(`Document publication PostgreSQL checks passed: ${checks}`);
}finally{
  for(const child of children)child.kill('SIGKILL');
  if(started){if(run('pg_ctl',['-D',data,'status'],false).status===0)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);assert.equal(run('pg_ctl',['-D',data,'status'],false).status,3,'owned local server stopped before cleanup');}
  assert.ok(temp.startsWith('/tmp/survey-document-publication-')&&data===join(temp,'data'));rmSync(temp,{recursive:true,force:true});
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
