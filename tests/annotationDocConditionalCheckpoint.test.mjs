import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { annotationOutboxRecordKey, createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';

const hex = bytes => `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
const pdf = () => new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) { if (predicate()) return; await wait(5); }
  assert.fail(message);
}

function measuredClient(backend, mutateResponse) {
  const calls = [];
  return { client: { ...backend.client, rpc(name, params) {
    const source = backend.client.rpc(name, params);
    const record = async () => {
      const result = structuredClone(await source);
      mutateResponse?.(name, result);
      calls.push({ name, params: structuredClone(params),
        snapshotMatches: result?.data?.snapshot_matches,
        responseBytes: Buffer.byteLength(JSON.stringify(result?.data ?? null), 'utf8') });
      return result;
    };
    const request = { setHeader(...args) { source.setHeader?.(...args); return request; },
      abortSignal(...args) { source.abortSignal?.(...args); return request; },
      then(resolve, reject) { return record().then(resolve, reject); } };
    return request;
  } }, calls };
}

async function publishSnapshot(backend, bundle, mutate, writer = 'conditional-new-snapshot') {
  const doc = createDetachedYDoc(`publish-${writer}`); Y.applyUpdate(doc, bundle.annotationUpdate);
  mutate(doc);
  const result = await backend.client.rpc('store_annotation_snapshot_v3', {
    p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
    p_content_model_version: 2, p_at_seq: bundle.throughSeq,
    p_snapshot: hex(Y.encodeStateAsUpdate(doc)), p_encoding_version: 1,
    p_writer_id: writer, p_writer_epoch: String(BigInt(bundle.snapshotBase.writerEpoch) + 1n),
    p_expected_at_seq: bundle.snapshotBase.atSeq,
    p_expected_writer_id: bundle.snapshotBase.writerId,
    p_expected_writer_epoch: bundle.snapshotBase.writerEpoch,
  });
  doc.destroy(); assert.equal(result.data.stored, true); return result;
}

async function appendDelta(backend, bundle, mutate, writer = 'conditional-tail') {
  const doc = createDetachedYDoc(`append-${writer}`); Y.applyUpdate(doc, bundle.annotationUpdate);
  const vector = Y.encodeStateVector(doc); mutate(doc);
  const result = await backend.client.rpc('append_annotation_update_v3', {
    p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
    p_content_model_version: 2, p_client_id: writer, p_client_seq: '1',
    p_data: hex(Y.encodeStateAsUpdate(doc, vector)),
  });
  doc.destroy(); assert.equal(result.data.accepted, true); return result;
}

async function open(t, backend, bundle, client, { indexedDb = new IDBFactory(), writerId = 'conditional-reader',
  outbox = null, doc = null, enableRealtime = false } = {}) {
  outbox ||= await createAnnotationOutbox({ indexedDb });
  doc ||= createDetachedYDoc(`conditional-open-${writerId}`);
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: client, outboxStore: outbox,
    enableLocal: false, enableRealtime, writerId, doc, snapshotRetryDelayMs: 0 });
  t.after(async () => { try { await handle.destroy(); } catch {} try { await outbox.close(); } catch {}
    if (!doc.isDestroyed) doc.destroy(); });
  return handle;
}

function pendingRecord(backend, bundle) {
  const doc = createDetachedYDoc('conditional-pending-record'); Y.applyUpdate(doc, bundle.annotationUpdate);
  const vector = Y.encodeStateVector(doc); doc.getMap('annoMeta').set('pendingLocal', 'preserved');
  const value = { documentId: backend.ids.documentId, actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId, contentModelVersion: 2,
    writerId: 'conditional-pending-writer', clientSeq: 1, ordinal: 1, incarnation: 0,
    editEpoch: 1, status: 'pending', update: Y.encodeStateAsUpdate(doc, vector),
    dependsOn: [], publishAfterAcceptance: false,
    historyTag: null };
  doc.destroy(); return { ...value, key: annotationOutboxRecordKey(value) };
}

test('opted-in checked open reuses its private verified checkpoint while default-off still reads full bytes', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const seed = await backend.read();
  await publishSnapshot(backend, seed, doc => doc.getMap('annoMeta').set('budgetPayload', 'x'.repeat(128 * 1024)),
    'moderate-checkpoint');

  const optedBundle = await backend.read({ conditionalAnnotationCheckpoint: true });
  assert.equal(Object.hasOwn(optedBundle, 'conditionalAnnotationCheckpoint'), false);
  optedBundle.annotationUpdate.fill(0); // Public bytes cannot replace the reader's private verified prefix.
  const opted = measuredClient(backend);
  const optedHandle = await open(t, backend, optedBundle, opted.client, { writerId: 'conditional-opted' });
  assert.equal(optedHandle.getMeta('budgetPayload').length, 128 * 1024);
  assert.equal(opted.calls.filter(call => call.name === 'read_annotation_checkpoint_conditional_v3').length, 1);
  assert.equal(opted.calls.some(call => call.name === 'read_annotation_snapshot_v3'), false);
  const omittedBytes = opted.calls.find(call => call.name === 'read_annotation_checkpoint_conditional_v3').responseBytes;

  const defaultBundle = await backend.read();
  const legacy = measuredClient(backend);
  const legacyHandle = await open(t, backend, defaultBundle, legacy.client, { writerId: 'conditional-default-off' });
  assert.equal(legacyHandle.getMeta('budgetPayload').length, 128 * 1024);
  assert.equal(legacy.calls.some(call => call.name === 'read_annotation_checkpoint_conditional_v3'), false);
  const full = legacy.calls.find(call => call.name === 'read_annotation_snapshot_v3');
  assert.ok(full.responseBytes > 250 * 1024); assert.ok(omittedBytes < 1024);
});

test('same-head changed checkpoint returns and installs full current bytes before opening', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const stale = await backend.read({ conditionalAnnotationCheckpoint: true });
  await publishSnapshot(backend, stale, doc => doc.getMap('annoMeta').set('sameHeadChanged', 'installed'));
  const measured = measuredClient(backend);
  const handle = await open(t, backend, stale, measured.client, { writerId: 'conditional-changed' });
  assert.equal(handle.getMeta('sameHeadChanged'), 'installed');
  const call = measured.calls.find(item => item.name === 'read_annotation_checkpoint_conditional_v3');
  assert.ok(call.responseBytes > 100); assert.equal(backend.inspect().walHead, '0');
  assert.equal(measured.calls.some(item => item.name === 'read_annotation_snapshot_v3'), false);
});

test('WAL-only advance keeps the checkpoint match and applies one fixed dependent tail', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read({ conditionalAnnotationCheckpoint: true });
  await appendDelta(backend, bundle, doc => doc.getMap('annoMeta').set('tailOnly', 'fixed'));
  const measured = measuredClient(backend);
  const handle = await open(t, backend, bundle, measured.client, { writerId: 'conditional-tail-reader' });
  assert.equal(handle.getMeta('tailOnly'), 'fixed');
  const conditional = measured.calls.find(call => call.name === 'read_annotation_checkpoint_conditional_v3');
  const tail = measured.calls.find(call => call.name === 'read_annotation_updates_v3');
  assert.equal(conditional.params.p_expected_at_seq, '0');
  assert.equal(tail.params.p_after_seq, '0'); assert.equal(tail.params.p_through_seq, '1');
  assert.equal(measured.calls.some(call => call.name === 'read_annotation_snapshot_v3'), false);
});

test('failed conditional candidate preserves exact pending recovery and cannot install partial bytes', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read({ conditionalAnnotationCheckpoint: true });
  await publishSnapshot(backend, bundle, doc => doc.getMap('annoMeta').set('failedCandidate', 'must not install'));
  const indexedDb = new IDBFactory(); let outbox = await createAnnotationOutbox({ indexedDb });
  const saved = pendingRecord(backend, bundle); await outbox.put(saved);
  const broken = measuredClient(backend, (name, result) => {
    if (name === 'read_annotation_checkpoint_conditional_v3') result.data.checkpoint.snapshot_sha256 = 'a'.repeat(64);
  });
  await assert.rejects(openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: broken.client, outboxStore: outbox,
    enableLocal: false, enableRealtime: false, writerId: 'conditional-failed',
    doc: createDetachedYDoc('conditional-failed-doc') }), { code: 'ANNOTATION_GENERATION_PROTOCOL' });
  assert.equal(broken.calls.some(call => call.name === 'append_annotation_update_v3'
    || call.name === 'store_annotation_snapshot_v3'), false);
  outbox = await createAnnotationOutbox({ indexedDb }); t.after(() => outbox.close());
  const pending = await outbox.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  assert.equal(pending.length, 1); assert.equal(pending[0].key, saved.key);
  assert.deepEqual(pending[0].update, saved.update); assert.deepEqual(pending[0].dependsOn, saved.dependsOn);
  const recovered = measuredClient(backend);
  const handle = await open(t, backend, bundle, recovered.client,
    { indexedDb, writerId: 'conditional-failed-recovery' });
  assert.equal(handle.getMeta('failedCandidate'), 'must not install');
  assert.equal(handle.getMeta('pendingLocal'), 'preserved');
});

test('append and snapshot acknowledgement never promote a local checkpoint into the private server prefix', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read({ conditionalAnnotationCheckpoint: true });
  const first = measuredClient(backend);
  const handle = await open(t, backend, bundle, first.client, { writerId: 'conditional-local-writer' });
  handle.setMeta('localAcked', 'server snapshot'); await handle.drain();
  assert.equal(await handle.flushSnapshot(), true); await handle.destroy();
  const second = measuredClient(backend);
  const reopened = await open(t, backend, bundle, second.client, { writerId: 'conditional-after-ack' });
  assert.equal(reopened.getMeta('localAcked'), 'server snapshot');
  const conditional = second.calls.find(call => call.name === 'read_annotation_checkpoint_conditional_v3');
  assert.equal(conditional.params.p_expected_at_seq, '0');
  assert.equal(conditional.params.p_expected_writer_id, null);
  assert.equal(conditional.snapshotMatches, false);
  assert.equal(second.calls.some(call => call.name === 'read_annotation_snapshot_v3'), false);
});

test('matched server prefix composes pending local state without treating it as accepted cloud bytes', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read({ conditionalAnnotationCheckpoint: true });
  const indexedDb = new IDBFactory(); const outbox = await createAnnotationOutbox({ indexedDb });
  const saved = pendingRecord(backend, bundle); await outbox.put(saved); backend.setOffline(true);
  const measured = measuredClient(backend);
  const handle = await open(t, backend, bundle, measured.client,
    { writerId: 'conditional-pending-open', indexedDb, outbox });
  assert.equal(handle.getMeta('pendingLocal'), 'preserved');
  assert.equal(measured.calls.find(call => call.name === 'read_annotation_checkpoint_conditional_v3').snapshotMatches, true);
  const pending = await outbox.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  assert.equal(pending.length, 1); assert.equal(pending[0].key, saved.key);
  assert.equal(backend.inspect().walRows, 0);
});

test('a changed conditional response finishing after handle destroy cannot mutate the sealed document', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read({ conditionalAnnotationCheckpoint: true });
  const measured = measuredClient(backend);
  const doc = createDetachedYDoc('conditional-delayed-digest-doc');
  const handle = await open(t, backend, bundle, measured.client,
    { writerId: 'conditional-delayed-digest', doc, enableRealtime: true });
  await until(() => measured.calls.filter(call => call.name === 'read_annotation_checkpoint_conditional_v3').length >= 2,
    'initial open and first SUBSCRIBED did not both use the conditional checkpoint');
  assert.equal(measured.calls.some(call => call.name === 'read_annotation_snapshot_v3'), false);
  let changes = 0; handle.onChange(() => { changes++; });
  const settledConditionalReads = measured.calls.filter(
    call => call.name === 'read_annotation_checkpoint_conditional_v3').length;
  backend.client.getChannels().at(-1).emitStatus('SUBSCRIBED');
  await until(() => measured.calls.filter(
    call => call.name === 'read_annotation_checkpoint_conditional_v3').length > settledConditionalReads,
  'observed SUBSCRIBED catch-up did not request the checkpoint');
  await until(() => changes >= 1, 'observed SUBSCRIBED catch-up did not notify');
  await until(() => handle.getSyncStatus().stage === 'idle',
    'observed SUBSCRIBED catch-up did not return to idle');
  const changesBeforeDelayedRefresh = changes;
  await publishSnapshot(backend, bundle, candidate => candidate.getMap('annoMeta').set('lateCandidate', 'blocked'));

  const originalCrypto = globalThis.crypto; let releaseDigest, digestStarted;
  const gate = new Promise(resolve => { releaseDigest = resolve; });
  let didStart = false;
  const started = new Promise(resolve => { digestStarted = () => { didStart = true; resolve(); }; });
  const subtle = new Proxy(originalCrypto.subtle, { get(target, key) {
    if (key !== 'digest') { const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value; }
    return async (name, data) => {
      const result = await originalCrypto.subtle.digest(name, data);
      digestStarted(); await gate; return result;
    };
  } });
  const gatedCrypto = new Proxy(originalCrypto, { get(target, key) {
    if (key === 'subtle') return subtle;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: gatedCrypto });
  let timeout;
  try {
    backend.client.getChannels().at(-1).emitStatus('SUBSCRIBED');
    await Promise.race([started, new Promise((_, reject) => { timeout = setTimeout(
      () => reject(new Error('conditional digest did not start')), 2_000); })]);
    clearTimeout(timeout);
    const closing = handle.destroy(); releaseDigest(); await closing;
    await wait(10);
    assert.equal(doc.getMap('annoMeta').get('lateCandidate'), undefined);
    assert.equal(changes, changesBeforeDelayedRefresh);
  } finally {
    clearTimeout(timeout);
    if (!didStart) releaseDigest();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
  }
});

test('malformed fixed tail rejects atomically and the same private prefix remains usable', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read({ conditionalAnnotationCheckpoint: true });
  await appendDelta(backend, bundle, doc => doc.getMap('annoMeta').set('validTailAfterFailure', 'recovered'));
  const broken = measuredClient(backend, (name, result) => {
    if (name === 'read_annotation_updates_v3' && result.data.rows.length) result.data.rows[0].data = '\\xff';
  });
  await assert.rejects(openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle, supabase: broken.client,
    outboxStore: await createAnnotationOutbox({ indexedDb: new IDBFactory() }),
    enableLocal: false, enableRealtime: false, writerId: 'conditional-bad-tail',
    doc: createDetachedYDoc('conditional-bad-tail-doc') }), { code: 'ANNOTATION_GENERATION_STATE' });
  const healthy = measuredClient(backend);
  const handle = await open(t, backend, bundle, healthy.client, { writerId: 'conditional-good-tail' });
  assert.equal(handle.getMeta('validTailAfterFailure'), 'recovered');
  assert.equal(healthy.calls.find(call => call.name === 'read_annotation_checkpoint_conditional_v3').snapshotMatches, true);
});

test('wrong actor generation or forged model bundle rejects before conditional transport or local writes', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const bundle = await backend.read({ conditionalAnnotationCheckpoint: true });
  for (const changes of [{ actorUserId: 'd2000000-0000-4000-8000-000000000099' },
    { pdfGenerationId: 'd2000000-0000-4000-8000-000000000099' },
    { checkedBundle: { ...bundle, contentModelVersion: 1 } }]) {
    const measured = measuredClient(backend); let storageTouches = 0;
    const untouched = new Proxy({}, { get() { storageTouches++; throw new Error('scope rejection touched storage'); } });
    await assert.rejects(openAnnotationDoc({ documentId: backend.ids.documentId,
      actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
      checkedBundle: bundle, supabase: measured.client, outboxStore: untouched,
      enableLocal: false, enableRealtime: false, writerId: 'conditional-wrong-scope', ...changes }),
    { code: 'DOCUMENT_OPEN_INPUT' });
    assert.equal(storageTouches, 0); assert.deepEqual(measured.calls, []);
  }
});
