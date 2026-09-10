import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import {
  annotationOutboxRecordKey,
  createAnnotationOutbox,
  createMemoryAnnotationOutbox,
} from '../src/services/annotationDocOutbox.js';

const GENERATION = '91000000-0000-4000-8000-000000000001';
const REPLACEMENT = '91000000-0000-4000-8000-000000000002';
const scope = Object.freeze({ documentId: 'receipt-doc', actorUserId: 'receipt-actor',
  pdfGenerationId: GENERATION, contentModelVersion: 2 });

function record(clientSeq = 1) {
  const doc = new Y.Doc();
  doc.getMap('annotations').set(`mark-${clientSeq}`, { value: clientSeq });
  const update = Y.encodeStateAsUpdate(doc); doc.destroy();
  const value = { ...scope, writerId: 'receipt-writer', clientSeq, ordinal: clientSeq,
    incarnation: 0, editEpoch: clientSeq, status: 'pending', update,
    checkpointUpdate: update, dependsOn: [], publishAfterAcceptance: false };
  return { ...value, key: annotationOutboxRecordKey(value) };
}

async function adapters(t) {
  const indexedDb = new IDBFactory();
  const indexed = await createAnnotationOutbox({ indexedDb });
  t.after(() => indexed.close());
  return [['memory', createMemoryAnnotationOutbox()], ['IndexedDB', indexed]];
}

