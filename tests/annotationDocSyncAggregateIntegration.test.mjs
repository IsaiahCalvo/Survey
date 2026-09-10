import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { handleAnnotationGenerationAggregate } from '../supabase/functions/annotation-generation-aggregate/handler.js';
import { buildEraseIntent, ERASE_OUTBOX_MAP } from '../src/utils/annotationEraseTransaction.js';
import { updateSurveyMarkersV2 } from '../src/services/documentSurveyCrdtV2.js';

const pdf = () => new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = bytes => `\\x${Buffer.from(bytes).toString('hex')}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) { const end = Date.now() + 2500;
  while (Date.now() < end) { if (await predicate()) return; await wait(5); } assert.fail(message); }
const lazy = value => { const request = {
  setHeader() { return request; }, abortSignal() { return request; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
}; return request; };

function aggregateHarness(backend, bundle, {
  errorCode = null, loseFirst = false, currentGenerationId = null,
  beforeFixedCheckpointRead = null, errorAfterCommits = 0,
} = {}) {
  const receipts = new Map(); const requestProofs = [];
  let requests = 0, probes = 0, commits = 0, markLost;
  const lostCommitted = new Promise(resolve => { markLost = resolve; });
  const actor = backend.ids.actorUserId, generation = backend.ids.generationId;
  const missing = identity => ({ version: 2, status: 'missing', document_id: backend.ids.documentId,
    generation_id: generation, content_model_version: 2, actor_user_id: actor,
    client_id: identity.writerId, client_seq: identity.clientSeq });
  const receiptKey = (requestedActor, identity) => [requestedActor, identity.writerId, identity.clientSeq].join('\0');
  const probe = async (requestedActor, identity) => { probes++;
    const accepted = receipts.get(receiptKey(requestedActor, identity));
    if (!accepted) return missing(identity);
    return { version: 2, status: 'accepted', accepted: true, document_id: backend.ids.documentId,
      generation_id: generation, content_model_version: 2, actor_user_id: actor,
      client_id: identity.writerId, client_seq: identity.clientSeq, seq: accepted.seq,
      data_sha256: accepted.data_sha256, current_generation_id: currentGenerationId ?? generation,
      is_current: (currentGenerationId ?? generation) === generation };
  };
  const deps = { runtimeVerified: true, timeoutMs: 2000, getUser: async token => {
    assert.equal(token, 'fixture-local-token'); return { id: actor }; }, probeV2: probe,
    probe: async () => { throw new Error('v1 probe forbidden'); },
    readFixedCheckpoint: async () => {
      await beforeFixedCheckpointRead?.({ backend, bundle });
      const result = await backend.client.rpc('read_annotation_snapshot_v3', {
        p_document_id: backend.ids.documentId, p_generation_id: generation,
        p_content_model_version: 2,
      });
      const stored = result.data.snapshot;
      return { version: 1, actor_user_id: actor, document_id: backend.ids.documentId,
        generation_id: generation, content_model_version: 2, head: result.data.wal_head,
        base_seq: '0', checkpoint: { at_seq: stored.at_seq, writer_id: stored.writer_id,
          writer_epoch: stored.writer_epoch, encoding_version: stored.encoding_version,
          snapshot_sha256: sha(Buffer.from(stored.snapshot.slice(2), 'hex')),
          snapshot: stored.snapshot } };
    },
    readFixedTailPage: async (_token, page) => {
      const result = await backend.client.rpc('read_annotation_updates_v3', {
        p_document_id: backend.ids.documentId, p_generation_id: generation,
        p_content_model_version: 2, p_after_seq: page.afterSeq,
        p_through_seq: page.throughSeq, p_limit: page.limit,
      });
      return result.data;
    },
    commitV2: async (requestedActor, value) => { commits++;
      if (errorCode && commits > errorAfterCommits) {
        throw Object.assign(new Error('private aggregate failure'), { code: errorCode,
        reason: errorCode === 'ANNOTATION_AGGREGATE_WORK_LIMIT' ? 'tail-pages' : undefined });
      }
      const expectedSeq = (BigInt(value.expectedHead) + 1n).toString();
      const committed = await backend.client.rpc('append_annotation_update_v3', {
        p_document_id: backend.ids.documentId, p_generation_id: generation, p_content_model_version: 2,
        p_client_id: value.writerId, p_client_seq: value.clientSeq, p_data: hex(value.update) });
      assert.equal(committed.data.seq, expectedSeq);
      const accepted = { seq: committed.data.seq, data_sha256: sha(value.update) };
      receipts.set(receiptKey(requestedActor, value), accepted);
      return { version: 2, status: 'accepted', accepted: true, document_id: backend.ids.documentId,
        generation_id: generation, content_model_version: 2, actor_user_id: actor,
        client_id: value.writerId, client_seq: value.clientSeq, seq: accepted.seq,
        data_sha256: accepted.data_sha256, current_generation_id: currentGenerationId ?? generation,
        is_current: (currentGenerationId ?? generation) === generation,
        checkpoint_stored: value.checkpoint !== null, checkpoint: value.checkpoint ? {
          at_seq: value.checkpoint.atSeq, writer_id: 'survey-private-aggregate-v1', writer_epoch: '1',
          encoding_version: value.checkpoint.encodingVersion, snapshot_sha256: value.checkpoint.snapshotSha256 } : null };
    }, commit: async () => { throw new Error('v1 commit forbidden'); } };
  return { lostCommitted, requestProofs,
    get counts() { return { requests, probes, commits }; }, async request(call) {
    requests++; assert.ok(call.body instanceof Blob); assert.equal(call.headers.Authorization, 'Bearer fixture-local-token');
    const body = new Uint8Array(await call.body.arrayBuffer());
    const query = new URL(`https://edge.invalid/${call.functionName}`).searchParams;
    requestProofs.push({ writerId: query.get('client_id'), clientSeq: query.get('client_seq'),
      dataSha256: sha(body), body });
    const response = await handleAnnotationGenerationAggregate(new Request(
      `https://edge.invalid/functions/v1/${call.functionName}`, { method: 'POST', headers: call.headers,
        body: call.body, signal: call.signal }), deps);
    if (loseFirst && requests === 1 && response.status === 200 && receipts.size === 1) {
      markLost(); throw new TypeError('lost accepted reply');
    }
    return response;
  } };
}

