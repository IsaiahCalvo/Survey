// Installed, disposable PostgreSQL only. No hosted provider, account or secret.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
import { handleAnnotationGenerationAggregate }
  from '../supabase/functions/annotation-generation-aggregate/handler.js';
import { createAnnotationGenerationAggregateSupabaseAdapter }
  from '../supabase/functions/annotation-generation-aggregate/supabaseAdapter.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { initializeSurveyCrdtV2, materializeSurveyCrdtV2, updateSurveyMarkersV2 }
  from '../src/services/documentSurveyCrdtV2.js';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(migrationPath(name), 'utf8');
const fn = (file, name) => { const text = source(file);
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = text.indexOf('$$;', start); assert.ok(start >= 0 && end > start);
  return text.slice(start, end + 3); };
const id = n => `a1200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4), project = id(5);
const sha = hex => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, applyMigration, quote } = pg;
  // Reuse the full local generation schema setup. Every object lives only in
  // this disposable cluster and no connection string can be supplied.
  const prior = readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs', import.meta.url), 'utf8');
  const a = prior.indexOf('  const prior='), b = prior.indexOf('  const doc=');
  assert.ok(a >= 0 && b > a);
  new Function('sql', 'applyMigration', 'migrationPath', 'readFileSync', 'source', 'fn',
    'owner', 'editor', 'viewer', 'other', 'project', 'assert',
    prior.slice(a, b).replaceAll("'import.meta.url'", "'__KEEP_IMPORT_META__'")
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
    '20260909112000_annotation_generation_aggregate_service_broker.sql']) {
    applyMigration(migrationPath(migration));
  }
  applyMigration(migrationPath('20260909112000_annotation_generation_aggregate_service_broker.sql'));

  const createGeneration = (number, { actor = owner, baseline = '0102', model = 2,
    baseSeq = 0 } = {}) => {
    const documentId = id(number), generationId = id(number + 100);
    sql(`SET request.jwt.claim.sub='${actor}';SET request.jwt.claim.role='authenticated';
      INSERT INTO documents(id,user_id,project_id,name,file_path,file_size)
        VALUES('${documentId}','${actor}','${project}','broker','${actor}/${number}.pdf',4);
      ${baseSeq > 0 ? `INSERT INTO public.annotation_updates(document_id,client_id,client_seq,data)
        SELECT '${documentId}','legacy-floor',n,decode('00','hex')
        FROM generate_series(1,${baseSeq}) n;
        INSERT INTO public.annotation_snapshots(
        document_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
        VALUES('${documentId}',${baseSeq},decode('${baseline}','hex'),1,'legacy-floor',1);` : ''}
      INSERT INTO survey_private.annotation_generations(
        document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
        VALUES('${documentId}','${generationId}',${baseSeq},decode('${baseline}','hex'),1,${model});
      INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq)
        VALUES('${documentId}','${generationId}',${baseSeq})`);
    return { documentId, generationId, baseline, model, baseSeq };
  };
  const receipt = (scope, actor, client = 'broker-writer', seq = 1, data = 'aa') =>
    `public.probe_annotation_generation_aggregate_receipt_service_v1(
      '${actor}','${scope.documentId}','${scope.generationId}',2::smallint,
      '${client}',${seq},decode('${data}','hex'))`;
  const checkpoint = (scope, actor) =>
    `public.read_annotation_generation_aggregate_checkpoint_service_v1(
      '${actor}','${scope.documentId}','${scope.generationId}',2::smallint)`;
  const commit = (scope, actor, { client = 'broker-writer', seq = 1, data = 'aa', head = 0,
    checkpointAt = 0, checkpointWriter = null, checkpointEpoch = 0,
    checkpointEncoding = 1, checkpointSha = sha(scope.baseline), result = null,
    resultEncoding = null } = {}) =>
    `public.commit_annotation_generation_aggregate_service_v1(
      '${actor}','${scope.documentId}','${scope.generationId}',2::smallint,
      '${client}',${seq},decode('${data}','hex'),${head},${checkpointAt},
      ${checkpointWriter === null ? 'NULL' : quote(checkpointWriter)},${checkpointEpoch},
      ${checkpointEncoding},'${checkpointSha}',
      ${result === null ? 'NULL::bytea' : `decode('${result}','hex')`},
      ${resultEncoding === null ? 'NULL::integer' : resultEncoding})`;
  const service = expression => JSON.parse(asRole(null,
    `SET request.jwt.claims='{"sub":"service-sentinel","role":"service_role"}';SELECT ${expression}`,
    'service_role').stdout);
  let checks = 0;
  const check = async (label, work) => { await work(); checks += 1; console.log(`PASS ${label}`); };

  await check('migration replay keeps only the three typed brokers service executable', () => {
    const signatures = [
      'public.probe_annotation_generation_aggregate_receipt_service_v1(uuid,uuid,uuid,smallint,text,bigint,bytea)',
      'public.read_annotation_generation_aggregate_checkpoint_service_v1(uuid,uuid,uuid,smallint)',
      'public.commit_annotation_generation_aggregate_service_v1(uuid,uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)',
    ];
    for (const signature of signatures) {
      assert.equal(scalar(`SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL
        aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE p.oid=${quote(signature)}::regprocedure AND acl.grantee=0
          AND acl.privilege_type='EXECUTE'`), '0');
      assert.equal(scalar(`SELECT has_function_privilege('service_role',${quote(signature)},'EXECUTE')`), 't');
      for (const role of ['anon', 'authenticated']) {
        assert.equal(scalar(`SELECT has_function_privilege('${role}',${quote(signature)},'EXECUTE')`), 'f');
      }
    }
    for (const signature of [
      'survey_private.probe_annotation_generation_update_receipt_v1(uuid,uuid,smallint,text,bigint,bytea)',
      'survey_private.commit_annotation_generation_aggregate_v1(uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)',
    ]) assert.equal(scalar(`SELECT has_function_privilege('service_role',${quote(signature)},'EXECUTE')`), 'f');
    assert.equal(scalar(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE '%annotation_generation_aggregate%tail%'`), '0');
  });

  await check('SQL role proof rejects anon and authenticated claim spoofing', () => {
    const scope = createGeneration(10);
    for (const role of ['anon', 'authenticated']) {
      const attempt = asRole(owner,
        `SET request.jwt.claim.role='service_role';
         SET request.jwt.claims='{"sub":"${owner}","role":"service_role"}';
         SELECT ${receipt(scope, owner)}`, role, false);
      errorState(attempt, '42501');
    }
  });

  await check('internal role guard rejects spoofing even behind a rollback-only temporary grant', () => {
    const scope = createGeneration(19);
    const cases = [
      ['public.probe_annotation_generation_aggregate_receipt_service_v1(uuid,uuid,uuid,smallint,text,bigint,bytea)',
        receipt(scope, owner)],
      ['public.read_annotation_generation_aggregate_checkpoint_service_v1(uuid,uuid,uuid,smallint)',
        checkpoint(scope, owner)],
      ['public.commit_annotation_generation_aggregate_service_v1(uuid,uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)',
        commit(scope, owner)],
    ];
    for (const role of ['anon', 'authenticated']) {
      for (const [signature, expression] of cases) {
        const attempt = sql(`BEGIN;
          GRANT EXECUTE ON FUNCTION ${signature} TO ${role};
          SET ROLE ${role};
          SET request.jwt.claim.sub='${owner}';
          SET request.jwt.claim.role='service_role';
          SET request.jwt.claims='{"sub":"${owner}","role":"service_role"}';
          SELECT ${expression}`, false);
        errorState(attempt, '42501');
        assert.match(attempt.stderr, /annotation aggregate service role required/);
        assert.equal(scalar(`SELECT has_function_privilege('${role}',${quote(signature)},'EXECUTE')`), 'f',
          'failed transaction must roll back its temporary grant');
      }
    }
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates
      WHERE document_id='${scope.documentId}'`), '0');
    assert.equal(scalar(`SELECT last_seq FROM survey_private.annotation_generation_heads
      WHERE document_id='${scope.documentId}'`), '0');
  });

  await check('service delegation uses minimal actor claims and restores every claim on success', () => {
    const scope = createGeneration(11);
    const statement = `BEGIN;
      CREATE TEMP TABLE claim_audit(value jsonb);
      CREATE FUNCTION pg_temp.capture_aggregate_claims() RETURNS trigger LANGUAGE plpgsql AS
        $$BEGIN INSERT INTO claim_audit VALUES(current_setting('request.jwt.claims',true)::jsonb);RETURN NEW;END$$;
      CREATE TRIGGER capture_aggregate_claims BEFORE INSERT ON survey_private.annotation_generation_updates
        FOR EACH ROW EXECUTE FUNCTION pg_temp.capture_aggregate_claims();
      SET ROLE service_role;
      SET request.jwt.claim.sub='${other}';SET request.jwt.claim.role='service_role';
      SET request.jwt.claims='{"sub":"${other}","role":"service_role","app_metadata":{"admin":true},"sentinel":"keep"}';
      SELECT ${commit(scope, owner)};
      RESET ROLE;
      DO $$BEGIN
        IF (SELECT value FROM claim_audit) IS DISTINCT FROM
          jsonb_build_object('sub','${owner}','role','authenticated') THEN
          RAISE EXCEPTION 'delegated claims were not minimal';
        END IF;
        IF current_setting('request.jwt.claim.sub',true) IS DISTINCT FROM '${other}'
          OR current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
          OR current_setting('request.jwt.claims',true) IS DISTINCT FROM
            '{"sub":"${other}","role":"service_role","app_metadata":{"admin":true},"sentinel":"keep"}' THEN
          RAISE EXCEPTION 'service claims were not restored';
        END IF;
      END$$;
      DROP TRIGGER capture_aggregate_claims ON survey_private.annotation_generation_updates;
      ROLLBACK;`;
    sql(statement);
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates
      WHERE document_id='${scope.documentId}'`), '0');
  });

  await check('nested errors and malformed modern claims fail closed without leaking identity', () => {
    const scope = createGeneration(12);
    sql(`BEGIN;SET ROLE service_role;
      SET request.jwt.claim.sub='${other}';SET request.jwt.claim.role='service_role';
      SET request.jwt.claims='{"sub":"${other}","role":"service_role","sentinel":"error"}';
      DO $$BEGIN
        BEGIN PERFORM ${commit(scope, owner, { checkpointSha: 'a'.repeat(64) })};
          RAISE EXCEPTION 'expected CAS error';
        EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
        IF current_setting('request.jwt.claim.sub',true) IS DISTINCT FROM '${other}'
          OR current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
          OR current_setting('request.jwt.claims',true) IS DISTINCT FROM
            '{"sub":"${other}","role":"service_role","sentinel":"error"}' THEN
          RAISE EXCEPTION 'error path leaked claims';
        END IF;
      END$$;ROLLBACK;`);
    errorState(asRole(null, `SET request.jwt.claims='not-json';SELECT ${receipt(scope, owner)}`,
      'service_role', false), '42501');
  });

  await check('checkpoint broker returns one fixed full model-2 checkpoint with actual base sequence', () => {
    const scope = createGeneration(13, { baseline: '01020304', baseSeq: 7 });
    const value = service(checkpoint(scope, owner));
    assert.deepEqual(Object.keys(value).sort(), ['actor_user_id', 'base_seq', 'checkpoint',
      'content_model_version', 'document_id', 'generation_id', 'head', 'version']);
    assert.deepEqual(Object.keys(value.checkpoint).sort(), ['at_seq', 'encoding_version',
      'snapshot', 'snapshot_sha256', 'writer_epoch', 'writer_id']);
    assert.equal(value.version, 1); assert.equal(value.actor_user_id, owner);
    assert.equal(value.document_id, scope.documentId); assert.equal(value.generation_id, scope.generationId);
    assert.equal(value.content_model_version, 2); assert.equal(value.head, '7');
    assert.equal(value.base_seq, '7'); assert.equal(value.checkpoint.at_seq, '7');
    assert.equal(value.checkpoint.snapshot, '\\x01020304');
    assert.equal(value.checkpoint.snapshot_sha256, sha('01020304'));
  });

  await check('checkpoint preflight rejects viewer, locked document and model 1 before bytes', () => {
    const scope = createGeneration(14);
    sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES
      ('${scope.documentId}','${viewer}','viewer','active')`);
    errorState(asRole(null, `SELECT ${checkpoint(scope, viewer)}`, 'service_role', false), '42501');
    sql(`UPDATE documents SET locked_at=now() WHERE id='${scope.documentId}'`);
    errorState(asRole(null, `SELECT ${checkpoint(scope, owner)}`, 'service_role', false), '42501');
    sql(`UPDATE documents SET locked_at=NULL WHERE id='${scope.documentId}'`);
    errorState(asRole(null, `SELECT public.read_annotation_generation_aggregate_checkpoint_service_v1(
      '${owner}','${scope.documentId}','${scope.generationId}',1::smallint)`, 'service_role', false), '22023');
  });

  await check('ordinary commit, lost reply retry and collision preserve exact receipts', () => {
    const scope = createGeneration(15);
    assert.equal(service(receipt(scope, owner)).status, 'missing');
    const admitted = service(commit(scope, owner));
    assert.equal(admitted.status, 'accepted'); assert.equal(admitted.seq, '1');
    assert.equal(admitted.checkpoint_stored, false);
    const retry = service(commit(scope, owner, { head: 99, checkpointSha: 'f'.repeat(64) }));
    assert.equal(retry.seq, '1'); assert.equal(retry.data_sha256, sha('aa'));
    errorState(asRole(null, `SELECT ${commit(scope, owner, { data: 'bb', head: 99,
      checkpointSha: 'f'.repeat(64) })}`, 'service_role', false), '23505');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates
      WHERE document_id='${scope.documentId}'`), '1');
  });

  await check('revoked editor keeps exact historical receipt but cannot make a new write', () => {
    const scope = createGeneration(16);
    sql(`UPDATE documents SET project_id=NULL WHERE id='${scope.documentId}';
      INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES
      ('${scope.documentId}','${editor}','editor','active')`);
    assert.equal(service(commit(scope, editor)).seq, '1');
    sql(`UPDATE document_collaborators SET status='revoked'
      WHERE document_id='${scope.documentId}' AND user_id='${editor}'`);
    assert.equal(service(receipt(scope, editor)).seq, '1');
    assert.equal(service(commit(scope, editor, { head: 999, checkpointSha: 'f'.repeat(64) })).seq, '1');
    errorState(asRole(null, `SELECT ${commit(scope, editor, { seq: 2, data: 'bb', head: 1 })}`,
      'service_role', false), '42501');
  });

  await check('retired generation keeps exact historical receipt but rejects a new write', () => {
    const scope = createGeneration(18);
    assert.equal(service(commit(scope, owner)).seq, '1');
    const nextGeneration = id(218);
    sql(`INSERT INTO survey_private.annotation_generations(
      document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
      VALUES('${scope.documentId}','${nextGeneration}',1,decode('0102','hex'),1,2);
      UPDATE survey_private.annotation_generation_heads SET generation_id='${nextGeneration}',last_seq=1
      WHERE document_id='${scope.documentId}'`);
    assert.equal(service(receipt(scope, owner)).seq, '1');
    assert.equal(service(commit(scope, owner, { head: 999, checkpointSha: 'f'.repeat(64) })).seq, '1');
    errorState(asRole(null, `SELECT ${commit(scope, owner, { seq: 2, data: 'bb', head: 1 })}`,
      'service_role', false), 'SG002');
  });

  await check('commit keeps source checkpoint CAS and optional checkpoint atomic', () => {
    const scope = createGeneration(17);
    const fixed = service(checkpoint(scope, owner));
    sql(`INSERT INTO survey_private.annotation_generation_snapshots(
      document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
      VALUES('${scope.documentId}','${scope.generationId}',0,decode('0304','hex'),1,'peer',1)`);
    errorState(asRole(null, `SELECT ${commit(scope, owner, {
      checkpointAt: Number(fixed.checkpoint.at_seq),
      checkpointWriter: fixed.checkpoint.writer_id,
      checkpointEpoch: Number(fixed.checkpoint.writer_epoch),
      checkpointEncoding: fixed.checkpoint.encoding_version,
      checkpointSha: fixed.checkpoint.snapshot_sha256,
    })}`, 'service_role', false), '40001');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates
      WHERE document_id='${scope.documentId}'`), '0');
    const current = service(checkpoint(scope, owner));
    const compacted = service(commit(scope, owner, { checkpointWriter: current.checkpoint.writer_id,
      checkpointEpoch: Number(current.checkpoint.writer_epoch),
      checkpointEncoding: current.checkpoint.encoding_version,
      checkpointSha: current.checkpoint.snapshot_sha256,
      result: '0506', resultEncoding: 1 }));
    assert.equal(compacted.seq, '1'); assert.equal(compacted.checkpoint_stored, true);
    assert.equal(scalar(`SELECT concat_ws(':',last_seq,
      (SELECT at_seq FROM survey_private.annotation_generation_snapshots s
       WHERE s.document_id=h.document_id AND s.generation_id=h.generation_id))
      FROM survey_private.annotation_generation_heads h WHERE document_id='${scope.documentId}'`), '1:1');
  });

  await check('actual Request, production adapter and service broker reopen through the checked reader', async () => {
    const token = 'synthetic-local-auth-token';
    const makeFlow = number => {
      const doc = createDetachedYDoc(`aggregate-broker-pg-${number}`);
      initializeSurveyCrdtV2(doc, { surveyMarkers: {}, spaces: [] });
      const baseline = Y.encodeStateAsUpdate(doc);
      const scope = createGeneration(number, { baseline: Buffer.from(baseline).toString('hex') });
      const vector = Y.encodeStateVector(doc);
      updateSurveyMarkersV2(doc, markers => ({ ...markers, marker: {
        annotationId: 'marker', pageNumber: 1,
        bounds: { x: 1, y: 2, width: 3, height: 4 }, moduleId: 'module',
        categoryId: 'category', entityId: 'entity', entityName: 'Entity',
        entityColor: '#123456', checklistResponses: {}, note: `flow-${number}`,
      } }), { origin: 'aggregate-broker-pg' });
      const update = Y.encodeStateAsUpdate(doc, vector), expected = materializeSurveyCrdtV2(doc);
      doc.destroy();
      return { scope, update, expected };
    };
    const serviceRpc = (name, params) => {
      let expression;
      if (name === 'probe_annotation_generation_aggregate_receipt_service_v1') {
        expression = `public.${name}(${quote(params.p_actor_user_id)},${quote(params.p_document_id)},
          ${quote(params.p_generation_id)},${params.p_content_model_version}::smallint,
          ${quote(params.p_client_id)},${params.p_client_seq}::bigint,${quote(params.p_data)}::bytea)`;
      } else if (name === 'read_annotation_generation_aggregate_checkpoint_service_v1') {
        expression = `public.${name}(${quote(params.p_actor_user_id)},${quote(params.p_document_id)},
          ${quote(params.p_generation_id)},${params.p_content_model_version}::smallint)`;
      } else if (name === 'commit_annotation_generation_aggregate_service_v1') {
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
      return JSON.parse(asRole(null, `SELECT ${expression}`, 'service_role').stdout);
    };
    const callerRpc = (actor, name, params) => {
      assert.equal(name, 'read_annotation_updates_v3');
      return JSON.parse(asRole(actor, `SELECT public.read_annotation_updates_v3(
        ${quote(params.p_document_id)},${quote(params.p_generation_id)},
        ${params.p_content_model_version}::smallint,${params.p_after_seq}::bigint,
        ${params.p_through_seq}::bigint,${params.p_limit}::integer)`).stdout);
    };
    const makeAdapter = ({ beforeCommit } = {}) => createAnnotationGenerationAggregateSupabaseAdapter({
      caller: supplied => {
        assert.equal(supplied, token);
        return { auth: { getUser: async received => {
          assert.equal(received, token);
          return { data: { user: { id: owner } }, error: null };
        } }, rpc: async (name, params) => ({ data: callerRpc(owner, name, params), error: null }) };
      },
      service: () => ({ rpc: async (name, params) => {
        if (name === 'commit_annotation_generation_aggregate_service_v1' && beforeCommit) {
          const work = beforeCommit; beforeCommit = null; work(params);
        }
        return { data: serviceRpc(name, params), error: null };
      } }),
    });
    const runHandler = async (flow, writerId, clientSeq, adapter) => {
      const params = new URLSearchParams({ document_id: flow.scope.documentId,
        generation_id: flow.scope.generationId, content_model_version: '2',
        client_id: writerId, client_seq: String(clientSeq) });
      const response = await handleAnnotationGenerationAggregate(new Request(
        `https://local.invalid/annotation-generation-aggregate?${params}`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`,
            'content-type': 'application/octet-stream' }, body: flow.update,
        }), { runtimeVerified: true, timeoutMs: 10_000, ...adapter });
      return { status: response.status, body: await response.json() };
    };
    const reopen = async (flow, number) => {
      const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a]);
      const pdfHash = createHash('sha256').update(pdf).digest('hex');
      const path = `${owner}/_generations/${flow.scope.documentId}/${flow.scope.generationId}.pdf`;
      const request = async (name, params) => {
        if (name === 'read_document_generation_open_v3') {
          const snapshot = JSON.parse(asRole(owner, `SELECT public.read_annotation_snapshot_v3(
            '${flow.scope.documentId}','${flow.scope.generationId}',2::smallint)`).stdout);
          return { data: { version: 3, actor_user_id: owner,
            document_id: flow.scope.documentId, generation_id: flow.scope.generationId,
            content_model_version: 2,
            document: { id: flow.scope.documentId, user_id: owner, project_id: project,
              name: 'Broker checked reopen', file_path: path, file_size: String(pdf.length) },
            publication: { operation_id: id(number + 300), generation_id: flow.scope.generationId,
              published_at: '2026-09-10T12:00:00.000Z', wal_head: '0' },
            pdf: { bucket_id: 'documents', path, id: id(number + 400), version: id(number + 500),
              byte_length: String(pdf.length), content_sha256: pdfHash },
            annotations: { version: 3, document_id: flow.scope.documentId,
              generation_id: flow.scope.generationId, content_model_version: 2,
              wal_head: snapshot.wal_head,
              snapshot_sha256: params.p_include_snapshot
                ? createHash('sha256').update(Buffer.from(snapshot.snapshot.snapshot.slice(2), 'hex')).digest('hex') : null,
              snapshot: params.p_include_snapshot ? snapshot.snapshot : null } } };
        }
        assert.equal(name, 'read_annotation_updates_v3');
        return { data: callerRpc(owner, name, params) };
      };
      const reader = createDocumentGenerationReader({ request,
        download: async () => new Blob([pdf], { type: 'application/pdf' }),
        getActorUserId: () => owner });
      const opened = await reader.open({ documentId: flow.scope.documentId, actorUserId: owner,
        pdfGenerationId: flow.scope.generationId, contentModelVersion: 2 });
      const doc = createDetachedYDoc(`aggregate-broker-reopen-${number}`);
      try {
        Y.applyUpdate(doc, opened.annotationUpdate);
        assert.deepEqual(materializeSurveyCrdtV2(doc).surveyMarkers, flow.expected.surveyMarkers);
      } finally { doc.destroy(); }
      return opened;
    };

    const ordinary = makeFlow(30);
    const ordinaryResponse = await runHandler(ordinary, 'handler-writer', 1, makeAdapter());
    assert.equal(ordinaryResponse.status, 200); assert.equal(ordinaryResponse.body.result.seq, '1');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_snapshots
      WHERE document_id='${ordinary.scope.documentId}'`), '0');
    assert.equal((await reopen(ordinary, 30)).throughSeq, '1');

    const raced = makeFlow(31);
    const peerMarker = { annotationId: 'peer', pageNumber: 1,
      bounds: { x: 9, y: 8, width: 2, height: 1 }, moduleId: 'module',
      categoryId: 'category', entityId: 'peer', entityName: 'Peer',
      entityColor: '#654321', checklistResponses: {}, note: 'peer-race' };
    raced.expected = { ...raced.expected,
      surveyMarkers: { ...raced.expected.surveyMarkers, peer: peerMarker } };
    sql(`UPDATE documents SET project_id=NULL WHERE id='${raced.scope.documentId}';
      INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES
      ('${raced.scope.documentId}','${editor}','editor','active')`);
    const racedAdapter = makeAdapter({ beforeCommit: params => {
      const peerDoc = createDetachedYDoc('aggregate-broker-peer-race');
      Y.applyUpdate(peerDoc, new Uint8Array(Buffer.from(raced.scope.baseline, 'hex')));
      const peerVector = Y.encodeStateVector(peerDoc);
      updateSurveyMarkersV2(peerDoc, markers => ({ ...markers, peer: peerMarker }),
        { origin: 'peer-race' });
      const peerUpdate = Y.encodeStateAsUpdate(peerDoc, peerVector);
      peerDoc.destroy();
      JSON.parse(asRole(editor, `SELECT public.append_annotation_update_v3(
        '${raced.scope.documentId}','${raced.scope.generationId}',2::smallint,
        'peer-race',1,decode('${Buffer.from(peerUpdate).toString('hex')}','hex'))`).stdout);
      JSON.parse(asRole(owner, `SELECT public.append_annotation_update_v3(
        '${raced.scope.documentId}','${raced.scope.generationId}',2::smallint,
        ${quote(params.p_client_id)},${params.p_client_seq},${quote(params.p_data)}::bytea)`).stdout);
    } });
    const racedResponse = await runHandler(raced, 'handler-race', 1, racedAdapter);
    assert.equal(racedResponse.status, 200); assert.equal(racedResponse.body.result.seq, '2');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates
      WHERE document_id='${raced.scope.documentId}'`), '2');
    assert.equal((await reopen(raced, 31)).throughSeq, '2');
  });

  console.log(`PASS ${checks} annotation aggregate service broker PostgreSQL checks`);
}, { name: 'annotation-aggregate-broker', commandTimeoutMs: 60_000 });
