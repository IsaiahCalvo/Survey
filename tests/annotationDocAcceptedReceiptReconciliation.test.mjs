import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { createAnnotationOutbox, createMemoryAnnotationOutbox,
  annotationOutboxRecordKey } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { updateSurveyMarkersV2 } from '../src/services/documentSurveyCrdtV2.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await wait(20);
  }
  assert.fail(message);
}
const hex = bytes => `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
function makeUpdate(key, value) {
  const doc = createDetachedYDoc(`accepted-receipt:${key}`);
  doc.getMap('annotations').set(key, value);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

function heldCollisionClient(source) {
  let armed = false, release = null;
  return {
    client: { ...source, rpc(name, params) {
      if (name !== 'append_annotation_update_v3' || !armed) return source.rpc(name, params);
      armed = false;
      let resume;
      const gate = new Promise(resolve => { resume = resolve; });
      release = resume;
      const request = {
        setHeader() { return request; },
        abortSignal() { return request; },
        then(resolve, reject) {
          return gate.then(() => Promise.reject(Object.assign(new Error('held collision'),
            { code: '23505' }))).then(resolve, reject);
        },
      };
      return request;
    } },
    arm() { armed = true; },
    release() { release?.(); },
    isHeld() { return release !== null; },
  };
}

function heldSnapshotClient(source) {
  let armed = false, release = null, started = null; const calls = [];
  return {
    client: { ...source, rpc(name, params) {
      if (name !== 'store_annotation_snapshot_v3') return source.rpc(name, params);
      calls.push(structuredClone(params));
      if (!armed) return source.rpc(name, params);
      armed = false;
      let resume; const gate = new Promise(resolve => { resume = resolve; }); release = resume;
      const committed = Promise.resolve(source.rpc(name, params)).then(value => {
        started?.(); return value;
      }, error => { started?.(); throw error; });
      const request = { setHeader() { return request; }, abortSignal() { return request; },
        then(resolve, reject) { return gate.then(() => committed).then(resolve, reject); } };
      return request;
    } },
    arm() { armed = true; return new Promise(resolve => { started = resolve; }); },
    release() { release?.(); }, calls,
  };
}

test('a checked handle opens a compact snapshot-only receipt without a new WAL write', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob([
    new TextEncoder().encode('%PDF-1.4\n%%EOF\n'),
  ], { type: 'application/pdf' }) });
  const indexedDb = new IDBFactory();
  let appendCalls = 0;
  const client = { ...backend.client, rpc(name, params) {
    if (name === 'append_annotation_update_v3') appendCalls += 1;
    return backend.client.rpc(name, params);
  } };
  let handle, outbox;
  t.after(async () => {
    try { await handle?.destroy(); } catch { /* test cleanup */ }
    try { await outbox?.close(); } catch { /* test cleanup */ }
    backend.destroy();
  });

  const bundle = await backend.read();
  const staged = createDetachedYDoc('accepted-receipt-reconcile-seed');
  Y.applyUpdate(staged, bundle.annotationUpdate);
  const before = Y.encodeStateVector(staged);
  updateSurveyMarkersV2(staged, markers => ({ ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'snapshot-only accepted edit' },
  }));
  const update = Y.encodeStateAsUpdate(staged, before);
  const snapshot = Y.encodeStateAsUpdate(staged);
  staged.destroy();

  const writerId = 'accepted-receipt-reconcile-writer';
  const value = { documentId: backend.ids.documentId, actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId, contentModelVersion: 2, writerId,
    clientSeq: 1, ordinal: 1, incarnation: 0, editEpoch: 1, status: 'pending', update,
    checkpointUpdate: snapshot, dependsOn: [], publishAfterAcceptance: false, historyTag: null };
  const saved = { ...value, key: annotationOutboxRecordKey(value) };
  outbox = await createAnnotationOutbox({ indexedDb });
  await outbox.put(saved); await outbox.settleAccepted(saved);
  await outbox.compactAccepted(backend.ids.documentId, backend.ids.actorUserId,
    snapshot, true, 0, { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  let clean = await outbox.loadCleanState(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  assert.equal(clean.records.length, 0);
  assert.equal(clean.acceptedReceiptProofs[0].seq, null);
  assert.equal(clean.acceptedReceiptProofs[0].updateByteLength, update.byteLength);
  assert.equal(clean.acceptedReceiptProofs[0].checkpointUpdateByteLength, snapshot.byteLength);
  await outbox.close(); outbox = null;
  await Promise.resolve(backend.client.rpc('store_annotation_snapshot_v3', {
    p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
    p_content_model_version: 2, p_at_seq: '0', p_snapshot: hex(snapshot),
    p_encoding_version: 1, p_writer_id: writerId, p_writer_epoch: '1',
    p_expected_at_seq: '0', p_expected_writer_id: null, p_expected_writer_epoch: '0',
  }));
  assert.equal(backend.inspect().walRows, 0);

  outbox = await createAnnotationOutbox({ indexedDb });
  handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(), supabase: client, outboxStore: outbox,
    enableLocal: false, enableRealtime: false, writerId, snapshotRetryDelayMs: 0 });
  await handle.drain();
  assert.equal(appendCalls, 0, 'cold proof reconciliation issues no append request');
  assert.equal(backend.inspect().walRows, 0, 'cold open sends no duplicate WAL request');
  clean = await outbox.loadCleanState(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  assert.equal(clean.acceptedReceiptProofs[0].seq, null);
  assert.equal(handle.getSurveyState().surveyMarkers['fixture-marker-left'].notes,
    'snapshot-only accepted edit');

  await handle.destroy(); handle = null; outbox = null;
  outbox = await createAnnotationOutbox({ indexedDb });
  handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(), supabase: client, outboxStore: outbox,
    enableLocal: false, enableRealtime: false, writerId: 'accepted-receipt-reconcile-reopen' });
  assert.equal(handle.getSurveyState().surveyMarkers['fixture-marker-left'].notes,
    'snapshot-only accepted edit');
});

for (const kind of ['memory', 'IndexedDB']) test(`${kind} proof binds exact receipt fields and retains unsupported rows`, async t => {
  const indexedDb = new IDBFactory();
  const store = kind === 'memory' ? createMemoryAnnotationOutbox()
    : await createAnnotationOutbox({ indexedDb });
  t.after(() => store.close());
  const generation = '92000000-0000-4000-8000-000000000001';
  const scope = { pdfGenerationId: generation, contentModelVersion: 2 };
  const base = { documentId: 'proof-doc', actorUserId: 'proof-actor', ...scope,
    writerId: 'proof-writer', clientSeq: 1, ordinal: 1, incarnation: 0, editEpoch: 1,
    status: 'pending', update: makeUpdate('proof', 'u'.repeat(8_192)),
    checkpointUpdate: makeUpdate('checkpoint', 'c'.repeat(8_192)), dependsOn: [],
    publishAfterAcceptance: false, historyTag: null };
  base.key = annotationOutboxRecordKey(base);
  await store.put(base); await store.settleAccepted(base);
  await store.compactAccepted(base.documentId, base.actorUserId,
    base.checkpointUpdate, true, 0, scope);
  let clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
  assert.deepEqual(clean.acceptedReceiptProofs[0].metadata.dependsOn, []);
  assert.equal(clean.acceptedReceiptProofs[0].metadata.status, 'accepted');
  await assert.rejects(store.settleAccepted({ ...base, seq: 7 }, { receiptConflict: true }),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
  assert.equal(clean.acceptedReceiptProofs[0].seq, null);
  assert.deepEqual(clean.acceptedReceiptConflicts, []);
  await assert.rejects(store.settleAccepted({ ...base, update: makeUpdate('proof', 2), seq: 7 }),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  await assert.rejects(store.settleAccepted({ ...base, dependsOn: [base.key], seq: 7 }),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  await store.settleAccepted({ ...base, seq: 7 });
  clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
  assert.equal(clean.acceptedReceiptProofs[0].seq, 7);
  const compactVerified = await store.settleAccepted(base, { receiptConflict: true });
  assert.equal(compactVerified.receiptVerified, true); assert.equal(compactVerified.seq, 7);
  clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
  assert.deepEqual(clean.acceptedReceiptConflicts, [],
    'a compact proof with a known sequence cannot become ambiguous');

  const unsupported = { ...base, clientSeq: 2, ordinal: 2, unknownReceiptField: true };
  unsupported.key = annotationOutboxRecordKey(unsupported);
  await store.put(unsupported); await store.settleAccepted(unsupported);
  await store.compactAccepted(base.documentId, base.actorUserId,
    unsupported.checkpointUpdate, true, 0, scope);
  clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
  assert.equal(clean.records.some(row => row.key === unsupported.key), true,
    'an unsupported row remains full evidence');

  const pending = { ...base, clientSeq: 3, ordinal: 3 };
  pending.key = annotationOutboxRecordKey(pending);
  await store.put(pending);
  await assert.rejects(store.settleAccepted(pending, { receiptConflict: true }),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  assert.equal((await store.list(base.documentId, base.actorUserId, scope))
    .some(row => row.key === pending.key), true,
  'a conflict report cannot promote pending bytes');
  const missing = { ...base, clientSeq: 4, ordinal: 4 };
  missing.key = annotationOutboxRecordKey(missing);
  await assert.rejects(store.settleAccepted(missing, { receiptConflict: true }),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });

  const conflict = { ...base, clientSeq: 5, ordinal: 5 };
  conflict.key = annotationOutboxRecordKey(conflict);
  await store.put(conflict); await store.settleAccepted(conflict);
  await store.settleAccepted(conflict, { receiptConflict: true });
  clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
  assert.deepEqual(clean.acceptedReceiptConflicts.map(item => item.key), [conflict.key]);
  await assert.rejects(store.settleAccepted({ ...conflict, seq: 9 }, { receiptConflict: true }),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
  assert.deepEqual(clean.acceptedReceiptConflicts.map(item => item.key), [conflict.key]);
  await store.settleAccepted({ ...conflict, seq: 9 });
  clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
  assert.deepEqual(clean.acceptedReceiptConflicts, [],
    'an exact positive receipt clears its own conflict at once');
  const fullVerified = await store.settleAccepted(conflict, { receiptConflict: true });
  assert.equal(fullVerified.receiptVerified, true); assert.equal(fullVerified.seq, 9);
  clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
  assert.deepEqual(clean.acceptedReceiptConflicts, [],
    'a full accepted row with a known sequence cannot become ambiguous');
  if (kind === 'IndexedDB') {
    await store.close();
    const reopened = await createAnnotationOutbox({ indexedDb });
    clean = await reopened.loadCleanState(base.documentId, base.actorUserId, scope);
    assert.deepEqual(clean.acceptedReceiptConflicts, []);
    assert.equal(clean.acceptedReceiptProofs.find(proof => proof.key === base.key)?.seq, 7);
    assert.equal(clean.records.find(row => row.key === conflict.key)?.seq, 9);
    await reopened.close();
  }
});

test('generated model 1 sequence-known receipts keep their historical compaction path', async () => {
  const store = createMemoryAnnotationOutbox();
  const scope = { pdfGenerationId: '92000000-0000-4000-8000-000000000002' };
  const row = { documentId: 'model-one-doc', actorUserId: 'model-one-actor', ...scope,
    writerId: 'model-one-writer', clientSeq: 1, ordinal: 1, incarnation: 0, editEpoch: 1,
    status: 'pending', update: makeUpdate('model-one', 1), checkpointUpdate: makeUpdate('model-one', 1),
    dependsOn: [], publishAfterAcceptance: false };
  row.key = annotationOutboxRecordKey(row);
  await store.put(row); await store.settleAccepted({ ...row, seq: 1 });
  assert.equal(await store.compactAccepted(row.documentId, row.actorUserId,
    row.update, true, 0, scope), true);
  const clean = await store.loadCleanState(row.documentId, row.actorUserId, scope);
  assert.deepEqual(clean.records, []);
  assert.deepEqual(clean.acceptedKeys, [row.key]);
  assert.deepEqual(clean.acceptedReceiptProofs, []);
});

const openRequest = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
const finishTransaction = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.onerror = () => {};
});

test('cold load rejects malformed or contradictory compact receipt evidence', async () => {
  for (const kind of ['null-checkpoint-hash', 'duplicate-dependency', 'unsorted-dependency',
    'conflict-without-evidence', 'conflict-with-sequence', 'proof-and-full-row']) {
    const indexedDb = new IDBFactory();
    let store = await createAnnotationOutbox({ indexedDb });
    const generation = '92000000-0000-4000-8000-000000000003';
    const scope = { pdfGenerationId: generation, contentModelVersion: 2 };
    const base = { documentId: 'corrupt-proof-doc', actorUserId: 'corrupt-proof-actor', ...scope,
      writerId: 'corrupt-proof-writer', clientSeq: 1, ordinal: 1, incarnation: 0, editEpoch: 1,
      status: 'pending', update: makeUpdate('corrupt-proof', 'u'.repeat(8_192)),
      checkpointUpdate: makeUpdate('corrupt-checkpoint', 'c'.repeat(8_192)), dependsOn: [],
      publishAfterAcceptance: false, historyTag: null };
    base.key = annotationOutboxRecordKey(base);
    await store.put(base); await store.settleAccepted(base);
    await store.compactAccepted(base.documentId, base.actorUserId, base.checkpointUpdate, true, 0, scope);
    const clean = await store.loadCleanState(base.documentId, base.actorUserId, scope);
    const proof = clean.acceptedReceiptProofs[0]; const scopeKey = proof.metadata.scopeKey;
    await store.close();
    const db = await openRequest(indexedDb.open('survey-annotation-outbox-v2'));
    const names = kind === 'proof-and-full-row' ? ['acceptedCheckpoints', 'accepted'] : ['acceptedCheckpoints'];
    const tx = db.transaction(names, 'readwrite');
    const checkpoints = tx.objectStore('acceptedCheckpoints');
    const checkpoint = await openRequest(checkpoints.get(scopeKey));
    const nextProof = structuredClone(checkpoint.acceptedReceiptProofs[0]);
    if (kind === 'null-checkpoint-hash') nextProof.checkpointUpdateSha256 = null;
    if (kind === 'duplicate-dependency') nextProof.metadata.dependsOn = [base.key, base.key];
    if (kind === 'unsorted-dependency') {
      const later = `${scopeKey}\u0000z`; const earlier = `${scopeKey}\u0000a`;
      nextProof.metadata.dependsOn = [later, earlier];
    }
    let acceptedReceiptConflicts = checkpoint.acceptedReceiptConflicts || [];
    if (kind === 'conflict-without-evidence') {
      acceptedReceiptConflicts = [{ version: 1, kind: 'ambiguous-23505', key: `${scopeKey}\u0000missing` }];
    } else if (kind === 'conflict-with-sequence') {
      nextProof.seq = 7;
      acceptedReceiptConflicts = [{ version: 1, kind: 'ambiguous-23505', key: base.key }];
    }
    checkpoints.put({ ...checkpoint, acceptedReceiptProofs: [nextProof], acceptedReceiptConflicts });
    if (kind === 'proof-and-full-row') tx.objectStore('accepted').put({ ...base, status: 'accepted', seq: 8,
      scopeKey });
    await finishTransaction(tx); db.close();
    store = await createAnnotationOutbox({ indexedDb });
    await assert.rejects(store.loadCleanState(base.documentId, base.actorUserId, scope),
      { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' }, kind);
    await store.close();
  }
});

test('model 2 fixture snapshot CAS rejects stale base and stale frontier without overwriting', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob(['%PDF-1.4\n%%EOF\n'],
    { type: 'application/pdf' }) });
  t.after(() => backend.destroy());
  const common = { p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
    p_content_model_version: 2 };
  const before = (await Promise.resolve(backend.client.rpc('read_annotation_snapshot_v3', common))).data.snapshot;
  const first = (await Promise.resolve(backend.client.rpc('store_annotation_snapshot_v3', { ...common,
    p_at_seq: '0', p_snapshot: before.snapshot, p_encoding_version: before.encoding_version,
    p_writer_id: 'cas-writer-a', p_writer_epoch: '1', p_expected_at_seq: '0',
    p_expected_writer_id: null, p_expected_writer_epoch: '0' }))).data;
  assert.equal(first.stored, true);
  const staleBase = (await Promise.resolve(backend.client.rpc('store_annotation_snapshot_v3', { ...common,
    p_at_seq: '0', p_snapshot: hex(makeUpdate('stale-base', 1)), p_encoding_version: 1,
    p_writer_id: 'cas-writer-b', p_writer_epoch: '2', p_expected_at_seq: '0',
    p_expected_writer_id: null, p_expected_writer_epoch: '0' }))).data;
  assert.equal(staleBase.stored, false); assert.equal(Object.hasOwn(staleBase, 'snapshot_sha256'), false);
  await Promise.resolve(backend.client.rpc('append_annotation_update_v3', { ...common,
    p_client_id: 'cas-frontier-writer', p_client_seq: '2', p_data: hex(makeUpdate('frontier', 1)) }));
  const writerSequence = (await Promise.resolve(backend.client.rpc('read_annotation_writer_sequence_v3', {
    ...common, p_client_id: 'cas-frontier-writer' }))).data;
  assert.equal(writerSequence.client_seq, '2', 'writer sequence returns max client seq, not row count');
  const staleFrontier = (await Promise.resolve(backend.client.rpc('store_annotation_snapshot_v3', { ...common,
    p_at_seq: '0', p_snapshot: hex(makeUpdate('stale-frontier', 1)), p_encoding_version: 1,
    p_writer_id: 'cas-writer-b', p_writer_epoch: '2', p_expected_at_seq: '0',
    p_expected_writer_id: 'cas-writer-a', p_expected_writer_epoch: '1' }))).data;
  assert.equal(staleFrontier.stored, false);
  const after = (await Promise.resolve(backend.client.rpc('read_annotation_snapshot_v3', common))).data.snapshot;
  assert.deepEqual(after, { at_seq: '0', snapshot: before.snapshot, encoding_version: before.encoding_version,
    writer_id: 'cas-writer-a', writer_epoch: '1' });
});

test('queued snapshot bytes cannot claim a WAL frontier reached after their capture', async t => {
  const listeners = new Map(); const previousWindow = globalThis.window;
  globalThis.window = { addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); } };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob(['%PDF-1.4\n%%EOF\n'],
    { type: 'application/pdf' }) });
  const transport = heldSnapshotClient(backend.client); const indexedDb = new IDBFactory();
  const outbox = await createAnnotationOutbox({ indexedDb }); let handle, fresh, freshOutbox;
  t.after(async () => { try { await handle?.destroy(); } catch {} try { await fresh?.destroy(); } catch {}
    try { await outbox.close(); } catch {} try { await freshOutbox?.close(); } catch {} backend.destroy(); });
  handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(), supabase: transport.client, outboxStore: outbox,
    enableLocal: false, enableRealtime: false, writerId: 'queued-snapshot-writer', snapshotRetryDelayMs: 0,
    doc: createDetachedYDoc('queued-snapshot-writer-doc') });
  handle.updateSurveyMarkers(markers => ({ ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'captured first' } }));
  await handle.drain();
  const snapshotWritesBefore = backend.inspect().snapshotWrites;
  const snapshotStarted = transport.arm();
  assert.equal(typeof listeners.get('pagehide'), 'function'); listeners.get('pagehide')();
  await snapshotStarted;
  assert.ok(backend.inspect().snapshotWrites > snapshotWritesBefore,
    'the held reply is signaled only after fixture snapshot CAS commits');
  const committedSnapshot = (await Promise.resolve(backend.client.rpc('read_annotation_snapshot_v3', {
    p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
    p_content_model_version: 2 }))).data.snapshot;
  assert.equal(committedSnapshot.at_seq, '1');
  assert.equal(committedSnapshot.writer_id, 'queued-snapshot-writer');
  listeners.get('pagehide')();
  handle.updateSurveyMarkers(markers => ({ ...markers,
    'fixture-marker-right': { ...markers['fixture-marker-right'], notes: 'advanced later' } }));
  await until(() => backend.inspect().walHead === '2', 'the later WAL row did not advance the frontier');
  transport.release();
  await until(() => transport.calls.length >= 2, 'the queued lifecycle snapshot did not execute');
  const captured = transport.calls[0];
  assert.equal(transport.calls.slice(1).some(call => BigInt(call.p_at_seq) > BigInt(captured.p_at_seq)
    && call.p_snapshot === captured.p_snapshot), false,
  'old snapshot bytes never claim a frontier reached after capture');
  assert.equal(await handle.flushSnapshot(), true);
  const freshBundle = await backend.read();
  freshOutbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  fresh = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: freshBundle, supabase: transport.client, outboxStore: freshOutbox,
    enableLocal: false, enableRealtime: false, writerId: 'queued-snapshot-fresh-reader',
    doc: createDetachedYDoc('queued-snapshot-fresh-reader-doc') });
  assert.equal(fresh.getSurveyState().surveyMarkers['fixture-marker-left'].notes, 'captured first');
  assert.equal(fresh.getSurveyState().surveyMarkers['fixture-marker-right'].notes, 'advanced later');
});

test('late ambiguous 23505 keeps snapshot-accepted content and stays unhealthy across success and reopen', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob([
    new TextEncoder().encode('%PDF-1.4\n%%EOF\n'),
  ], { type: 'application/pdf' }) });
  const transport = heldCollisionClient(backend.client);
  const indexedDb = new IDBFactory();
  let handle, freshHandle, outbox, freshOutbox;
  t.after(async () => {
    try { await handle?.destroy(); } catch { /* test cleanup */ }
    try { await freshHandle?.destroy(); } catch { /* test cleanup */ }
    try { await outbox?.close(); } catch { /* test cleanup */ }
    try { await freshOutbox?.close(); } catch { /* test cleanup */ }
    backend.destroy();
  });
  const scope = { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 };
  const checkedBundle = await backend.read();
  const open = async (writerId, doc = null, bundle = checkedBundle) => {
    const store = await createAnnotationOutbox({ indexedDb });
    const value = await openAnnotationDoc({ documentId: backend.ids.documentId,
      actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
      checkedBundle: bundle, supabase: transport.client, outboxStore: store,
      enableLocal: false, enableRealtime: false, writerId, snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 1, doc });
    return { value, store };
  };
  ({ value: handle, store: outbox } = await open('ambiguous-receipt-writer',
    createDetachedYDoc('ambiguous-receipt-writer-doc')));
  backend.setOffline(true);
  handle.updateSurveyMarkers(markers => ({ ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'snapshot accepted' },
  }));
  await handle.drain();
  transport.arm();
  backend.setOffline(false);
  await until(transport.isHeld, 'the first WAL request did not pause');
  const acceptedEvidence = await until(async () => {
    const state = await outbox.loadCleanState(backend.ids.documentId, backend.ids.actorUserId, scope);
    const record = state.records.find(row => !Object.hasOwn(row, 'seq'));
    const proof = state.acceptedReceiptProofs.find(item => item.seq === null);
    return record ? { key: record.key, record } : proof ? { key: proof.key, proof } : null;
  }, 'the snapshot did not accept the held receipt');
  if (acceptedEvidence.record) await outbox.compactAccepted(backend.ids.documentId, backend.ids.actorUserId,
    acceptedEvidence.record.checkpointUpdate, true, 0, scope);
  transport.release();
  await handle.drain();
  let clean = await outbox.loadCleanState(backend.ids.documentId, backend.ids.actorUserId, scope);
  assert.deepEqual(clean.acceptedReceiptConflicts.map(item => item.key), [acceptedEvidence.key]);
  assert.deepEqual(clean.quarantined || [], []);
  assert.equal(handle.getSyncStatus().healthy, false);
  assert.match(handle.getSyncStatus().error, /could not confirm this annotation receipt/i);
  assert.equal(handle.getSurveyState().surveyMarkers['fixture-marker-left'].notes,
    'snapshot accepted');

  handle.updateSurveyMarkers(markers => ({ ...markers,
    'fixture-marker-right': { ...markers['fixture-marker-right'], notes: 'later success' },
  }));
  await handle.drain();
  assert.equal(handle.getSyncStatus().healthy, false,
    'an unrelated append cannot clear the receipt conflict');
  assert.equal(await handle.flushSnapshot(), true,
    'the same-handle dependency chain reaches one checked server snapshot');
  let freshBundle;
  try { freshBundle = await backend.read(); }
  catch (error) {
    assert.fail(`fresh checked read failed: ${JSON.stringify({ backend: backend.inspect(),
      status: handle.getSyncStatus(), error: { code: error?.code, message: error?.message } })}`);
  }
  freshOutbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  freshHandle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: freshBundle, supabase: transport.client, outboxStore: freshOutbox,
    enableLocal: false, enableRealtime: false, writerId: 'fresh-server-proof',
    doc: createDetachedYDoc('fresh-server-proof-doc') });
  assert.equal(freshHandle.getSurveyState().surveyMarkers['fixture-marker-left'].notes, 'snapshot accepted');
  assert.equal(freshHandle.getSurveyState().surveyMarkers['fixture-marker-right'].notes, 'later success');
  await freshHandle.destroy(); freshHandle = null; freshOutbox = null;
  assert.equal(handle.getSyncStatus().healthy, false,
    'an unrelated append cannot clear the receipt conflict');
  await handle.destroy(); handle = null; outbox = null;
  ({ value: handle, store: outbox } = await open('ambiguous-receipt-reopen',
    createDetachedYDoc('ambiguous-receipt-reopen-doc'), freshBundle));
  clean = await outbox.loadCleanState(backend.ids.documentId, backend.ids.actorUserId, scope);
  assert.deepEqual(clean.acceptedReceiptConflicts.map(item => item.key), [acceptedEvidence.key]);
  assert.equal(handle.getSyncStatus().healthy, false);
  assert.equal(handle.getSurveyState().surveyMarkers['fixture-marker-left'].notes,
    'snapshot accepted');
  assert.equal(handle.getSurveyState().surveyMarkers['fixture-marker-right'].notes, 'later success');
});