async function setup(t, options = {}, syncOptions = {}) {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }), bundle = await backend.read();
  const indexedDb = new IDBFactory(), outbox = await createAnnotationOutbox({ indexedDb });
  const doc = createDetachedYDoc('aggregate-sync');
  const aggregate = aggregateHarness(backend, bundle, options);
  const appCalls = [], client = { ...backend.client, rpc(name, params) {
    appCalls.push(name); return backend.client.rpc(name, params); } };
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: client, outboxStore: outbox, doc,
    writerId: 'aggregate-sync-writer', enableLocal: false, enableRealtime: false,
    snapshotRetryDelayMs: 0, aggregateRequest: aggregate.request, ...syncOptions });
  t.after(async () => { try { await handle.destroy(); } catch {} await outbox.close();
    if (!doc.isDestroyed) doc.destroy(); backend.destroy(); });
  return { backend, bundle, indexedDb, outbox, handle, aggregate, appCalls, client };
}

test('opt-in sync sends a real Yjs update through the binary handler and never writes a direct snapshot', async t => {
  const h = await setup(t); h.handle.setMeta('aggregate-write', 'accepted'); await h.handle.drain();
  assert.equal(h.handle.getMeta('aggregate-write'), 'accepted');
  assert.deepEqual(h.aggregate.counts, { requests: 1, probes: 1, commits: 1 });
  assert.equal(h.appCalls.some(name => name === 'append_annotation_update_v3'), false);
  assert.equal(h.backend.inspect().snapshotWrites, 0);
  assert.equal(await h.handle.flushSnapshot(), true); assert.equal(h.backend.inspect().snapshotWrites, 0);
  await h.handle.destroy(); assert.equal(h.backend.inspect().snapshotWrites, 0,
    'aggregate close must not dispatch a direct snapshot');
});

