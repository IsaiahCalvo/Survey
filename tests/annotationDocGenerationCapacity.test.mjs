import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';

const pdf = () => new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 2000;
  while (Date.now() < end) { if (await predicate()) return; await wait(5); } assert.fail('capacity state did not settle'); }
const lazy = value => { const request = { setHeader() { return request; }, abortSignal() { return request; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } }; return request; };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('model2 WAL capacity is terminal for one handle while exact local recovery bytes survive', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read(), indexedDb = new IDBFactory();
  const outbox = await createAnnotationOutbox({ indexedDb }), doc = createDetachedYDoc('capacity-red');
  let appends = 0, snapshots = 0;
  const client = { ...backend.client, rpc(name, params) {
    if (name === 'append_annotation_update_v3') { appends++;
      return lazy({ error: { code: 'SG004', message: 'capacity' } }); }
    if (name === 'store_annotation_snapshot_v3') snapshots++;
    return backend.client.rpc(name, params);
  } };
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: client, outboxStore: outbox, doc,
    enableLocal: false, enableRealtime: false, writerId: 'capacity-writer', snapshotRetryDelayMs: 0 });
  t.after(async () => { await handle.destroy(); await outbox.close(); if (!doc.isDestroyed) doc.destroy(); });
  handle.updateSurveyMarkers(markers => ({ ...markers, capacityMarker: { annotationId: 'capacityMarker',
    entityId: 'entity', pageNumber: 1, bounds: { x: 1, y: 2, width: 3, height: 4 }, checklistResponses: {} } }));
  await until(() => handle.getSyncStatus().stage === 'error');
  assert.equal(typeof handle.getSyncStatus().error, 'string');
  const pending = await outbox.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  assert.equal(pending.length, 1); assert.ok(pending[0].update.length > 0);
  assert.equal(appends, 1); assert.equal(snapshots, 0);
  let updaterCalls = 0;
  assert.throws(() => handle.updateSurveyMarkers(markers => { updaterCalls++; return markers; }),
    { code: 'ANNOTATION_GENERATION_CAPACITY' });
  assert.equal(updaterCalls, 0); await wait(20); assert.equal(appends, 1); assert.equal(snapshots, 0);
  await assert.rejects(handle.flushSnapshot(), { code: 'ANNOTATION_GENERATION_CAPACITY' });
  const receipt = await handle.flushLocalDurability(); assert.equal(receipt.contentModelVersion, 2);
  handle.doc.transact(() => handle.doc.getMap('annoMeta').set('afterCapacity', 'kept'), 'local');
  await until(async () => (await outbox.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 })).length === 2);
  assert.equal(appends, 1); assert.equal(snapshots, 0);
  await handle.destroy(); await outbox.close();
  const reopenedOutbox = await createAnnotationOutbox({ indexedDb });
  const reopenedDoc = createDetachedYDoc('capacity-cold-reopen');
  const reopened = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: client, outboxStore: reopenedOutbox, doc: reopenedDoc,
    enableLocal: false, enableRealtime: false, writerId: 'capacity-writer', snapshotRetryDelayMs: 0 });
  t.after(async () => { await reopened.destroy(); await reopenedOutbox.close(); if (!reopenedDoc.isDestroyed) reopenedDoc.destroy(); });
  assert.equal(reopened.getSurveyState().surveyMarkers.capacityMarker.annotationId, 'capacityMarker');
  assert.equal(reopened.getMeta('afterCapacity'), 'kept');
  assert.equal(appends, 2, 'cold reopen makes one fresh upload attempt then pauses');
  const reopenedPending = await reopenedOutbox.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  assert.equal(reopenedPending.length, 2);
  assert.deepEqual(reopenedPending.map(row => row.status), ['pending', 'pending']);
  assert.ok(reopenedPending.every(row => row.update.length > 0));
  reopened.doc.transact(() => reopened.doc.getMap('annoMeta').set('afterColdReopen', 'third'), 'local');
  await until(async () => (await reopenedOutbox.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 })).length === 3);
  const thirdReceipt = await reopened.flushLocalDurability();
  assert.equal(thirdReceipt.contentModelVersion, 2);
  const threePending = await reopenedOutbox.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  assert.deepEqual(threePending.map(row => row.clientSeq), [1, 2, 3]);
  assert.equal(new Set(threePending.map(row => row.key)).size, 3);
  assert.equal(reopened.getMeta('afterColdReopen'), 'third');
  assert.equal(appends, 2); assert.equal(snapshots, 0);
});

