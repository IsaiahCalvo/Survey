// Real installed PostgreSQL; Storage is SQL metadata only, not a provider test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
assert.equal(process.argv.length,2,'This disposable local fixture accepts no arguments');
const migrationPath=name=>fileURLToPath(new URL(`../supabase/migrations/${name}`,import.meta.url));
const target='20260909070000_document_generation_storage_references.sql';
const id=n=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
await withDisposablePostgres(async pg=>{
  const {sql,scalar,asRole,errorState,session,applyMigration,quote}=pg;
  let checks=0;
  const check=async(name,work)=>{await work();checks++;console.log(`PASS ${name}`);};
  // Minimal core tables and permissive fixture RLS isolate actual tracked
  // retirement/closing/publication/quota code, not the app's complete RLS.
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
    CREATE FUNCTION get_actual_storage_usage(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT coalesce(sum((metadata->>'size')::bigint),0) FROM storage.objects WHERE bucket_id='documents' AND name LIKE $1::text || '/%' $$;`);
  for(const migration of ['20260908160000_document_quota_guard.sql','20260908200000_document_identity_tombstones.sql',
    '20260908201000_document_publication_authorization.sql','20260908220000_document_storage_retirement.sql',
    '20260908230000_account_storage_closing.sql','20260909000000_account_storage_cleanup_scan.sql']) applyMigration(migrationPath(migration));
  // Install the prior trigger signature, then load the actual latest byte gate.
  sql(`CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    CREATE FUNCTION enforce_documents_storage_quota() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER enforce_documents_storage_quota BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION enforce_documents_storage_quota();
    CREATE INDEX idx_documents_file_path ON public.documents(file_path);`);
  applyMigration(migrationPath('20260908161000_storage_quota_guard.sql'));
  const owner=id(1),other=id(2);
  sql(`INSERT INTO auth.users VALUES('${owner}'),('${other}')`);
  const refs='survey_private.document_generation_storage_references',queue='survey_private.document_storage_cleanup';
  const path=n=>`${owner}/generation-${n}.pdf`;
  const document=(n,actor=owner,filePath=`${actor}/original-${n}.pdf`)=>{
    sql(`INSERT INTO documents(id,user_id,name,file_path,file_size) VALUES('${id(n)}','${actor}','fixture',${quote(filePath)},4)`);return id(n);
  };
  const reserve=(doc,p,generation=id(900))=>`INSERT INTO ${refs}(document_id,generation_id,path) VALUES('${doc}','${generation}',${quote(p)})`;
  const release=(doc,p)=>`DELETE FROM ${refs} WHERE document_id='${doc}' AND path=${quote(p)}`;
  const upload=(p,size=4)=>`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(p)},'v1',jsonb_build_object('size',${size}))`;
  const remove=p=>`DELETE FROM storage.objects WHERE bucket_id='documents' AND name=${quote(p)}`;
  const retireSql=p=>`SELECT public.retire_document_storage_paths(ARRAY[${quote(p)}])`;
  const retire=p=>JSON.parse(asRole(null,retireSql(p),'service_role').stdout);
  const ack=p=>JSON.parse(asRole(null,`SELECT public.ack_document_storage_cleanup(ARRAY[${quote(p)}])`,'service_role').stdout);
  const referenced=p=>scalar(`SELECT survey_private.document_storage_path_is_referenced(${quote(p)})`);
  const queued=p=>scalar(`SELECT count(*) FROM ${queue} WHERE path=${quote(p)}`);
  const list=()=>JSON.parse(asRole(null,'SELECT public.list_document_storage_cleanup(100)','service_role').stdout).paths;
  // Predicate not yet installed: prove the existing path-only retirement can
  // retire an uploaded non-current path, the case a reservation must prevent.
  await check('baseline path-only cleanup retires a non-current uploaded path',()=>{
    sql(upload(path(0)));assert.deepEqual(retire(path(0)).retired_paths,[path(0)]);sql(remove(path(0)));
  });
  const preservedFunctions=scalar(`SELECT pg_get_functiondef('public.enforce_documents_storage_quota()'::regprocedure)`);
  const policies=scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p');
  applyMigration(migrationPath(target));
  await check('migration replay preserves byte quota, policies, active paths and reference rows',()=>{
    const d=document(100);sql(reserve(d,path(100)));const before=scalar(`SELECT jsonb_agg(to_jsonb(r)) FROM ${refs} r`);
    applyMigration(migrationPath(target));assert.equal(scalar(`SELECT jsonb_agg(to_jsonb(r)) FROM ${refs} r`),before);
    assert.equal(scalar(`SELECT pg_get_functiondef('public.enforce_documents_storage_quota()'::regprocedure)`),preservedFunctions);
    assert.equal(scalar('SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p'),policies);
    assert.equal(scalar(`SELECT file_path FROM documents WHERE id='${d}'`),`${owner}/original-100.pdf`);
  });
  await check('private ledger and reference predicate deny raw clients and service role',()=>{
    for(const role of ['anon','authenticated','service_role']) {
      for(const statement of [reserve(id(100),path(101)),`SELECT * FROM ${refs}`,`UPDATE ${refs} SET path='x'`,
        `DELETE FROM ${refs}`,`TRUNCATE ${refs}`,`SELECT survey_private.document_storage_path_is_referenced(${quote(path(100))})`]) {
        errorState(asRole(owner,statement,role,false),'42501');
      }
    }
  });
  await check('reservation requires real document, exact owner namespace and generated immutable hash',()=>{
    errorState(sql(reserve(id(9999),path(2)),false),'23503');
    for(const p of [`${other}/wrong.pdf`,`${owner}/../wrong.pdf`,`${owner}/x?bad`,
      `{${owner}}/bad.pdf`,`${owner.replaceAll('-','')}/bad.pdf`]) {
      errorState(sql(reserve(id(100),p),false),'42501');
    }
    assert.equal(scalar(`SELECT encode(path_hash,'hex')=encode(survey_private.document_storage_path_hash(path),'hex') FROM ${refs} WHERE document_id='${id(100)}'`),'t');
    errorState(sql(`UPDATE ${refs} SET created_at=created_at WHERE document_id='${id(100)}'`,false),'23514');
    errorState(sql(`INSERT INTO ${refs}(document_id,generation_id,path,path_hash) VALUES('${id(100)}','${id(901)}',${quote(path(101))},decode(repeat('00',32),'hex'))`,false),'428C9');
    const longPath=`${owner}/${'界'.repeat(1900)}.pdf`;sql(reserve(id(100),longPath,id(902)));assert.equal(referenced(longPath),'t');
  });
  await check('reserve before upload protects retained and staged paths in retirement/list/ack',()=>{
    const d=document(101),p=path(101);sql(reserve(d,p));assert.equal(referenced(p),'t');
    sql(`SELECT survey_private.queue_document_storage_cleanup(${quote(p)})`);
    assert.deepEqual(retire(p).referenced_paths,[p]);assert.equal(list().includes(p),false);
    assert.deepEqual(ack(p).pending_paths,[p]);assert.equal(queued(p),'1');
    sql(upload(p));errorState(sql(remove(p),false),'23514');
    assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(p)}`),'1');
  });
  await check('release queues cleanup and last reference must leave before retirement',()=>{
    const a=document(102),b=document(103),p=path(102);sql(reserve(a,p));sql(reserve(b,p));sql(upload(p));
    sql(release(a,p));assert.equal(queued(p),'1');assert.deepEqual(retire(p).referenced_paths,[p]);
    sql(release(b,p));assert.deepEqual(retire(p).retired_paths,[p]);sql(remove(p));assert.deepEqual(ack(p).acknowledged_paths,[p]);
    errorState(sql(reserve(a,p),false),'23514');
  });
  await check('one path can have multiple generation receipts and release rollback preserves evidence',async()=>{
    const d=document(115),p=path(115);sql(reserve(d,p,id(910)));sql(reserve(d,p,id(911)));
    errorState(sql(reserve(d,p,id(910)),false),'23505');
    const writer=session('release_rollback',{role:'postgres'});
    writer.send(`${release(d,p)}; SELECT 'held';`);await writer.wait('held');
    errorState(asRole(null,retireSql(p),'service_role',false),'55P03');await writer.finish(false);
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${d}'`),'2');assert.equal(queued(p),'0');
    sql(`DELETE FROM ${refs} WHERE document_id='${d}' AND generation_id='${id(910)}'`);
    assert.deepEqual(retire(p).referenced_paths,[p]);
  });
  await check('final object deletion rechecks ledger even with a privileged inconsistent retired guard',()=>{
    const d=document(116),p=path(116);sql(reserve(d,p));sql(upload(p));
    // Deliberate fixture corruption exercises the final guard independently
    // from the normal retirement RPC, which never authorizes a referenced path.
    sql(`UPDATE survey_private.document_storage_path_guards SET retired=true,retirement_xid=pg_current_xact_id()
      WHERE path_hash=survey_private.document_storage_path_hash(${quote(p)})`);
    const result=sql(remove(p),false);errorState(result,'23514');assert.match(result.stderr,/DOCUMENT_STORAGE_PATH_REFERENCED/);
    assert.deepEqual(ack(p).pending_paths,[p]);
  });
  await check('reserve-first blocks retirement promptly and retry sees committed reference',async()=>{
    const d=document(104),p=path(104),writer=session('reserve_first',{role:'postgres'});
    writer.send(`${reserve(d,p)}; SELECT 'held';`);await writer.wait('held');
    errorState(asRole(null,retireSql(p),'service_role',false),'55P03');
    assert.equal((await writer.finish()).status,0);assert.deepEqual(retire(p).referenced_paths,[p]);
  });
  await check('retire-first blocks reservation promptly and committed retirement stays permanent',async()=>{
    const d=document(105),p=path(105),retirer=session('retire_first',{role:'service_role'});
    retirer.send(`${retireSql(p)}; SELECT 'held';`);await retirer.wait('held');
    errorState(sql(reserve(d,p),false),'55P03');assert.equal((await retirer.finish()).status,0);
    errorState(sql(reserve(d,p),false),'23514');
  });
  await check('reservation rollback leaves no reference or path mutation',async()=>{
    const d=document(106),p=path(106),writer=session('reserve_rollback',{role:'postgres'});
    writer.send(`${reserve(d,p)}; SELECT 'held';`);await writer.wait('held');await writer.finish(false);
    assert.equal(referenced(p),'f');assert.equal(scalar(`SELECT count(*) FROM survey_private.document_storage_path_guards WHERE path_hash=survey_private.document_storage_path_hash(${quote(p)})`),'0');
    assert.deepEqual(retire(p).retired_paths,[p]);
  });
  await check('document cascade releases its refs while another document keeps shared generation bytes',()=>{
    const a=document(107),b=document(108),p=path(107);sql(reserve(a,p));sql(reserve(b,p));sql(upload(p));
    sql(`DELETE FROM documents WHERE id='${a}'`);assert.equal(queued(p),'1');assert.equal(referenced(p),'t');
    sql(`DELETE FROM documents WHERE id='${b}'`);assert.equal(referenced(p),'f');assert.deepEqual(retire(p).retired_paths,[p]);
  });
  await check('document deletion and reservation cannot cross without retry',async()=>{
    const d=document(109),writer=session('delete_first',{role:'postgres'});
    writer.send(`DELETE FROM documents WHERE id='${d}'; SELECT 'held';`);await writer.wait('held');
    errorState(sql(reserve(d,path(109)),false),'55P03');assert.equal((await writer.finish()).status,0);
    errorState(sql(reserve(d,path(109)),false),'23503');
  });
  await check('reservation-first blocks document deletion while independent documents progress',async()=>{
    const a=document(117),b=document(118),p=path(117),writer=session('reserve_blocks_delete',{role:'postgres'});
    writer.send(`${reserve(a,p)}; SELECT 'held';`);await writer.wait('held');
    errorState(sql(`SET lock_timeout='100ms'; DELETE FROM documents WHERE id='${a}'`,false),'55P03');
    sql(reserve(b,path(118)));assert.equal(referenced(path(118)),'t');
    assert.equal((await writer.finish()).status,0);sql(`DELETE FROM documents WHERE id='${a}'`);
    assert.equal(referenced(p),'f');assert.equal(queued(p),'1');
  });
  await check('closing account rejects privileged reservation and cascades queued refs',()=>{
    const actor=id(3);sql(`INSERT INTO auth.users VALUES('${actor}')`);const d=document(110,actor),p=`${actor}/retained.pdf`;
    // Test-only service definer entry proves the trigger itself enforces closing
    // when a future checked service RPC owns writes; product has no such RPC.
    sql(`CREATE FUNCTION public.fixture_service_reserve(d uuid,p text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
      BEGIN INSERT INTO ${refs}(document_id,generation_id,path) VALUES(d,gen_random_uuid(),p); END $$;
      REVOKE ALL ON FUNCTION public.fixture_service_reserve(uuid,text) FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION public.fixture_service_reserve(uuid,text) TO service_role;`);
    sql(reserve(d,p));asRole(null,`SELECT fixture_service_reserve('${d}','${actor}/service.pdf')`,'service_role');
    sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${actor}'`);
    errorState(sql(reserve(d,`${actor}/late.pdf`),false),'23514');
    errorState(asRole(null,`SELECT fixture_service_reserve('${d}','${actor}/service-late.pdf')`,'service_role',false),'23514');
    asRole(null,`SELECT delete_account_owned_rows('${actor}')`,'service_role');assert.equal(queued(p),'1');
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${d}'`),'0');
  });
  await check('account scan skips referenced paths from both sources but reports remaining',()=>{
    const actor=id(4);sql(`INSERT INTO auth.users VALUES('${actor}')`);const d=document(111,actor),p=`${actor}/retained.pdf`;
    sql(reserve(d,p));sql(upload(p));sql(`SELECT survey_private.queue_document_storage_cleanup(${quote(p)})`);
    // Mark closing without deleting the fixture document to isolate the scan's
    // protected-reference branch; the real close RPC is exercised above.
    sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${actor}'`);
    for(let i=0;i<4;i++) {
      const row=JSON.parse(asRole(null,`SELECT claim_account_storage_cleanup('${actor}',100)`,'service_role').stdout);
      assert.deepEqual(row.paths,[]);assert.equal(row.has_remaining,true);
    }
  });
  await check('actual byte quota still counts old plus staged bytes and has no new exemptions',()=>{
    const actor=id(5);sql(`INSERT INTO auth.users VALUES('${actor}')`);const d=document(112,actor),p=`${actor}/new.pdf`;
    sql(`CREATE OR REPLACE FUNCTION get_storage_limit(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT CASE WHEN $1='${actor}'::uuid THEN 8 ELSE 1000000000 END::bigint $$`);
    sql(upload(`${actor}/old.pdf`,4));sql(reserve(d,p));sql(upload(p,4));
    const third=`${actor}/third.pdf`;sql(reserve(d,third,id(903)));errorState(sql(upload(third,1),false),'42501');
    assert.equal(scalar(`SELECT get_actual_storage_usage('${actor}')`),'8');
    assert.equal(scalar(`SELECT pg_get_functiondef('public.enforce_documents_storage_quota()'::regprocedure)`),preservedFunctions);
    // This foundation does NOT promise immutable object bytes; existing upserts
    // retain their prior behavior until the guarded provider route is designed.
    sql(`UPDATE storage.objects SET version='v2',metadata='{"size":3}' WHERE name=${quote(p)}`);
    assert.equal(scalar(`SELECT get_actual_storage_usage('${actor}')`),'7');
  });
  for(const isolation of ['REPEATABLE READ','SERIALIZABLE']) await check(`${isolation} stale reserve rejects retirement committed after its snapshot`,async()=>{
    const n=isolation==='REPEATABLE READ'?113:114,d=document(n),p=path(n),writer=session(`stale_${n}`,{role:'postgres',isolation});
    writer.send(`SELECT count(*) FROM ${refs}; SELECT 'snapshot';`);await writer.wait('snapshot');retire(p);
    writer.send(`${reserve(d,p)};`);errorState(await writer.done,'40001');
  });
  console.log(`Document generation storage reference PostgreSQL checks passed: ${checks}`);
},{name:'generation-storage-refs'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