test('lost aggregate reply keeps exact durable bytes and cold checked WAL recovery avoids a duplicate commit', async t => {
  const h = await setup(t, { loseFirst: true }); h.handle.setMeta('lost', 'kept');
  await Promise.race([h.aggregate.lostCommitted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('accepted commit was not reached')), 2000))]);
  await until(async () => (await h.outbox.list(h.backend.ids.documentId, h.backend.ids.actorUserId,
    { pdfGenerationId: h.backend.ids.generationId, contentModelVersion: 2 })).length === 1, 'pending row absent');
  await h.handle.destroy();
  const reopenedOutbox = await createAnnotationOutbox({ indexedDb: h.indexedDb });
  const reopened = await openAnnotationDoc({ documentId: h.backend.ids.documentId,
    actorUserId: h.backend.ids.actorUserId, pdfGenerationId: h.backend.ids.generationId,
    checkedBundle: h.bundle, supabase: h.client, outboxStore: reopenedOutbox,
    doc: createDetachedYDoc('aggregate-reopen'), writerId: 'aggregate-sync-writer', enableLocal: false,
    enableRealtime: false, aggregateRequest: h.aggregate.request });
  t.after(async () => { await reopened.destroy(); await reopenedOutbox.close(); });
  await reopened.drain(); assert.equal(reopened.getMeta('lost'), 'kept');
  assert.deepEqual(h.aggregate.counts, { requests: 1, probes: 1, commits: 1 },
    'the coherent checked WAL proves acceptance before aggregate replay is needed');
  assert.equal(h.backend.inspect().snapshotWrites, 0);
});

test('warm retry resubmits the same aggregate receipt bytes and commits only once', async t => {
  const h = await setup(t, { loseFirst: true }, { repairRetryDelayMs: 5 });
  h.handle.setMeta('warm-retry', 'kept');
  await until(() => h.aggregate.counts.requests === 2
    && h.handle.getSyncStatus().queueSize === 0, 'warm exact receipt retry did not settle');
  assert.deepEqual(h.aggregate.counts, { requests: 2, probes: 2, commits: 1 });
  const [first, second] = h.aggregate.requestProofs;
  assert.equal(second.writerId, first.writerId);
  assert.equal(second.clientSeq, first.clientSeq);
  assert.equal(second.dataSha256, first.dataSha256);
  assert.deepEqual(second.body, first.body);
  assert.equal(h.backend.inspect().walRows, 1);
  assert.equal(h.backend.inspect().snapshotWrites, 0);
});

test('aggregate flush catches up a peer row covered by admission before its own receipt', async t => {
  let inserted = false;
  let releaseFixedRead;
  const fixedReadGate = new Promise(resolve => { releaseFixedRead = resolve; });
  const h = await setup(t, { beforeFixedCheckpointRead: async ({ backend, bundle }) => {
    await fixedReadGate;
    if (inserted) return;
    inserted = true;
    const peer = new Y.Doc();
    Y.applyUpdate(peer, bundle.annotationUpdate);
    const vector = Y.encodeStateVector(peer);
    updateSurveyMarkersV2(peer, markers => ({ ...markers,
      'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'peer-before-receipt' },
    }));
    const update = Y.encodeStateAsUpdate(peer, vector);
    peer.destroy();
    await backend.client.rpc('append_annotation_update_v3', {
      p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
      p_content_model_version: 2, p_client_id: 'aggregate-peer-writer',
      p_client_seq: '1', p_data: hex(update),
    });
  } });
  const readsBeforeFlush = h.appCalls.filter(name => name === 'read_annotation_updates_v3').length;
  h.handle.setMeta('raced-own-receipt', 'accepted');
  const flushing = h.handle.flushSnapshot();
  await until(() => h.appCalls.filter(name => name === 'read_annotation_updates_v3').length
    > readsBeforeFlush,
    'flush did not finish its initial checked read before aggregate admission');
  await wait(0);
  releaseFixedRead();
  assert.equal(await flushing, true);
  assert.equal(h.backend.inspect().walHead, '2');
  assert.equal(h.handle.getSurveyState().surveyMarkers['fixture-marker-left'].notes,
    'peer-before-receipt');
  assert.equal(h.handle.getSyncStatus().healthy, true);
  assert.equal(h.backend.inspect().snapshotWrites, 0);
});

