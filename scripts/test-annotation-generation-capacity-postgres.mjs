// Installed, disposable PostgreSQL only. No hosted provider, account or secret.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(migrationPath(name), 'utf8');
const fn = (file, name) => { const text = source(file), start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = text.indexOf('$$;', start); assert.ok(start >= 0 && end > start); return text.slice(start, end + 3); };
const id = n => `97500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4), project = id(5);

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, applyMigration } = pg;
  const prior = readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs', import.meta.url), 'utf8');
  const start = prior.indexOf('  const prior='), end = prior.indexOf('  const doc='); assert.ok(start >= 0 && end > start);
  new Function('sql', 'applyMigration', 'migrationPath', 'readFileSync', 'source', 'fn',
    'owner', 'editor', 'viewer', 'other', 'project', 'assert',
    prior.slice(start, end).replaceAll("'import.meta.url'", "'__KEEP_IMPORT_META__'")
      .replaceAll('import.meta.url', JSON.stringify(new URL('./test-document-generation-source-receipts-postgres.mjs', import.meta.url).href))
      .replaceAll('__KEEP_IMPORT_META__', 'import.meta.url'))
  (sql, applyMigration, migrationPath, readFileSync, source, fn, owner, editor, viewer, other, project, assert);
  for (const name of ['20260909092000_document_generation_source_receipts.sql',
    '20260909093000_document_generation_source_bytes.sql', '20260909094000_document_generation_source_bound_uploads.sql',
    '20260909095000_document_generation_source_archives.sql', '20260909096000_document_generation_transform_source.sql',
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
  sql(`INSERT INTO templates(id,user_id) VALUES('${id(500)}','${owner}')`);
  applyMigration(migrationPath('20260909107000_annotation_content_model_v2.sql'));

  const createGeneration = (number, model) => { const documentId = id(number), generationId = id(number + 100);
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${documentId}','${owner}','${project}','capacity','${owner}/${number}.pdf',4);
      INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
       VALUES('${documentId}','${generationId}',0,decode('0102','hex'),1,${model});
      INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq) VALUES('${documentId}','${generationId}',0)`);
    return { documentId, generationId }; };
  const call = (actor, name, args) => JSON.parse(asRole(actor,
    `SELECT public.${name}(${args.join(',')})`).stdout);
  const append = (scope, model, client, seq, bytes) => call(owner, 'append_annotation_update_v3', [
    `'${scope.documentId}'`, `'${scope.generationId}'`, `${model}::smallint`, `'${client}'`, seq,
    `decode(repeat('aa',${bytes}),'hex')`]);
  const store = (scope, model, writer, epoch, bytes) => call(owner, 'store_annotation_snapshot_v3', [
    `'${scope.documentId}'`, `'${scope.generationId}'`, `${model}::smallint`, '0',
    `decode(repeat('aa',${bytes}),'hex')`, '1', `'${writer}'`, epoch, '0', 'NULL', '0']);

  const historicalSnapshot = createGeneration(35, 2);
  sql(`INSERT INTO survey_private.annotation_generation_snapshots(document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
    VALUES('${historicalSnapshot.documentId}','${historicalSnapshot.generationId}',0,decode(repeat('aa',67108865),'hex'),1,'old-snapshot',1)`);
  applyMigration(migrationPath('20260909109000_annotation_model2_capacity.sql'));
  applyMigration(migrationPath('20260909109000_annotation_model2_capacity.sql'));

  const bounded = createGeneration(21, 2), tooLarge = createGeneration(22, 2);
  assert.equal(append(bounded, 2, 'wal-boundary', 1, 16 * 1024 * 1024).accepted, true);
  const signalBefore = scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${tooLarge.documentId}'`);
  errorState(asRole(owner, `SELECT public.append_annotation_update_v3('${tooLarge.documentId}','${tooLarge.generationId}',2::smallint,'wal-large',1,decode(repeat('aa',16777217),'hex'))`, 'authenticated', false), 'SG004');
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates WHERE document_id='${tooLarge.documentId}'`), '0');
  assert.equal(scalar(`SELECT last_seq FROM survey_private.annotation_generation_heads WHERE document_id='${tooLarge.documentId}'`), '0');
  assert.equal(scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${tooLarge.documentId}'`), signalBefore);
  errorState(asRole(other, `SELECT public.append_annotation_update_v3('${tooLarge.documentId}','${tooLarge.generationId}',2::smallint,'unauthorized-large',1,decode(repeat('aa',16777217),'hex'))`, 'authenticated', false), '42501');
  errorState(asRole(owner, `SELECT public.append_annotation_update_v3('${tooLarge.documentId}','${tooLarge.generationId}',1::smallint,'wrong-model-large',1,decode(repeat('aa',16777217),'hex'))`, 'authenticated', false), 'SG003');
  assert.equal(scalar("SELECT has_function_privilege('anon','public.append_annotation_update_v3(uuid,uuid,smallint,text,bigint,bytea)','EXECUTE')"), 'f');
  const snapshotBound = createGeneration(31, 2), snapshotLarge = createGeneration(32, 2);
  assert.equal(store(snapshotBound, 2, 'snapshot-boundary', 1, 64 * 1024 * 1024).stored, true);
  errorState(asRole(owner, `SELECT public.store_annotation_snapshot_v3('${snapshotLarge.documentId}','${snapshotLarge.generationId}',2::smallint,0,decode(repeat('aa',67108865),'hex'),1,'snapshot-large',1,0,NULL,0)`, 'authenticated', false), 'SG004');
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_snapshots WHERE document_id='${snapshotLarge.documentId}'`), '0');
  const oldSnapshotReplay = call(owner, 'store_annotation_snapshot_v3', [`'${historicalSnapshot.documentId}'`,
    `'${historicalSnapshot.generationId}'`, '2::smallint', '0', `decode(repeat('aa',67108865),'hex')`,
    '1', `'old-snapshot'`, '1', '0', 'NULL', '0']);
  assert.equal(oldSnapshotReplay.stored, true);
  const staleSnapshot = call(owner, 'store_annotation_snapshot_v3', [`'${historicalSnapshot.documentId}'`,
    `'${historicalSnapshot.generationId}'`, '2::smallint', '0', `decode(repeat('bb',67108865),'hex')`,
    '1', `'stale-snapshot'`, '2', '0', 'NULL', '0']);
  assert.equal(staleSnapshot.stored, false);

  const sequenceScope = createGeneration(25, 2);
  assert.equal(append(sequenceScope, 2, 'sequence-order', 2, 1).accepted, true);
  errorState(asRole(owner, `SELECT public.append_annotation_update_v3('${sequenceScope.documentId}','${sequenceScope.generationId}',2::smallint,'sequence-order',1,decode(repeat('aa',16777217),'hex'))`, 'authenticated', false), '23505');

  const historical = createGeneration(23, 2);
  sql(`INSERT INTO survey_private.annotation_generation_updates(document_id,generation_id,seq,actor_user_id,client_id,client_seq,data)
    VALUES('${historical.documentId}','${historical.generationId}',1,'${owner}','old-large',1,decode(repeat('aa',16777217),'hex'));
    UPDATE survey_private.annotation_generation_heads SET last_seq=1 WHERE document_id='${historical.documentId}'`);
  const replay = append(historical, 2, 'old-large', 1, 16 * 1024 * 1024 + 1);
  assert.equal(replay.seq, '1'); assert.equal(replay.accepted, true);
  errorState(asRole(owner, `SELECT public.append_annotation_update_v3('${historical.documentId}','${historical.generationId}',2::smallint,'old-large',1,decode(repeat('bb',16777217),'hex'))`, 'authenticated', false), '23505');
  const replacement = id(223);
  sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
    VALUES('${historical.documentId}','${replacement}',1,decode('0102','hex'),1,2);
    UPDATE survey_private.annotation_generation_heads SET generation_id='${replacement}',last_seq=1 WHERE document_id='${historical.documentId}'`);
  assert.equal(append(historical, 2, 'old-large', 1, 16 * 1024 * 1024 + 1).seq, '1');

  const snapshotReplacement = id(235);
  sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
    VALUES('${historicalSnapshot.documentId}','${snapshotReplacement}',0,decode('0102','hex'),1,2);
    UPDATE survey_private.annotation_generation_heads SET generation_id='${snapshotReplacement}',last_seq=0 WHERE document_id='${historicalSnapshot.documentId}'`);
  errorState(asRole(owner, `SELECT public.store_annotation_snapshot_v3('${historicalSnapshot.documentId}','${historicalSnapshot.generationId}',2::smallint,0,decode(repeat('aa',67108865),'hex'),1,'old-snapshot',1,0,NULL,0)`, 'authenticated', false), 'SG002');

  const revoked = createGeneration(26, 2);
  sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${revoked.documentId}','${other}','editor','active');
    INSERT INTO survey_private.annotation_generation_updates(document_id,generation_id,seq,actor_user_id,client_id,client_seq,data)
      VALUES('${revoked.documentId}','${revoked.generationId}',1,'${other}','revoked-wal',1,decode(repeat('aa',16777217),'hex'));
    UPDATE survey_private.annotation_generation_heads SET last_seq=1 WHERE document_id='${revoked.documentId}';
    INSERT INTO survey_private.annotation_generation_snapshots(document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
      VALUES('${revoked.documentId}','${revoked.generationId}',1,decode(repeat('bb',67108865),'hex'),1,'revoked-snapshot',1);
    DELETE FROM document_collaborators WHERE document_id='${revoked.documentId}' AND user_id='${other}'`);
  const revokedWal = JSON.parse(asRole(other, `SELECT public.append_annotation_update_v3('${revoked.documentId}','${revoked.generationId}',2::smallint,'revoked-wal',1,decode(repeat('aa',16777217),'hex'))`).stdout);
  assert.equal(revokedWal.seq, '1');
  errorState(asRole(other, `SELECT public.store_annotation_snapshot_v3('${revoked.documentId}','${revoked.generationId}',2::smallint,1,decode(repeat('bb',67108865),'hex'),1,'revoked-snapshot',1,1,'revoked-snapshot',1)`, 'authenticated', false), '42501');

  const legacy = createGeneration(24, 1), legacySnapshot = createGeneration(34, 1);
  assert.equal(append(legacy, 1, 'legacy-large', 1, 16 * 1024 * 1024 + 1).accepted, true);
  assert.equal(store(legacySnapshot, 1, 'legacy-snapshot-large', 1, 64 * 1024 * 1024 + 1).stored, true);
  console.log('PASS model2 WAL/snapshot boundaries, rejection atomicity, historical receipt, collision, and model1 compatibility');
});
