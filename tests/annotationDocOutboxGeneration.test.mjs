import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createAnnotationOutbox, createMemoryAnnotationOutbox, annotationOutboxRecordKey } from '../src/services/annotationDocOutbox.js';

const DB = 'survey-annotation-outbox-v2';
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const options = pdfGenerationId => ({ documentId: 'doc', actorUserId: 'actor', pdfGenerationId });
function row(pdfGenerationId, clientSeq = 1, incarnation = 0) {
  const doc = new Y.Doc(); doc.getMap('annotations').set(`mark-${clientSeq}`, pdfGenerationId || 'legacy');
  const record = { documentId: 'doc', actorUserId: 'actor', writerId: 'writer', clientSeq,
    ordinal: clientSeq, incarnation, status: 'pending', update: Y.encodeStateAsUpdate(doc) };
  doc.destroy();
  if (pdfGenerationId != null) record.pdfGenerationId = pdfGenerationId;
  return { ...record, key: annotationOutboxRecordKey(record) };
}
async function stores(t) {
  const indexedDb = new IDBFactory();
  const a = await createAnnotationOutbox({ indexedDb }); const b = await createAnnotationOutbox({ indexedDb });
  t.after(async () => { await a.close(); await b.close(); });
  return { a, b, indexedDb };
}
const retire = (store, pdfGenerationId = A) => store.retireScope('doc', 'actor', 0,
  { pdfGenerationId, replacementGenerationId: B, reason: 'cloud-generation-replaced' });
const retired = error => error.code === 'ANNOTATION_PDF_GENERATION_RETIRED';
function request(value) { return new Promise((resolve, reject) => {
  value.addEventListener('success', () => resolve(value.result));
  value.addEventListener('error', () => reject(value.error));
}); }

for (const memory of [false, true]) test(`${memory ? 'memory' : 'IndexedDB'} generation keys isolate pending, receipts, dependencies and compaction`, async t => {
  const store = memory ? createMemoryAnnotationOutbox() : (await stores(t)).a;
  const legacy = row(null), first = row(A), second = row(B);
  first.dependsOn = [annotationOutboxRecordKey({ ...first, clientSeq: 0 })];
  assert.equal(legacy.key, ['doc', 'actor', 'writer', 1].join('\0'));
  assert.equal(new Set([legacy.key, first.key, second.key]).size, 3);
  for (const record of [legacy, first, second]) await store.put(record);
  assert.deepEqual((await store.list('doc', 'actor')).map(r => r.key), [legacy.key]);
  assert.deepEqual((await store.list('doc', 'actor', options(A))).map(r => r.dependsOn), [first.dependsOn]);
  await store.settleAccepted({ ...first, seq: 1 });
  await store.compactAccepted('doc', 'actor', first.update, true, 0, options(A));
  const clean = await store.loadCleanState('doc', 'actor', options(A));
  assert.deepEqual(clean.acceptedKeys, [first.key]); assert.deepEqual(clean.records, []);
  assert.deepEqual((await store.list('doc', 'actor', options(B))).map(r => r.key), [second.key]);
  assert.deepEqual((await store.loadCleanState('doc', 'actor')).acceptedKeys, []);
});