for (const [code, errorCode] of [['SG004', 'ANNOTATION_GENERATION_CAPACITY'],
  ['ANNOTATION_AGGREGATE_WORK_LIMIT', 'ANNOTATION_AGGREGATE_WORK_LIMIT']]) {
  test(`${code} pauses aggregate sync with durable pending bytes and no snapshot fallback`, async t => {
    let effects = 0;
    const h = await setup(t, { errorCode: code }, {
      eraseEffectConsumer: async () => { effects += 1; },
    });
    const markerId = 'fixture-marker-left';
    const expectedMarker = h.handle.getSurveyState().surveyMarkers[markerId];
    await h.handle.commitEraseIntent(buildEraseIntent({
      mutationId: `aggregate-paused-${code}`, pageNumber: 1, renderer: 'svg',
      gesture: { points: [{ x: 80, y: 100 }], radius: 10, mode: 'whole' },
      surveyMarkerTargets: [{ markerId, expectedMarker }],
      sideEffects: [{ type: 'trash', targetKey: markerId,
        payload: { before: structuredClone(expectedMarker) } }],
    }), { permissionContext: { mode: 'registered', viewerId: h.backend.ids.actorUserId,
      documentOwnerId: h.backend.ids.actorUserId }, validateSurveyTarget: () => true });
    await until(() => h.handle.getSyncStatus().errorCode === errorCode, 'sticky pause absent');
    const pendingEffect = h.handle.doc.getMap(ERASE_OUTBOX_MAP).get(`aggregate-paused-${code}`);
    assert.equal(pendingEffect.status, 'pending');
    assert.equal(pendingEffect.effects.length, 1);
    assert.equal(effects, 0);
    const drain = await h.handle.drainEraseOutbox();
    assert.equal(drain.pending, 1);
    assert.equal(effects, 0);
    const rows = await h.outbox.list(h.backend.ids.documentId, h.backend.ids.actorUserId,
      { pdfGenerationId: h.backend.ids.generationId, contentModelVersion: 2 });
    assert.equal(rows.length, 1); assert.ok(rows[0].update.length > 0);
    assert.equal(h.backend.inspect().snapshotWrites, 0);
    await assert.rejects(h.handle.flushSnapshot(), { code: errorCode });
    await wait(20); assert.equal(h.aggregate.counts.requests, 1);
  });
}

test('an effect already in flight at aggregate pause is recorded once and never retried', async t => {
  const effects = [];
  let markEffectStarted;
  let releaseEffect;
  const effectStarted = new Promise(resolve => { markEffectStarted = resolve; });
  const effectGate = new Promise(resolve => { releaseEffect = resolve; });
  const h = await setup(t, { errorCode: 'SG004', errorAfterCommits: 1 }, {
    eraseEffectConsumer: async effect => {
      effects.push(effect.type);
      if (effect.type === 'trash') {
        markEffectStarted();
        await effectGate;
      }
    },
    eraseOutboxRetryBaseMs: 5,
    eraseOutboxRetryMaxMs: 5,
  });
  t.after(() => releaseEffect());
  const markerId = 'fixture-marker-left';
  const expectedMarker = h.handle.getSurveyState().surveyMarkers[markerId];
  await h.handle.commitEraseIntent(buildEraseIntent({
    mutationId: 'aggregate-inflight-effect', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 80, y: 100 }], radius: 10, mode: 'whole' },
    surveyMarkerTargets: [{ markerId, expectedMarker }],
    sideEffects: [
      { type: 'trash', targetKey: markerId,
        payload: { before: structuredClone(expectedMarker) } },
      { type: 'history', targetKey: markerId,
        payload: { before: structuredClone(expectedMarker) } },
    ],
  }), { permissionContext: { mode: 'registered', viewerId: h.backend.ids.actorUserId,
    documentOwnerId: h.backend.ids.actorUserId }, validateSurveyTarget: () => true });
  await effectStarted;
  h.handle.setMeta('capacity-while-effect-runs', 'kept locally');
  await until(() => h.handle.getSyncStatus().errorCode === 'ANNOTATION_GENERATION_CAPACITY',
    'second append did not enter the capacity pause');
  releaseEffect();
  await until(() => h.handle.doc.getMap(ERASE_OUTBOX_MAP)
    .get('aggregate-inflight-effect')?.acknowledgedEffectKeys?.length === 1,
  'the completed external effect was not kept as durable acknowledgement evidence');
  await wait(25);
  assert.deepEqual(effects, ['trash']);
  const pausedEntry = h.handle.doc.getMap(ERASE_OUTBOX_MAP).get('aggregate-inflight-effect');
  assert.equal(pausedEntry.status, 'pending');
  assert.equal(pausedEntry.effects.length, 2);
  assert.equal(h.aggregate.counts.requests, 2);
  assert.equal(h.backend.inspect().snapshotWrites, 0);
  const pending = await h.outbox.list(h.backend.ids.documentId, h.backend.ids.actorUserId,
    { pdfGenerationId: h.backend.ids.generationId, contentModelVersion: 2 });
  assert.ok(pending.length >= 2, 'the paused edit and effect acknowledgement remain durable');
});

