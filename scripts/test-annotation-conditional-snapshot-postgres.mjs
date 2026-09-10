// Installed, disposable PostgreSQL only. No hosted provider, account or secret.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const target = '20260909108000_annotation_checkpoint_conditional.sql';
const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(migrationPath(name), 'utf8');
const fn = (file, name) => { const text = source(file);
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), end = text.indexOf('$$;', start);
  assert.ok(start >= 0 && end > start); return text.slice(start, end + 3); };
const id = n => `c2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4), project = id(5);
const sha = hex => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, session, applyMigration, quote } = pg;
  // Reuse the repo's disposable generation schema setup, never a live provider.
  const prior = readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs', import.meta.url), 'utf8');
  const a = prior.indexOf('  const prior='), b = prior.indexOf('  const doc='); assert.ok(a >= 0 && b > a);
  new Function('sql', 'applyMigration', 'migrationPath', 'readFileSync', 'source', 'fn',
    'owner', 'editor', 'viewer', 'other', 'project', 'assert',
    prior.slice(a, b).replaceAll("'import.meta.url'", "'__KEEP_IMPORT_META__'")
      .replaceAll('import.meta.url', JSON.stringify(new URL('./test-document-generation-source-receipts-postgres.mjs', import.meta.url).href))
      .replaceAll('__KEEP_IMPORT_META__', 'import.meta.url'))
    (sql, applyMigration, migrationPath, readFileSync, source, fn, owner, editor, viewer, other, project, assert);
  for (const name of ['20260909092000_document_generation_source_receipts.sql',
    '20260909093000_document_generation_source_bytes.sql',
    '20260909094000_document_generation_source_bound_uploads.sql',
    '20260909095000_document_generation_source_archives.sql',
    '20260909096000_document_generation_transform_source.sql',
    '20260909097000_document_generation_retention.sql']) applyMigration(migrationPath(name));
  applyMigration(migrationPath('20260425121704_extend_document_annotations_for_all_types.sql'));
  const timestamp = source('20241230000002_create_document_annotations.sql');
  sql(timestamp.slice(timestamp.indexOf('CREATE OR REPLACE FUNCTION update_document_tables_updated_at()'),
    timestamp.indexOf('CREATE TRIGGER trigger_update_document_collaborators_updated_at')));
  sql(source('20260518000000_rename_ball_in_court_to_entity.sql').split('\n')
    .filter(line => line.startsWith('ALTER TABLE document_annotations RENAME COLUMN')).join('\n'));
  applyMigration(migrationPath('20260518000001_survey_marker_widen_type_check.sql'));
  applyMigration(migrationPath('20260603130000_db_sync_annotations_changed_at.sql'));
  applyMigration(migrationPath('20260909098000_document_generation_publication.sql'));
  applyMigration(migrationPath('20260909099000_document_generation_open.sql'));
  sql(fn('20260802000000_kal426_user_archive_foundation.sql', 'get_my_document_role'));
  applyMigration(migrationPath('20260909100000_document_generation_collaboration.sql'));
  applyMigration(migrationPath('20260909103000_document_generation_replacement_requests.sql'));
  const identity = source('20260606120000_rebuild_yjs_source_of_truth.sql');
  const identityStart = identity.indexOf('ALTER TABLE public.documents\n  ADD COLUMN IF NOT EXISTS content_sha256');
  const identityEnd = identity.indexOf(';', identity.indexOf('WHERE content_sha256 IS NOT NULL', identityStart)) + 1;
  sql(identity.slice(identityStart, identityEnd));
  applyMigration(migrationPath('20260909107000_annotation_content_model_v2.sql'));
  applyMigration(migrationPath(target)); applyMigration(migrationPath(target));

  const doc = n => { const value = id(n); sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size)
    VALUES('${value}','${owner}','${project}','conditional fixture','${owner}/${n}.pdf',4)`); return value; };
  const gen = (documentId, n, model = 2, baseline = '0102') => { const generationId = id(n);
    sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
      VALUES('${documentId}','${generationId}',0,decode('${baseline}','hex'),1,${model});
      INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq)
      VALUES('${documentId}','${generationId}',0)`); return generationId; };
  const expected = ({ at = 0, writer = null, epoch = 0, encoding = 1, hash = sha('0102') } = {}) =>
    `${at},${quote(writer)},${epoch},${encoding},${quote(hash)}`;
  const query = (d, g, model = 2, token = expected()) =>
    `SELECT public.read_annotation_checkpoint_conditional_v3('${d}','${g}',${model}::smallint,${token})`;
  const run = (actor, statement) => JSON.parse(sql(`SET request.jwt.claim.sub=${quote(actor)};
    SET request.jwt.claim.role='authenticated';${statement}`).stdout);
  let checks = 0; const check = async (label, work) => { await work(); checks++; console.log(`PASS ${label}`); };

  await check('private RPC has no implicit grants and replay preserves that boundary', () => {
    const signature = 'public.read_annotation_checkpoint_conditional_v3(uuid,uuid,smallint,bigint,text,bigint,integer,text)';
    assert.equal(scalar(`SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL
      aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      WHERE p.oid=${quote(signature)}::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE'`), '0');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(scalar(`SELECT has_function_privilege('${role}',${quote(signature)},'EXECUTE')`), 'f');
    }
    errorState(asRole(owner, query(id(90), id(91)), 'authenticated', false), '42501');
  });

  await check('exact unchanged identity omits bytes while all-null forces a full hashed checkpoint', () => {
    const d = doc(10), g = id(110), largeHash = createHash('sha256').update(Buffer.alloc(128 * 1024, 0xab)).digest('hex');
    sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
      VALUES('${d}','${g}',0,decode(repeat('ab',131072),'hex'),1,2);
      INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq) VALUES('${d}','${g}',0)`);
    const matched = run(owner, query(d, g, 2, expected({ hash: largeHash })));
    assert.deepEqual(Object.keys(matched).sort(), ['actor_user_id', 'checkpoint', 'content_model_version',
      'document_id', 'generation_id', 'snapshot_matches', 'version', 'wal_head']);
    assert.equal(matched.snapshot_matches, true); assert.equal(matched.checkpoint.snapshot, null);
    assert.deepEqual(Object.keys(matched.checkpoint).sort(), ['at_seq', 'encoding_version', 'snapshot',
      'snapshot_sha256', 'writer_epoch', 'writer_id']);
    assert.equal(matched.actor_user_id, owner); assert.equal(matched.wal_head, '0');
    const full = run(owner, query(d, g, 2, 'NULL,NULL,NULL,NULL,NULL'));
    assert.equal(full.snapshot_matches, false); assert.equal(full.checkpoint.snapshot.length, 2 + 2 * 128 * 1024);
    assert.equal(full.checkpoint.snapshot_sha256, largeHash);
    const matchedBytes = Buffer.byteLength(JSON.stringify(matched), 'utf8');
    const fullBytes = Buffer.byteLength(JSON.stringify(full), 'utf8');
    assert.ok(matchedBytes < fullBytes); console.log(`BYTES unchanged=${matchedBytes} changed=${fullBytes}`);
    assert.equal(matched.checkpoint.snapshot_sha256, full.checkpoint.snapshot_sha256);
    assert.equal(matched.wal_head, full.wal_head);
  });

  await check('baseline null writer and epoch zero are a valid exact match', () => {
    const d = doc(11), g = gen(d, 111);
    const value = run(owner, query(d, g));
    assert.equal(value.checkpoint.writer_id, null); assert.equal(value.checkpoint.writer_epoch, '0');
    assert.equal(value.snapshot_matches, true);
  });

  await check('wrong digest and same-head newer snapshot return full current bytes', () => {
    const d = doc(12), g = gen(d, 112);
    let value = run(owner, query(d, g, 2, expected({ hash: 'a'.repeat(64) })));
    assert.equal(value.snapshot_matches, false); assert.equal(value.checkpoint.snapshot, '\\x0102');
    const stored = run(owner, `SELECT public.store_annotation_snapshot_v3('${d}','${g}',2::smallint,0,
      decode('0304','hex'),1,'new-writer',1,0,NULL,0)`);
    assert.equal(stored.stored, true);
    value = run(owner, query(d, g));
    assert.equal(value.wal_head, '0'); assert.equal(value.snapshot_matches, false);
    assert.equal(value.checkpoint.snapshot, '\\x0304'); assert.equal(value.checkpoint.writer_id, 'new-writer');
  });

  await check('tail-only head advance keeps checkpoint match and returns the higher fixed head', () => {
    const d = doc(13), g = gen(d, 113);
    run(owner, `SELECT public.append_annotation_update_v3('${d}','${g}',2::smallint,'tail',1,decode('aa','hex'))`);
    const value = run(owner, query(d, g));
    assert.equal(value.snapshot_matches, true); assert.equal(value.checkpoint.snapshot, null);
    assert.equal(value.wal_head, '1');
    const page = run(owner, `SELECT public.read_annotation_updates_v3('${d}','${g}',2::smallint,0,1,1000)`);
    assert.equal(page.through_seq, '1'); assert.equal(page.rows[0].data, '\\xaa');
  });

  await check('partial impossible and future expected tokens fail before any response', () => {
    const d = doc(14), g = gen(d, 114);
    for (const token of ['0,NULL,NULL,1,NULL', `0,NULL,1,1,'${sha('0102')}'`,
      `1,NULL,0,1,'${sha('0102')}'`, `0,'writer',0,1,'${sha('0102')}'`]) {
      errorState(sql(`SET request.jwt.claim.sub='${owner}';${query(d, g, 2, token)}`, false), '22023');
    }
  });

  await check('actor model and generation mismatch or revoked access fail closed', () => {
    const d = doc(15), g = gen(d, 115);
    errorState(sql(`SET request.jwt.claim.sub='${other}';${query(d, g)}`, false), '42501');
    errorState(sql(`SET request.jwt.claim.sub='${owner}';${query(d, g, 1)}`, false), 'SG003');
    errorState(sql(`SET request.jwt.claim.sub='${owner}';${query(d, id(999))}`, false), 'SG002');
    sql(`INSERT INTO document_collaborators(document_id,user_id,role,status)
      VALUES('${d}','${other}','viewer','active')`);
    run(other, query(d, g));
    sql(`UPDATE document_collaborators SET status='revoked' WHERE document_id='${d}' AND user_id='${other}'`);
    errorState(sql(`SET request.jwt.claim.sub='${other}';${query(d, g)}`, false), '42501');
  });

  await check('malformed current checkpoints never match and fail before returning bytes', () => {
    const cases = [
      ['ahead of fixed head', 1, "decode('01','hex')", 1, 'bad', 1, '23514'],
      ['empty bytes', 0, "decode('','hex')", 1, 'bad', 1, '54000'],
      ['writer without epoch', 0, "decode('01','hex')", 1, 'bad', 0, '23514'],
      ['epoch without writer', 0, "decode('01','hex')", 1, null, 1, '23514'],
      ['oversized bytes', 0, "decode(repeat('aa',67108865),'hex')", 1, 'bad', 1, '54000'],
    ];
    for (const [label, at, payload, encoding, writer, epoch, state] of cases) {
      const d = doc(30 + cases.findIndex(value => value[0] === label)), g = gen(d, 130 + cases.findIndex(value => value[0] === label));
      sql(`ALTER TABLE survey_private.annotation_generation_snapshots DISABLE TRIGGER USER;
        INSERT INTO survey_private.annotation_generation_snapshots(document_id,generation_id,at_seq,snapshot,
          encoding_version,writer_id,writer_epoch)
        VALUES('${d}','${g}',${at},${payload},${encoding},${quote(writer)},${epoch});
        ALTER TABLE survey_private.annotation_generation_snapshots ENABLE TRIGGER USER;`);
      errorState(sql(`SET request.jwt.claim.sub='${owner}';${query(d, g, 2, 'NULL,NULL,NULL,NULL,NULL')}`, false), state);
    }
    const d = doc(39), g = id(139);
    sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,
        baseline_encoding_version,content_model_version) VALUES('${d}','${g}',5,decode('0102','hex'),1,2);
      ALTER TABLE survey_private.annotation_generation_heads DISABLE TRIGGER USER;
      INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq) VALUES('${d}','${g}',5);
      ALTER TABLE survey_private.annotation_generation_heads ENABLE TRIGGER USER;
      ALTER TABLE survey_private.annotation_generation_snapshots DISABLE TRIGGER USER;
      INSERT INTO survey_private.annotation_generation_snapshots(document_id,generation_id,at_seq,snapshot,
        encoding_version,writer_id,writer_epoch) VALUES('${d}','${g}',4,decode('01','hex'),1,'below-base',1);
      ALTER TABLE survey_private.annotation_generation_snapshots ENABLE TRIGGER USER;`);
    errorState(sql(`SET request.jwt.claim.sub='${owner}';${query(d, g, 2, 'NULL,NULL,NULL,NULL,NULL')}`, false), '23514');
  });

  await check('exclusive snapshot writer and shared conditional reader yield coherent before or after state', async () => {
    const d = doc(16), g = gen(d, 116);
    const writer = session('conditional_snapshot_writer', { role: 'authenticated', actorId: owner });
    writer.send(`SELECT public.store_annotation_snapshot_v3('${d}','${g}',2::smallint,0,
      decode('0506','hex'),1,'race-writer',1,0,NULL,0);SELECT 'writer-held';`);
    await writer.wait('writer-held');
    errorState(sql(`SET request.jwt.claim.sub='${owner}';${query(d, g)}`, false), '40001');
    assert.equal((await writer.finish()).status, 0);
    const after = run(owner, query(d, g));
    assert.equal(after.snapshot_matches, false); assert.equal(after.checkpoint.snapshot, '\\x0506');
  });

  console.log(`Conditional annotation checkpoint PostgreSQL checks passed: ${checks}`);
}, { name: 'conditional-checkpoint' });