test('generic 54000 does not mint the model2 terminal capacity state', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read(), outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc('generic-limit-control'); let appends = 0;
  const client = { ...backend.client, rpc(name, params) {
    if (name === 'append_annotation_update_v3') { appends++; return lazy({ error: { code: '54000', message: 'generic limit' } }); }
    return backend.client.rpc(name, params); } };
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: client, outboxStore: outbox, doc,
    enableLocal: false, enableRealtime: false, writerId: 'generic-limit-writer', snapshotRetryDelayMs: 0 });
  t.after(async () => { await handle.destroy(); await outbox.close(); if (!doc.isDestroyed) doc.destroy(); });
  handle.updateSurveyMarkers(markers => ({ ...markers, genericLimit: { annotationId: 'genericLimit',
    entityId: 'entity', pageNumber: 1, bounds: { x: 1, y: 1, width: 1, height: 1 }, checklistResponses: {} } }));
  await until(() => appends >= 1); let updaterCalls = 0;
  handle.updateSurveyMarkers(markers => { updaterCalls++; return markers; });
  assert.equal(updaterCalls, 1);
});

test('model2 snapshot capacity stops snapshot retries and blocks later writes', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read(), outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc('snapshot-capacity'); let snapshots = 0;
  const client = { ...backend.client, rpc(name, params) {
    if (name === 'store_annotation_snapshot_v3') { snapshots++; return lazy({ error: { code: 'SG004', message: 'capacity' } }); }
    return backend.client.rpc(name, params); } };
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: client, outboxStore: outbox, doc,
    enableLocal: false, enableRealtime: false, writerId: 'snapshot-capacity-writer', snapshotRetryDelayMs: 0 });
  t.after(async () => { await handle.destroy(); await outbox.close(); if (!doc.isDestroyed) doc.destroy(); });
  await assert.rejects(handle.flushSnapshot(), { code: 'ANNOTATION_GENERATION_CAPACITY' });
  assert.equal(snapshots, 1); await wait(20); assert.equal(snapshots, 1);
  let calls = 0; assert.throws(() => handle.updateSurveyMarkers(markers => { calls++; return markers; }),
    { code: 'ANNOTATION_GENERATION_CAPACITY' }); assert.equal(calls, 0);
});

test('an append capacity pause stops a held snapshot retry loop after its first attempt', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read(), outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc('held-snapshot-capacity'), held = deferred(); let snapshots = 0, appends = 0;
  const client = { ...backend.client, rpc(name, params) {
    if (name === 'store_annotation_snapshot_v3') { snapshots++; return lazy(held.promise); }
    if (name === 'append_annotation_update_v3') { appends++; return lazy({ error: { code: 'SG004', message: 'capacity' } }); }
    return backend.client.rpc(name, params); } };
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: client, outboxStore: outbox, doc,
    enableLocal: false, enableRealtime: false, writerId: 'held-snapshot-writer', snapshotRetryDelayMs: 0 });
  t.after(async () => { held.resolve({ error: { code: '40001', message: 'transient' } });
    await handle.destroy(); await outbox.close(); if (!doc.isDestroyed) doc.destroy(); });
  const snapshot = handle.flushSnapshot(); await until(() => snapshots === 1);
  handle.doc.transact(() => handle.doc.getMap('annoMeta').set('capacityRace', true), 'local');
  await until(() => appends === 1 && handle.getSyncStatus().errorCode === 'ANNOTATION_GENERATION_CAPACITY');
  held.resolve({ error: { code: '40001', message: 'transient' } });
  await assert.rejects(snapshot); await Promise.resolve();
  assert.equal(snapshots, 1);
});
