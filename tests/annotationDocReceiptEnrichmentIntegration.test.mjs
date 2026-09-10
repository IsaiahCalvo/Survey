import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { annotationOutboxRecordKey } from '../src/services/annotationDocOutbox.js';
import { buildEraseIntent } from '../src/utils/annotationEraseTransaction.js';
import { syncByPageToDoc } from '../src/services/annotationDocStore.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { materializeSurveyCrdtV2 } from '../src/services/documentSurveyCrdtV2.js';
import * as Y from 'yjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await wait(20);
  }
  assert.fail(message);
}

function delayedAppendClient(source) {
  let delay = false, release = null;
  return {
    client: { ...source, rpc(name, params) {
        const query = source.rpc(name, params);
        if (name !== 'append_annotation_update_v3' || !delay) return query;
        delay = false;
        let resume;
        const gate = new Promise(resolve => { resume = resolve; });
        release = resume;
        const wrapper = {
          setHeader(...args) { query.setHeader(...args); return wrapper; },
          abortSignal(...args) { query.abortSignal(...args); return wrapper; },
          then(resolve, reject) {
            return gate.then(() => Promise.resolve(query)).then(resolve, reject);
          },
        };
        return wrapper;
      } },
    delayNextAppend() { delay = true; },
    releaseAppend() { release?.(); },
    appendIsHeld: () => release !== null,
  };
}

test('snapshot acceptance and a blocked exact WAL request converge on one sequenced receipt', async t => {
  const pdf = new Blob([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10])],
    { type: 'application/pdf' });
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf });
  const transport = delayedAppendClient(backend.client);
  const indexedDb = new IDBFactory();
  const warnings = [], originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  let handle, outbox;
  t.after(async () => {
    console.warn = originalWarn;
    try { await handle?.destroy(); } catch { /* test cleanup */ }
    try { await outbox?.close(); } catch { /* test cleanup */ }
    backend.destroy();
  });

  const open = async writerId => {
    outbox = await createAnnotationOutbox({ indexedDb });
    return openAnnotationDoc({ documentId: backend.ids.documentId,
      actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
      checkedBundle: await backend.read(), supabase: transport.client, outboxStore: outbox,
      enableLocal: false, enableRealtime: false, writerId, snapshotRetryDelayMs: 0,
      eraseEffectConsumer: async () => {} });
  };

  handle = await open('receipt-race-writer');
  const markerId = 'fixture-marker-left';
  const expectedMarker = handle.getSurveyState().surveyMarkers[markerId];
  const erased = await handle.commitEraseIntent(buildEraseIntent({
    mutationId: 'receipt-race-erase', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 80, y: 100 }], radius: 10, mode: 'whole' },
    surveyMarkerTargets: [{ markerId, expectedMarker }],
  }), { permissionContext: { mode: 'registered', viewerId: backend.ids.actorUserId,
    documentOwnerId: backend.ids.actorUserId }, validateSurveyTarget: () => true });
  await handle.drain();
  const beforeOfflineUndo = backend.inspect();
  assert.equal(beforeOfflineUndo.markerIds.includes(markerId), false);

  backend.setOffline(true);
  assert.equal(handle.applyEraseHistoryTransition(erased.historyTransition, 'undo').status, 'applied');
  await handle.drain();
  const scope = { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 };
  const offlineState = await outbox.readLocalState(backend.ids.documentId,
    backend.ids.actorUserId, 0, scope);
  assert.equal(offlineState.pending.length, 1);
  const undoKey = offlineState.pending[0].key;
  backend.setOffline(false);
  transport.delayNextAppend();
  await until(transport.appendIsHeld, 'the exact WAL replay starts');
  await until(async () => {
    const clean = await outbox.loadCleanState(backend.ids.documentId, backend.ids.actorUserId, scope);
    return clean.records.some(record => record.key === undoKey && !Object.hasOwn(record, 'seq'));
  }, 'snapshot coverage durably accepts the exact undo before its WAL request runs');
  const whileWalBlocked = backend.inspect();
  assert.equal(whileWalBlocked.walHead, beforeOfflineUndo.walHead,
    'the blocked WAL request has not advanced the backend head');
  assert.equal(whileWalBlocked.walRows, beforeOfflineUndo.walRows,
    'the blocked WAL request has not written a backend row');
  assert.equal(whileWalBlocked.markerIds.includes(markerId), false,
    'the live backend state remains erased until the WAL request runs');
  const snapshotOnlyBundle = await backend.read();
  const snapshotOnlyDoc = createDetachedYDoc('receipt-race-snapshot-only');
  try {
    Y.applyUpdate(snapshotOnlyDoc, snapshotOnlyBundle.annotationUpdate);
    assert.deepEqual(materializeSurveyCrdtV2(snapshotOnlyDoc).surveyMarkers[markerId], expectedMarker,
      'the stored server snapshot alone restores the offline undo before WAL completion');
  } finally {
    snapshotOnlyDoc.destroy();
  }
  transport.releaseAppend();
  const enriched = await until(async () => {
    const clean = await outbox.loadCleanState(backend.ids.documentId, backend.ids.actorUserId, scope);
    return clean.records.find(record => record.key === undoKey && Object.hasOwn(record, 'seq'));
  }, 'the exact WAL reply durably enriches the same accepted receipt');
  await handle.drain();

  const clean = await outbox.loadCleanState(backend.ids.documentId, backend.ids.actorUserId,
    scope);
  assert.equal(clean.records.find(record => record.key === undoKey)?.seq, enriched.seq);
  assert.ok(Number(enriched.seq) > 0, 'the stored WAL sequence is positive');
  assert.equal(warnings.some(line => line.includes('outbox identity cannot replace')), false);
  assert.equal(warnings.some(line => line.includes('accepted annotation receipt is immutable')), false);

  await handle.destroy(); handle = null; await outbox.close(); outbox = null;
  handle = await open('receipt-race-reopen');
  assert.deepEqual(handle.getSurveyState().surveyMarkers[markerId], expectedMarker);
  assert.equal(handle.getByPage()['1'].objects.some(item => item.id === 'fixture-ordinary-rect'), true);
  assert.equal(backend.inspect().baselineSemanticMatch, true);
});

