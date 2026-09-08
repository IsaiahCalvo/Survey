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
const temp=mkdtempSync('/tmp/survey-storage-retirement-'),data=join(temp,'data'),socket=temp,port='6543';
const psqlArgs=['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq'];
let started=false,checks=0;const children=new Set();
function run(command,args,required=true){const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:20_000});if(required&&(result.error||result.status!==0))throw Error(result.error?.message||result.stderr||result.stdout);return{status:result.status,stdout:String(result.stdout||'').trim(),stderr:String(result.stderr||'').trim()};}
const sql=(statement,required=true)=>run('psql',[...psqlArgs,'-c',statement],required);
const scalar=statement=>sql(statement).stdout;
const source=file=>readFileSync(join(root,'supabase/migrations',file),'utf8');
const apply=file=>run('psql',[...psqlArgs,'-f',join(root,'supabase/migrations',file)]);
const uuid=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
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
  // Minimal original tables and permissive fixture policies isolate the real
  // retirement trigger/RPC boundary, including privileged Storage metadata writes.
  sql(`CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE ROLE storage_admin NOLOGIN BYPASSRLS;CREATE ROLE retirement_member LOGIN IN ROLE authenticated;
    CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE SCHEMA survey_private AUTHORIZATION postgres;REVOKE ALL ON SCHEMA survey_private FROM PUBLIC,anon,authenticated;CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE TABLE public.documents(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,project_id uuid,name text,file_path text,file_size bigint,archived boolean DEFAULT false,user_archived_at timestamptz,annotations jsonb DEFAULT '{}');
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL,name text NOT NULL,version text,metadata jsonb,owner uuid,owner_id text,updated_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role,storage_admin;
    GRANT ALL ON public.documents,storage.objects TO anon,authenticated,service_role,storage_admin;
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_documents ON public.documents FOR ALL USING(true) WITH CHECK(true);
    CREATE POLICY fixture_storage ON storage.objects FOR ALL USING(true) WITH CHECK(true);`);
  const index=source('20260907213935_storage_lookup_and_function_hardening.sql').match(/CREATE INDEX IF NOT EXISTS idx_documents_file_path[^;]*;/)?.[0];assert.ok(index);sql(index);
  const owner=uuid(1),other=uuid(2);sql(`INSERT INTO auth.users VALUES('${owner}'),('${other}')`);
  const path=n=>`${owner}/fixture-${n}.pdf`;
  const pathsSql=paths=>`ARRAY[${paths.map(quote).join(',')}]::text[]`;
  const publish=(id,filePath,actor=owner)=>`INSERT INTO public.documents(id,user_id,name,file_path,file_size) VALUES('${uuid(id)}','${actor}','fixture',${quote(filePath)},4)`;
  const upload=(filePath,bucket='documents')=>`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES(${quote(bucket)},${quote(filePath)},'v1','{"size":4,"etag":"fixture"}')`;
  const remove=filePath=>`DELETE FROM storage.objects WHERE bucket_id='documents' AND name=${quote(filePath)}`;
  const retireSql=paths=>`SELECT public.retire_document_storage_paths(${pathsSql(paths)})`;
  const retire=(paths,actor=owner,role='authenticated')=>JSON.parse(asRole(actor,retireSql(paths),role).stdout);
  const list=()=>JSON.parse(asRole(null,'SELECT public.list_document_storage_cleanup(100)','service_role').stdout).paths;
  const ack=paths=>JSON.parse(asRole(null,`SELECT public.ack_document_storage_cleanup(${pathsSql(paths)})`,'service_role').stdout);
  const snapshot=(tables=['public.documents','storage.objects'])=>tables.map(table=>scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t`));
  await check('BEFORE retirement fence: late document publication can reference already deleted metadata',()=>{
    asRole(null,upload(path(0)),'storage_admin');asRole(null,remove(path(0)),'storage_admin');asRole(owner,publish(100,path(0)));
    assert.equal(scalar(`SELECT count(*) FROM documents WHERE file_path=${quote(path(0))}`),'1');sql(`DELETE FROM documents WHERE id='${uuid(100)}'`);
  });
  // Remaining tests use the actual migration; no production function copies.
  const migration='20260908220000_document_storage_retirement.sql';apply(migration);
  const guards='survey_private.document_storage_path_guards',queue='survey_private.document_storage_cleanup';
  const allSnapshot=()=>snapshot(['public.documents','storage.objects',guards,queue]);
  const isRetired=filePath=>scalar(`SELECT retired FROM ${guards} WHERE path_hash=survey_private.document_storage_path_hash(${quote(filePath)})`);
  await check('unretired metadata deletion fails for every SQL role, including bypass Storage writes',()=>{
    asRole(null,upload(path(1)),'storage_admin');const before=allSnapshot();
    for(const role of ['anon','authenticated','service_role','storage_admin','postgres']){
      const result=asRole(owner,remove(path(1)),role,false);errorState(result,'23514');assert.match(result.stderr,/DOCUMENT_STORAGE_PATH_NOT_RETIRED/);
    }
    assert.deepEqual(allSnapshot(),before);
  });
  await check('retirement must commit before API-style metadata deletion; same transaction rolls back everything',()=>{
    const before=allSnapshot();const result=asRole(owner,`BEGIN;${retireSql([path(1)])};${remove(path(1))};COMMIT`,'service_role',false);
    errorState(result,'23514');assert.match(result.stderr,/DOCUMENT_STORAGE_RETIREMENT_NOT_COMMITTED/);assert.deepEqual(allSnapshot(),before);
    assert.deepEqual(retire([path(1)]),{retired_paths:[path(1)],referenced_paths:[]});
    asRole(null,remove(path(1)),'storage_admin');assert.equal(isRetired(path(1)),'t');assert.ok(list().includes(path(1)));
    assert.deepEqual(ack([path(1)]),{acknowledged_paths:[path(1)],pending_paths:[]});assert.ok(!list().includes(path(1)));
    assert.deepEqual(ack([path(1)]),{acknowledged_paths:[path(1)],pending_paths:[]});assert.equal(isRetired(path(1)),'t');
  });
  await check('live, shared and both archive kinds all protect the same exact storage path',()=>{
    for(const n of [2,3,4,5])asRole(null,upload(path(n)),'storage_admin');
    asRole(owner,publish(102,path(2)));asRole(owner,publish(103,path(3)));asRole(other,publish(104,path(3),other));asRole(owner,publish(105,path(4)));asRole(owner,publish(106,path(5)));
    sql(`UPDATE documents SET archived=true WHERE id='${uuid(105)}';UPDATE documents SET user_archived_at='2026-01-01' WHERE id='${uuid(106)}'`);
    const before=snapshot();assert.deepEqual(retire([path(2),path(3),path(4),path(5)]),{retired_paths:[],referenced_paths:[path(2),path(3),path(4),path(5)]});assert.deepEqual(snapshot(),before);
    asRole(owner,`DELETE FROM documents WHERE id='${uuid(103)}'`);assert.deepEqual(retire([path(3)]),{retired_paths:[],referenced_paths:[path(3)]});assert.equal(isRetired(path(3)),'f');
  });
  await check('normal replacement and pure metadata refresh preserve rows and do not queue cleanup',()=>{
    const beforeQueue=scalar(`SELECT count(*) FROM ${queue}`);asRole(null,`UPDATE storage.objects SET version='v2',metadata='{"size":8}' WHERE name=${quote(path(2))}`,'storage_admin');
    const beforeGuard=scalar(`SELECT revision FROM ${guards} WHERE path_hash=survey_private.document_storage_path_hash(${quote(path(2))})`);
    asRole(null,`UPDATE storage.objects SET metadata='{"size":8,"lastAccess":"fixture"}',updated_at=clock_timestamp() WHERE name=${quote(path(2))}`,'storage_admin');
    assert.equal(scalar(`SELECT revision FROM ${guards} WHERE path_hash=survey_private.document_storage_path_hash(${quote(path(2))})`),beforeGuard);assert.equal(scalar(`SELECT count(*) FROM ${queue}`),beforeQueue);assert.equal(scalar(`SELECT count(*) FROM documents WHERE file_path=${quote(path(2))}`),'1');
  });
  await check('retired paths reject late publication, new metadata, version replacement and incoming moves for all writers',()=>{
    asRole(null,upload(path(6)),'storage_admin');retire([path(6)]);
    for(const role of ['authenticated','service_role','storage_admin','postgres']){
      errorState(asRole(owner,publish(107,path(6)),role,false),'23514');
      errorState(asRole(owner,`UPDATE storage.objects SET version='late' WHERE name=${quote(path(6))}`,role,false),'23514');
      errorState(asRole(owner,upload(path(1)),role,false),'23514');
    }
    asRole(null,upload(path(7),'other'),'storage_admin');errorState(asRole(null,`UPDATE storage.objects SET bucket_id='documents',name=${quote(path(6))} WHERE bucket_id='other' AND name=${quote(path(7))}`,'storage_admin',false),'23514');
    assert.equal(isRetired(path(6)),'t');assert.deepEqual(ack([path(6)]),{acknowledged_paths:[],pending_paths:[path(6)]});
  });
  await check('metadata transaction rollback after a simulated provider delete cannot remove the committed fence',()=>{
    const physicalProvider=new Set([path(8)]);asRole(null,upload(path(8)),'storage_admin');retire([path(8)]);
    // Explicit provider stub: an external delete cannot roll back with SQL.
    // This tests the database fence, not real provider authorization or ordering.
    physicalProvider.delete(path(8));errorState(asRole(null,`BEGIN;${remove(path(8))};SELECT 1/0;COMMIT`,'storage_admin',false),'22012');
    assert.equal(physicalProvider.has(path(8)),false);assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(path(8))}`),'1');assert.equal(isRetired(path(8)),'t');
    errorState(asRole(owner,publish(108,path(8)),'authenticated',false),'23514');assert.deepEqual(ack([path(8)]),{acknowledged_paths:[],pending_paths:[path(8)]});
    asRole(null,remove(path(8)),'storage_admin');assert.deepEqual(ack([path(8)]),{acknowledged_paths:[path(8)],pending_paths:[]});
  });
  await check('old clients deleting or changing a document path queue candidates without retiring shared bytes',()=>{
    asRole(owner,publish(109,path(9)));asRole(owner,publish(110,path(9)));asRole(owner,publish(111,path(10)));
    asRole(owner,`DELETE FROM documents WHERE id='${uuid(109)}';UPDATE documents SET file_path=${quote(path(11))} WHERE id='${uuid(111)}'`);
    const offered=list();assert.equal(scalar(`SELECT count(*) FROM ${queue} WHERE path=${quote(path(9))}`),'1');assert.ok(!offered.includes(path(9)));assert.ok(offered.includes(path(10)));assert.equal(isRetired(path(9)),'f');assert.equal(isRetired(path(10)),'f');
    assert.deepEqual(retire([path(9),path(10)]),{retired_paths:[path(10)],referenced_paths:[path(9)]});
    const before=allSnapshot();errorState(asRole(owner,`BEGIN;DELETE FROM documents WHERE id='${uuid(110)}';SELECT 1/0;COMMIT`,'authenticated',false),'22012');assert.deepEqual(allSnapshot(),before);
  });
  await check('renaming or moving out requires committed old-path retirement and leaves the old path fenced',()=>{
    for(const n of [12,13])asRole(null,upload(path(n)),'storage_admin');
    const rename=`UPDATE storage.objects SET name=${quote(path(14))} WHERE bucket_id='documents' AND name=${quote(path(12))}`;
    const move=`UPDATE storage.objects SET bucket_id='other' WHERE bucket_id='documents' AND name=${quote(path(13))}`;
    for(const statement of [rename,move])errorState(asRole(null,statement,'storage_admin',false),'23514');
    retire([path(12),path(13)]);asRole(null,rename,'storage_admin');asRole(null,move,'storage_admin');
    assert.equal(isRetired(path(12)),'t');assert.equal(isRetired(path(13)),'t');assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE bucket_id='documents' AND name=${quote(path(14))}`),'1');
    errorState(asRole(owner,publish(112,path(12)),'authenticated',false),'23514');
    assert.deepEqual(ack([path(12),path(13)]),{acknowledged_paths:[path(12),path(13)],pending_paths:[]});
  });
  await check('missing paths retire safely and acknowledgments retain the permanent opaque guard',()=>{
    assert.deepEqual(retire([path(15),path(15)]),{retired_paths:[path(15)],referenced_paths:[]});assert.ok(list().includes(path(15)));
    assert.deepEqual(ack([path(15)]),{acknowledged_paths:[path(15)],pending_paths:[]});assert.equal(isRetired(path(15)),'t');errorState(asRole(null,upload(path(15)),'storage_admin',false),'23514');
    assert.deepEqual(ack([path(16)]),{acknowledged_paths:[],pending_paths:[path(16)]});assert.equal(isRetired(path(16)),'f');
  });
  await check('RPCs and private storage reject anon, missing identity, foreign prefixes and forged service claims',()=>{
    const before=allSnapshot();
    errorState(asRole(null,retireSql([path(17)]),'anon',false),'42501');errorState(asRole(null,retireSql([path(17)]),'authenticated',false),'42501');
    errorState(asRole(other,retireSql([path(17)]),'authenticated',false),'42501');errorState(sql(`${actorContext(other)}SET request.jwt.claim.role='service_role';${retireSql([path(17)])}`,false),'42501');
    const args=[...psqlArgs];args[args.indexOf('-U')+1]='retirement_member';errorState(run('psql',[...args,'-c',`SET request.jwt.claim.sub='${other}';SET request.jwt.claim.role='service_role';${retireSql([path(17)])}`],false),'42501');
    errorState(run('psql',[...args,'-c',retireSql([path(17)])],false),'42501');
    errorState(asRole(owner,'SELECT public.list_document_storage_cleanup(100)','authenticated',false),'42501');
    for(const role of ['anon','authenticated','service_role'])for(const table of [guards,queue])errorState(asRole(owner,`SELECT * FROM ${table}`,role,false),'42501');
    assert.deepEqual(allSnapshot(),before);assert.deepEqual(retire(['legacy-safe.pdf'],null,'service_role'),{retired_paths:['legacy-safe.pdf'],referenced_paths:[]});
    const inherited=run('psql',[...args,'-c',`SET request.jwt.claim.sub='${owner}';${retireSql([path(17)])}`]);assert.deepEqual(JSON.parse(inherited.stdout),{retired_paths:[path(17)],referenced_paths:[]});
  });
  await check('bounds and path validation reject the entire batch without partial retirement',()=>{
    const before=allSnapshot();for(const value of ['NULL','ARRAY[NULL]::text[]',pathsSql(['']),pathsSql([path(18),'x'.repeat(2049)]),pathsSql([path(18),'bad\npath']),pathsSql(Array.from({length:101},(_,n)=>path(1000+n)))])errorState(asRole(owner,`SELECT public.retire_document_storage_paths(${value})`,'service_role',false),'22023');
    for(const value of ['NULL','0','101','-1'])errorState(asRole(null,`SELECT public.list_document_storage_cleanup(${value})`,'service_role',false),'22023');
    assert.deepEqual(allSnapshot(),before);assert.deepEqual(retire([]),{retired_paths:[],referenced_paths:[]});
    retire([path(19)]);assert.equal(JSON.parse(asRole(null,'SELECT public.list_document_storage_cleanup(1)','service_role').stdout).paths.length,1);
  });
  await check('publisher first blocks retirement; after publish commit all references are rechecked',async()=>{
    const first=session('storage-publisher-first','authenticated',owner);first.send(publish(120,path(20))+";SELECT 'PUBLISHED';");await first.wait('PUBLISHED');
    errorState(asRole(owner,retireSql([path(20)]),'authenticated',false),'55P03');assert.equal((await first.finish()).status,0);
    assert.deepEqual(retire([path(20)]),{retired_paths:[],referenced_paths:[path(20)]});
  });
  await check('retirer first blocks publication; committed retirement rejects fresh and late metadata writes',async()=>{
    const first=session('storage-retirer-first','authenticated',owner);first.send(retireSql([path(21)])+";SELECT 'RETIRED';");await first.wait('RETIRED');
    errorState(asRole(owner,publish(121,path(21)),'authenticated',false),'55P03');errorState(asRole(null,upload(path(21)),'storage_admin',false),'55P03');assert.equal((await first.finish()).status,0);
    errorState(asRole(owner,publish(121,path(21)),'authenticated',false),'23514');errorState(asRole(null,upload(path(21)),'storage_admin',false),'23514');
  });
  await check('metadata upload first serializes retirement before the later delete and delayed upload cannot revive it',async()=>{
    const first=session('storage-upload-first','storage_admin');first.send(upload(path(22))+";SELECT 'UPLOADED';");await first.wait('UPLOADED');
    errorState(asRole(owner,retireSql([path(22)]),'authenticated',false),'55P03');assert.equal((await first.finish()).status,0);retire([path(22)]);asRole(null,remove(path(22)),'storage_admin');errorState(asRole(null,upload(path(22)),'storage_admin',false),'23514');
  });
  for(const [index,isolation] of ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'].entries())await check(`${isolation} old snapshot cannot publish or upload after retirement`,async()=>{
    const currentPath=path(30+index),first=session('storage-stale-publish-'+index,'authenticated',owner,isolation);first.send("SELECT count(*) FROM documents;SELECT 'SNAPSHOT';");await first.wait('SNAPSHOT');retire([currentPath]);first.send(publish(130+index,currentPath)+';');errorState(await first.finish(),index===0?'23514':'40001');assert.equal(isRetired(currentPath),'t');
    const uploadPath=path(40+index),uploader=session('storage-stale-upload-'+index,'storage_admin',null,isolation);uploader.send("SELECT count(*) FROM storage.objects;SELECT 'SNAPSHOT';");await uploader.wait('SNAPSHOT');retire([uploadPath]);uploader.send(upload(uploadPath)+';');errorState(await uploader.finish(),index===0?'23514':'40001');
  });
  for(const [index,isolation] of ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'].entries())await check(`${isolation} retirement cannot use an old snapshot to miss a committed publisher`,async()=>{
    const currentPath=path(50+index),first=session('storage-stale-retire-'+index,'authenticated',owner,isolation);first.send("SELECT count(*) FROM documents;SELECT 'SNAPSHOT';");await first.wait('SNAPSHOT');asRole(owner,publish(150+index,currentPath));first.send(retireSql([currentPath])+';');const result=await first.finish();
    if(index===0){assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout.split('\n').find(line=>line.startsWith('{'))),{retired_paths:[],referenced_paths:[currentPath]});}else errorState(result,'40001');assert.equal(isRetired(currentPath),'f');
  });
  await check('application roles cannot truncate documents or storage and bypass row guards',()=>{
    const before=allSnapshot();for(const role of ['anon','authenticated','service_role','retirement_member'])for(const table of ['documents','storage.objects'])errorState(asRole(owner,`TRUNCATE ${table}`,role,false),'42501');assert.deepEqual(allSnapshot(),before);
  });
  await check('referenced cleanup candidates cannot fill the page and starve a later unreferenced path',()=>{
    const sharedPaths=Array.from({length:100},(_,n)=>path(2000+n));
    asRole(owner,sharedPaths.map((filePath,n)=>`${publish(3000+n,filePath)};${publish(4000+n,filePath)};DELETE FROM documents WHERE id='${uuid(3000+n)}'`).join(';'));
    sql(`UPDATE ${queue} SET created_at='2000-01-01' WHERE path=ANY(${pathsSql(sharedPaths)})`);
    asRole(owner,publish(5000,path(5000))+`;DELETE FROM documents WHERE id='${uuid(5000)}'`);
    const offered=list();assert.ok(offered.includes(path(5000)));assert.ok(offered.every(item=>!sharedPaths.includes(item)));assert.ok(offered.length<=100);
    assert.equal(scalar(`SELECT count(*) FROM ${queue} WHERE path=ANY(${pathsSql(sharedPaths)})`),'100');
  });
  await check('lost or failed first 100 claims do not starve job 101 and cannot immediately repeat',()=>{
    sql(`UPDATE ${queue} SET next_attempt_at=clock_timestamp()+interval '1 day'`);
    const firstBatch=Array.from({length:100},(_,n)=>path(6000+n)),last=path(6100);retire(firstBatch);retire([last]);
    assert.deepEqual(list(),firstBatch);assert.equal(scalar(`SELECT count(*) FROM ${queue} WHERE path=ANY(${pathsSql(firstBatch)}) AND next_attempt_at>clock_timestamp()`),'100');
    assert.deepEqual(list(),[last]);assert.deepEqual(list(),[]);
    assert.equal(scalar(`SELECT count(*) FROM ${queue} WHERE path=ANY(${pathsSql([...firstBatch,last])})`),'101');
    // Advance only owned fixture eligibility, without a real minute-long wait.
    sql(`UPDATE ${queue} SET next_attempt_at='2000-01-01' WHERE path=ANY(${pathsSql(firstBatch)})`);
    assert.deepEqual(new Set(list()),new Set(firstBatch));assert.deepEqual(list(),[]);
  });
  await check('concurrent cleanup claims skip locked jobs and return distinct committed batches',async()=>{
    sql(`UPDATE ${queue} SET next_attempt_at=clock_timestamp()+interval '1 day'`);
    const available=[path(6200),path(6201),path(6202),path(6203)];retire(available);
    const first=session('cleanup-claim-first');first.send("SELECT public.list_document_storage_cleanup(2);SELECT 'CLAIMED';");await first.wait('CLAIMED');
    const second=JSON.parse(asRole(null,'SELECT public.list_document_storage_cleanup(2)','service_role').stdout).paths;
    const result=await first.finish();assert.equal(result.status,0);const firstPaths=JSON.parse(result.stdout.split('\n').find(line=>line.startsWith('{'))).paths;
    assert.equal(firstPaths.length,2);assert.equal(second.length,2);assert.ok(second.every(item=>!firstPaths.includes(item)));assert.deepEqual(new Set([...firstPaths,...second]),new Set(available));assert.deepEqual(list(),[]);
  });
  await check('delegated TRIGGER privilege can replay the actual Storage trigger without table ownership',()=>{
    const trigger=source(migration).match(/CREATE OR REPLACE TRIGGER a_document_storage_retirement_guard[\s\S]*?EXECUTE FUNCTION survey_private\.guard_document_storage_object\(\);/)?.[0];assert.ok(trigger);
    // Only this exact hosted trigger-install operation is under test. The role
    // cannot run the full migration or alter the provider-owned table schema.
    sql(`CREATE ROLE fixture_migrator NOLOGIN;GRANT USAGE ON SCHEMA storage,survey_private TO fixture_migrator;GRANT TRIGGER ON storage.objects TO fixture_migrator;GRANT EXECUTE ON FUNCTION survey_private.guard_document_storage_object() TO fixture_migrator`);
    assert.equal(scalar("SELECT has_table_privilege('fixture_migrator','storage.objects','TRIGGER') AND NOT pg_has_role('fixture_migrator',(SELECT relowner FROM pg_class WHERE oid='storage.objects'::regclass),'MEMBER')"),'t');
    asRole(null,trigger,'fixture_migrator');asRole(null,trigger,'fixture_migrator');errorState(asRole(null,'DROP TRIGGER a_document_storage_retirement_guard ON storage.objects','fixture_migrator',false),'42501');
    errorState(asRole(null,upload(path(1)),'storage_admin',false),'23514');
  });
  await check('installation postcondition fails closed if hosted grant authority leaves TRUNCATE exposed',()=>{
    const postcondition=source(migration).match(/DO \$\$[\s\S]*?\n\$\$;/)?.[0];assert.ok(postcondition);
    sql('GRANT TRUNCATE ON storage.objects TO service_role');errorState(sql(postcondition,false),'42501');sql('REVOKE TRUNCATE ON storage.objects FROM service_role');sql(postcondition);
  });
  await check('migration replay changes neither bytes metadata, document state, fences nor queue',()=>{
    const before=allSnapshot(),policies=scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p');assert.equal(scalar(`SELECT count(*)>0 FROM ${queue} WHERE next_attempt_at>clock_timestamp()`),'t');apply(migration);assert.deepEqual(allSnapshot(),before);assert.equal(scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p'),policies);
  });
  console.log(`Document storage retirement PostgreSQL checks passed: ${checks}`);
}finally{
  for(const child of children)child.kill('SIGKILL');
  if(started){if(run('pg_ctl',['-D',data,'status'],false).status===0)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);assert.equal(run('pg_ctl',['-D',data,'status'],false).status,3,'owned local server stopped before cleanup');}
  assert.ok(temp.startsWith('/tmp/survey-storage-retirement-')&&data===join(temp,'data'));rmSync(temp,{recursive:true,force:true});
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
