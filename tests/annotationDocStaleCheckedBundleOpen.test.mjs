import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { annotationOutboxRecordKey, createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { updateSurveyMarkersV2 } from '../src/services/documentSurveyCrdtV2.js';

const hex = bytes => `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await wait(10); }
  assert.fail(message);
}

async function publishSameHeadSnapshotAndDependentTail(backend, bundle) {
  const doc = createDetachedYDoc('stale-bundle-server-state');
  Y.applyUpdate(doc, bundle.annotationUpdate);
  updateSurveyMarkersV2(doc, markers => ({ ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'newer same-head snapshot' } }));
  const snapshot = Y.encodeStateAsUpdate(doc); const snapshotVector = Y.encodeStateVector(doc);
  const common = { p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
    p_content_model_version: 2 };
  const stored = (await Promise.resolve(backend.client.rpc('store_annotation_snapshot_v3', { ...common,
    p_at_seq: '0', p_snapshot: hex(snapshot), p_encoding_version: 1,
    p_writer_id: 'newer-snapshot-writer', p_writer_epoch: '1', p_expected_at_seq: '0',
    p_expected_writer_id: null, p_expected_writer_epoch: '0' }))).data;
  assert.equal(stored.stored, true);
  updateSurveyMarkersV2(doc, markers => ({ ...markers,
    'fixture-marker-right': { ...markers['fixture-marker-right'], notes: 'dependent WAL edit' } }));
  const dependent = Y.encodeStateAsUpdate(doc, snapshotVector); doc.destroy();
  const appended = (await Promise.resolve(backend.client.rpc('append_annotation_update_v3', { ...common,
    p_client_id: 'dependent-tail-writer', p_client_seq: '1', p_data: hex(dependent) }))).data;
  assert.equal(appended.seq, '1');
}

async function publishSameHeadSnapshot(backend, bundle, note = 'newer same-head snapshot') {
  const doc = createDetachedYDoc('same-head-server-state'); Y.applyUpdate(doc, bundle.annotationUpdate);
  updateSurveyMarkersV2(doc, markers => ({ ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], notes: note } }));
  const common = { p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
    p_content_model_version: 2 };
  const stored = (await Promise.resolve(backend.client.rpc('store_annotation_snapshot_v3', { ...common,
    p_at_seq: '0', p_snapshot: hex(Y.encodeStateAsUpdate(doc)), p_encoding_version: 1,
    p_writer_id: 'same-head-only-writer', p_writer_epoch: '1', p_expected_at_seq: '0',
    p_expected_writer_id: null, p_expected_writer_epoch: '0' }))).data;
  doc.destroy(); assert.equal(stored.stored, true);
}

function scopedClient(backend, calls = []) {
  return { ...backend.client, rpc(name, params) {
    calls.push({ name, params: structuredClone(params) });
    if (['read_annotation_snapshot_v3', 'read_annotation_updates_v3'].includes(name)) {
      assert.equal(params.p_document_id, backend.ids.documentId);
      assert.equal(params.p_generation_id, backend.ids.generationId);
      assert.equal(params.p_content_model_version, 2);
    }
    return backend.client.rpc(name, params);
  } };
}

test('a stale checked bundle refreshes a newer snapshot even when the WAL head is unchanged', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob(['%PDF-1.4\n%%EOF\n'],
    { type: 'application/pdf' }) });
  const staleBundle = await backend.read(); await publishSameHeadSnapshot(backend, staleBundle);
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() }); let handle;
  t.after(async () => { try { await handle?.destroy(); } catch {} try { await outbox.close(); } catch {} backend.destroy(); });
  handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: staleBundle, supabase: scopedClient(backend), outboxStore: outbox,
    enableLocal: false, enableRealtime: false, writerId: 'same-head-only-reader',
    doc: createDetachedYDoc('same-head-only-reader-doc') });
  assert.equal(handle.getSurveyState().surveyMarkers['fixture-marker-left'].notes, 'newer same-head snapshot');
});

test('a stale checked bundle refreshes a newer same-head snapshot before its dependent WAL tail', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob(['%PDF-1.4\n%%EOF\n'],
    { type: 'application/pdf' }) });
  const staleBundle = await backend.read();
  await publishSameHeadSnapshotAndDependentTail(backend, staleBundle);
  const calls = [];
  const client = scopedClient(backend, calls);
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() }); let handle;
  const doc = createDetachedYDoc('stale-bundle-fresh-handle-doc');
  t.after(async () => { try { await handle?.destroy(); } catch {} try { await outbox.close(); } catch {} backend.destroy(); });
  handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: staleBundle, supabase: client, outboxStore: outbox,
    enableLocal: false, enableRealtime: false, writerId: 'stale-bundle-fresh-handle',
    doc });
  assert.equal(handle.getSurveyState().surveyMarkers['fixture-marker-left'].notes,
    'newer same-head snapshot');
  assert.equal(handle.getSurveyState().surveyMarkers['fixture-marker-right'].notes,
    'dependent WAL edit');
  assert.equal(doc.store.pendingStructs, null); assert.equal(doc.store.pendingDs, null);
  assert.equal(calls.some(call => call.name === 'read_document_generation_open_v3'), false,
    'opening an issued checked bundle never reacquires its PDF generation');
  assert.ok(calls.some(call => call.name === 'read_annotation_snapshot_v3'));
  const tail = calls.find(call => call.name === 'read_annotation_updates_v3');
  assert.equal(tail.params.p_through_seq, '1');
});

test('a failed stale-snapshot refresh rejects without cloud writes or local receipt changes', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob(['%PDF-1.4\n%%EOF\n'],
    { type: 'application/pdf' }) });
  const staleBundle = await backend.read(); await publishSameHeadSnapshot(backend, staleBundle, 'must not hydrate');
  const calls = [];
  const client = { ...backend.client, rpc(name, params) {
    calls.push(name);
    if (name === 'read_annotation_snapshot_v3') return Promise.resolve({ data: null,
      error: { code: 'FIXTURE_SNAPSHOT_READ_FAILED', message: 'fixture snapshot read failed' } });
    return backend.client.rpc(name, params);
  } };
  const indexedDb = new IDBFactory();
  const outbox = await createAnnotationOutbox({ indexedDb });
  const staged = createDetachedYDoc('failed-refresh-recovery-seed');
  Y.applyUpdate(staged, staleBundle.annotationUpdate);
  const vector = Y.encodeStateVector(staged);
  updateSurveyMarkersV2(staged, markers => ({ ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'saved local recovery' } }));
  const value = { documentId: backend.ids.documentId, actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId, contentModelVersion: 2,
    writerId: 'failed-refresh-recovery-writer', clientSeq: 1, ordinal: 1, incarnation: 0,
    editEpoch: 1, status: 'pending', update: Y.encodeStateAsUpdate(staged, vector),
    checkpointUpdate: Y.encodeStateAsUpdate(staged), dependsOn: [],
    publishAfterAcceptance: false, historyTag: null };
  staged.destroy();
  const saved = { ...value, key: annotationOutboxRecordKey(value) };
  await outbox.put(saved);
  assert.equal((await outbox.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 })).length, 1);
  t.after(async () => { try { await outbox.close(); } catch {} backend.destroy(); });
  const before = backend.inspect();
  await assert.rejects(openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: staleBundle, supabase: client, outboxStore: outbox,
    enableLocal: false, enableRealtime: false, writerId: 'failed-stale-refresh-reader',
    doc: createDetachedYDoc('failed-stale-refresh-reader-doc') }),
  /server did not confirm this annotation generation request/i);
  assert.equal(calls.includes('append_annotation_update_v3'), false);
  assert.equal(calls.includes('store_annotation_snapshot_v3'), false);
  assert.deepEqual(backend.inspect(), before);
  const recovery = await createAnnotationOutbox({ indexedDb });
  const clean = await recovery.loadCleanState(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  const pending = await recovery.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  await recovery.close();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].key, saved.key); assert.equal(pending[0].status, 'pending');
  assert.deepEqual(pending[0].dependsOn, []);
  assert.deepEqual(pending[0].update, saved.update);
  assert.deepEqual(pending[0].checkpointUpdate, saved.checkpointUpdate);
  assert.deepEqual(clean.acceptedReceiptProofs, []);
});

test('the first SUBSCRIBED catch-up refreshes a same-head snapshot before its dependent tail', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob(['%PDF-1.4\n%%EOF\n'],
    { type: 'application/pdf' }) });
  const staleBundle = await backend.read(); let publishStarted, publishFailed;
  const published = new Promise((resolve, reject) => { publishStarted = resolve; publishFailed = reject; });
  const calls = [];
  const scoped = scopedClient(backend, calls);
  const client = { ...scoped, channel(topic) {
    const source = scoped.channel(topic);
    const wrapped = { ...source,
      on(...args) { source.on(...args); return wrapped; },
      subscribe(callback) {
        queueMicrotask(async () => {
          try {
            await publishSameHeadSnapshotAndDependentTail(backend, staleBundle);
            publishStarted(); callback?.('SUBSCRIBED');
          } catch (error) { publishFailed(error); }
        });
        return wrapped;
      } };
    return wrapped;
  } };
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() }); let handle;
  t.after(async () => { try { await handle?.destroy(); } catch {} try { await outbox.close(); } catch {} backend.destroy(); });
  handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: staleBundle, supabase: client, outboxStore: outbox,
    enableLocal: false, enableRealtime: true, writerId: 'stale-bundle-subscribed-handle',
    doc: createDetachedYDoc('stale-bundle-subscribed-handle-doc') });
  await published;
  await until(() => handle.getSurveyState().surveyMarkers['fixture-marker-right']?.notes === 'dependent WAL edit',
    'first subscribed catch-up did not refresh the newer snapshot and dependent tail');
  assert.equal(handle.getSurveyState().surveyMarkers['fixture-marker-left'].notes,
    'newer same-head snapshot');
  assert.equal(calls.some(call => call.name === 'read_document_generation_open_v3'), false);
  assert.ok(calls.filter(call => call.name === 'read_annotation_snapshot_v3').length >= 2);
  assert.ok(calls.some(call => call.name === 'read_annotation_updates_v3'));
});
