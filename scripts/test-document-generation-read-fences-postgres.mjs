// Isolated installed PostgreSQL only; Storage metadata is not provider-byte or
// signed-URL proof. No public adoption route is installed by this fixture.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
assert.equal(process.argv.length, 2, 'This isolated fixture accepts no arguments');
const target = '20260909091000_document_generation_read_fences.sql';
const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(migrationPath(name), 'utf8');
const fn = (file, name) => { const s = source(file), a = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), b = s.indexOf('$$;', a); assert.ok(a >= 0 && b > a); return s.slice(a, b + 3); };
const id = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4), project = id(5);

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, session, applyMigration, quote } = pg;
  const prior = readFileSync(new URL('./test-document-generation-upload-staging-postgres.mjs', import.meta.url), 'utf8');
  const start = prior.indexOf('  const prior='), end = prior.indexOf('  const uploads=');
  assert.ok(start >= 0 && end > start);
  new Function('sql', 'applyMigration', 'migrationPath', 'readFileSync', 'source', 'fn', 'owner', 'editor', 'viewer', 'other', 'project', 'assert',
    prior.slice(start, end).replaceAll('import.meta.url', JSON.stringify(new URL('./test-document-generation-upload-staging-postgres.mjs', import.meta.url).href)))
    (sql, applyMigration, migrationPath, readFileSync, source, fn, owner, editor, viewer, other, project, assert);

  // Replace the reference-ledger fixture's deliberately permissive document /
  // Storage SELECT with real tracked policies; all access oracles below use them.
  sql('DROP POLICY fixture_document_read ON documents; DROP POLICY fixture_storage ON storage.objects;');
  sql(fn('20260817010000_kal390_storage_quota_enforcement.sql', 'get_actual_storage_usage'));
  applyMigration(migrationPath('20260513013000_fix_document_insert_returning_select_policy.sql'));
  applyMigration(migrationPath('20260513003000_allow_collaborators_to_read_document_storage.sql'));
  const storagePolicy = source('20260703030000_codify_documents_bucket_write_policies.sql').match(/CREATE POLICY documents_owner_select[\s\S]*?;/)?.[0];
  assert.ok(storagePolicy); sql(storagePolicy);
  sql('ALTER TABLE document_annotations ENABLE ROW LEVEL SECURITY');
  const annotationPolicy = source('20241230000002_create_document_annotations.sql').match(/CREATE POLICY "Users can view annotations on accessible documents"[\s\S]*?;/)?.[0];
  assert.ok(annotationPolicy); sql(annotationPolicy);
  applyMigration(migrationPath('20260522120000_kal48_document_revisions.sql'));
  applyMigration(migrationPath('20260522170000_kal48_inline_auth_checks.sql'));
  const excelDDL = source('20260625120000_kal309_excel_sync.sql').match(/CREATE TABLE IF NOT EXISTS public.excel_sync_ops \([\s\S]*?\n\);/)?.[0];
  assert.ok(excelDDL); sql(excelDDL); sql('ALTER TABLE excel_sync_ops ALTER COLUMN marker_annotation_id TYPE text USING marker_annotation_id::text; ALTER TABLE excel_sync_ops ENABLE ROW LEVEL SECURITY; REVOKE ALL ON excel_sync_ops FROM PUBLIC,anon,authenticated; GRANT ALL ON excel_sync_ops TO service_role;');
  const excel = source('20260626150000_kal309_marker_id_text.sql');
  const excelStart = excel.indexOf('CREATE OR REPLACE FUNCTION public.kal309_fetch_since('), excelEnd = excel.indexOf('$function$;', excelStart);
  assert.ok(excelStart >= 0 && excelEnd > excelStart); sql(excel.slice(excelStart, excelEnd + '$function$;'.length));
  sql('GRANT EXECUTE ON FUNCTION kal309_fetch_since(uuid,text,bigint) TO anon,authenticated,service_role; GRANT SELECT ON document_revisions TO authenticated; GRANT ALL ON document_revisions TO service_role;');
  const legacy = id(10), adopted = id(11), g = id(12), template = id(13), sessionId = id(14), foreignSession = id(15);
  asRole(owner, `INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES
    ('${legacy}','${owner}','${project}','Legacy','${owner}/legacy.pdf',4),('${adopted}','${owner}','${project}','Adopted','${owner}/original.pdf',4);
    INSERT INTO document_collaborators VALUES('${adopted}','${viewer}','viewer','active');
    INSERT INTO templates(id,user_id,name) VALUES('${template}','${owner}','Fixture');
    INSERT INTO survey_sessions(id,template_id,user_id,document_id) VALUES('${sessionId}','${template}','${owner}','${adopted}'),('${foreignSession}','${template}','${other}','${adopted}');
    INSERT INTO survey_items(id,session_id,annotation_id,module_id,category_id) VALUES('${id(16)}','${sessionId}','mark','m','c'),('${id(17)}','${foreignSession}','private','m','c');
    INSERT INTO document_annotations(document_id,user_id,annotation_id,annotation_type,page_number,bounds) VALUES('${adopted}','${owner}','mark','text',1,'{}');
    INSERT INTO annotation_updates(document_id,client_id,client_seq,data,actor_user_id) VALUES('${adopted}','fixture',1,'\\x0102','${owner}');
    INSERT INTO annotation_snapshots(document_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch) VALUES('${adopted}',1,'\\x0102',1,'fixture',1);
    INSERT INTO doc_yjs_state(document_id,state,state_vector,through_seq) VALUES('${adopted}','\\x0102','\\x00',1);
    INSERT INTO doc_yjs_updates(document_id,client_id,seq,update) VALUES('${adopted}','fixture',1,'\\x0102');
    INSERT INTO excel_sync_ops(document_id,template_id,scope_id,workbook_generation,excel_revision,op_id,marker_annotation_id,op_type,patch_payload,client_change_set_id)
      VALUES('${adopted}','fixture','scope',1,1,'op','mark','apply','{"value":"private"}','set');
    INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${owner}/legacy.pdf','v1','{"size":4}'),
      ('documents','${owner}/_generations/staged.pdf','v1','{"size":4}');`, 'postgres');
  const revision = JSON.parse(asRole(owner, `SELECT row_to_json(public.kal48_create_revision('${adopted}'))`).stdout).id;
  const legacyRevision = JSON.parse(asRole(owner, `SELECT row_to_json(public.kal48_create_revision('${legacy}'))`).stdout).id;
  applyMigration(migrationPath('20260909090000_annotation_generation_transport.sql'));
  const rpcIdentities = ['kal48_create_revision(uuid,text,text)', 'kal48_list_revisions(uuid)', 'kal48_get_revision(uuid)', 'kal48_restore_revision(uuid)', 'kal309_fetch_since(uuid,text,bigint)', 'kal49_lock_document(uuid,text)', 'kal49_unlock_document(uuid)'];
  const acl = () => scalar(`SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text,proowner,proacl) ORDER BY oid::regprocedure::text) FROM pg_proc WHERE oid IN (${rpcIdentities.map(value => `${quote(value)}::regprocedure`).join(',')})`);
  const originalACL = acl(); const originalAccess = scalar(`SELECT pg_get_functiondef('public._kal48_can_access(uuid,text)'::regprocedure)`);
  let checks = 0;
  const check = async (label, run) => { await run(); checks++; console.log(`PASS ${label}`); };

  await check('baseline legacy readers and staged owner download are accessible before the read fence', () => {
    assert.equal(asRole(owner, `SELECT count(*) FROM documents WHERE id='${adopted}'`).stdout, '1');
    assert.equal(asRole(viewer, `SELECT count(*) FROM annotation_updates WHERE document_id='${adopted}'`).stdout, '1');
    assert.equal(asRole(owner, `SELECT count(*) FROM storage.objects WHERE name='${owner}/_generations/staged.pdf'`).stdout, '1');
    assert.equal(asRole(other, `SELECT count(*) FROM documents WHERE id='${adopted}'`).stdout, '0');
  });
  applyMigration(migrationPath(target));
  await check('zero-head legacy reads and definer content remain unchanged; query uses one initPlan', () => {
    assert.equal(asRole(owner, `SELECT count(*) FROM annotation_updates WHERE document_id='${adopted}'`).stdout, '1');
    errorState(asRole(owner, `SELECT * FROM storage.objects WHERE name='${owner}/_generations/staged.pdf'`, 'authenticated', false), 'SG001');
    assert.equal(JSON.parse(asRole(owner, `SELECT row_to_json(kal48_get_revision('${revision}'))`).stdout).id, revision);
    const plan = JSON.parse(asRole(owner, `EXPLAIN (ANALYZE,FORMAT JSON) SELECT * FROM annotation_updates WHERE document_id='${adopted}'`).stdout);
    const encoded = JSON.stringify(plan); assert.match(encoded, /InitPlan/);
    const init = []; const walk = node => { if (node['Subplan Name']?.startsWith('InitPlan')) init.push(node); for (const child of node.Plans || []) walk(child); }; walk(plan[0].Plan);
    assert.ok(init.some(node => node['Actual Loops'] === 1)); console.log(`EXPLAIN zero-head initPlan loops: ${init.map(node => node['Actual Loops']).join(',')}`);
  });
  // Private test-only seed, NOT a callable publication API or a live adoption.
  sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version) VALUES('${adopted}','${g}',1,'\\x0102',1);
    INSERT INTO survey_private.annotation_generation_heads VALUES('${adopted}','${g}',1);`);
  await check('authorized raw adopted content raises SG001 across every installed document lane', () => {
    for (const table of ['documents', 'annotation_updates', 'annotation_snapshots', 'document_annotations', 'doc_yjs_state', 'doc_yjs_updates', 'document_revisions']) {
      const column = table === 'documents' ? 'id' : 'document_id';
      errorState(asRole(owner, `SELECT * FROM ${table} WHERE ${column}='${adopted}'`, 'authenticated', false), 'SG001');
      errorState(asRole(viewer, `SELECT * FROM ${table} WHERE ${column}='${adopted}'`, 'authenticated', false), 'SG001');
    }
    for (const statement of [`SELECT * FROM survey_sessions WHERE id='${sessionId}'`, `SELECT * FROM survey_items WHERE session_id='${sessionId}'`]) {
      errorState(asRole(owner, statement, 'authenticated', false), 'SG001');
    }
  });
  await check('Excel raw ACL remains denied and its restrictive fence survives a permissive read grant', () => {
    errorState(asRole(owner, `SELECT * FROM excel_sync_ops WHERE document_id='${adopted}'`, 'authenticated', false), '42501');
    const result = sql(`BEGIN; GRANT SELECT ON excel_sync_ops TO authenticated;
      CREATE POLICY fixture_excel_read ON excel_sync_ops FOR SELECT TO authenticated USING (user_can_access_document(document_id,'viewer'));
      SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';
      SELECT * FROM excel_sync_ops WHERE document_id='${adopted}';`, false);
    errorState(result, 'SG001');
    // The failing psql connection rolls back both temporary grants and policy.
    errorState(asRole(owner, `SELECT * FROM excel_sync_ops`, 'authenticated', false), '42501');
  });
  await check('strangers get no rows and cannot probe adoption through policy helper calls', () => {
    for (const table of ['documents', 'annotation_updates', 'annotation_snapshots', 'document_annotations', 'doc_yjs_state', 'doc_yjs_updates', 'document_revisions']) {
      const column = table === 'documents' ? 'id' : 'document_id';
      assert.equal(asRole(other, `SELECT count(*) FROM ${table} WHERE ${column}='${adopted}'`).stdout, '0');
    }
    assert.equal(asRole(viewer, `SELECT count(*) FROM survey_sessions WHERE id='${foreignSession}'`).stdout, '0');
    assert.equal(asRole(viewer, `SELECT count(*) FROM survey_items WHERE session_id='${foreignSession}'`).stdout, '0');
    errorState(asRole(other, `SELECT survey_private.legacy_generation_read_allowed('${adopted}',false)`, 'authenticated', false), '42501');
    // Even a future schema-USAGE grant must not turn the policy helper into an
    // adoption oracle. The temporary grant is rolled back in this fixture only.
    for (const d of [legacy, adopted, id(999)]) assert.equal(sql(`BEGIN; GRANT USAGE ON SCHEMA survey_private TO authenticated;
      SET ROLE authenticated; SET request.jwt.claim.sub='${other}'; SELECT survey_private.legacy_generation_read_allowed('${d}',false); ROLLBACK;`).stdout, 't');
  });
  await check('legacy reads and INSERT RETURNING still work when another document is adopted', () => {
    assert.equal(asRole(owner, `SELECT count(*) FROM documents WHERE id='${legacy}'`).stdout, '1');
    assert.equal(JSON.parse(asRole(owner, `SELECT row_to_json(kal48_get_revision('${legacyRevision}'))`).stdout).id, legacyRevision);
    assert.equal(asRole(owner, `INSERT INTO documents(id,user_id,name,file_path) VALUES('${id(20)}','${owner}','New','${owner}/new.pdf') RETURNING id`).stdout, id(20));
    assert.equal(asRole(owner, `INSERT INTO survey_sessions(id,template_id,user_id,document_id) VALUES('${id(21)}','${template}','${owner}','${legacy}') RETURNING id`).stdout, id(21));
  });
  await check('all protected stages reject owner reads while service verification and ordinary Storage still work', () => {
    const query = `SELECT count(*) FROM storage.objects WHERE name='${owner}/_generations/staged.pdf'`;
    errorState(asRole(owner, query, 'authenticated', false), 'SG001');
    assert.equal(asRole(other, query).stdout, '0');
    assert.equal(asRole(null, query, 'service_role').stdout, '1');
    assert.equal(asRole(owner, `SELECT count(*) FROM storage.objects WHERE name='${owner}/legacy.pdf'`).stdout, '1');
    errorState(asRole(owner, `SET request.jwt.claim.role='service_role'; ${query}`, 'authenticated', false), 'SG001');
  });
  await check('legacy content definers cannot bypass adopted fences or weaken original access checks', () => {
    for (const call of [`kal48_create_revision('${adopted}')`, `kal48_list_revisions('${adopted}')`, `kal48_get_revision('${revision}')`, `kal48_restore_revision('${revision}')`, `kal309_fetch_since('${adopted}','fixture',0)`, `kal49_lock_document('${adopted}')`, `kal49_unlock_document('${adopted}')`]) {
      errorState(asRole(owner, `SELECT ${call}`, 'authenticated', false), 'SG001');
      const denied = asRole(other, `SELECT ${call}`, 'authenticated', false); assert.notEqual(denied.status, 0); assert.doesNotMatch(denied.stderr, /SG001/);
    }
    assert.equal(acl(), originalACL); assert.equal(scalar(`SELECT pg_get_functiondef('public._kal48_can_access(uuid,text)'::regprocedure)`), originalAccess);
  });
  await check('legacy lock and unlock still return full unchanged rows after real owner checks', () => {
    const locked = JSON.parse(asRole(owner, `SELECT row_to_json(kal49_lock_document('${legacy}','Fixture lock'))`).stdout);
    assert.equal(locked.file_path, `${owner}/legacy.pdf`); assert.equal(locked.locked_label, 'Fixture lock'); assert.ok(locked.locked_at);
    const unlocked = JSON.parse(asRole(owner, `SELECT row_to_json(kal49_unlock_document('${legacy}'))`).stdout);
    assert.equal(unlocked.locked_at, null); assert.equal(unlocked.locked_label, null);
    for (const call of [`kal49_lock_document('${legacy}')`, `kal49_unlock_document('${legacy}')`]) {
      errorState(asRole(viewer, `SELECT ${call}`, 'authenticated', false), '42501');
    }
  });
  await check('legacy revision create and restore still execute their real unchanged bodies', () => {
    const created = JSON.parse(asRole(owner, `SELECT row_to_json(kal48_create_revision('${legacy}'))`).stdout);
    assert.equal(created.document_id, legacy);
    const restored = JSON.parse(asRole(owner, `SELECT row_to_json(kal48_restore_revision('${legacyRevision}'))`).stdout);
    assert.equal(restored.document_id, legacy);
    assert.equal(asRole(owner, `SELECT count(*) FROM kal309_fetch_since('${legacy}','fixture',0)`).stdout, '0');
  });
  await check('checked v2 reader still returns exact adopted baseline and rejects wrong generation', () => {
    const result = JSON.parse(asRole(viewer, `SELECT read_annotation_snapshot_v2('${adopted}','${g}')`).stdout);
    assert.equal(result.generation_id, g); assert.equal(result.snapshot.snapshot, '\\x0102');
    errorState(asRole(viewer, `SELECT read_annotation_snapshot_v2('${adopted}',NULL)`, 'authenticated', false), 'SG001');
    errorState(asRole(other, `SELECT read_annotation_snapshot_v2('${adopted}','${g}')`, 'authenticated', false), '42501');
  });
  await check('shared definer reads coexist but hold out activation through both transactions', async () => {
    const held = session('legacy_content_reader', { role: 'authenticated', actorId: owner });
    held.send(`SELECT count(*) FROM kal48_list_revisions('${legacy}'); SELECT 'reader_ready';`); await held.wait('reader_ready');
    const second = session('legacy_content_reader_two', { role: 'authenticated', actorId: owner });
    second.send(`SELECT (kal48_get_revision('${legacyRevision}')).id; SELECT 'second_ready';`); await second.wait('second_ready');
    assert.equal(scalar(`SELECT pg_try_advisory_xact_lock(hashtextextended('${legacy}',0))`), 'f');
    await held.finish();
    assert.equal(scalar(`SELECT pg_try_advisory_xact_lock(hashtextextended('${legacy}',0))`), 'f');
    await second.finish();
    assert.equal(scalar(`SELECT pg_try_advisory_xact_lock(hashtextextended('${legacy}',0))`), 't');
  });
  await check('activation lock first makes legacy definer reads retry rather than read across publication', async () => {
    const writer = session('publication_lock_owner', { role: 'postgres' });
    writer.send(`SELECT pg_advisory_xact_lock(hashtextextended('${legacy}',0)); SELECT 'publication_ready';`); await writer.wait('publication_ready');
    errorState(asRole(owner, `SELECT kal48_get_revision('${legacyRevision}')`, 'authenticated', false), '40001');
    errorState(asRole(owner, `SELECT kal48_create_revision('${legacy}')`, 'authenticated', false), '40001');
    await writer.finish(false);
  });
  await check('repeatable-read and serializable legacy content definers fail closed', () => {
    for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
      for (const call of [`kal48_get_revision('${legacyRevision}')`, `kal48_list_revisions('${legacy}')`, `kal309_fetch_since('${legacy}','fixture',0)`]) {
        errorState(asRole(owner, `BEGIN ISOLATION LEVEL ${isolation}; SELECT ${call}; COMMIT;`, 'authenticated', false), '25001');
      }
    }
  });
  await check('read fence reapply preserves ACLs and does not duplicate definer instrumentation', () => {
    applyMigration(migrationPath(target)); assert.equal(acl(), originalACL);
    for (const signature of rpcIdentities) {
      const definition = scalar(`SELECT pg_get_functiondef(${quote(signature)}::regprocedure)`);
      assert.equal(definition.split('-- generation legacy content read fence').length - 1, 1);
    }
    errorState(asRole(owner, `SELECT * FROM documents WHERE id='${adopted}'`, 'authenticated', false), 'SG001');
  });
  console.log(`Document generation read fence PostgreSQL checks passed: ${checks}`);
}, { name: 'generation-read-fences' });
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