test('default model2 path remains direct and can store its normal checked snapshot', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read(), outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc('aggregate-default-control');
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: backend.client, outboxStore: outbox, doc,
    writerId: 'default-control', enableLocal: false, enableRealtime: false });
  t.after(async () => { await handle.destroy(); await outbox.close(); if (!doc.isDestroyed) doc.destroy(); });
  handle.setMeta('default', 'kept'); await handle.drain(); assert.equal(await handle.flushSnapshot(), true);
  assert.equal(backend.inspect().snapshotWrites, 1);
});

test('a fenced default model2 writer pauses on SG005 and never falls back to a snapshot', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const bundle = await backend.read();
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc('aggregate-fence-default');
  let appends = 0;
  let snapshots = 0;
  const client = { ...backend.client, rpc(name, params) {
    if (name === 'append_annotation_update_v3') {
      appends += 1;
      return lazy({ data: null, error: { code: 'SG005', message: 'private fence detail' } });
    }
    if (name === 'store_annotation_snapshot_v3') snapshots += 1;
    return backend.client.rpc(name, params);
  } };
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: client, outboxStore: outbox, doc,
    writerId: 'fenced-default', enableLocal: false, enableRealtime: false,
    repairRetryDelayMs: 5, snapshotRetryDelayMs: 0 });
  t.after(async () => { await handle.destroy(); await outbox.close();
    if (!doc.isDestroyed) doc.destroy(); backend.destroy(); });

  handle.setMeta('fenced', 'kept');
  await until(() => handle.getSyncStatus().errorCode === 'ANNOTATION_GENERATION_ADMISSION_REQUIRED',
    'SG005 did not enter the sticky admission pause');
  assert.equal(appends, 1);
  assert.equal(snapshots, 0);
  assert.throws(() => handle.setMeta('after-fence', 'blocked'), {
    code: 'ANNOTATION_GENERATION_ADMISSION_REQUIRED',
  });
  await wait(25);
  assert.equal(appends, 1);
  assert.equal(snapshots, 0);
  const pending = await outbox.list(backend.ids.documentId, backend.ids.actorUserId, {
    pdfGenerationId: backend.ids.generationId, contentModelVersion: 2,
  });
  assert.equal(pending.length, 1);
  assert.ok(pending[0].update.length > 0);
  await handle.destroy();
  assert.equal(snapshots, 0);
});

