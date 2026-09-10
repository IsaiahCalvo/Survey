import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { computeContentSha256 } from '../src/services/contentHash.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';

const pdf = () => new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hex = bytes => `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;

async function until(predicate, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(5);
  }
  assert.fail(message);
}

test('opted-in model2 appends use one actor-bound aggregate binary request and no snapshot RPC', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc('aggregate-sync-accepted');
  const calls = [];
  let directAppends = 0;
  let directSnapshots = 0;
  const client = { ...backend.client, rpc(name, params) {
    if (name === 'append_annotation_update_v3') directAppends += 1;
    if (name === 'store_annotation_snapshot_v3') directSnapshots += 1;
    return backend.client.rpc(name, params);
  } };
  const aggregateRequest = async call => {
    const bytes = new Uint8Array(await call.body.arrayBuffer());
    calls.push({ ...call, bytes });
    const query = new URL(`https://local.invalid/${call.functionName}`).searchParams;
    const accepted = await backend.client.rpc('append_annotation_update_v3', {
      p_document_id: backend.ids.documentId,
      p_generation_id: backend.ids.generationId,
      p_content_model_version: 2,
      p_client_id: query.get('client_id'),
      p_client_seq: query.get('client_seq'),
      p_data: hex(bytes),
    });
    const receipt = accepted.data;
    return Response.json({ result: {
      version: 2,
      status: 'accepted',
      document_id: backend.ids.documentId,
      generation_id: backend.ids.generationId,
      content_model_version: 2,
      actor_user_id: backend.ids.actorUserId,
      client_id: query.get('client_id'),
      client_seq: query.get('client_seq'),
      seq: receipt.seq,
      data_sha256: await computeContentSha256(bytes),
      current_generation_id: backend.ids.generationId,
      is_current: true,
    } });
  };
  const handle = await openAnnotationDoc({
    documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(),
    supabase: client,
    outboxStore: outbox,
    doc,
    enableLocal: false,
    enableRealtime: false,
    writerId: 'aggregate-sync-writer',
    aggregateRequest,
  });
  t.after(async () => {
    await handle.destroy();
    await outbox.close();
    if (!doc.isDestroyed) doc.destroy();
    backend.destroy();
  });

  handle.updateSurveyMarkers(markers => ({ ...markers, aggregate: {
    annotationId: 'aggregate', entityId: 'entity', pageNumber: 1,
    bounds: { x: 1, y: 2, width: 3, height: 4 }, checklistResponses: {},
  } }));
  await until(() => calls.length === 1 && handle.getSyncStatus().queueSize === 0,
    'aggregate receipt did not settle');

  assert.equal(calls[0].body instanceof Blob, true);
  assert.equal(calls[0].headers.Authorization, 'Bearer fixture-local-token');
  assert.equal(calls[0].headers['Content-Type'], 'application/octet-stream');
  assert.ok(calls[0].bytes.length > 0);
  assert.match(calls[0].functionName, /receipt_version=2/);
  assert.equal(directAppends, 0, 'the app-facing old append RPC was not used');
  assert.equal(backend.inspect().walRows, 1, 'the broker simulation committed one checked row');
  assert.equal(backend.inspect().snapshotWrites, 0, 'the old snapshot RPC was not used');
  assert.equal(await handle.flushSnapshot(), true);
  assert.equal(directSnapshots, 0);
  assert.equal(backend.inspect().snapshotWrites, 0);
});

