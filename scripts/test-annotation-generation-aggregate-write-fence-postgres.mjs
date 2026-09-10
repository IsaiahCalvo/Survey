// Installed, disposable PostgreSQL only. No hosted provider, account or secret.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { initializeSurveyCrdtV2 } from '../src/services/documentSurveyCrdtV2.js';
import { handleAnnotationGenerationAggregate }
  from '../supabase/functions/annotation-generation-aggregate/handler.js';
import { createAnnotationGenerationAggregateSupabaseAdapter }
  from '../supabase/functions/annotation-generation-aggregate/supabaseAdapter.js';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(migrationPath(name), 'utf8');
const fn = (file, name) => { const text = source(file);
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = text.indexOf('$$;', start); assert.ok(start >= 0 && end > start);
  return text.slice(start, end + 3); };
const id = n => `a1400000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4), project = id(5);
const sha = hex => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, message) => {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(5);
  }
  assert.fail(message);
};

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, applyMigration, session, quote } = pg;
  const prior = readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs', import.meta.url), 'utf8');
  const start = prior.indexOf('  const prior='), end = prior.indexOf('  const doc=');
  assert.ok(start >= 0 && end > start);
  new Function('sql', 'applyMigration', 'migrationPath', 'readFileSync', 'source', 'fn',
    'owner', 'editor', 'viewer', 'other', 'project', 'assert',
    prior.slice(start, end).replaceAll("'import.meta.url'", "'__KEEP_IMPORT_META__'")
      .replaceAll('import.meta.url', JSON.stringify(new URL('./test-document-generation-source-receipts-postgres.mjs', import.meta.url).href))
      .replaceAll('__KEEP_IMPORT_META__', 'import.meta.url'))
    (sql, applyMigration, migrationPath, readFileSync, source, fn,
      owner, editor, viewer, other, project, assert);
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
  sql(`INSERT INTO templates(id,user_id) VALUES('${id(500)}','${owner}')`);
  for (const migration of ['20260909107000_annotation_content_model_v2.sql',
    '20260909108000_annotation_checkpoint_conditional.sql',
    '20260909109000_annotation_model2_capacity.sql',
    '20260909110000_annotation_generation_aggregate_admission.sql',
    '20260909112000_annotation_generation_aggregate_service_broker.sql',
    '20260909113000_annotation_generation_aggregate_current_receipts.sql']) {
    applyMigration(migrationPath(migration));
  }

  const createGeneration = (number, model = 2) => {
    const documentId = id(number), generationId = id(number + 100);
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size)
      VALUES('${documentId}','${owner}','${project}','fence','${owner}/${number}.pdf',4);
      INSERT INTO survey_private.annotation_generations(
        document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
      VALUES('${documentId}','${generationId}',0,decode('0102','hex'),1,${model});
      INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq)
      VALUES('${documentId}','${generationId}',0)`);
    return { documentId, generationId, model };
  };
  const appendSql = (scope, actor = owner, { model = scope.model, writer = 'public-writer',
    clientSeq = 1, data = 'aa' } = {}, required = true) => asRole(actor,
    `SELECT public.append_annotation_update_v3('${scope.documentId}','${scope.generationId}',
      ${model}::smallint,'${writer}',${clientSeq},decode('${data}','hex'))`, 'authenticated', required);
  const append = (...args) => JSON.parse(appendSql(...args).stdout);
  const snapshotSql = (scope, actor = owner, { model = scope.model, atSeq = 0,
    data = '0102', writer = 'snapshot-writer', epoch = 1, expectedAt = 0,
    expectedWriter = null, expectedEpoch = 0 } = {}, required = true) => asRole(actor,
    `SELECT public.store_annotation_snapshot_v3('${scope.documentId}','${scope.generationId}',
      ${model}::smallint,${atSeq},decode('${data}','hex'),1,'${writer}',${epoch},${expectedAt},
      ${expectedWriter === null ? 'NULL' : `'${expectedWriter}'`},${expectedEpoch})`, 'authenticated', required);
  const snapshot = (...args) => JSON.parse(snapshotSql(...args).stdout);
  const enableSql = scope => `SELECT survey_private.enable_annotation_generation_aggregate_write_fence_v1(
    '${scope.documentId}','${scope.generationId}')`;
  const enable = scope => JSON.parse(sql(enableSql(scope)).stdout);
  const state = scope => scalar(`SELECT h.last_seq||':'||coalesce(s.writer_epoch,0)||':'||
    (SELECT count(*) FROM survey_private.annotation_generation_updates u
      WHERE u.document_id=h.document_id AND u.generation_id=h.generation_id)||':'||
    (SELECT wake_revision FROM public.annotation_generation_signals z WHERE z.document_id=h.document_id)
    FROM survey_private.annotation_generation_heads h
    LEFT JOIN survey_private.annotation_generation_snapshots s
      ON s.document_id=h.document_id AND s.generation_id=h.generation_id
    WHERE h.document_id='${scope.documentId}'`);
  let checks = 0;
  const check = async (name, work) => { await work(); checks += 1; console.log(`PASS ${name}`); };

  const existing = createGeneration(20);
  applyMigration(migrationPath('20260909114000_annotation_generation_aggregate_write_fence.sql'));
  applyMigration(migrationPath('20260909114000_annotation_generation_aggregate_write_fence.sql'));

  await check('migration is empty, replay-safe and private by default', () => {
    assert.equal(scalar('SELECT count(*) FROM survey_private.annotation_generation_aggregate_write_fences'), '0');
    assert.equal(scalar(`SELECT relrowsecurity FROM pg_class
      WHERE oid='survey_private.annotation_generation_aggregate_write_fences'::regclass`), 't');
    assert.equal(scalar(`SELECT count(*) FROM pg_policy
      WHERE polrelid='survey_private.annotation_generation_aggregate_write_fences'::regclass`), '0');
    assert.equal(scalar(`SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL
      aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid='survey_private.enable_annotation_generation_aggregate_write_fence_v1(uuid,uuid)'::regprocedure
        AND a.grantee=0 AND a.privilege_type='EXECUTE'`), '0');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.equal(scalar(`SELECT has_table_privilege('${role}',
          'survey_private.annotation_generation_aggregate_write_fences','${privilege}')`), 'f');
      }
      assert.equal(scalar(`SELECT has_function_privilege('${role}',
        'survey_private.enable_annotation_generation_aggregate_write_fence_v1(uuid,uuid)','EXECUTE')`), 'f');
      errorState(asRole(owner, enableSql(existing), role, false), '42501');
      errorState(asRole(owner, `SELECT count(*) FROM survey_private.annotation_generation_aggregate_write_fences`, role, false), '42501');
      errorState(asRole(owner, `INSERT INTO survey_private.annotation_generation_aggregate_write_fences
        VALUES('${existing.documentId}','${existing.generationId}')`, role, false), '42501');
    }
    assert.equal(scalar(`SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL
      aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid='public.append_annotation_update_v3(uuid,uuid,smallint,text,bigint,bytea)'::regprocedure
        AND a.grantee=0 AND a.privilege_type='EXECUTE'`), '0');
    for (const role of ['anon', 'service_role']) {
      assert.equal(scalar(`SELECT has_function_privilege('${role}',
        'public.append_annotation_update_v3(uuid,uuid,smallint,text,bigint,bytea)','EXECUTE')`), 'f');
    }
    assert.equal(scalar(`SELECT has_function_privilege('authenticated',
      'public.append_annotation_update_v3(uuid,uuid,smallint,text,bigint,bytea)','EXECUTE')`), 't');
  });

  await check('an empty fence preserves existing model-2 and model-1 writes', () => {
    assert.equal(append(existing).seq, '1');
    assert.equal(snapshot(existing, owner, { atSeq: 1, data: 'bb' }).stored, true);
    const model1 = createGeneration(21, 1);
    assert.equal(append(model1, owner, { model: 1 }).accepted, true);
    assert.equal(snapshot(model1, owner, { model: 1, atSeq: 1, data: 'cc' }).stored, true);
    errorState(sql(enableSql(model1), false), 'SG003');
  });

  await check('enablement is current-only, idempotent and lock ordered', async () => {
    const scope = createGeneration(22);
    const writer = session('aggregate-fence-prior-write', { role: 'authenticated', actorId: owner });
    writer.send(`SELECT public.append_annotation_update_v3('${scope.documentId}','${scope.generationId}',
      2::smallint,'prior-write',1,decode('aa','hex'));SELECT 'PRIOR_WRITE_READY';`);
    await writer.wait('PRIOR_WRITE_READY');
    errorState(sql(enableSql(scope), false), '40001');
    await writer.finish(true);
    assert.equal(enable(scope).status, 'enabled');
    assert.equal(enable(scope).status, 'enabled');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_aggregate_write_fences
      WHERE document_id='${scope.documentId}' AND generation_id='${scope.generationId}'`), '1');
    assert.equal(append(scope, owner, { writer: 'prior-write', clientSeq: 1 }).seq, '1');
    errorState(appendSql(scope, owner, { writer: 'after-fence', clientSeq: 1 }, false), 'SG005');

    const unknown = { documentId: scope.documentId, generationId: id(999) };
    errorState(sql(enableSql(unknown), false), 'SG002');
    const replacement = id(222);
    sql(`INSERT INTO survey_private.annotation_generations(
      document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
      VALUES('${scope.documentId}','${replacement}',1,decode('0102','hex'),1,2);
      UPDATE survey_private.annotation_generation_heads SET generation_id='${replacement}',last_seq=1
      WHERE document_id='${scope.documentId}'`);
    errorState(sql(enableSql(scope), false), 'SG002');
  });

  await check('fenced public append keeps exact receipt and collision order', () => {
    const scope = existing;
    enable(scope);
    const before = state(scope);
    assert.equal(append(scope).seq, '1');
    errorState(appendSql(scope, owner, { data: 'cc' }, false), '23505');
    errorState(appendSql(scope, owner, { clientSeq: 2 }, false), 'SG005');
    assert.equal(state(scope), before);
  });

  await check('fenced snapshot keeps exact retry and stale CAS before the write fence', () => {
    const scope = existing;
    const before = state(scope);
    assert.equal(snapshot(scope, owner, { atSeq: 1, data: 'bb' }).stored, true);
    assert.equal(snapshot(scope, owner, { atSeq: 1, data: 'cc', writer: 'new-writer', epoch: 2,
      expectedAt: 0, expectedWriter: null, expectedEpoch: 0 }).stored, false);
    errorState(snapshotSql(scope, owner, { atSeq: 1, data: 'cc', writer: 'new-writer', epoch: 2,
      expectedAt: 1, expectedWriter: 'snapshot-writer', expectedEpoch: 1 }, false), 'SG005');
    assert.equal(state(scope), before);
  });

  await check('revoked and retired append receipts remain exact but snapshot scope stays strict', () => {
    const revoked = createGeneration(23);
    sql(`UPDATE documents SET project_id=NULL WHERE id='${revoked.documentId}';
      INSERT INTO document_collaborators(document_id,user_id,role,status)
      VALUES('${revoked.documentId}','${editor}','editor','active')`);
    assert.equal(append(revoked, editor, { writer: 'revoked' }).seq, '1');
    assert.equal(snapshot(revoked, editor, { atSeq: 1, data: 'dd', writer: 'revoked-snapshot' }).stored, true);
    enable(revoked);
    sql(`UPDATE document_collaborators SET status='revoked'
      WHERE document_id='${revoked.documentId}' AND user_id='${editor}'`);
    assert.equal(append(revoked, editor, { writer: 'revoked' }).seq, '1');
    errorState(appendSql(revoked, editor, { writer: 'revoked', data: 'ee' }, false), '23505');
    errorState(appendSql(revoked, editor, { writer: 'revoked', clientSeq: 2 }, false), '42501');
    errorState(snapshotSql(revoked, editor, { atSeq: 1, data: 'dd', writer: 'revoked-snapshot' }, false), '42501');

    const retired = createGeneration(24);
    assert.equal(append(retired, owner, { writer: 'retired' }).seq, '1');
    enable(retired);
    const replacement = id(224);
    sql(`INSERT INTO survey_private.annotation_generations(
      document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
      VALUES('${retired.documentId}','${replacement}',1,decode('0102','hex'),1,2);
      UPDATE survey_private.annotation_generation_heads SET generation_id='${replacement}',last_seq=1
      WHERE document_id='${retired.documentId}'`);
    assert.equal(append(retired, owner, { writer: 'retired' }).seq, '1');
    errorState(appendSql(retired, owner, { writer: 'retired', clientSeq: 2 }, false), 'SG002');
    errorState(snapshotSql(retired, owner, {}, false), 'SG002');
  });

  await check('all older public entry points reject a fenced model-2 generation', () => {
    const scope = createGeneration(25); enable(scope);
    errorState(asRole(owner, `SELECT public.append_annotation_update_v2('${scope.documentId}',
      '${scope.generationId}','old-v2',1,decode('aa','hex'))`, 'authenticated', false), 'SG003');
    errorState(asRole(owner, `SELECT public.append_annotation_update('${scope.documentId}',
      'legacy',1,decode('aa','hex'))`, 'authenticated', false), 'SG001');
    errorState(asRole(owner, `SELECT public.append_annotation_update_v3('${scope.documentId}',NULL,
      1::smallint,'null-generation',1,decode('aa','hex'))`, 'authenticated', false), 'SG001');
    errorState(asRole(owner, `SELECT public.append_annotation_update_v3('${scope.documentId}',
      '${scope.generationId}',1::smallint,'wrong-model',1,decode('aa','hex'))`, 'authenticated', false), 'SG003');
    errorState(asRole(owner, `SELECT public.store_annotation_snapshot_v2('${scope.documentId}',
      '${scope.generationId}',0,decode('0102','hex'),1,'old-v2',1,0,NULL,0)`, 'authenticated', false), 'SG003');
    errorState(asRole(owner, `SELECT public.store_annotation_snapshot('${scope.documentId}',
      0,decode('0102','hex'),1,'legacy',1,0,NULL,0)`, 'authenticated', false), 'SG001');
    errorState(asRole(owner, `SELECT public.store_annotation_snapshot_v3('${scope.documentId}',NULL,
      1::smallint,0,decode('0102','hex'),1,'null-generation',1,0,NULL,0)`, 'authenticated', false), 'SG001');
    errorState(asRole(owner, `SELECT public.store_annotation_snapshot_v3('${scope.documentId}',
      '${scope.generationId}',1::smallint,0,decode('0102','hex'),1,'wrong-model',1,0,NULL,0)`,
      'authenticated', false), 'SG003');
    assert.equal(state(scope).split(':')[0], '0');
  });

  await check('trusted aggregate commit remains the only new model-2 write under a fence', () => {
    const scope = createGeneration(26); enable(scope);
    const result = JSON.parse(asRole(null,
      `SELECT public.commit_annotation_generation_aggregate_service_v2(
        '${owner}','${scope.documentId}','${scope.generationId}',2::smallint,
        'trusted',1,decode('aa','hex'),0,0,NULL,0,1,'${sha('0102')}',NULL::bytea,NULL::integer)`,
      'service_role').stdout);
    assert.equal(result.accepted, true); assert.equal(result.seq, '1');
    assert.equal(result.is_current, true); assert.equal(result.checkpoint_stored, false);
    errorState(appendSql(scope, owner, { writer: 'public-new', clientSeq: 1 }, false), 'SG005');
    assert.equal(append(scope, owner, { writer: 'trusted', clientSeq: 1 }).seq, '1');
    const read = JSON.parse(asRole(owner, `SELECT public.read_annotation_updates_v3(
      '${scope.documentId}','${scope.generationId}',2::smallint,0,1,1000)`).stdout);
    assert.equal(read.through_seq, '1'); assert.equal(read.rows.length, 1);
    assert.equal(read.rows[0].client_id, 'trusted'); assert.equal(read.rows[0].data, '\\xaa');
  });

  await check('real sync uses handler and aggregate SQL under the fence with exact lost-reply recovery', async () => {
    const number = 30, documentId = id(number), generationId = id(number + 100);
    const seed = createDetachedYDoc('aggregate-fence-pg-seed');
    initializeSurveyCrdtV2(seed);
    const baseline = Y.encodeStateAsUpdate(seed), baselineHex = Buffer.from(baseline).toString('hex');
    const peerVector = Y.encodeStateVector(seed);
    seed.getMap('annoMeta').set('aggregate-fence-peer', 'seen-before-local-receipt');
    const peerUpdate = Y.encodeStateAsUpdate(seed, peerVector);
    seed.destroy();
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a]);
    const pdfHash = createHash('sha256').update(pdf).digest('hex');
    const path = `${owner}/_generations/${documentId}/${generationId}.pdf`;
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size)
      VALUES('${documentId}','${owner}','${project}','sync fence','${path}',${pdf.length});
      INSERT INTO survey_private.annotation_generations(
        document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
      VALUES('${documentId}','${generationId}',0,decode('${baselineHex}','hex'),1,2);
      INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq)
      VALUES('${documentId}','${generationId}',0)`);
    const scope = { documentId, generationId, model: 2 }; enable(scope);

    const callerRpc = (name, params) => {
      let expression;
      if (name === 'read_annotation_snapshot_v3') {
        expression = `public.read_annotation_snapshot_v3(${quote(params.p_document_id)},
          ${quote(params.p_generation_id)},${params.p_content_model_version}::smallint)`;
      } else if (name === 'read_annotation_writer_sequence_v3') {
        expression = `public.read_annotation_writer_sequence_v3(${quote(params.p_document_id)},
          ${quote(params.p_generation_id)},${params.p_content_model_version}::smallint,
          ${quote(params.p_client_id)})`;
      } else if (name === 'read_annotation_updates_v3') {
        expression = `public.read_annotation_updates_v3(${quote(params.p_document_id)},
          ${quote(params.p_generation_id)},${params.p_content_model_version}::smallint,
          ${params.p_after_seq}::bigint,${params.p_through_seq}::bigint,${params.p_limit}::integer)`;
      } else throw new Error(`Unexpected caller RPC ${name}`);
      return JSON.parse(asRole(owner, `SELECT ${expression}`).stdout);
    };
    let probes = 0, commits = 0, directAppends = 0, directSnapshots = 0;
    const serviceRpc = (name, params) => {
      let expression;
      if (name === 'probe_annotation_generation_aggregate_receipt_service_v2') {
        probes += 1;
        expression = `public.${name}(${quote(params.p_actor_user_id)},${quote(params.p_document_id)},
          ${quote(params.p_generation_id)},${params.p_content_model_version}::smallint,
          ${quote(params.p_client_id)},${params.p_client_seq}::bigint,${quote(params.p_data)}::bytea)`;
      } else if (name === 'read_annotation_generation_aggregate_checkpoint_service_v1') {
        expression = `public.${name}(${quote(params.p_actor_user_id)},${quote(params.p_document_id)},
          ${quote(params.p_generation_id)},${params.p_content_model_version}::smallint)`;
      } else if (name === 'commit_annotation_generation_aggregate_service_v2') {
        commits += 1;
        expression = `public.${name}(${quote(params.p_actor_user_id)},${quote(params.p_document_id)},
          ${quote(params.p_generation_id)},${params.p_content_model_version}::smallint,
          ${quote(params.p_client_id)},${params.p_client_seq}::bigint,${quote(params.p_data)}::bytea,
          ${params.p_expected_head}::bigint,${params.p_expected_checkpoint_at_seq}::bigint,
          ${quote(params.p_expected_checkpoint_writer_id)},${params.p_expected_checkpoint_writer_epoch}::bigint,
          ${params.p_expected_checkpoint_encoding_version}::integer,
          ${quote(params.p_expected_checkpoint_sha256)},${params.p_result_checkpoint === null
            ? 'NULL::bytea' : `${quote(params.p_result_checkpoint)}::bytea`},
          ${params.p_result_checkpoint_encoding_version === null ? 'NULL::integer'
            : `${params.p_result_checkpoint_encoding_version}::integer`})`;
      } else throw new Error(`Unexpected service RPC ${name}`);
      try {
        return { data: JSON.parse(asRole(null, `SELECT ${expression}`, 'service_role').stdout), error: null };
      } catch (error) {
        const code = String(error?.message || '').match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];
        return { data: null, error: { code: code || 'unconfirmed' } };
      }
    };
    const token = 'aggregate-fence-local-token';
    const adapter = createAnnotationGenerationAggregateSupabaseAdapter({
      caller: supplied => {
        assert.equal(supplied, token);
        return { auth: { getUser: async received => {
          assert.equal(received, token); return { data: { user: { id: owner } }, error: null };
        } }, rpc: async (name, params) => ({ data: callerRpc(name, params), error: null }) };
      },
      service: () => ({ rpc: async (name, params) => serviceRpc(name, params) }),
    });
    let requests = 0, lost = false, armInitialFlushRead = false;
    let markInitialFlushRead;
    const initialFlushRead = new Promise(resolve => { markInitialFlushRead = resolve; });
    const aggregateRequest = async call => {
      requests += 1;
      assert.ok(call.body instanceof Blob);
      assert.equal(call.headers.Authorization, `Bearer ${token}`);
      if (requests === 1) {
        await initialFlushRead;
        assert.equal(scalar(`SELECT last_seq FROM survey_private.annotation_generation_heads
          WHERE document_id='${documentId}'`), '0');
        const peerParams = new URLSearchParams({ document_id: documentId,
          generation_id: generationId, content_model_version: '2',
          client_id: 'aggregate-fence-peer', client_seq: '1', receipt_version: '2' });
        const peerResponse = await handleAnnotationGenerationAggregate(new Request(
          `https://local.invalid/functions/v1/annotation-generation-aggregate?${peerParams}`, {
            method: 'POST', headers: call.headers, body: new Blob([peerUpdate], {
              type: 'application/octet-stream',
            }), signal: call.signal,
          }), { runtimeVerified: true, timeoutMs: 10_000, ...adapter });
        assert.equal(peerResponse.status, 200);
        assert.equal((await peerResponse.json()).result.seq, '1');
      }
      const response = await handleAnnotationGenerationAggregate(new Request(
        `https://local.invalid/functions/v1/${call.functionName}`, {
          method: 'POST', headers: call.headers, body: call.body, signal: call.signal,
        }), { runtimeVerified: true, timeoutMs: 10_000, ...adapter });
      if (!lost && response.status === 200) {
        lost = true;
        throw new TypeError('fixture lost the accepted response');
      }
      return response;
    };
    const readerRequest = async (name, params) => {
      if (name === 'read_document_generation_open_v3') {
        const snapshotResult = callerRpc('read_annotation_snapshot_v3', {
          p_document_id: documentId, p_generation_id: generationId, p_content_model_version: 2,
        });
        return { data: { version: 3, actor_user_id: owner, document_id: documentId,
          generation_id: generationId, content_model_version: 2,
          document: { id: documentId, user_id: owner, project_id: project,
            name: 'sync fence', file_path: path, file_size: String(pdf.length) },
          publication: { operation_id: id(430), generation_id: generationId,
            published_at: '2026-09-10T12:00:00.000Z', wal_head: '0' },
          pdf: { bucket_id: 'documents', path, id: id(431), version: id(432),
            byte_length: String(pdf.length), content_sha256: pdfHash },
          annotations: { version: 3, document_id: documentId, generation_id: generationId,
            content_model_version: 2, wal_head: snapshotResult.wal_head,
            snapshot_sha256: params.p_include_snapshot
              ? createHash('sha256').update(Buffer.from(snapshotResult.snapshot.snapshot.slice(2), 'hex')).digest('hex') : null,
            snapshot: params.p_include_snapshot ? snapshotResult.snapshot : null } } };
      }
      return { data: callerRpc(name, params) };
    };
    const readBundle = async () => createDocumentGenerationReader({ request: readerRequest,
      download: async () => new Blob([pdf], { type: 'application/pdf' }),
      getActorUserId: () => owner }).open({ documentId, actorUserId: owner,
      pdfGenerationId: generationId, contentModelVersion: 2 });
    const checkedBundle = await readBundle();
    const appClient = { auth: { getSession: async () => ({ data: { session: {
      access_token: token, user: { id: owner },
    } }, error: null }) }, rpc(name, params) {
      const headers = {};
      const request = {
        setHeader(header, value) { headers[header] = value; return request; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            assert.equal(headers.Authorization, `Bearer ${token}`);
            if (name === 'append_annotation_update_v3') {
              directAppends += 1; throw new Error('direct append bypass');
            }
            if (name === 'store_annotation_snapshot_v3') {
              directSnapshots += 1; throw new Error('direct snapshot bypass');
            }
            const data = callerRpc(name, params);
            if (armInitialFlushRead && name === 'read_annotation_updates_v3') {
              assert.equal(data.through_seq, '0');
              armInitialFlushRead = false;
              markInitialFlushRead();
            }
            return { data, error: null };
          }).then(resolve, reject);
        },
      };
      return request;
    } };
    const indexedDb = new IDBFactory();
    const outbox = await createAnnotationOutbox({ indexedDb });
    const doc = createDetachedYDoc('aggregate-fence-pg-sync');
    const handle = await openAnnotationDoc({ documentId, actorUserId: owner,
      pdfGenerationId: generationId, checkedBundle, supabase: appClient, outboxStore: outbox,
      doc, writerId: 'aggregate-fence-sync', enableLocal: false, enableRealtime: false,
      snapshotRetryDelayMs: 0, aggregateRequest });
    try {
      armInitialFlushRead = true;
      assert.equal(await handle.flushSnapshot(), true);
      handle.setMeta('aggregate-fence-pg', 'saved');
      await until(() => requests === 2 && handle.getSyncStatus().queueSize === 0,
        'warm exact aggregate receipt retry did not settle');
      await handle.drain();
      assert.equal(await handle.flushSnapshot(), true);
      assert.equal(handle.getMeta('aggregate-fence-pg'), 'saved');
      assert.equal(handle.getMeta('aggregate-fence-peer'), 'seen-before-local-receipt');
    } finally {
      await handle.destroy(); await outbox.close(); if (!doc.isDestroyed) doc.destroy();
    }
    assert.equal(lost, true); assert.equal(requests, 2); assert.equal(probes, 3); assert.equal(commits, 2);
    assert.equal(directAppends, 0); assert.equal(directSnapshots, 0);
    assert.equal(scalar(`SELECT last_seq FROM survey_private.annotation_generation_heads
      WHERE document_id='${documentId}'`), '2');
    assert.equal(scalar(`SELECT seq||':'||client_id FROM survey_private.annotation_generation_updates
      WHERE document_id='${documentId}' ORDER BY seq`), '1:aggregate-fence-peer\n2:aggregate-fence-sync');

    const reopenedBundle = await readBundle();
    const reopenedOutbox = await createAnnotationOutbox({ indexedDb });
    const reopenedDoc = createDetachedYDoc('aggregate-fence-pg-reopen');
    const reopened = await openAnnotationDoc({ documentId, actorUserId: owner,
      pdfGenerationId: generationId, checkedBundle: reopenedBundle, supabase: appClient,
      outboxStore: reopenedOutbox, doc: reopenedDoc, writerId: 'aggregate-fence-reopen',
      enableLocal: false, enableRealtime: false, aggregateRequest });
    try {
      assert.equal(reopened.getMeta('aggregate-fence-pg'), 'saved');
      assert.equal(reopened.getMeta('aggregate-fence-peer'), 'seen-before-local-receipt');
      assert.equal(await reopened.flushSnapshot(), true);
    } finally {
      await reopened.destroy(); await reopenedOutbox.close();
      if (!reopenedDoc.isDestroyed) reopenedDoc.destroy();
    }
    assert.equal(requests, 2); assert.equal(commits, 2);
    assert.equal(directAppends, 0); assert.equal(directSnapshots, 0);
  });

  console.log(`PASS ${checks} annotation aggregate public write-fence PostgreSQL checks`);
}, { name: 'annotation-aggregate-fence', commandTimeoutMs: 60_000 });
