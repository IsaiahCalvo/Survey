// Installed, disposable PostgreSQL only. No hosted provider, account or secret.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
import { admitAnnotationGenerationAggregate }
  from '../supabase/functions/_shared/annotationGenerationAggregateAdmission.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { initializeSurveyCrdtV2, materializeSurveyCrdtV2, updateSurveyMarkersV2 }
  from '../src/services/documentSurveyCrdtV2.js';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(migrationPath(name), 'utf8');
const fn = (file, name) => { const text = source(file), start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = text.indexOf('$$;', start); assert.ok(start >= 0 && end > start); return text.slice(start, end + 3); };
const id = n => `97600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4), project = id(5);
const sha256 = hex => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const sha256Bytes = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesHex = bytes => Buffer.from(bytes).toString('hex');

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, applyMigration } = pg;
  // Reuse the complete local generation/publication schema bootstrap. It has no
  // external connection path and creates only this disposable cluster.
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
  applyMigration(migrationPath('20260909109000_annotation_model2_capacity.sql'));
  applyMigration(migrationPath('20260909110000_annotation_generation_aggregate_admission.sql'));
  applyMigration(migrationPath('20260909110000_annotation_generation_aggregate_admission.sql'));

  const createGeneration = (number, { baseline = '0102', baseSeq = 0 } = {}) => {
    const documentId = id(number), generationId = id(number + 100);
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size)
        VALUES('${documentId}','${owner}','${project}','aggregate','${owner}/${number}.pdf',4);
      INSERT INTO survey_private.annotation_generations(
        document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
        VALUES('${documentId}','${generationId}',${baseSeq},decode('${baseline}','hex'),1,2);
      INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq)
        VALUES('${documentId}','${generationId}',${baseSeq})`);
    return { documentId, generationId, baseline, baseSeq };
  };
  const privateRaw = (actor, expression, required = true) => sql(
    `SET request.jwt.claim.sub='${actor}'; SET request.jwt.claim.role='authenticated'; SELECT ${expression}`,
    required,
  );
  const privateCall = (actor, expression) => JSON.parse(privateRaw(actor, expression).stdout);
  const probeSql = (scope, actor, client, clientSeq, dataHex) =>
    `survey_private.probe_annotation_generation_update_receipt_v1(
      '${scope.documentId}','${scope.generationId}',2::smallint,'${client}',${clientSeq},decode('${dataHex}','hex'))`;
  const commitSql = (scope, {
    client, clientSeq, data = 'aa', head = scope.baseSeq, checkpointAt = scope.baseSeq,
    checkpointWriter = null, checkpointEpoch = 0, checkpointEncoding = 1,
    checkpointSha = sha256(scope.baseline), result = null, resultEncoding = null,
  }) => `survey_private.commit_annotation_generation_aggregate_v1(
    '${scope.documentId}','${scope.generationId}',2::smallint,'${client}',${clientSeq},decode('${data}','hex'),
    ${head},${checkpointAt},${checkpointWriter === null ? 'NULL' : `'${checkpointWriter}'`},${checkpointEpoch},
    ${checkpointEncoding},'${checkpointSha}',${result === null ? 'NULL::bytea' : `decode('${result}','hex')`},
    ${resultEncoding === null ? 'NULL::integer' : resultEncoding})`;

  const readFixedCheckpoint = (scope, actor) => {
    const value = JSON.parse(sql(`SELECT jsonb_build_object(
      'documentId','${scope.documentId}','generationId','${scope.generationId}',
      'actorUserId','${actor}','contentModelVersion',2,
      'head',h.last_seq::text,'baseSeq',g.base_seq::text,
      'checkpoint',jsonb_build_object(
        'atSeq',coalesce(s.at_seq,g.base_seq)::text,
        'writerId',s.writer_id,'writerEpoch',coalesce(s.writer_epoch,0)::text,
        'encodingVersion',coalesce(s.encoding_version,g.baseline_encoding_version),
        'snapshotSha256',encode(sha256(coalesce(s.snapshot,g.baseline_snapshot)),'hex'),
        'snapshotHex',encode(coalesce(s.snapshot,g.baseline_snapshot),'hex')))
      FROM survey_private.annotation_generations g
      JOIN survey_private.annotation_generation_heads h
        ON h.document_id=g.document_id AND h.generation_id=g.generation_id
      LEFT JOIN survey_private.annotation_generation_snapshots s
        ON s.document_id=g.document_id AND s.generation_id=g.generation_id
      WHERE g.document_id='${scope.documentId}' AND g.generation_id='${scope.generationId}'`).stdout);
    const { snapshotHex, ...checkpoint } = value.checkpoint;
    return { ...value, checkpoint: { ...checkpoint, snapshot: new Uint8Array(Buffer.from(snapshotHex, 'hex')) } };
  };
  const readTail = (scope, actor, afterSeq, throughSeq, limit) => {
    const rows = JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'seq',q.seq::text,'actorUserId',q.actor_user_id,'writerId',q.client_id,
      'clientSeq',q.client_seq::text,'updateHex',encode(q.data,'hex')) ORDER BY q.seq),'[]'::jsonb)
      FROM (SELECT * FROM survey_private.annotation_generation_updates
        WHERE document_id='${scope.documentId}' AND generation_id='${scope.generationId}'
          AND seq>${afterSeq} AND seq<=${throughSeq} ORDER BY seq LIMIT ${limit}) q`).stdout);
    return { documentId: scope.documentId, generationId: scope.generationId,
      actorUserId: actor, contentModelVersion: 2, throughSeq: String(throughSeq), hasMore: false,
      rows: rows.map(({ updateHex, ...row }) => ({ ...row,
        update: new Uint8Array(Buffer.from(updateHex, 'hex')) })) };
  };
  const aggregateAdapter = (scope, actor, update) => ({
    async lookupReceipt(identity) {
      const response = privateCall(actor, probeSql(scope, actor, identity.writerId,
        identity.clientSeq, bytesHex(update)));
      if (response.status === 'missing') return null;
      assert.equal(response.status, 'accepted');
      assert.equal(response.actor_user_id, actor);
      assert.equal(response.document_id, scope.documentId);
      assert.equal(response.generation_id, scope.generationId);
      assert.equal(response.client_id, identity.writerId);
      assert.equal(response.client_seq, identity.clientSeq);
      assert.equal(response.data_sha256, sha256Bytes(update));
      return { documentId: scope.documentId, generationId: scope.generationId,
        actorUserId: actor, contentModelVersion: 2, writerId: identity.writerId,
        clientSeq: identity.clientSeq, seq: response.seq, update: new Uint8Array(update) };
    },
    async readFixedCheckpoint() { return readFixedCheckpoint(scope, actor); },
    async readFixedTailPage({ afterSeq, throughSeq, limit }) {
      return readTail(scope, actor, afterSeq, throughSeq, limit);
    },
  });
  const commitAdmission = (scope, actor, admitted, writerId, clientSeq) => {
    assert.equal(admitted.kind, 'admitted');
    const sourceCheckpoint = admitted.sourceCheckpoint;
    assert.deepEqual(Object.keys(sourceCheckpoint).sort(), ['atSeq', 'contentModelVersion',
      'documentId', 'encodingVersion', 'generationId', 'snapshotSha256', 'writerEpoch', 'writerId']);
    const response = privateCall(actor,
      `survey_private.commit_annotation_generation_aggregate_v1(
        '${scope.documentId}','${scope.generationId}',2::smallint,'${writerId}',${clientSeq},
        decode('${bytesHex(admitted.update)}','hex'),${admitted.expectedHead},${sourceCheckpoint.atSeq},
        ${sourceCheckpoint.writerId === null ? 'NULL' : `'${sourceCheckpoint.writerId}'`},
        ${sourceCheckpoint.writerEpoch},${sourceCheckpoint.encodingVersion},'${sourceCheckpoint.snapshotSha256}',
        ${admitted.checkpoint === null ? 'NULL::bytea' : `decode('${bytesHex(admitted.checkpoint.bytes)}','hex')`},
        ${admitted.checkpoint === null ? 'NULL::integer' : admitted.checkpoint.encodingVersion})`);
    assert.equal(response.seq, admitted.nextSeq);
    assert.equal(response.data_sha256, sha256Bytes(admitted.update));
    assert.equal(response.checkpoint_stored, admitted.checkpoint !== null);
    if (admitted.checkpoint !== null) {
      assert.equal(response.checkpoint.at_seq, admitted.checkpoint.atSeq);
      assert.equal(response.checkpoint.encoding_version, admitted.checkpoint.encodingVersion);
      assert.equal(response.checkpoint.snapshot_sha256, admitted.checkpoint.snapshotSha256);
    }
    return response;
  };

  const ordinary = createGeneration(20);
  const miss = privateCall(owner, probeSql(ordinary, owner, 'ordinary', 1, 'aa'));
  assert.deepEqual(Object.keys(miss).sort(), ['actor_user_id', 'client_id', 'client_seq',
    'content_model_version', 'document_id', 'generation_id', 'status', 'version']);
  assert.equal(miss.status, 'missing');
  const wakeBefore = scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${ordinary.documentId}'`);
  const admitted = privateCall(owner, commitSql(ordinary, { client: 'ordinary', clientSeq: 1 }));
  assert.equal(admitted.accepted, true); assert.equal(admitted.seq, '1');
  assert.equal(admitted.checkpoint_stored, false); assert.equal(admitted.checkpoint, null);
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_snapshots WHERE document_id='${ordinary.documentId}'`), '0');
  assert.equal(scalar(`SELECT last_seq FROM survey_private.annotation_generation_heads WHERE document_id='${ordinary.documentId}'`), '1');
  assert.equal(Number(scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${ordinary.documentId}'`)), Number(wakeBefore) + 1);
  const found = privateCall(owner, probeSql(ordinary, owner, 'ordinary', 1, 'aa'));
  assert.equal(found.status, 'accepted'); assert.equal(found.seq, '1');
  assert.equal(found.data_sha256, sha256('aa'));
  errorState(privateRaw(owner, probeSql(ordinary, owner, 'ordinary', 1, 'bb'), false), '23505');

  const compacted = createGeneration(21);
  const compact = privateCall(owner, commitSql(compacted, {
    client: 'compact', clientSeq: 1, data: 'ab', result: 'deadbeef', resultEncoding: 2,
  }));
  assert.equal(compact.seq, '1'); assert.equal(compact.checkpoint_stored, true);
  assert.deepEqual(compact.checkpoint, {
    at_seq: '1', writer_id: 'survey-private-aggregate-v1', writer_epoch: '1',
    encoding_version: 2, snapshot_sha256: sha256('deadbeef'),
  });
  assert.equal(scalar(`SELECT concat_ws(':',at_seq,encode(snapshot,'hex'),encoding_version,writer_id,writer_epoch)
    FROM survey_private.annotation_generation_snapshots WHERE document_id='${compacted.documentId}'`),
  '1:deadbeef:2:survey-private-aggregate-v1:1');

  const makeSurveyAdmission = (number, { peerTail = false, checkpointPolicy } = {}) => {
    const doc = createDetachedYDoc(`aggregate-pg-${number}`);
    const marker = { annotationId: 'marker-a', pageNumber: 1,
      bounds: { x: 1, y: 2, width: 3, height: 4 }, moduleId: 'module-a',
      categoryId: 'category-a', entityId: 'entity-a', entityName: 'Entity A',
      entityColor: '#112233', checklistResponses: {}, note: 'baseline' };
    initializeSurveyCrdtV2(doc, { surveyMarkers: { 'marker-a': marker }, spaces: [] });
    const baseline = Y.encodeStateAsUpdate(doc);
    const scope = createGeneration(number, { baseline: bytesHex(baseline) });
    if (peerTail) {
      sql(`INSERT INTO document_collaborators(document_id,user_id,role,status)
        VALUES('${scope.documentId}','${editor}','editor','active')`);
      const vector = Y.encodeStateVector(doc);
      updateSurveyMarkersV2(doc, markers => ({ ...markers, 'marker-a': {
        ...markers['marker-a'], note: 'peer note',
      } }), { origin: 'aggregate-pg-peer' });
      const peerUpdate = Y.encodeStateAsUpdate(doc, vector);
      const peerReceipt = JSON.parse(asRole(editor, `SELECT public.append_annotation_update_v3(
        '${scope.documentId}','${scope.generationId}',2::smallint,
        'shared-writer',1,decode('${bytesHex(peerUpdate)}','hex'))`).stdout);
      assert.equal(peerReceipt.seq, '1');
    }
    const vector = Y.encodeStateVector(doc);
    updateSurveyMarkersV2(doc, markers => ({ ...markers, 'marker-a': {
      ...markers['marker-a'], checklistResponses: { aggregate: { selection: 'Y' } },
    } }), { origin: 'aggregate-pg-owner' });
    const update = Y.encodeStateAsUpdate(doc, vector);
    const expected = materializeSurveyCrdtV2(doc);
    doc.destroy();
    return { scope, update, expected, input: {
      documentId: scope.documentId, generationId: scope.generationId,
      actorUserId: owner, contentModelVersion: 2, writerId: 'shared-writer',
      clientSeq: '1', update, ...(checkpointPolicy ? { checkpointPolicy } : {}),
    } };
  };
  const checkedReopen = async (fixture, number) => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
    const pdfSha = sha256Bytes(pdf), path = `${owner}/_generations/${fixture.scope.documentId}/${fixture.scope.generationId}.pdf`;
    const request = async (name, params) => {
      if (name === 'read_document_generation_open_v3') {
        const fixed = readFixedCheckpoint(fixture.scope, owner);
        return { data: { version: 3, actor_user_id: owner,
          document_id: fixture.scope.documentId, generation_id: fixture.scope.generationId,
          content_model_version: 2,
          document: { id: fixture.scope.documentId, user_id: owner, project_id: project,
            name: 'Aggregate checked reopen', file_path: path, file_size: String(pdf.length) },
          publication: { operation_id: id(number + 300), generation_id: fixture.scope.generationId,
            published_at: '2026-09-10T12:00:00.000Z', wal_head: String(fixture.scope.baseSeq) },
          pdf: { bucket_id: 'documents', path, id: id(number + 400), version: id(number + 500),
            byte_length: String(pdf.length), content_sha256: pdfSha },
          annotations: { version: 3, document_id: fixture.scope.documentId,
            generation_id: fixture.scope.generationId, content_model_version: 2,
            wal_head: fixed.head,
            snapshot_sha256: params.p_include_snapshot ? fixed.checkpoint.snapshotSha256 : null,
            snapshot: params.p_include_snapshot ? {
              at_seq: fixed.checkpoint.atSeq,
              snapshot: `\\x${bytesHex(fixed.checkpoint.snapshot)}`,
              encoding_version: fixed.checkpoint.encodingVersion,
              writer_id: fixed.checkpoint.writerId,
              writer_epoch: fixed.checkpoint.writerEpoch,
            } : null } } };
      }
      assert.equal(name, 'read_annotation_updates_v3');
      const page = readTail(fixture.scope, owner, params.p_after_seq, params.p_through_seq, params.p_limit);
      return { data: { version: 3, document_id: fixture.scope.documentId,
        generation_id: fixture.scope.generationId, content_model_version: 2,
        through_seq: page.throughSeq, has_more: page.hasMore,
        rows: page.rows.map(row => ({ seq: row.seq, actor_user_id: row.actorUserId,
          client_id: row.writerId, client_seq: row.clientSeq,
          data: `\\x${bytesHex(row.update)}` })) } };
    };
    const reader = createDocumentGenerationReader({ request,
      download: async () => new Blob([pdf], { type: 'application/pdf' }),
      getActorUserId: () => owner });
    const opened = await reader.open({ documentId: fixture.scope.documentId,
      actorUserId: owner, pdfGenerationId: fixture.scope.generationId, contentModelVersion: 2 });
    const doc = createDetachedYDoc(`aggregate-pg-reopen-${number}`);
    try {
      Y.applyUpdate(doc, opened.annotationUpdate);
      const actual = materializeSurveyCrdtV2(doc);
      assert.deepEqual(actual.surveyMarkers, fixture.expected.surveyMarkers);
      assert.deepEqual(actual.spaces, fixture.expected.spaces);
    } finally { doc.destroy(); }
    return opened;
  };

  const ordinaryFlow = makeSurveyAdmission(40);
  const ordinaryResult = await admitAnnotationGenerationAggregate(ordinaryFlow.input,
    aggregateAdapter(ordinaryFlow.scope, owner, ordinaryFlow.update));
  assert.equal(ordinaryResult.checkpoint, null);
  commitAdmission(ordinaryFlow.scope, owner, ordinaryResult, 'shared-writer', 1);
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_snapshots
    WHERE document_id='${ordinaryFlow.scope.documentId}'`), '0');
  assert.equal((await checkedReopen(ordinaryFlow, 40)).throughSeq, '1');

  const compactFlow = makeSurveyAdmission(41, { peerTail: true, checkpointPolicy: 'maintenance' });
  const compactResult = await admitAnnotationGenerationAggregate(compactFlow.input,
    aggregateAdapter(compactFlow.scope, owner, compactFlow.update));
  assert.equal(compactResult.expectedHead, '1');
  assert.ok(compactResult.checkpoint);
  commitAdmission(compactFlow.scope, owner, compactResult, 'shared-writer', 1);
  assert.equal(scalar(`SELECT at_seq FROM survey_private.annotation_generation_snapshots
    WHERE document_id='${compactFlow.scope.documentId}'`), '2');
  assert.equal((await checkedReopen(compactFlow, 41)).throughSeq, '2');

  const sameHead = createGeneration(22);
  const sameHeadWake = scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${sameHead.documentId}'`);
  const changed = JSON.parse(asRole(owner, `SELECT public.store_annotation_snapshot_v3(
    '${sameHead.documentId}','${sameHead.generationId}',2::smallint,0,decode('0304','hex'),1,
    'other-writer',1,0,NULL,0)`).stdout);
  assert.equal(changed.stored, true);
  const wakeAfterSnapshot = scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${sameHead.documentId}'`);
  assert.equal(Number(wakeAfterSnapshot), Number(sameHeadWake) + 1);
  errorState(privateRaw(owner, commitSql(sameHead, { client: 'stale-snapshot', clientSeq: 1 }), false), '40001');
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates WHERE document_id='${sameHead.documentId}'`), '0');
  assert.equal(scalar(`SELECT last_seq FROM survey_private.annotation_generation_heads WHERE document_id='${sameHead.documentId}'`), '0');
  assert.equal(scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${sameHead.documentId}'`), wakeAfterSnapshot);

  const movedHead = createGeneration(23);
  JSON.parse(asRole(owner, `SELECT public.append_annotation_update_v3(
    '${movedHead.documentId}','${movedHead.generationId}',2::smallint,'other-client',1,decode('11','hex'))`).stdout);
  const movedWake = scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${movedHead.documentId}'`);
  errorState(privateRaw(owner, commitSql(movedHead, { client: 'stale-head', clientSeq: 1 }), false), '40001');
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates WHERE document_id='${movedHead.documentId}'`), '1');
  assert.equal(scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${movedHead.documentId}'`), movedWake);

  const retired = createGeneration(24);
  sql(`INSERT INTO document_collaborators(document_id,user_id,role,status)
      VALUES('${retired.documentId}','${editor}','editor','active');
    INSERT INTO survey_private.annotation_generation_updates(
      document_id,generation_id,seq,actor_user_id,client_id,client_seq,data)
      VALUES('${retired.documentId}','${retired.generationId}',1,'${editor}','historical',1,decode('22','hex'));
    UPDATE survey_private.annotation_generation_heads SET last_seq=1 WHERE document_id='${retired.documentId}';
    DELETE FROM document_collaborators WHERE document_id='${retired.documentId}' AND user_id='${editor}'`);
  const replacement = id(224);
  sql(`INSERT INTO survey_private.annotation_generations(
      document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
      VALUES('${retired.documentId}','${replacement}',1,decode('0102','hex'),1,2);
    UPDATE survey_private.annotation_generation_heads
      SET generation_id='${replacement}',last_seq=1 WHERE document_id='${retired.documentId}'`);
  assert.equal(privateCall(editor, probeSql(retired, editor, 'historical', 1, '22')).seq, '1');
  const historicalRetry = privateCall(editor,
    `survey_private.commit_annotation_generation_aggregate_v1(
      '${retired.documentId}','${retired.generationId}',2::smallint,'historical',1,decode('22','hex'),
      NULL,NULL,NULL,NULL,NULL,NULL,decode(repeat('aa',67108865),'hex'),NULL)`);
  assert.equal(historicalRetry.seq, '1'); assert.equal(historicalRetry.checkpoint_stored, false);
  errorState(privateRaw(editor, probeSql(retired, editor, 'historical', 1, '23'), false), '23505');

  const overflow = createGeneration(25);
  sql(`INSERT INTO survey_private.annotation_generation_snapshots(
      document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
      VALUES('${overflow.documentId}','${overflow.generationId}',0,decode('0102','hex'),1,
        'epoch-limit',9223372036854775807)`);
  const overflowWake = scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${overflow.documentId}'`);
  errorState(privateRaw(owner, commitSql(overflow, {
    client: 'epoch-overflow', clientSeq: 1, checkpointWriter: 'epoch-limit',
    checkpointEpoch: '9223372036854775807', result: 'bb', resultEncoding: 1,
  }), false), '22003');
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates WHERE document_id='${overflow.documentId}'`), '0');
  assert.equal(scalar(`SELECT last_seq FROM survey_private.annotation_generation_heads WHERE document_id='${overflow.documentId}'`), '0');
  assert.equal(scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${overflow.documentId}'`), overflowWake);
  assert.equal(scalar(`SELECT writer_epoch FROM survey_private.annotation_generation_snapshots WHERE document_id='${overflow.documentId}'`), '9223372036854775807');

  const sequenceOverflow = createGeneration(27);
  sql(`UPDATE survey_private.annotation_generation_heads SET last_seq=9223372036854775807
    WHERE document_id='${sequenceOverflow.documentId}'`);
  const sequenceOverflowWake = scalar(`SELECT wake_revision FROM public.annotation_generation_signals
    WHERE document_id='${sequenceOverflow.documentId}'`);
  errorState(privateRaw(owner, commitSql(sequenceOverflow, {
    client: 'sequence-overflow', clientSeq: 1, head: '9223372036854775807',
  }), false), '22003');
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates
    WHERE document_id='${sequenceOverflow.documentId}'`), '0');
  assert.equal(scalar(`SELECT last_seq FROM survey_private.annotation_generation_heads
    WHERE document_id='${sequenceOverflow.documentId}'`), '9223372036854775807');
  assert.equal(scalar(`SELECT wake_revision FROM public.annotation_generation_signals
    WHERE document_id='${sequenceOverflow.documentId}'`), sequenceOverflowWake);

  const badToken = createGeneration(26);
  const badWake = scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${badToken.documentId}'`);
  errorState(privateRaw(owner, `survey_private.commit_annotation_generation_aggregate_v1(
    '${badToken.documentId}','${badToken.generationId}',2::smallint,'bad-token',1,decode('aa','hex'),
    0,0,NULL,0,1,'',NULL,NULL)`, false), '22023');
  assert.equal(scalar(`SELECT wake_revision FROM public.annotation_generation_signals WHERE document_id='${badToken.documentId}'`), badWake);

  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(scalar(`SELECT has_function_privilege('${role}',
      'survey_private.probe_annotation_generation_update_receipt_v1(uuid,uuid,smallint,text,bigint,bytea)','EXECUTE')`), 'f');
    assert.equal(scalar(`SELECT has_function_privilege('${role}',
      'survey_private.commit_annotation_generation_aggregate_v1(uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)','EXECUTE')`), 'f');
  }
  assert.equal(scalar(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname='survey_private' AND p.proname IN(
      'probe_annotation_generation_update_receipt_v1','commit_annotation_generation_aggregate_v1')
      AND a.grantee=0 AND (a.privilege_type='EXECUTE')`), '0');
  assert.equal(scalar(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE '%annotation_generation_aggregate%'`), '0');

  console.log('PASS private aggregate receipt, head/checkpoint CAS, optional checkpoint, rollback, and ACL contract');
}, { name: 'annotation-generation-aggregate', commandTimeoutMs: 60_000 });