test('generated keys and exact keyed mutation scope fail closed', async t => {
  const { a } = await stores(t); const first = row(A); await a.put(first);
  await assert.rejects(a.put({ ...first, key: row(null).key }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  for (const name of ['delete', 'deleteMany', 'markRejected']) {
    const key = name === 'delete' ? first.key : [first.key];
    await assert.rejects(a[name](key, 0), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
    await assert.rejects(a[name](key, 0, options(B)), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
    assert.equal((await a.list('doc', 'actor', options(A))).length, 1);
  }
  for (const pdfGenerationId of ['', 'not-a-uuid', A.toUpperCase().replace('1', 'A'), 7]) {
    await assert.rejects(a.list('doc', 'actor', { pdfGenerationId }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  }
  await a.delete(first.key, 0, options(A)); assert.deepEqual(await a.list('doc', 'actor', options(A)), []);
});

for (const lateFirst of [true, false]) test(`two connections retire versus queued put, put first=${lateFirst}`, async t => {
  const { a, b } = await stores(t); const first = row(A), accepted = row(A, 2);
  await a.put(accepted); await a.settleAccepted({ ...accepted, seq: 2 });
  await a.compactAccepted('doc', 'actor', accepted.update, true, 0, options(A));
  const work = lateFirst ? [a.put(first), retire(b)] : [retire(b), a.put(first)];
  const result = await Promise.allSettled(work);
  if (!lateFirst) { assert.equal(result[1].status, 'rejected'); assert.equal(result[1].reason.evidenceSaved, true); }
  else assert.equal(result[0].status, 'fulfilled');
  const saved = await b.readRetiredScope('doc', 'actor', 0, options(A));
  assert.deepEqual(saved.acceptedKeys, [accepted.key]);
  assert.deepEqual(saved.quarantined.map(r => r.key), [first.key]);
  assert.deepEqual(saved.quarantined[0].update, first.update);
  assert.equal(saved.quarantined[0].originalStatus, 'pending');
  for (const call of [() => a.list('doc', 'actor', options(A)),
    () => a.loadCleanState('doc', 'actor', options(A)),
    () => a.readLocalState('doc', 'actor', 0, options(A)),
    () => a.compactAccepted('doc', 'actor', accepted.update, true, 0, options(A)),
    () => a.deleteScope('doc', 'actor', 0, options(A)),
    () => a.delete(first.key, 0, options(A))]) await assert.rejects(call(), retired);
  await retire(a);
  await assert.rejects(a.retireScope('doc', 'actor', 0, { ...options(A), replacementGenerationId: A }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  await a.put(row(B)); assert.equal((await a.list('doc', 'actor', options(B))).length, 1);
});

for (const acceptedFirst of [true, false]) test(`late accepted receipt is preserved in retired scope, acceptance first=${acceptedFirst}`, async t => {
  const { a, b } = await stores(t); const first = row(A); await a.put(first);
  const result = await Promise.allSettled(acceptedFirst ? [a.settleAccepted(first), retire(b)] : [retire(b), a.settleAccepted(first)]);
  if (!acceptedFirst) { assert.equal(result[1].status, 'rejected'); assert.equal(result[1].reason.acceptedEvidenceSaved, true); }
  const saved = await b.readRetiredScope('doc', 'actor', 0, options(A));
  assert.deepEqual(saved.accepted.map(r => r.key), [first.key]);
  assert.deepEqual(saved.accepted[0].update, first.update);
  if (!acceptedFirst) assert.deepEqual(saved.quarantined.map(r => r.key), [first.key]);
  assert.deepEqual((await b.loadCleanState('doc', 'actor', options(B))).records, []);
});

for (const version of [1, 3]) test(`v${version} upgrade preserves legacy records without adopting them`, async t => {
  const indexedDb = new IDBFactory(); const initial = indexedDb.open(DB, version); const first = row(null);
  initial.onupgradeneeded = () => {
    const db = initial.result;
    for (const name of version === 1 ? ['pending', 'accepted'] : ['pending', 'accepted', 'quarantined']) {
      const store = db.createObjectStore(name, { keyPath: 'key' }); store.createIndex('scopeKey', 'scopeKey');
    }
    db.createObjectStore('acceptedCheckpoints', { keyPath: 'scopeKey' });
    if (version === 3) db.createObjectStore('documentIncarnations', { keyPath: 'documentId' });
    initial.transaction.objectStore('pending').put({ ...first, scopeKey: 'doc\0actor' });
  };
  const old = await request(initial); old.close();
  const store = await createAnnotationOutbox({ indexedDb }); t.after(() => store.close());
  assert.deepEqual((await store.list('doc', 'actor'))[0], { ...first, scopeKey: 'doc\0actor' });
  assert.deepEqual(await store.list('doc', 'actor', options(A)), []);
  await retire(store, null);
  const saved = await store.readRetiredScope('doc', 'actor', 0);
  assert.deepEqual(saved.quarantined[0].update, first.update);
  await assert.rejects(store.list('doc', 'actor'), retired);
});

test('retirement evidence survives reopen; whole-document deletion fences every generation', async t => {
  const { a, b, indexedDb } = await stores(t); await a.put(row(A)); await a.put(row(B)); await retire(a); await a.close();
  const fresh = await createAnnotationOutbox({ indexedDb }); t.after(() => fresh.close());
  assert.equal((await fresh.readRetiredScope('doc', 'actor', 0, options(A))).quarantined.length, 1);
  await b.deleteDocument('doc');
  for (const pdfGenerationId of [null, A, B]) {
    await assert.rejects(fresh.put(row(pdfGenerationId)), { code: 'ANNOTATION_DOCUMENT_DELETED' });
    await assert.rejects(fresh.settleAccepted(row(pdfGenerationId)), { code: 'ANNOTATION_DOCUMENT_DELETED' });
    assert.deepEqual(await fresh.list('doc', 'actor', options(pdfGenerationId)), []);
  }
  await assert.rejects(fresh.readRetiredScope('doc', 'actor', 0, options(A)), { code: 'ANNOTATION_DOCUMENT_DELETED' });
});

test('legacy caller cannot overwrite a generated key or mix keyed delete scopes', async t => {
  const { a } = await stores(t); const first = row(A), second = row(B), legacy = row(null);
  await a.put(first); await a.put(second); await a.put(legacy);
  for (const method of ['put', 'settleAccepted']) await assert.rejects(
    a[method]({ ...legacy, key: first.key }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  await assert.rejects(a.deleteMany([first.key, second.key], 0, options(A)), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  await assert.rejects(a.put({ ...first, dependsOn: [second.key] }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  await assert.rejects(a.delete(first.key, 0, { ...options(A), actorUserId: 'other' }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  for (const generation of [A, B, null]) assert.equal((await a.list('doc', 'actor', options(generation))).length, 1);
});

for (const compactFirst of [true, false]) test(`compaction versus retirement is atomic, compaction first=${compactFirst}`, async t => {
  const { a, b } = await stores(t); const first = row(A); await a.put(first); await a.settleAccepted({ ...first, seq: 1 });
  const compact = () => a.compactAccepted('doc', 'actor', first.update, true, 0, options(A));
  const results = await Promise.allSettled(compactFirst ? [compact(), retire(b)] : [retire(b), compact()]);
  const saved = await b.readRetiredScope('doc', 'actor', 0, options(A));
  if (compactFirst) { assert.deepEqual(saved.acceptedKeys, [first.key]); assert.deepEqual(saved.accepted, []); }
  else { assert.equal(results[1].reason.code, 'ANNOTATION_PDF_GENERATION_RETIRED'); assert.deepEqual(saved.accepted.map(r => r.key), [first.key]); }
  assert.deepEqual((await b.loadCleanState('doc', 'actor', options(B))).acceptedKeys, []);
});

test('late puts and acceptance cannot change quarantined bytes, dependencies or first status', async t => {
  const { a, b } = await stores(t); const first = { ...row(A), status: 'ambiguous', dependsOn: [] };
  await a.put(first); await retire(b);
  await assert.rejects(a.put({ ...first, status: 'pending' }), e => retired(e) && e.evidenceSaved);
  await assert.rejects(a.settleAccepted(first), e => retired(e) && e.acceptedEvidenceSaved);
  const before = await b.readRetiredScope('doc', 'actor', 0, options(A));
  assert.equal(before.quarantined[0].originalStatus, 'ambiguous');
  for (const method of ['put', 'settleAccepted']) await assert.rejects(
    a[method]({ ...first, update: row(B).update }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  await assert.rejects(a.settleAccepted(row(A, 7)), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  assert.deepEqual(await b.readRetiredScope('doc', 'actor', 0, options(A)), before);
});

test('retired scope keeps its compacted acceptance receipt without reintroducing supplied bytes', async t => {
  const { a, b } = await stores(t); const first = row(A); await a.put(first); await a.settleAccepted({ ...first, seq: 1 });
  await a.compactAccepted('doc', 'actor', first.update, true, 0, options(A)); await retire(b);
  const before = await b.readRetiredScope('doc', 'actor', 0, options(A));
  await assert.rejects(a.settleAccepted(first), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  assert.deepEqual(await b.readRetiredScope('doc', 'actor', 0, options(A)), before);
});

test('all destructive scope methods reject retirement, while unrelated actors survive', async t => {
  const { a, b } = await stores(t); const first = row(A), other = { ...row(A), actorUserId: 'other' };
  other.key = annotationOutboxRecordKey(other); await a.put(first); await a.put(other); await retire(b);
  const before = await b.readRetiredScope('doc', 'actor', 0, options(A));
  for (const call of [() => a.deleteMany([first.key], 0, options(A)),
    () => a.markRejected([first.key], 0, options(A)),
    () => a.deleteFromOrdinal('doc', 'actor', 'writer', 0, 0, options(A)),
    () => a.listQuarantined('doc', 'actor', options(A)),
    () => a.readLocalStateFresh('doc', 'actor', 0, options(A))]) await assert.rejects(call(), retired);
  assert.deepEqual(await b.readRetiredScope('doc', 'actor', 0, options(A)), before);
  assert.deepEqual((await b.list('doc', 'other', { pdfGenerationId: A })).map(r => r.key), [other.key]);
});

test('actual IndexedDB abort rolls back the retirement marker and every moved row', async t => {
  const base = new IDBFactory(); let abortNext = false;
  const indexedDb = { open(...args) {
    const opened = base.open(...args);
    opened.addEventListener('success', () => {
      const db = opened.result, transaction = db.transaction.bind(db);
      db.transaction = (...txArgs) => {
        const tx = transaction(...txArgs), objectStore = tx.objectStore.bind(tx);
        tx.objectStore = name => {
          const store = objectStore(name), put = store.put.bind(store);
          if (name === 'retiredScopes') store.put = value => {
            const req = put(value);
            if (abortNext) { abortNext = false; req.addEventListener('success', () => tx.abort()); }
            return req;
          };
          return store;
        };
        return tx;
      };
    });
    return opened;
  } };
  const a = await createAnnotationOutbox({ indexedDb }); const b = await createAnnotationOutbox({ indexedDb });
  t.after(async () => { await a.close(); await b.close(); });
  const first = row(A); await a.put(first); const before = await a.readLocalState('doc', 'actor', 0, options(A));
  abortNext = true; await assert.rejects(retire(b));
  assert.deepEqual(await a.readLocalState('doc', 'actor', 0, options(A)), before);
  await assert.rejects(a.readRetiredScope('doc', 'actor', 0, options(A)), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  await retire(b); assert.equal((await a.readRetiredScope('doc', 'actor', 0, options(A))).quarantined.length, 1);
});

test('blocked upgrade rejects promptly, closes late result and allows a fresh v4 open', async t => {
  const base = new IDBFactory(); const old = await request(base.open(DB, 3)); let blockedRequest;
  const indexedDb = { open(...args) { blockedRequest = base.open(...args); return blockedRequest; } };
  await assert.rejects(createAnnotationOutbox({ indexedDb, timeoutMs: 100 }), { code: 'IDB_BLOCKED' });
  const late = request(blockedRequest); old.close(); const lateDb = await late;
  assert.throws(() => lateDb.transaction('pending'), { name: 'InvalidStateError' }, 'production handler closes the late result');
  const fresh = await createAnnotationOutbox({ indexedDb: base }); t.after(() => fresh.close());
  await fresh.put(row(A)); assert.equal((await fresh.list('doc', 'actor', options(A))).length, 1);
});

test('versionchange closes an open outbox connection and old version clients fail closed', async t => {
  const base = new IDBFactory(); const current = await createAnnotationOutbox({ indexedDb: base });
  t.after(() => current.close());
  const upgrade = await request(base.open(DB, 5)); upgrade.close();
  await assert.rejects(current.list('doc', 'actor'), { name: 'InvalidStateError' });
  await assert.rejects(createAnnotationOutbox({ indexedDb: base }), { name: 'VersionError' });
});

test('generated destructive calls require and atomically verify the current document incarnation', async t => {
  const { a, b } = await stores(t); const old = row(A); await a.put(old); await b.deleteDocument('doc');
  const current = row(A, 1, 1); await b.put(current);
  for (const expected of [undefined, null, '1', -1]) {
    for (const call of [() => a.delete(current.key, expected, options(A)),
      () => a.deleteMany([current.key], expected, options(A)),
      () => a.markRejected([current.key], expected, options(A)),
      () => a.deleteFromOrdinal('doc', 'actor', 'writer', 0, expected, options(A)),
      () => a.deleteScope('doc', 'actor', expected, options(A))]) {
      await assert.rejects(call(), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
    }
  }
  for (const call of [() => a.delete(current.key, 0, options(A)),
    () => a.deleteMany([current.key], 0, options(A)),
    () => a.markRejected([current.key], 0, options(A)),
    () => a.deleteFromOrdinal('doc', 'actor', 'writer', 0, 0, options(A)),
    () => a.deleteScope('doc', 'actor', 0, options(A))]) {
    await assert.rejects(call(), { code: 'ANNOTATION_DOCUMENT_DELETED' });
    assert.deepEqual((await b.list('doc', 'actor', options(A))).map(r => r.key), [current.key]);
  }
  await b.delete(current.key, 1, options(A)); assert.deepEqual(await b.list('doc', 'actor', options(A)), []);
});

test('generated recovery prefix may be enriched once but neither it nor ordinal can be replaced', async t => {
  const { a } = await stores(t); const first = row(A); await a.put(first);
  const enriched = { ...first, checkpointUpdate: first.update };
  await a.put(enriched);
  for (const record of [{ ...enriched, ordinal: 7 }, { ...enriched, checkpointUpdate: row(B).update }, first]) {
    for (const method of ['put', 'settleAccepted']) await assert.rejects(a[method](record), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  }
  const second = row(A, 2); await a.put(second);
  await a.settleAccepted({ ...second, checkpointUpdate: second.update, seq: 9 });
  const before = await a.loadCleanState('doc', 'actor', options(A));
  await a.settleAccepted({ ...second, checkpointUpdate: second.update, seq: 9 });
  await assert.rejects(a.settleAccepted({ ...second, checkpointUpdate: second.update, seq: 10 }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  assert.deepEqual(await a.loadCleanState('doc', 'actor', options(A)), before);
});

for (const isRetired of [false, true]) test(`compacted keys cannot be republished with different bytes, retired=${isRetired}`, async t => {
  const { a, b } = await stores(t); const first = row(A); await a.put(first); await a.settleAccepted({ ...first, seq: 1 });
  await a.compactAccepted('doc', 'actor', first.update, true, 0, options(A));
  if (isRetired) await retire(b);
  const read = () => isRetired ? b.readRetiredScope('doc', 'actor', 0, options(A)) : b.readLocalState('doc', 'actor', 0, options(A));
  const before = await read();
  for (const update of [first.update, row(B).update]) await assert.rejects(a.put({ ...first, update }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  // Even a forged late acceptance must not add its bytes to the frozen checkpoint.
  await assert.rejects(a.settleAccepted({ ...first, update: row(B).update }), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  assert.deepEqual(await read(), before);
});

test('retired legacy compacted keys cannot manufacture quarantine bytes; active legacy behavior is unchanged', async t => {
  const { a, b } = await stores(t); const first = row(null), changed = { ...first, update: row(B).update };
  await a.put(first); await a.settleAccepted(first);
  await a.compactAccepted('doc', 'actor', first.update, true, 0);
  // The optional generation feature must not change an active legacy namespace.
  await a.put(changed); assert.deepEqual((await a.list('doc', 'actor'))[0].update, changed.update);
  await a.delete(changed.key, 0);
  await retire(b, null);
  const before = await b.readRetiredScope('doc', 'actor', 0);
  assert.deepEqual(before.acceptedKeys, [first.key]); assert.deepEqual(before.quarantined, []);
  await assert.rejects(a.put(changed), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  assert.deepEqual(await b.readRetiredScope('doc', 'actor', 0), before);
});