for (const kind of ['memory', 'IndexedDB']) test(`${kind} accepted receipt permits only exact missing-seq enrichment`, async t => {
  const store = (await adapters(t)).find(([name]) => name === kind)[1];
  const base = record();
  await store.put(base);
  await store.settleAccepted(base);
  await store.settleAccepted({ ...base, seq: '7' });
  let accepted = (await store.loadCleanState(scope.documentId, scope.actorUserId, scope)).records[0];
  assert.equal(accepted.seq, 7);
  assert.equal((await store.list(scope.documentId, scope.actorUserId, scope)).length, 0,
    'an accepted receipt never returns to pending');

  await store.settleAccepted(base);
  accepted = (await store.loadCleanState(scope.documentId, scope.actorUserId, scope)).records[0];
  assert.equal(accepted.seq, 7, 'a later snapshot receipt cannot remove the WAL sequence');

  for (const changed of [
    { ...base, seq: 8 },
    { ...base, seq: 7, update: record(2).update },
    { ...base, seq: 7, checkpointUpdate: record(2).update },
    { ...base, seq: 7, dependsOn: ['other'] },
    { ...base, seq: 7, editEpoch: 99 },
    { ...base, seq: 7, publishAfterAcceptance: true },
    { ...base, seq: 7, historyTag: { historyKind: 'other', mutationId: 'changed' } },
    { ...base, seq: 7, unknownReceiptField: true },
    { ...base, seq: 7, contentModelVersion: 1 },
    { ...base, seq: 7, pdfGenerationId: REPLACEMENT },
  ]) await assert.rejects(store.settleAccepted(changed), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  await assert.rejects(store.settleAccepted({ ...base, seq: 7, incarnation: 1 }),
    { code: 'ANNOTATION_DOCUMENT_DELETED' });
  for (const seq of [undefined, null, 0, -1, 1.5, '01', '9223372036854775808']) {
    await assert.rejects(store.settleAccepted({ ...base, seq }),
      { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  }
});

for (const kind of ['memory', 'IndexedDB']) test(`${kind} compaction retains missing-seq proof until exact WAL enrichment`, async t => {
  const store = (await adapters(t)).find(([name]) => name === kind)[1];
  const base = record(); await store.put(base); await store.settleAccepted(base);
  assert.equal(await store.compactAccepted(scope.documentId, scope.actorUserId,
    base.update, true, 0, scope), true);
  let clean = await store.loadCleanState(scope.documentId, scope.actorUserId, scope);
  assert.equal(clean.records.length, 1);
  assert.equal(Object.hasOwn(clean.records[0], 'seq'), false);
  assert.deepEqual(clean.acceptedKeys, []);
  assert.equal(await store.compactAccepted(scope.documentId, scope.actorUserId,
    base.update, true, 0, scope), false, 'unchanged retained proof does not rewrite its checkpoint');

  await store.settleAccepted({ ...base, seq: 12 });
  clean = await store.loadCleanState(scope.documentId, scope.actorUserId, scope);
  assert.equal(clean.records[0].seq, 12);
  assert.equal(await store.compactAccepted(scope.documentId, scope.actorUserId,
    base.update, true, 0, scope), true);
  clean = await store.loadCleanState(scope.documentId, scope.actorUserId, scope);
  assert.deepEqual(clean.records, []);
  assert.deepEqual(clean.acceptedKeys, [base.key]);
  await assert.rejects(store.settleAccepted({ ...base, seq: 12 }),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });

  const large = record(3); await store.put(large); await store.settleAccepted(large);
  await store.settleAccepted({ ...large, seq: '9007199254740992' });
  assert.equal((await store.loadCleanState(scope.documentId, scope.actorUserId, scope))
    .records.find(candidate => candidate.key === large.key).seq, '9007199254740992');

  const deleteDoc = new Y.Doc();
  const deleted = deleteDoc.getMap('annotations');
  deleted.set('deleted-mark', true); deleted.delete('deleted-mark');
  const deleteUpdate = Y.encodeStateAsUpdate(deleteDoc); deleteDoc.destroy();
  const deletion = { ...record(4), update: deleteUpdate, checkpointUpdate: deleteUpdate };
  await store.put(deletion); await store.settleAccepted(deletion);
  assert.equal(await store.compactAccepted(scope.documentId, scope.actorUserId,
    deleteUpdate, true, 0, scope), true);
  assert.equal(await store.compactAccepted(scope.documentId, scope.actorUserId,
    deleteUpdate, true, 0, scope), false, 'retained delete-set proof does not rewrite its checkpoint');
});

test('IndexedDB compaction and enrichment serialize without losing exact receipt proof', async t => {
  const indexedDb = new IDBFactory();
  const first = await createAnnotationOutbox({ indexedDb });
  const peer = await createAnnotationOutbox({ indexedDb });
  t.after(async () => { await first.close(); await peer.close(); });
  for (const enrichFirst of [true, false]) {
    const base = record(enrichFirst ? 20 : 21);
    await first.put(base); await first.settleAccepted(base);
    const enrich = () => first.settleAccepted({ ...base, seq: base.clientSeq });
    const compact = () => peer.compactAccepted(scope.documentId, scope.actorUserId,
      base.update, true, 0, scope);
    await Promise.all(enrichFirst ? [enrich(), compact()] : [compact(), enrich()]);
    const clean = await first.loadCleanState(scope.documentId, scope.actorUserId, scope);
    const row = clean.records.find(candidate => candidate.key === base.key);
    assert.ok(clean.acceptedKeys.includes(base.key) || row?.seq === base.clientSeq);
    if (row) {
      await first.compactAccepted(scope.documentId, scope.actorUserId, base.update, true, 0, scope);
      assert.ok((await first.loadCleanState(scope.documentId, scope.actorUserId, scope))
        .acceptedKeys.includes(base.key));
    }
  }
});

for (const kind of ['memory', 'IndexedDB']) test(`${kind} WAL-first settlement keeps its sequence and rejects a conflicting race`, async t => {
  const store = (await adapters(t)).find(([name]) => name === kind)[1];
  const base = record(); await store.put(base);
  await store.settleAccepted({ ...base, seq: 9 });
  await store.settleAccepted(base);
  const same = await Promise.allSettled([
    store.settleAccepted({ ...base, seq: '9' }),
    store.settleAccepted({ ...base, seq: 9 }),
  ]);
  assert.deepEqual(same.map(result => result.status), ['fulfilled', 'fulfilled']);
  const conflict = await Promise.allSettled([
    store.settleAccepted({ ...base, seq: 9 }),
    store.settleAccepted({ ...base, seq: 10 }),
  ]);
  assert.equal(conflict.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(conflict.filter(result => result.status === 'rejected').length, 1);
  assert.equal(conflict.find(result => result.status === 'rejected').reason.code,
    'ANNOTATION_OUTBOX_SCOPE_MISMATCH');
  assert.equal((await store.loadCleanState(scope.documentId, scope.actorUserId, scope)).records[0].seq, 9);
});

test('receipt enrichment obeys retirement, incarnation, and compacted-key fences', async t => {
  const indexedDb = new IDBFactory();
  const first = await createAnnotationOutbox({ indexedDb });
  const peer = await createAnnotationOutbox({ indexedDb });
  t.after(async () => { await first.close(); await peer.close(); });

  const retired = record(); await first.put(retired); await first.settleAccepted(retired);
  await peer.retireScope(scope.documentId, scope.actorUserId, 0,
    { ...scope, replacementGenerationId: REPLACEMENT, reason: 'cloud-generation-replaced' });
  await assert.rejects(first.settleAccepted({ ...retired, seq: 3 }), error => (
    error.code === 'ANNOTATION_PDF_GENERATION_RETIRED' && error.acceptedEvidenceSaved === true
  ));
  assert.equal((await peer.readRetiredScope(scope.documentId, scope.actorUserId, 0, scope))
    .accepted[0].seq, 3);

  const otherScope = { ...scope, pdfGenerationId: REPLACEMENT };
  const stale = { ...record(2), ...otherScope, incarnation: 1 };
  stale.key = annotationOutboxRecordKey(stale);
  await peer.deleteDocument(scope.documentId);
  await peer.put(stale);
  await assert.rejects(first.settleAccepted({ ...stale, incarnation: 0, seq: 4 }),
    { code: 'ANNOTATION_DOCUMENT_DELETED' });

  await peer.settleAccepted({ ...stale, seq: 4 });
  await peer.compactAccepted(scope.documentId, scope.actorUserId, stale.update, true, 1, otherScope);
  await assert.rejects(first.settleAccepted({ ...stale, seq: 4 }),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
});

test('WAL sequence enrichment remains exact when retirement follows it', async t => {
  const indexedDb = new IDBFactory();
  const first = await createAnnotationOutbox({ indexedDb });
  const peer = await createAnnotationOutbox({ indexedDb });
  t.after(async () => { await first.close(); await peer.close(); });
  const base = record();
  await first.put(base);
  await first.settleAccepted(base);
  await first.settleAccepted({ ...base, seq: 5 });
  await peer.retireScope(scope.documentId, scope.actorUserId, 0,
    { ...scope, replacementGenerationId: REPLACEMENT, reason: 'cloud-generation-replaced' });
  const retired = await first.readRetiredScope(scope.documentId, scope.actorUserId, 0, scope);
  assert.equal(retired.accepted.length, 1);
  assert.equal(retired.accepted[0].seq, 5);
  await assert.rejects(first.settleAccepted(base), error => (
    error.code === 'ANNOTATION_PDF_GENERATION_RETIRED'
      && error.acceptedEvidenceSaved === true
  ));
  assert.equal((await peer.readRetiredScope(scope.documentId, scope.actorUserId, 0, scope))
    .accepted[0].seq, 5);
});