test('an actor switch before aggregate dispatch keeps the original outbox row and sends no request', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const bundle = await backend.read();
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc('aggregate-actor-switch');
  let switched = false;
  let requests = 0;
  const otherActor = 'd2000000-0000-4000-8000-000000000099';
  const client = { ...backend.client, auth: { ...backend.client.auth,
    async getSession() {
      if (!switched) return backend.client.auth.getSession();
      return { data: { session: { user: { id: otherActor }, access_token: 'other-token' } },
        error: null };
    } } };
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: client, outboxStore: outbox, doc,
    writerId: 'aggregate-actor-switch', enableLocal: false, enableRealtime: false,
    repairRetryDelayMs: 10_000, aggregateRequest: async () => {
      requests += 1;
      return Response.json({});
    } });
  t.after(async () => { await handle.destroy(); await outbox.close();
    if (!doc.isDestroyed) doc.destroy(); backend.destroy(); });
  switched = true;

  handle.setMeta('actor-switch', 'kept');
  await until(() => !handle.getSyncStatus().healthy && handle.getSyncStatus().queueSize === 1,
    'actor mismatch did not retain the pending row');
  assert.equal(requests, 0);
  assert.equal(backend.inspect().snapshotWrites, 0);
  const pending = await outbox.list(backend.ids.documentId, backend.ids.actorUserId, {
    pdfGenerationId: backend.ids.generationId, contentModelVersion: 2,
  });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].actorUserId, backend.ids.actorUserId);
});

test('a retired aggregate receipt is saved without running its queued erase effect', async t => {
  const replacement = 'd2000000-0000-4000-8000-000000000098';
  let effects = 0;
  const h = await setup(t, { currentGenerationId: replacement }, {
    eraseEffectConsumer: async () => { effects += 1; },
  });
  const markerId = 'fixture-marker-left';
  const expectedMarker = h.handle.getSurveyState().surveyMarkers[markerId];
  await h.handle.commitEraseIntent(buildEraseIntent({
    mutationId: 'aggregate-retired-erase', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 80, y: 100 }], radius: 10, mode: 'whole' },
    surveyMarkerTargets: [{ markerId, expectedMarker }],
    sideEffects: [{ type: 'trash', targetKey: markerId,
      payload: { before: structuredClone(expectedMarker) } }],
  }), { permissionContext: { mode: 'registered', viewerId: h.backend.ids.actorUserId,
    documentOwnerId: h.backend.ids.actorUserId }, validateSurveyTarget: () => true });
  await until(() => h.handle.getGenerationStatus().blocked, 'retired receipt did not block the old handle');
  await assert.rejects(h.handle.drain());
  assert.equal(effects, 0);
  const retired = await h.outbox.readRetiredScope(h.backend.ids.documentId,
    h.backend.ids.actorUserId, 0, { pdfGenerationId: h.backend.ids.generationId,
      contentModelVersion: 2 });
  assert.equal(retired.accepted.length, 1);
  assert.equal(retired.accepted[0].seq, 1);
  const acceptedDoc = new Y.Doc();
  Y.applyUpdate(acceptedDoc, retired.accepted[0].update);
  const pendingEffect = acceptedDoc.getMap(ERASE_OUTBOX_MAP).get('aggregate-retired-erase');
  assert.equal(pendingEffect.status, 'pending');
  assert.equal(pendingEffect.effects.length, 1);
  assert.equal(pendingEffect.effects[0].type, 'trash');
  acceptedDoc.destroy();
  assert.equal(h.backend.inspect().snapshotWrites, 0);
});

test('pagehide cannot write a direct snapshot for aggregate-managed model2 state', async t => {
  const listeners = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const h = await setup(t);
  h.handle.setMeta('pagehide-aggregate', 'accepted');
  await h.handle.drain();
  assert.equal(typeof listeners.get('pagehide'), 'function');
  listeners.get('pagehide')();
  await wait(20);
  assert.equal(h.backend.inspect().snapshotWrites, 0);
  assert.equal(h.appCalls.includes('store_annotation_snapshot_v3'), false);
});

test('aggregate-managed model2 never uses the direct snapshot threshold', async t => {
  const h = await setup(t);
  for (let index = 0; index < 41; index += 1) {
    h.handle.setMeta(`aggregate-threshold-${index}`, index);
    await h.handle.drain();
  }
  assert.equal(h.aggregate.counts.requests, 41);
  assert.equal(h.backend.inspect().walRows, 41);
  assert.equal(h.backend.inspect().snapshotWrites, 0);
  assert.equal(h.appCalls.includes('store_annotation_snapshot_v3'), false);
  assert.equal(await h.handle.flushSnapshot(), true);
  assert.equal(h.backend.inspect().snapshotWrites, 0);
});