test('aggregate request deadline covers a stalled response body and keeps the exact outbox row', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc('aggregate-sync-stalled-body');
  let requests = 0;
  let cancelled = 0;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const aggregateRequest = async () => {
    requests += 1;
    markStarted();
    return new Response(new ReadableStream({ start() {}, cancel() { cancelled += 1; } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const handle = await openAnnotationDoc({
    documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(),
    supabase: backend.client,
    outboxStore: outbox,
    doc,
    enableLocal: false,
    enableRealtime: false,
    writerId: 'aggregate-stalled-body',
    aggregateRequest,
    requestTimeoutMs: 100,
    repairRetryDelayMs: 10_000,
  });
  t.after(async () => {
    await handle.destroy();
    await outbox.close();
    if (!doc.isDestroyed) doc.destroy();
    backend.destroy();
  });

  handle.updateSurveyMarkers(markers => ({ ...markers, stalled: {
    annotationId: 'stalled', entityId: 'entity', pageNumber: 1,
    bounds: { x: 1, y: 2, width: 3, height: 4 }, checklistResponses: {},
  } }));
  await started;
  await until(() => !handle.getSyncStatus().healthy && handle.getSyncStatus().queueSize === 1,
    'stalled response did not time out');
  assert.equal(requests, 1);
  await until(() => cancelled === 1, 'late aggregate response body was not cancelled');
  assert.equal(backend.inspect().snapshotWrites, 0);
  const pending = await outbox.list(backend.ids.documentId, backend.ids.actorUserId, {
    pdfGenerationId: backend.ids.generationId, contentModelVersion: 2,
  });
  assert.equal(pending.length, 1);
  assert.ok(pending[0].update.length > 0);
});

test('aggregate deadline can expire during actor lookup without dispatching under a late session', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc('aggregate-sync-delayed-auth');
  let delayAuth = false;
  let requests = 0;
  let markAuthStarted;
  let releaseAuth;
  const authStarted = new Promise(resolve => { markAuthStarted = resolve; });
  const authGate = new Promise(resolve => { releaseAuth = resolve; });
  const client = {
    ...backend.client,
    auth: {
      ...backend.client.auth,
      getSession() {
        if (!delayAuth) return backend.client.auth.getSession();
        markAuthStarted();
        return authGate.then(() => ({ data: { session: {
          user: { id: backend.ids.actorUserId }, access_token: 'late-token',
        } }, error: null }));
      },
    },
  };
  const handle = await openAnnotationDoc({
    documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(),
    supabase: client,
    outboxStore: outbox,
    doc,
    enableLocal: false,
    enableRealtime: false,
    writerId: 'aggregate-delayed-auth',
    aggregateRequest: async () => { requests += 1; return Response.json({}); },
    requestTimeoutMs: 100,
    repairRetryDelayMs: 10_000,
  });
  t.after(async () => {
    releaseAuth();
    await handle.destroy();
    await outbox.close();
    if (!doc.isDestroyed) doc.destroy();
    backend.destroy();
  });
  delayAuth = true;

  handle.updateSurveyMarkers(markers => ({ ...markers, delayedAuth: {
    annotationId: 'delayedAuth', entityId: 'entity', pageNumber: 1,
    bounds: { x: 1, y: 2, width: 3, height: 4 }, checklistResponses: {},
  } }));
  await authStarted;
  await until(() => !handle.getSyncStatus().healthy && handle.getSyncStatus().queueSize === 1,
    'late actor session did not time out');
  releaseAuth();
  await wait(0);
  assert.equal(requests, 0);
  assert.equal(backend.inspect().snapshotWrites, 0);
});

test('aggregate opt-in rejects a checked model 1 generation before storage or request work', async () => {
  const actorUserId = 'd2000000-0000-4000-8000-000000000071';
  const documentId = 'd2000000-0000-4000-8000-000000000072';
  const generationId = 'd2000000-0000-4000-8000-000000000073';
  const pdfId = 'd2000000-0000-4000-8000-000000000074';
  const pdfVersion = 'd2000000-0000-4000-8000-000000000075';
  const operationId = 'd2000000-0000-4000-8000-000000000076';
  const pdfBytes = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
  const baseline = new Y.Doc();
  const stateBytes = Y.encodeStateAsUpdate(baseline);
  baseline.destroy();
  const path = `${actorUserId}/_generations/model1.pdf`;
  const reader = createDocumentGenerationReader({
    getActorUserId: () => actorUserId,
    download: async () => new Blob([pdfBytes], { type: 'application/pdf' }),
    request: async (name, params) => {
      assert.equal(name, 'read_document_generation_open_v3');
      return { data: { version: 3, actor_user_id: actorUserId, document_id: documentId,
        generation_id: generationId, content_model_version: 1,
        document: { id: documentId, user_id: actorUserId, project_id: null,
          name: 'model1.pdf', file_path: path, file_size: String(pdfBytes.length) },
        publication: { operation_id: operationId, generation_id: generationId,
          published_at: '2026-09-10T00:00:00.000Z', wal_head: '0' },
        pdf: { bucket_id: 'documents', path, id: pdfId, version: pdfVersion,
          byte_length: String(pdfBytes.length), content_sha256: await computeContentSha256(pdfBytes) },
        annotations: { version: 3, document_id: documentId, generation_id: generationId,
          content_model_version: 1, wal_head: '0',
          snapshot: params.p_include_snapshot ? { at_seq: '0', snapshot: hex(stateBytes),
            encoding_version: 1, writer_id: null, writer_epoch: '0' } : null,
          snapshot_sha256: params.p_include_snapshot
            ? await computeContentSha256(stateBytes) : null } } };
    },
  });
  const checkedBundle = await reader.open({ documentId, actorUserId,
    pdfGenerationId: generationId, contentModelVersion: 1 });
  let storageTouches = 0;
  let aggregateRequests = 0;
  const untouchedStore = new Proxy({}, { get() {
    storageTouches += 1;
    throw new Error('invalid aggregate mode touched storage');
  } });
  await assert.rejects(openAnnotationDoc({ documentId, actorUserId,
    pdfGenerationId: generationId, checkedBundle,
    supabase: { rpc() { throw new Error('invalid aggregate mode used cloud'); },
      auth: { async getSession() { throw new Error('invalid aggregate mode used auth'); } } },
    outboxStore: untouchedStore, enableLocal: false, enableRealtime: false,
    aggregateRequest: async () => { aggregateRequests += 1; return Response.json({}); } }),
  { code: 'ANNOTATION_AGGREGATE_INPUT' });
  assert.equal(storageTouches, 0);
  assert.equal(aggregateRequests, 0);
});
