// Installed local PostgreSQL and synthetic metadata only. No provider process
// runs here; these checks do not exercise S3 or the deployed Storage API.
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
const temp=mkdtempSync('/tmp/survey-account-scan-'),data=join(temp,'data'),socket=temp,port='6543';
const psqlArgs=['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq'];
let started=false,checks=0;const children=new Set();
function run(command,args,required=true){const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:20_000});if(required&&(result.error||result.status!==0))throw Error(result.error?.message||result.stderr||result.stdout);return{status:result.status,stdout:String(result.stdout||'').trim(),stderr:String(result.stderr||'').trim()};}
const sql=(statement,required=true)=>run('psql',[...psqlArgs,'-c',statement],required);
const scalar=statement=>sql(statement).stdout;
const source=file=>readFileSync(join(root,'supabase/migrations',file),'utf8');
const apply=file=>run('psql',[...psqlArgs,'-f',join(root,'supabase/migrations',file)]);
const uuid=n=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
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
  // Pre-existing unrelated metadata is seeded before triggers solely to measure
  // the scan query, not to benchmark 100,000 upload-admission transactions.
  sql(`INSERT INTO storage.objects(bucket_id,name,version,metadata) SELECT 'documents','ffffffff-ffff-4fff-8fff-ffffffffffff/'||lpad(n::text,8,'0')||'.pdf','v1','{"size":4}'::jsonb FROM generate_series(1,100000) n`);
  sql(`INSERT INTO auth.users VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff');INSERT INTO documents(id,user_id,name,file_path,file_size) SELECT md5('scan-unrelated-'||n)::uuid,'ffffffff-ffff-4fff-8fff-ffffffffffff','unrelated reference','ffffffff-ffff-4fff-8fff-ffffffffffff/'||lpad(n::text,8,'0')||'.pdf',4 FROM generate_series(1,100000) n`);
  for(const migration of ['20260908160000_document_quota_guard.sql','20260908200000_document_identity_tombstones.sql','20260908201000_document_publication_authorization.sql','20260908220000_document_storage_retirement.sql'])apply(migration);
  const storageIndex=source('20260907213935_storage_lookup_and_function_hardening.sql').match(/CREATE INDEX IF NOT EXISTS idx_documents_file_path[^;]*;/)?.[0];assert.ok(storageIndex);sql(storageIndex);
  const user=n=>uuid(n),filePath=(actor,n)=>`${actor}/fixture-${n}.pdf`;
  const createUser=actor=>sql(`INSERT INTO auth.users VALUES('${actor}')`);
  const createProject=(id,actor)=>`INSERT INTO projects(id,user_id,name) VALUES('${uuid(id)}','${actor}','fixture project')`;
  const createTemplate=(id,actor)=>`INSERT INTO templates(id,user_id,name) VALUES('${uuid(id)}','${actor}','fixture template')`;
  const createDocument=(id,actor,project=null,path=filePath(actor,id))=>`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${uuid(id)}','${actor}',${quote(project)},'fixture document',${quote(path)},4)`;
  const upload=(path,bucket='documents')=>`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES(${quote(bucket)},${quote(path)},'v1','{"size":4,"etag":"fixture"}')`;
  const snapshot=(tables=['auth.users','projects','templates','documents','project_collaborators','document_collaborators','storage.objects'])=>tables.map(table=>scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t`));

  apply('20260908230000_account_storage_closing.sql');
  // Model the documented provider index prerequisite; this is fixture DDL, not
  // permission to create an index on hosted provider-owned Storage tables.
  sql('CREATE INDEX fixture_storage_bucket_name_c ON storage.objects(bucket_id,name COLLATE "C")');
  const legacyClosed=user(1);createUser(legacyClosed);asRole(null,upload(filePath(legacyClosed,1)),'storage_admin');asRole(null,`SELECT public.delete_account_owned_rows('${legacyClosed}')`,'service_role');
  const migration='20260909000000_account_storage_cleanup_scan.sql';
  apply(migration);
  sql(`INSERT INTO survey_private.document_storage_cleanup(path_hash,path) SELECT survey_private.document_storage_path_hash('ffffffff-ffff-4fff-8fff-ffffffffffff/'||lpad(n::text,8,'0')||'.pdf'),'ffffffff-ffff-4fff-8fff-ffffffffffff/'||lpad(n::text,8,'0')||'.pdf' FROM generate_series(1,100000) n`);
  const guards='survey_private.account_write_guards',queue='survey_private.document_storage_cleanup';
  const makeActor=n=>{const actor=user(n);createUser(actor);return actor;};
  const close=actor=>asRole(null,`SELECT public.delete_account_owned_rows('${actor}')`,'service_role');
  const namesFor=(actor,count,start=0)=>Array.from({length:count},(_,i)=>`${actor}/folder/sheet-${String(start+i).padStart(5,'0')}.pdf`);
  const seedMetadata=names=>asRole(null,names.map(name=>upload(name)).join(';'),'storage_admin');
  // Synthetic existing cleanup intent: exercise the real candidate queue helper,
  // without inventing any provider operation or retiring a path during scanning.
  const seedQueue=names=>sql(names.map(name=>`SELECT survey_private.queue_document_storage_cleanup(${quote(name)})`).join(';'));
  const claimSql=(actor,limit=100)=>`SELECT public.claim_account_storage_cleanup(${quote(actor)}::uuid,${limit})`;
  const claim=(actor,limit=100)=>{const value=JSON.parse(asRole(null,claimSql(actor,limit),'service_role').stdout);assert.ok(Array.isArray(value.paths));assert.ok(value.paths.length<=limit);assert.equal(typeof value.has_remaining,'boolean');assert.equal(typeof value.cycle_complete,'boolean');return value;};
  const cycle=(actor,limit=100,maxCalls=20)=>{const pages=[];for(let n=0;n<maxCalls;n++){const page=claim(actor,limit);assert.equal(new Set(page.paths).size,page.paths.length);pages.push(page);if(page.cycle_complete)return pages;}throw Error('Owned fixture scan failed to finish a bounded cycle');};
  const dataSnapshot=actor=>[
    scalar(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY name),'[]') FROM storage.objects o WHERE bucket_id='documents' AND name LIKE '${actor}/%'`),
    scalar(`SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]') FROM documents d WHERE user_id='${actor}' OR file_path LIKE '${actor}/%'`),
    scalar(`SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY path),'[]') FROM ${queue} q WHERE path LIKE '${actor}/%'`),
    scalar('SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY path_hash),\'[]\') FROM survey_private.document_storage_path_guards g'),
  ];
  await check('more than 300 nested and raw object names advance before return and retry after a complete cycle',()=>{
    const actor=makeActor(10),names=[...namesFor(actor,347),`${actor}/a folder/raw %?# name.pdf`,`${actor}/nested/épreuve.pdf`,`${actor}/z.last`].sort();seedMetadata(names);close(actor);const before=dataSnapshot(actor);
    const pages=cycle(actor);assert.ok(pages.every(page=>page.has_remaining));assert.deepEqual(pages.flatMap(page=>page.paths),names);assert.deepEqual(dataSnapshot(actor),before);
    // No cleanup occurred after the first claim: a lost reply/failure must not
    // reset the cursor and repeat page one until all later work got a turn.
    assert.deepEqual(claim(actor).paths,names.slice(0,100));
  });
  await check('an exact last full page needs an empty final call before resetting the cycle',()=>{
    const actor=makeActor(11),names=namesFor(actor,300);seedMetadata(names);close(actor);
    const pages=cycle(actor);assert.deepEqual(pages.flatMap(page=>page.paths),names);assert.ok(pages.filter(page=>page.paths.length===100).every(page=>!page.cycle_complete));assert.deepEqual(pages.at(-1),{paths:[],has_remaining:true,cycle_complete:true});assert.deepEqual(claim(actor).paths,names.slice(0,100));
  });
  await check('metadata-only, queue-only and overlapping candidates are deduplicated per page without source writes',()=>{
    const actor=makeActor(12),metadata=`${actor}/metadata.pdf`,queued=`${actor}/queue.pdf`,both=`${actor}/both.pdf`;seedMetadata([metadata,both]);seedQueue([queued,both]);close(actor);const before=dataSnapshot(actor);
    const pages=cycle(actor);assert.deepEqual(new Set(pages.flatMap(page=>page.paths)),new Set([both,metadata,queued]));assert.ok(pages.every(page=>page.has_remaining));assert.deepEqual(dataSnapshot(actor),before);
  });
  await check('shared-only paths keep has_remaining true without returning any deletion candidate',()=>{
    const actor=makeActor(13),foreign=makeActor(14),names=namesFor(actor,3);seedMetadata(names);seedQueue(names);
    asRole(null,names.map((name,i)=>createDocument(1300+i,foreign,null,name)).join(';'),'service_role');close(actor);const before=dataSnapshot(actor);
    const pages=cycle(actor);assert.ok(pages.every(page=>page.has_remaining&&page.paths.length===0));assert.deepEqual(dataSnapshot(actor),before);
  });
  await check('more than 100 shared prefixes do not block later unreferenced raw-page work',()=>{
    const actor=makeActor(15),foreign=makeActor(16),shared=namesFor(actor,120),healthy=namesFor(actor,5,120);seedMetadata([...shared,...healthy]);seedQueue(shared);
    asRole(null,shared.map((name,i)=>createDocument(1500+i,foreign,null,name)).join(';'),'service_role');close(actor);
    assert.deepEqual(claim(actor),{paths:[],has_remaining:true,cycle_complete:false});const rest=cycle(actor);assert.deepEqual(new Set(rest.flatMap(page=>page.paths)),new Set(healthy));assert.ok(rest.every(page=>page.has_remaining));
  });
  await check('empty closing accounts finish a cycle with no remaining provider metadata or queue evidence',()=>{
    const actor=makeActor(17);close(actor);assert.deepEqual(claim(actor),{paths:[],has_remaining:false,cycle_complete:true});assert.deepEqual(claim(actor),{paths:[],has_remaining:false,cycle_complete:true});
  });
  const cursors='survey_private.account_storage_cleanup_scans';
  const cursorSnapshot=()=>scalar(`SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY user_id),'[]') FROM ${cursors} s`);
  await check('scan denies absent/open accounts, malformed input and untrusted caller roles without advancing cursors',()=>{
    const open=makeActor(18),closed=makeActor(19);close(closed);const before=cursorSnapshot();
    for(const target of [open,user(999)])errorState(asRole(null,claimSql(target),'service_role',false),'23514');
    for(const statement of [claimSql(null),claimSql(closed,'NULL'),claimSql(closed,0),claimSql(closed,101),claimSql(closed,-1)])errorState(asRole(null,statement,'service_role',false),'22023');
    for(const role of ['anon','authenticated','closing_member'])errorState(asRole(closed,claimSql(closed),role,false),'42501');
    errorState(sql(`${actorContext(closed)}SET request.jwt.claim.role='service_role';${claimSql(closed)}`,false),'42501');
    const args=[...psqlArgs];args[args.indexOf('-U')+1]='closing_member';errorState(run('psql',[...args,'-c',`SET request.jwt.claim.sub='${closed}';SET request.jwt.claim.role='service_role';${claimSql(closed)}`],false),'42501');
    for(const role of ['anon','authenticated','service_role'])errorState(asRole(closed,`SELECT * FROM ${cursors}`,role,false),'42501');assert.equal(cursorSnapshot(),before);
  });
  await check('exact canonical UUID slash bounds exclude neighboring prefixes and other buckets',()=>{
    const actor=makeActor(20),other=makeActor(21),valid=`${actor}/valid.pdf`,foreign=[`${other}/foreign.pdf`,`${actor}0/wrong.pdf`,`${actor}-suffix/wrong.pdf`,`${actor}wrong.pdf`];seedMetadata([valid,...foreign]);seedQueue([valid,...foreign]);asRole(null,upload(`${actor}/other-bucket.pdf`,'other'),'storage_admin');close(actor);
    const pages=cycle(actor);assert.deepEqual(new Set(pages.flatMap(page=>page.paths)),new Set([valid]));assert.ok(pages.every(page=>page.has_remaining));
  });
  await check('rollback after returning a claim restores its cursor and offers the same page on retry',()=>{
    const actor=makeActor(22),names=namesFor(actor,250);seedMetadata(names);close(actor);const before=cursorSnapshot();
    errorState(asRole(null,`BEGIN;${claimSql(actor)};SELECT 1/0;COMMIT`,'service_role',false),'22012');assert.equal(cursorSnapshot(),before);assert.ok(claim(actor).paths.length>0);
  });
  await check('concurrent same-account claims serialize the cursor and commit distinct pages',async()=>{
    const actor=makeActor(23),names=namesFor(actor,350),queued=namesFor(actor,10,1000);seedMetadata(names);seedQueue(queued);close(actor);
    const first=session('account-scan-first');first.send(claimSql(actor)+";SELECT 'CLAIMED';");await first.wait('CLAIMED');
    const second=session('account-scan-second');second.send(claimSql(actor)+';');await blocked(second.name);const firstResult=await first.finish();assert.equal(firstResult.status,0);const secondResult=await second.finish();assert.equal(secondResult.status,0);
    const firstPaths=JSON.parse(firstResult.stdout.split('\n').find(line=>line.startsWith('{'))).paths,secondPaths=JSON.parse(secondResult.stdout.trim()).paths;
    assert.ok(firstPaths.length>0&&secondPaths.length>0);assert.ok(secondPaths.every(path=>!firstPaths.includes(path)));assert.ok(firstPaths.length+secondPaths.length<=200);
  });
  for(const isolation of ['REPEATABLE READ','SERIALIZABLE'])await check(`${isolation} scan is refused without changing cursor state`,async()=>{
    const actor=makeActor(isolation==='REPEATABLE READ'?24:25);close(actor);const before=cursorSnapshot(),first=session('old-scan-'+actor.slice(-2),'service_role',null,isolation);first.send(claimSql(actor)+';');errorState(await first.finish(),'25001');assert.equal(cursorSnapshot(),before);
  });
  await check('limit one alternates sources fairly and exhausted sources do not stall the other',()=>{
    const actor=makeActor(26),metadata=namesFor(actor,4),queued=namesFor(actor,2,1000);seedMetadata(metadata);seedQueue(queued);close(actor);
    const pages=cycle(actor,1,12);assert.deepEqual(new Set(pages.flatMap(page=>page.paths)),new Set([...metadata,...queued]));assert.ok(metadata.includes(pages[0].paths[0]));assert.ok(queued.includes(pages[1].paths[0]));assert.ok(pages.every(page=>page.has_remaining));
  });
  await check('wide incompressible Unicode paths remain insertable in the fixed-width queue index and scan exactly',()=>{
    const actor=makeActor(27);let random=0x12345678;const chars=Array.from({length:2011},()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return String.fromCharCode(0x4e00+((random>>>0)%20000));});const path=`${actor}/${chars.join('')}`;assert.equal(path.length,2048);seedQueue([path]);close(actor);
    assert.ok(Number(scalar(`SELECT pg_column_size(path) FROM ${queue} WHERE path=${quote(path)}`))>2704);
    // The fixture proves why a full text B-tree would regress this allowed key.
    errorState(sql(`CREATE TEMP TABLE fixture_wide_path(path text);CREATE INDEX fixture_wide_path_idx ON fixture_wide_path(path);INSERT INTO fixture_wide_path VALUES(${quote(path)})`,false),'54000');
    const pages=cycle(actor);assert.deepEqual(pages.flatMap(page=>page.paths),[path]);
  });
  await check('only a previously committed close may claim, including savepoint closure and rollback',()=>{
    for(const [index,savepoint] of [false,true].entries()){
      const actor=makeActor(28+index);seedMetadata(namesFor(actor,1));const before=cursorSnapshot();
      const statement=`BEGIN;${savepoint?'SAVEPOINT fixture_close;':''}SELECT public.delete_account_owned_rows('${actor}');${savepoint?'RELEASE SAVEPOINT fixture_close;':''}${claimSql(actor)};COMMIT`;
      const result=asRole(null,statement,'service_role',false);errorState(result,'23514');assert.match(result.stderr,/ACCOUNT_CLOSURE_NOT_COMMITTED/);assert.equal(cursorSnapshot(),before);assert.equal(scalar(`SELECT closing FROM ${guards} WHERE user_id='${actor}'`),'f');
      close(actor);assert.ok(claim(actor).paths.length>0);
      // Replaying an already committed close in the claim transaction is safe;
      // it must not replace the original closure receipt with the new top XID.
      asRole(null,`BEGIN;SELECT public.delete_account_owned_rows('${actor}');${claimSql(actor)};COMMIT`,'service_role');
    }
  });
  await check('pre-migration committed closure is backfilled and remains usable after auth deletion',()=>{
    assert.equal(scalar(`SELECT closing_xid IS NULL FROM ${cursors} WHERE user_id='${legacyClosed}'`),'t');assert.deepEqual(claim(legacyClosed).paths,[filePath(legacyClosed,1)]);sql(`DELETE FROM auth.users WHERE id='${legacyClosed}'`);assert.ok(cycle(legacyClosed).every(page=>page.has_remaining));
    assert.equal(scalar(`SELECT count(*) FROM pg_constraint WHERE conrelid='${cursors}'::regclass AND contype='f'`),'0');
  });
  await check('a missing receipt or suppressed cursor write fails closed without source mutation',()=>{
    const actor=makeActor(31);seedMetadata(namesFor(actor,1));close(actor);sql(`DELETE FROM ${cursors} WHERE user_id='${actor}'`);const before=dataSnapshot(actor);errorState(asRole(null,claimSql(actor),'service_role',false),'40001');assert.deepEqual(dataSnapshot(actor),before);
    const suppressed=makeActor(32);seedMetadata(namesFor(suppressed,1));close(suppressed);sql(`CREATE FUNCTION fixture_suppress_scan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${suppressed}' THEN RETURN NULL;END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_suppress_scan BEFORE UPDATE ON ${cursors} FOR EACH ROW EXECUTE FUNCTION fixture_suppress_scan()`);
    const cursorBefore=cursorSnapshot();errorState(asRole(null,claimSql(suppressed),'service_role',false),'40001');assert.equal(cursorSnapshot(),cursorBefore);sql(`DROP TRIGGER fixture_suppress_scan ON ${cursors};DROP FUNCTION fixture_suppress_scan()`);
  });
  await check('unfiltered absence overrides unfinished source state and returns an empty completed cycle',()=>{
    const actor=makeActor(33),names=namesFor(actor,100);seedMetadata(names);close(actor);assert.equal(claim(actor).cycle_complete,false);
    // Explicit database-only cleanup fixture, not provider proof: removes the
    // source records through their real retirement guards between scan calls.
    asRole(null,`SELECT public.retire_document_storage_paths(ARRAY[${names.map(quote).join(',')}])`,'service_role');asRole(null,`DELETE FROM storage.objects WHERE name=ANY(ARRAY[${names.map(quote).join(',')}])`,'storage_admin');asRole(null,`SELECT public.ack_document_storage_cleanup(ARRAY[${names.map(quote).join(',')}])`,'service_role');
    assert.deepEqual(claim(actor),{paths:[],has_remaining:false,cycle_complete:true});
  });
  await check('actual raw-page query plans use bounded indexes with 100k unrelated rows per source',()=>{
    const actor=makeActor(34),names=namesFor(actor,350);seedMetadata(names);seedQueue(names);close(actor);sql('ANALYZE storage.objects;ANALYZE survey_private.document_storage_cleanup;ANALYZE public.documents');
    const queries=[...source(migration).matchAll(/WITH raw_page AS MATERIALIZED[\s\S]*?INTO raw_count,(?:last_offered|last_hash),paths FROM raw_page r;/g)].map(match=>match[0]);assert.equal(queries.length,2);
    for(const [index,query] of queries.entries()){
      const exact=query.replace(/INTO raw_count,(?:last_offered|last_hash),paths FROM raw_page r;/,'FROM raw_page r;').replaceAll('cursor_row.last_storage_path','NULL::text').replaceAll('cursor_row.last_queue_hash',"NULL::bytea").replaceAll('target_user_id::text',`${quote(actor)}::text`).replaceAll('prefix_lower',quote(actor+'/')).replaceAll('prefix_upper',quote(actor+'0')).replaceAll('p_limit','100');
      const explained=JSON.parse(scalar(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${exact}`))[0];const nodes=[];const visit=node=>{nodes.push(node);for(const child of node.Plans||[])visit(child);};visit(explained.Plan);
      const raw=nodes.find(node=>node['Node Type']==='Limit'&&node['Subplan Name']==='CTE raw_page');assert.ok(raw,JSON.stringify(explained));assert.equal(raw['Actual Rows'],100);
      const relation=index===0?'objects':'document_storage_cleanup';const access=nodes.find(node=>node['Relation Name']===relation);assert.ok(access?.['Node Type'].includes('Index'),JSON.stringify(explained));assert.ok(access['Actual Rows']<=100);assert.ok((access['Rows Removed by Filter']||0)<=100);
      const references=nodes.filter(node=>node['Relation Name']==='documents');assert.ok(references.length>0,JSON.stringify(explained));for(const reference of references){assert.match(reference['Node Type'],/Index/);assert.equal(reference['Index Name'],'idx_documents_file_path');assert.ok(reference['Actual Loops']<=100);assert.ok(reference['Actual Rows']<=1);console.log(`PLAN references: ${reference['Node Type']} ${reference['Index Name']}; loops=${reference['Actual Loops']}; rows-per-loop=${reference['Actual Rows']}; filtered=${reference['Rows Removed by Filter']||0}`);}
      console.log(`PLAN ${relation}: ${access['Node Type']} ${access['Index Name']}; raw=${raw['Actual Rows']}; read=${access['Actual Rows']}; filtered=${access['Rows Removed by Filter']||0}; buffers=${explained.Plan['Shared Hit Blocks']||0}; milliseconds=${explained['Execution Time']}`);
    }
    assert.equal(scalar("SELECT count(*) FROM storage.objects WHERE name LIKE 'ffffffff-ffff-4fff-8fff-ffffffffffff/%'"),'100000');assert.equal(scalar(`SELECT count(*) FROM ${queue} WHERE path LIKE 'ffffffff-ffff-4fff-8fff-ffffffffffff/%'`),'100000');assert.equal(scalar("SELECT count(*) FROM documents WHERE user_id='ffffffff-ffff-4fff-8fff-ffffffffffff'"),'100000');
  });
  await check('migration replay preserves saved per-source progress and closure receipts',()=>{
    const actor=makeActor(35);seedMetadata(namesFor(actor,250));seedQueue(namesFor(actor,120,1000));close(actor);claim(actor);claim(actor);const before=JSON.parse(cursorSnapshot());apply(migration);const after=JSON.parse(cursorSnapshot());
    for(const row of before)assert.deepEqual(after.find(value=>value.user_id===row.user_id),row);
    // The earlier negative fixture deliberately removed this receipt. Replay
    // may backfill that committed closure, but must not reset any existing row.
    const added=after.filter(row=>!before.some(value=>value.user_id===row.user_id));assert.equal(added.length,1);assert.equal(added[0].user_id,user(31));assert.equal(added[0].closing_xid,null);assert.equal(added[0].last_storage_path,null);assert.equal(added[0].last_queue_hash,null);
    const repaired=cursorSnapshot();apply(migration);assert.equal(cursorSnapshot(),repaired);assert.ok(claim(actor).paths.length>0);
  });
  console.log(`Account storage scan PostgreSQL checks passed: ${checks}`);
}finally{
  for(const child of children)child.kill('SIGKILL');
  if(started){if(run('pg_ctl',['-D',data,'status'],false).status===0)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);assert.equal(run('pg_ctl',['-D',data,'status'],false).status,3,'owned local server stopped before cleanup');}
  assert.ok(temp.startsWith('/tmp/survey-account-scan-')&&data===join(temp,'data'));rmSync(temp,{recursive:true,force:true});
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
