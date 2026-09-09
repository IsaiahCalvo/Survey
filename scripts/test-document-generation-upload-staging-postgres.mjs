// Installed disposable PostgreSQL only. Storage objects are metadata, not proof
// of provider bytes, signed-token behavior, or the deployed Storage version.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
assert.equal(process.argv.length,2,'This isolated local fixture accepts no arguments');
const target='20260909080000_document_generation_upload_staging.sql';
const migrationPath=name=>fileURLToPath(new URL(`../supabase/migrations/${name}`,import.meta.url));
const source=name=>readFileSync(migrationPath(name),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`81000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4),project=id(5),sha='a'.repeat(64),version=id(9);

await withDisposablePostgres(async pg=>{
  const {sql,scalar,asRole,errorState,session,blocked,applyMigration,quote}=pg;
  // Reuse the exact existing local fixture bootstrap (roles/core schema plus
  // actual quota, retirement, closing and scan migrations), not its test cases.
  // Its permissive fixture Storage RLS is intentional: the new restrictive
  // policies and final all-role guard must hold even with broad owner grants.
  const prior=readFileSync(new URL('./test-document-generation-storage-references-postgres.mjs',import.meta.url),'utf8');
  const start=prior.indexOf('sql(`CREATE ROLE'),end=prior.indexOf('  const owner=');
  assert.ok(start>=0&&end>start);
  new Function('sql','applyMigration','migrationPath',prior.slice(start,end))(sql,applyMigration,migrationPath);
  sql(`CREATE PUBLICATION supabase_realtime;
    ALTER TABLE documents ADD COLUMN page_count integer,ADD COLUMN locked_at timestamptz,ADD COLUMN locked_by uuid,ADD COLUMN locked_label text;
    INSERT INTO auth.users VALUES('${owner}'),('${editor}'),('${viewer}'),('${other}');
    INSERT INTO projects(id,user_id,name) VALUES('${project}','${owner}','Fixture');
    INSERT INTO project_collaborators VALUES('${project}','${editor}','editor','active'),('${project}','${viewer}','viewer','active');`);
  sql(fn('20260802000000_kal426_user_archive_foundation.sql','user_can_access_document'));
  sql(fn('20260802000000_kal426_user_archive_foundation.sql','user_can_access_project'));
  const annotations=source('20241230000002_create_document_annotations.sql').match(/CREATE TABLE IF NOT EXISTS document_annotations \([\s\S]*?\n\);/)?.[0];
  assert.ok(annotations);sql(annotations);sql('ALTER TABLE document_annotations RENAME COLUMN highlight_id TO annotation_id');
  applyMigration(migrationPath('20260522000000_kal49_document_lock_state.sql'));
  applyMigration(migrationPath('20260428000000_phase27_crdt_foundation_schema.sql'));
  const phase28=source('20260504000000_phase28_transport_auth_validator.sql');
  sql(phase28.slice(phase28.indexOf('DROP POLICY IF EXISTS doc_yjs_updates_phase27_stub_deny_all'),phase28.lastIndexOf('COMMIT;')));
  applyMigration(migrationPath('20260603130000_db_sync_annotations_changed_at.sql'));
  applyMigration(migrationPath('20260606120000_rebuild_yjs_source_of_truth.sql'));
  applyMigration(migrationPath('20241230000001_create_survey_realtime_tables.sql'));
  sql(`ALTER TABLE survey_items RENAME COLUMN highlight_id TO annotation_id;ALTER TABLE survey_items RENAME COLUMN ball_in_court_entity_id TO entity_id;ALTER TABLE survey_items RENAME COLUMN ball_in_court_name TO entity_name;
    GRANT ALL ON document_annotations,doc_yjs_state,doc_yjs_updates,annotation_updates,annotation_snapshots,survey_sessions,survey_items TO authenticated,service_role;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;`);
  for(const name of ['20260727131230_annotation_wal_concurrency.sql','20260909040000_annotation_write_authorization.sql',
    '20260909050000_legacy_annotation_revision.sql','20260909060000_document_survey_revision.sql',
    '20260909070000_document_generation_storage_references.sql','20260909071000_annotation_destructive_write_fence.sql',
    '20260909072000_document_publication_source_capture.sql']) applyMigration(migrationPath(name));
  const uploads='survey_private.document_generation_uploads',refs='survey_private.document_generation_storage_references';
  const doc=n=>{sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size,page_count) VALUES('${id(n)}','${owner}','${project}','Fixture','${owner}/original-${n}.pdf',4,1)`);return id(n);};
  const beginSql=(d,n,hash=sha,bytes=4)=>`SELECT public.begin_document_generation_upload('${d}','${id(n)}',${quote(hash)},${bytes})`;
  const begin=(d,n,actor=owner)=>JSON.parse(asRole(actor,beginSql(d,n)).stdout);
  const get=(n,actor=owner)=>JSON.parse(asRole(actor,`SELECT public.get_document_generation_upload('${id(n)}')`).stdout);
  const cancel=(n,actor=owner)=>JSON.parse(asRole(actor,`SELECT public.cancel_document_generation_upload('${id(n)}')`).stdout);
  const put=(u,v=version,size=4)=>`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},${quote(v)},${size===null?'NULL':`jsonb_build_object('size',${size})`})`;
  const claimSql=(n,c,actor=owner)=>`SELECT public.claim_document_generation_upload_verification('${actor}','${id(n)}','${id(c)}')`;
  const claim=(n,c,actor=owner)=>JSON.parse(asRole(null,claimSql(n,c,actor),'service_role').stdout);
  const release=(n,c,actor=owner)=>JSON.parse(asRole(null,`SELECT public.release_document_generation_upload_verification('${actor}','${id(n)}','${id(c)}')`,'service_role').stdout);
  const recordSql=(u,c,actor=owner)=>`SELECT public.record_document_generation_upload_verification('${actor}','${u.operation_id}','${u.object.id}',${quote(u.object.version)},${quote(u.content_sha256)},${u.byte_length},'${id(c)}')`;
  const record=(u,c,actor=owner)=>JSON.parse(asRole(null,recordSql(u,c,actor),'service_role').stdout);
  const rejectSql=(u,c,observed='b'.repeat(64),actor=owner,bytes=u.byte_length)=>`SELECT public.reject_document_generation_upload_verification('${actor}','${u.operation_id}','${id(c)}','${u.object.id}',${quote(u.object.version)},${quote(observed)},${bytes})`;
  const reject=(u,c,observed='b'.repeat(64),actor=owner)=>JSON.parse(asRole(null,rejectSql(u,c,observed,actor),'service_role').stdout);
  const expired=n=>sql(`UPDATE ${uploads} SET expires_at=clock_timestamp()-interval '1 second' WHERE operation_id='${id(n)}'`);
  let checks=0;
  const check=async(label,run)=>{await run();checks++;console.log(`PASS ${label}`);
    sql(`SELECT survey_private.cancel_document_generation_upload(operation_id) FROM ${uploads} WHERE state<>'canceled'`);
    sql(`DELETE FROM storage.objects o WHERE bucket_id='documents' AND EXISTS(SELECT 1 FROM ${uploads} u WHERE u.path=o.name AND u.state='canceled')
      AND NOT survey_private.document_storage_path_is_referenced(o.name)`);};

  // Baseline: existing guards protect references but do not make their bytes
  // immutable. Real provider physical versions are NOT modeled by this update.
  const baselineDoc=doc(90),baselinePath=`${owner}/generation-baseline.pdf`;
  sql(`INSERT INTO ${refs}(document_id,generation_id,path) VALUES('${baselineDoc}','${id(91)}','${baselinePath}');
    INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${baselinePath}','${version}','{"size":4}');
    UPDATE storage.objects SET version='${id(8)}' WHERE name='${baselinePath}'`);
  assert.equal(scalar(`SELECT version FROM storage.objects WHERE name='${baselinePath}'`),id(8));
  console.log('PASS baseline retained path accepts a different Storage version');
  const quotaBefore=scalar(`SELECT pg_get_functiondef('public.enforce_documents_storage_quota()'::regprocedure)`);
  const pointerBefore=scalar(`SELECT pg_get_functiondef('public.enforce_documents_file_path_immutable()'::regprocedure)`);
  const collision=`${owner}/_generations/unrelated.pdf`;
  sql(`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(collision)},'${version}','{"size":4}')`);
  assert.throws(()=>applyMigration(migrationPath(target)),/23514: Unregistered generation/);
  assert.equal(scalar(`SELECT to_regclass('${uploads}') IS NULL`),'t');
  assert.equal(scalar(`SELECT version FROM storage.objects WHERE name=${quote(collision)}`),version);
  asRole(null,`SELECT public.retire_document_storage_paths(ARRAY[${quote(collision)}])`,'service_role');
  sql(`DELETE FROM storage.objects WHERE name=${quote(collision)}`);
  console.log('PASS namespace collision aborts migration atomically without altering existing objects');
  applyMigration(migrationPath(target));
  await check('replay preserves existing functions, paths and operation identity',()=>{
    const d=doc(100),u=begin(d,1000);applyMigration(migrationPath(target));assert.deepEqual(begin(d,1000),u);
    assert.equal(scalar(`SELECT pg_get_functiondef('public.enforce_documents_storage_quota()'::regprocedure)`),quotaBefore);
    assert.equal(scalar(`SELECT pg_get_functiondef('public.enforce_documents_file_path_immutable()'::regprocedure)`),pointerBefore);
    assert.equal(scalar(`SELECT file_path FROM documents WHERE id='${d}'`),`${owner}/original-100.pdf`);
  });
  await check('begin captures exact SQL hash, durable pin, owner path and string bytes',()=>{
    const d=doc(101),expected=JSON.parse(asRole(owner,`SELECT survey_private.capture_document_publication_sources('${d}')`,'postgres').stdout);
    const u=begin(d,1001,editor);assert.equal(u.owner_user_id,owner);assert.equal(u.actor_user_id,editor);assert.equal(u.byte_length,'4');
    const actorCapture=JSON.parse(asRole(editor,`SELECT survey_private.capture_document_publication_sources('${d}')`,'postgres').stdout);
    assert.equal(u.source_sql_sha256,actorCapture.compare.sql_sha256);assert.notEqual(u.source_sql_sha256,expected.compare.sql_sha256);
    assert.equal(u.path,`${owner}/_generations/${d}/${u.generation_id}/${u.operation_id}.pdf`);
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(u.path)}`),'1');
    assert.ok(Date.parse(u.expires_at)>Date.now()+7_000_000);assert.equal(u.object,null);
    assert.equal('verification_claim_id' in u,false);
  });
  await check('operation replay keeps source after edits and rejects altered inputs/actors',()=>{
    const d=doc(102),u=begin(d,1002);sql(`UPDATE documents SET annotations='{"new":true}' WHERE id='${d}'`);
    assert.deepEqual(begin(d,1002),u);
    errorState(asRole(owner,beginSql(d,1002,'b'.repeat(64)), 'authenticated',false),'22023');
    errorState(asRole(editor,beginSql(d,1002),'authenticated',false),'42501');
    errorState(asRole(editor,`SELECT public.get_document_generation_upload('${id(1002)}')`,'authenticated',false),'42501');
  });
  await check('unknown/viewer/explicit viewer/locked sources reject without reservations',()=>{
    const d=doc(103);
    for(const actor of [viewer,other]) errorState(asRole(actor,beginSql(d,1003),'authenticated',false),'42501');
    sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`);
    errorState(asRole(editor,beginSql(d,1003),'authenticated',false),'42501');
    sql(`UPDATE documents SET locked_at=now() WHERE id='${d}'`);
    errorState(asRole(owner,beginSql(d,1003),'authenticated',false),'42501');
    assert.equal(scalar(`SELECT count(*) FROM ${uploads} WHERE operation_id='${id(1003)}'`),'0');
  });
  await check('raw clients cannot reserve, verify, or write protected Storage',()=>{
    const d=doc(104),u=begin(d,1004);
    for(const role of ['anon','authenticated','service_role']) errorState(asRole(owner,`SELECT * FROM ${uploads}`,role,false),'42501');
    for(const role of ['anon','authenticated']) {
      errorState(asRole(owner,put(u),role,false),'42501');
      errorState(asRole(owner,claimSql(1004,4004),role,false),'42501');
      errorState(asRole(owner,'SELECT public.expire_document_generation_uploads(100)',role,false),'42501');
    }
    errorState(asRole(owner,`SET request.jwt.claim.role='service_role';${claimSql(1004,4004)}`,'authenticated',false),'42501');
  });
  await check('provider provisional inserts roll back and cannot become byte receipts',async()=>{
    const d=doc(105),u=begin(d,1005),s=session('permission_probe',{role:'storage_admin'});
    s.send(`${put(u,null,null)};SELECT 'probe';`);await s.wait('probe');await s.finish(false);
    assert.equal(get(1005).object,null);errorState(asRole(null,claimSql(1005,4005),'service_role',false),'23514');
    sql(put(u,'1',4));errorState(asRole(null,claimSql(1005,4005),'service_role',false),'23514');
  });
  await check('final Storage is write once for service too; quota remains actual bytes',()=>{
    const d=doc(106),u=begin(d,1006);sql(put(u));
    for(const change of [`version='${id(7)}'`,`name=name||'.new'`,`bucket_id='other'`,`id='${id(6)}'`,`metadata='{"size":5}'`])
      errorState(sql(`UPDATE storage.objects SET ${change} WHERE name=${quote(u.path)}`,false),'23514');
    errorState(sql(`${put(u,id(7))} ON CONFLICT(bucket_id,name) DO UPDATE SET version=EXCLUDED.version`,false),'23514');
    errorState(sql(`DELETE FROM storage.objects WHERE name=${quote(u.path)}`,false),'23514');
    assert.equal(get(1006).object.version,version);
    assert.equal(scalar(`SELECT get_actual_storage_usage('${owner}')`),'8');
  });
  await check('server claim is single flight and verification needs exact trusted receipt',()=>{
    const d=doc(107),u=begin(d,1007);sql(put(u));const c=claim(1007,4007);
    assert.equal(c.verification_claim_id,id(4007));assert.equal(c.object.version,version);
    assert.ok(Date.parse(c.verification_claim_expires_at)<=Date.now()+120_100);
    assert.equal('verification_claim_id' in get(1007),false);
    assert.deepEqual(claim(1007,4007),c);
    errorState(asRole(null,claimSql(1007,4107),'service_role',false),'40001');
    errorState(asRole(null,recordSql({...c,content_sha256:'b'.repeat(64)},4007),'service_role',false),'23514');
    errorState(asRole(null,recordSql(c,4107),'service_role',false),'40001');
    errorState(asRole(null,recordSql(c,4007,other),'service_role',false),'42501');
    const done=record(c,4007);assert.equal(done.state,'verified');assert.ok(done.verified_at);
    expired(1007);const historical=get(1007);assert.equal(historical.verified_at,done.verified_at);
    assert.deepEqual(record(c,4007),historical);assert.deepEqual(claim(1007,4107),historical);
    assert.equal(release(1007,4007).state,'verified');
  });
  await check('release/reclaim fences stale workers and never reuses claim identity',()=>{
    const d=doc(108),u=begin(d,1008);sql(put(u));const a=claim(1008,4008);
    release(1008,9999);errorState(asRole(null,claimSql(1008,4108),'service_role',false),'40001');
    release(1008,4008);const b=claim(1008,4108);
    errorState(asRole(null,recordSql(a,4008),'service_role',false),'40001');
    release(1008,4108);errorState(asRole(null,claimSql(1008,4008),'service_role',false),'40001');
    const c=claim(1008,4208);assert.equal(record(c,4208).state,'verified');
  });
  await check('cancel is durable, idempotent, retires before provider deletion and blocks late insert',()=>{
    const d=doc(109),u=begin(d,1009);sql(put(u));const c=claim(1009,4009);assert.equal(cancel(1009).state,'canceled');
    assert.equal(scalar(`SELECT retired FROM survey_private.document_storage_path_guards WHERE path_hash=survey_private.document_storage_path_hash(${quote(u.path)})`),'t');
    errorState(asRole(null,recordSql(c,4009),'service_role',false),'23514');
    sql(`DELETE FROM storage.objects WHERE name=${quote(u.path)}`);errorState(sql(put(u),false),'23514');
    assert.equal(cancel(1009).state,'canceled');assert.equal(begin(d,1009).state,'canceled');
  });
  await check('expired reservations fail admission and bounded expiry releases unactivated verified refs safely',()=>{
    const d=doc(110),u=begin(d,1010);expired(1010);
    errorState(sql(put(u),false),'23514');errorState(asRole(owner,beginSql(d,1010),'authenticated',false),'23514');
    errorState(asRole(owner,`SELECT public.get_document_generation_upload('${id(1010)}')`,'authenticated',false),'23514');
    const v=begin(d,1110);sql(put(v));record(claim(1110,4110),4110);expired(1110);
    const result=JSON.parse(asRole(null,'SELECT public.expire_document_generation_uploads(1)','service_role').stdout);
    assert.deepEqual(result.canceled_operation_ids,[id(1010)]);assert.equal(get(1110).state,'verified');
    const survivor=doc(210);sql(`INSERT INTO ${refs}(document_id,generation_id,path) VALUES('${survivor}','${id(2110)}',${quote(v.path)})`);
    const next=JSON.parse(asRole(null,'SELECT public.expire_document_generation_uploads(1)','service_role').stdout);
    assert.deepEqual(next.canceled_operation_ids,[id(1110)]);const terminal=get(1110);assert.equal(terminal.state,'canceled');assert.ok(terminal.verified_at);
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(v.path)}`),'1');
    errorState(sql(`DELETE FROM storage.objects WHERE name=${quote(v.path)}`,false),'23514');
    for(const limit of [0,101]) errorState(asRole(null,`SELECT public.expire_document_generation_uploads(${limit})`,'service_role',false),'22023');
  });
  await check('reserved, expired and verified retained candidates all count toward document cap',()=>{
    const d=doc(111);for(let i=0;i<4;i++){const u=begin(d,1200+i);if(i===0){sql(put(u));record(claim(1200,4200),4200);}if(i===1)expired(1201);}
    errorState(asRole(owner,beginSql(d,1204),'authenticated',false),'54000');cancel(1201);assert.equal(begin(d,1204).state,'reserved');
  });
  await check('actor cap spans documents and expected bytes cannot exceed existing tier limit',()=>{
    for(let i=0;i<4;i++){const d=doc(130+i);for(let j=0;j<4;j++)begin(d,1300+i*4+j);}
    const d=doc(134);errorState(asRole(owner,beginSql(d,1399),'authenticated',false),'54000');
    errorState(asRole(owner,beginSql(d,1399,sha,1_000_000_001),'authenticated',false),'42501');
  });
  await check('revocation after reservation blocks get, final Storage and verification',()=>{
    const d=doc(112),u=begin(d,1012,editor);sql(put(u));const c=claim(1012,4012,editor);
    sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`);
    errorState(asRole(editor,`SELECT public.get_document_generation_upload('${id(1012)}')`,'authenticated',false),'42501');
    errorState(asRole(null,recordSql(c,4012,editor),'service_role',false),'42501');
    const d2=doc(113),u2=begin(d2,1013,editor);sql(`INSERT INTO document_collaborators VALUES('${d2}','${editor}','viewer','active')`);
    errorState(sql(put(u2),false),'42501');assert.equal(cancel(1013,editor).state,'canceled');
  });
  await check('accepted final insert holds role until commit and independent document progresses',async()=>{
    const d=doc(114),u=begin(d,1014,editor),s=session('final_insert',{role:'storage_admin'});
    s.send(`${put(u)};SELECT 'held';`);await s.wait('held');
    errorState(sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`,false),'55P03');
    // Same-owner physical uploads still serialize through the existing byte
    // quota counter. Unrelated document reservation does not take that lock.
    const independent=doc(115),v=begin(independent,1015);await s.finish();sql(put(v));
    sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`);
  });
  await check('delete cascade retains terminal operation identity and permanently retires late uploads',()=>{
    const d=doc(116),u=begin(d,1016);sql(`DELETE FROM documents WHERE id='${d}'`);
    assert.equal(get(1016).state,'canceled');assert.equal(begin(d,1016).state,'canceled');errorState(sql(put(u),false),'23514');
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(u.path)}`),'0');
  });
  await check('cancel rollback leaves reference, reservation and accepted object intact',async()=>{
    const d=doc(117),u=begin(d,1017);sql(put(u));const s=session('cancel_rollback',{role:'authenticated',actorId:owner});
    s.send(`SELECT public.cancel_document_generation_upload('${id(1017)}');SELECT 'held';`);await s.wait('held');
    errorState(asRole(null,claimSql(1017,4017),'service_role',false),'55P03');await s.finish(false);
    assert.equal(get(1017).state,'reserved');assert.equal(claim(1017,4017).object.version,version);
  });
  await check('READ COMMITTED guard rejects stale snapshot reservations and uploads',()=>{
    const d=doc(118),u=begin(d,1018);
    for(const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
      errorState(asRole(owner,`BEGIN ISOLATION LEVEL ${isolation};${beginSql(d,1118)};COMMIT`,'authenticated',false),'25001');
      errorState(sql(`BEGIN ISOLATION LEVEL ${isolation};${put(u)};COMMIT`,false),'25001');
    }
  });
  await check('closing actor/owner rejects upload even as service and restores scoped auth context',()=>{
    const d=doc(119),u=begin(d,1019,editor);
    sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${editor}'`);
    errorState(sql(put(u),false),'23514');sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${editor}'`);
    sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${owner}'`);
    errorState(sql(put(u),false),'23514');sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${owner}'`);
    const context=asRole(other,`${put(u)};SELECT auth.uid()`,'storage_admin').stdout;assert.equal(context,other);
  });
  await check('independent verifier claims progress while another document claim transaction is held',async()=>{
    const a=begin(doc(220),2200),b=begin(doc(221),2201);sql(put(a));sql(put(b));
    const held=session('claim_a',{role:'service_role'});held.send(`${claimSql(2200,5200)};SELECT 'held';`);await held.wait('held');
    assert.equal(claim(2201,5201).verification_claim_id,id(5201));
    errorState(asRole(null,claimSql(2200,5202),'service_role',false),'55P03');await held.finish();
  });
  await check('expiry skips locked operations and retries a contended path without losing evidence',async()=>{
    const a=begin(doc(222),2202),b=begin(doc(223),2203);expired(2202);expired(2203);
    const held=session('expiry_row',{role:'postgres'});held.send(`SELECT operation_id FROM ${uploads} WHERE operation_id='${id(2202)}' FOR UPDATE;SELECT 'held';`);await held.wait('held');
    const result=JSON.parse(asRole(null,'SELECT public.expire_document_generation_uploads(100)','service_role').stdout);
    assert.deepEqual(result.canceled_operation_ids,[id(2203)]);await held.finish();
    const pathHeld=session('expiry_path',{role:'postgres'});pathHeld.send(`SELECT survey_private.touch_document_storage_path(${quote(a.path)});SELECT 'held';`);await pathHeld.wait('held');
    const skipped=JSON.parse(asRole(null,'SELECT public.expire_document_generation_uploads(100)','service_role').stdout);
    assert.deepEqual(skipped.skipped_operation_ids,[id(2202)]);assert.equal(scalar(`SELECT state FROM ${uploads} WHERE operation_id='${id(2202)}'`),'reserved');
    await pathHeld.finish();assert.deepEqual(JSON.parse(asRole(null,'SELECT public.expire_document_generation_uploads(100)','service_role').stdout).canceled_operation_ids,[id(2202)]);
  });
  await check('actual aggregate quota rejects staged bytes without deleting prior bytes or reservation',()=>{
    const u=begin(doc(224),2204),used=Number(scalar(`SELECT get_actual_storage_usage('${owner}')`));
    sql(`CREATE OR REPLACE FUNCTION get_storage_limit(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT ${used+3}::bigint $$`);
    errorState(sql(put(u),false),'42501');assert.equal(get(2204).state,'reserved');assert.equal(get(2204).object,null);
    assert.equal(Number(scalar(`SELECT get_actual_storage_usage('${owner}')`)),used);
    sql(`CREATE OR REPLACE FUNCTION get_storage_limit(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT 1000000000::bigint $$`);
  });
  await check('trusted document transfer cannot admit a staged path under the former owner',()=>{
    const d=doc(225),u=begin(d,2205,editor);
    sql(`UPDATE documents SET user_id='${other}' WHERE id='${d}'`);
    errorState(sql(put(u),false),'42501');errorState(asRole(editor,`SELECT public.get_document_generation_upload('${id(2205)}')`,'authenticated',false),'42501');
  });
  await check('permission wait cannot admit final Storage after the fixed staging deadline',async()=>{
    const u=begin(doc(226),2206);
    sql(`UPDATE ${uploads} SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE operation_id='${id(2206)}'`);
    const blocker=session('admission_clock_blocker',{role:'postgres'});blocker.send(`SELECT user_id FROM survey_private.account_write_guards WHERE user_id='${owner}' FOR UPDATE;SELECT 'held';`);await blocker.wait('held');
    const writer=session('admission_clock_writer',{role:'storage_admin'});writer.send(put(u)+';');await blocked(writer.name);
    await new Promise(resolve=>setTimeout(resolve,450));await blocker.finish();errorState(await writer.finish(),'23514');
    assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(u.path)}`),'0');
  });
  await check('permission wait cannot settle verification after its claim deadline',async()=>{
    const u=begin(doc(227),2207);sql(put(u));const c=claim(2207,5207);
    sql(`UPDATE ${uploads} SET verification_claim_expires_at=clock_timestamp()+interval '400 milliseconds' WHERE operation_id='${id(2207)}'`);
    const blocker=session('verification_clock_blocker',{role:'postgres'});blocker.send(`SELECT user_id FROM survey_private.account_write_guards WHERE user_id='${owner}' FOR UPDATE;SELECT 'held';`);await blocker.wait('held');
    const writer=session('verification_clock_writer',{role:'service_role'});writer.send(recordSql(c,5207)+';');await blocked(writer.name);
    await new Promise(resolve=>setTimeout(resolve,450));await blocker.finish();errorState(await writer.finish(),'40001');assert.equal(get(2207).state,'reserved');
  });
  await check('verified descriptor fails closed if privileged corruption changes object proof',()=>{
    const u=begin(doc(228),2208);sql(put(u));record(claim(2208,5208),5208);
    // Corrupt only within this test transaction; a later rollback restores all
    // guards. No supported public/service route can perform this mutation.
    errorState(sql(`BEGIN;ALTER TABLE storage.objects DISABLE TRIGGER a_document_generation_upload_object_guard;
      UPDATE storage.objects SET version='${id(888)}' WHERE name=${quote(u.path)};
      SELECT survey_private.document_generation_upload_descriptor('${id(2208)}');COMMIT`,false),'23514');
    assert.equal(get(2208).object.version,version);
  });
  await check('ordinary legacy uploads remain writable and rejected scoped auth restores its caller',()=>{
    const d=doc(229),p=`${owner}/plain-legacy.pdf`;
    asRole(owner,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${p}','${version}','{"size":4}');UPDATE storage.objects SET version='${id(889)}' WHERE name='${p}'`);
    assert.equal(scalar(`SELECT version FROM storage.objects WHERE name='${p}'`),id(889));
    const result=asRole(owner,`DO $$ BEGIN BEGIN PERFORM survey_private.assert_document_generation_upload_authority('${other}','${d}'); EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$; SELECT auth.uid()`,'postgres');
    assert.equal(result.stdout,owner);
  });
  await check('full-size hash mismatch becomes one durable negative receipt and never a new claim',()=>{
    const d=doc(300),u=begin(d,3000);assert.equal(u.rejection,null);sql(put(u));const c=claim(3000,6000),r=reject(c,6000);
    assert.equal(r.state,'rejected');assert.equal(r.verified_at,null);
    assert.deepEqual(r.rejection,{reason:'sha256_mismatch',observed_sha256:'b'.repeat(64),byte_length:'4',
      object:{id:c.object.id,version},rejected_at:r.rejection.rejected_at});assert.ok(Date.parse(r.rejection.rejected_at));
    assert.deepEqual(reject(c,6000),r);assert.deepEqual(claim(3000,6100),r);assert.deepEqual(begin(d,3000),r);assert.deepEqual(get(3000),r);
    assert.equal(release(3000,6000).state,'rejected');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_generation_upload_claims WHERE operation_id='${id(3000)}'`),'1');
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(u.path)}`),'1');
    errorState(asRole(null,recordSql(c,6000),'service_role',false),'23514');
    errorState(sql(`${put(u,id(7))} ON CONFLICT(bucket_id,name) DO UPDATE SET version=EXCLUDED.version`,false),'23514');
    const saved=scalar(`SELECT to_jsonb(u) FROM ${uploads} u WHERE operation_id='${id(3000)}'`);
    applyMigration(migrationPath(target));assert.equal(scalar(`SELECT to_jsonb(u) FROM ${uploads} u WHERE operation_id='${id(3000)}'`),saved);
  });
  await check('negative receipts reject malformed, matching, short and extra-byte attestations',()=>{
    const u=begin(doc(301),3001);sql(put(u));const c=claim(3001,6001);
    for(const hash of [null,'bad','A'.repeat(64),sha]) errorState(asRole(null,rejectSql(c,6001,hash),'service_role',false),'23514');
    for(const bytes of [0,3,5,'NULL']) errorState(asRole(null,rejectSql(c,6001,'b'.repeat(64),owner,bytes),'service_role',false),'23514');
    for(const role of ['anon','authenticated']) errorState(asRole(owner,rejectSql(c,6001),role,false),'42501');
    errorState(asRole(owner,`SET request.jwt.claim.role='service_role';${rejectSql(c,6001)}`,'authenticated',false),'42501');
    assert.equal(get(3001).state,'reserved');assert.equal(get(3001).rejection,null);
  });
  await check('negative receipt rejects stale claims, foreign actors and altered terminal evidence',()=>{
    const u=begin(doc(302),3002);sql(put(u));const a=claim(3002,6002);release(3002,6002);const b=claim(3002,6102);
    errorState(asRole(null,rejectSql(a,6002),'service_role',false),'40001');
    errorState(asRole(null,rejectSql(b,6102,'b'.repeat(64),other),'service_role',false),'42501');
    errorState(asRole(null,rejectSql({...b,object:{...b.object,id:id(999)}},6102),'service_role',false),'40001');
    const r=reject(b,6102);
    for(const text of [rejectSql(b,6002),rejectSql(b,6102,'c'.repeat(64)),rejectSql({...b,object:{...b.object,version:id(999)}},6102)])
      errorState(asRole(null,text,'service_role',false),'23514');
    assert.deepEqual(get(3002),r);
  });
  await check('negative receipt rechecks exact current Storage object and metadata',()=>{
    const u=begin(doc(303),3003);sql(put(u));const c=claim(3003,6003);
    for(const patch of [`version='${id(998)}'`,`metadata='{"size":5}'`]) {
      errorState(sql(`BEGIN;ALTER TABLE storage.objects DISABLE TRIGGER a_document_generation_upload_object_guard;
        UPDATE storage.objects SET ${patch} WHERE name=${quote(u.path)};${rejectSql(c,6003)};COMMIT`,false),'23514');
    }
    const r=reject(c,6003);
    errorState(sql(`BEGIN;ALTER TABLE storage.objects DISABLE TRIGGER a_document_generation_upload_object_guard;
      UPDATE storage.objects SET version='${id(998)}' WHERE name=${quote(u.path)};
      SELECT survey_private.document_generation_upload_descriptor('${id(3003)}');COMMIT`,false),'23514');
    assert.deepEqual(get(3003),r);
  });
  await check('revocation and expiry prevent new rejection but preserve prior terminal audit',()=>{
    const d=doc(304),u=begin(d,3004,editor);sql(put(u));const c=claim(3004,6004,editor);
    sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`);
    errorState(asRole(null,rejectSql(c,6004,'b'.repeat(64),editor),'service_role',false),'42501');
    const d2=doc(305),u2=begin(d2,3005,editor);sql(put(u2));const c2=claim(3005,6005,editor),r=reject(c2,6005,'b'.repeat(64),editor);
    sql(`INSERT INTO document_collaborators VALUES('${d2}','${editor}','viewer','active')`);
    assert.deepEqual(get(3005,editor),r);assert.deepEqual(begin(d2,3005,editor),r);assert.deepEqual(reject(c2,6005,'b'.repeat(64),editor),r);
    const u3=begin(doc(306),3006);sql(put(u3));const c3=claim(3006,6006);expired(3006);
    errorState(asRole(null,rejectSql(c3,6006),'service_role',false),'23514');
  });
  await check('cancellation and expiry retain negative evidence while releasing staged refs',()=>{
    const u=begin(doc(307),3007);sql(put(u));const c=claim(3007,6007),r=reject(c,6007),canceled=cancel(3007);
    assert.equal(canceled.state,'canceled');assert.deepEqual(canceled.rejection,r.rejection);
    sql(`DELETE FROM storage.objects WHERE name=${quote(u.path)}`);const after=get(3007);assert.equal(after.object,null);assert.deepEqual(after.rejection,r.rejection);
    errorState(asRole(null,rejectSql(c,6007),'service_role',false),'23514');
    const v=begin(doc(308),3008);sql(put(v));const rejected=reject(claim(3008,6008),6008);expired(3008);
    const result=JSON.parse(asRole(null,'SELECT public.expire_document_generation_uploads(100)','service_role').stdout);
    assert.deepEqual(result.canceled_operation_ids,[id(3008)]);assert.deepEqual(get(3008).rejection,rejected.rejection);
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(v.path)}`),'0');
  });
  await check('negative receipt deadline remains fenced after a permission-lock wait',async()=>{
    const u=begin(doc(309),3009);sql(put(u));const c=claim(3009,6009);
    sql(`UPDATE ${uploads} SET verification_claim_expires_at=clock_timestamp()+interval '400 milliseconds' WHERE operation_id='${id(3009)}'`);
    const blocker=session('negative_clock_blocker',{role:'postgres'});blocker.send(`SELECT user_id FROM survey_private.account_write_guards WHERE user_id='${owner}' FOR UPDATE;SELECT 'held';`);await blocker.wait('held');
    const writer=session('negative_clock_writer',{role:'service_role'});writer.send(rejectSql(c,6009)+';');await blocked(writer.name);
    await new Promise(resolve=>setTimeout(resolve,450));await blocker.finish();errorState(await writer.finish(),'40001');assert.equal(get(3009).state,'reserved');
  });
  console.log(`Document generation upload staging PostgreSQL checks passed: ${checks+2}`);
},{name:'generation-upload-staging'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