test('a real handle ignores a stale captured callback after WAL-first receipt compaction', async t => {
  const pdf = new Blob([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10])],
    { type: 'application/pdf' });
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf });
  const indexedDb = new IDBFactory();
  const outbox = await createAnnotationOutbox({ indexedDb });
  let handle;
  t.after(async () => {
    try { await handle?.destroy(); } catch { /* test cleanup */ }
    try { await outbox.close(); } catch { /* test cleanup */ }
    backend.destroy();
  });

  const writerId = 'receipt-compaction-writer';
  const staged = new Y.Doc();
  syncByPageToDoc(staged, { 1: { objects: [{ id: 'receipt-compaction-mark', type: 'rect',
    left: 10, top: 10, width: 20, height: 20 }] } });
  const update = Y.encodeStateAsUpdate(staged); staged.destroy();
  const value = { documentId: backend.ids.documentId, actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId, contentModelVersion: 2, writerId,
    clientSeq: 1, ordinal: 1, incarnation: 0, editEpoch: 1, status: 'pending',
    update, checkpointUpdate: update, dependsOn: [], publishAfterAcceptance: false,
    historyTag: null };
  const staleCaptured = { ...value, key: annotationOutboxRecordKey(value) };
  await outbox.put(staleCaptured);
  await outbox.settleAccepted({ ...staleCaptured, seq: 1 });
  await outbox.compactAccepted(backend.ids.documentId, backend.ids.actorUserId,
    update, true, 0, { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  assert.deepEqual((await outbox.loadCleanState(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 })).acceptedKeys,
  [staleCaptured.key]);

  let staleDelivered = false, settleCalls = 0, staleRepersistCalls = 0;
  const racedOutbox = new Proxy(outbox, { get(target, property) {
    if (property === 'list') return async () => {
      if (staleDelivered) return [];
      staleDelivered = true;
      return [{ ...staleCaptured, update: new Uint8Array(staleCaptured.update),
        checkpointUpdate: new Uint8Array(staleCaptured.checkpointUpdate) }];
    };
    if (property === 'settleAccepted') return async record => {
      settleCalls += 1;
      return target.settleAccepted(record);
    };
    // `loadPendingOutboxRecords` is the public handle seam used here to inject
    // the callback that an in-flight snapshot captured before compaction. Its
    // original put already happened, so a replay-time persistence pass is a
    // no-op for this one exact identity rather than a second store mutation.
    if (property === 'put') return async record => {
      if (record.key === staleCaptured.key) { staleRepersistCalls += 1; return; }
      return target.put(record);
    };
    const result = target[property];
    return typeof result === 'function' ? result.bind(target) : result;
  } });
  handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(), supabase: backend.client, outboxStore: racedOutbox,
    enableLocal: false, enableRealtime: false, writerId, snapshotRetryDelayMs: 0,
    eraseEffectConsumer: async () => {} });
  await handle.drain();
  assert.equal(staleDelivered, true);
  assert.equal(staleRepersistCalls, 1);
  assert.equal(settleCalls, 0, 'the stale callback never re-settles a compacted receipt');
  assert.equal(handle.getByPage()['1'].objects.some(item => item.id === 'receipt-compaction-mark'), true);
});
