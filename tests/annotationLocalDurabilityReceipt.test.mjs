import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createAnnotationOutbox, createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc, purgeAnnotationDoc } from '../src/services/annotationDocSync.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function backend() {
  const gate = deferred();
  const entered = deferred();
  const state = { gate, entered, hold: true, calls: 0, readCalls: 0, seq: 0 };
  return Object.assign(state, {
    from(table) {
      const result = { data: table === 'annotation_updates' ? [] : null, error: null };
      const builder = {};
      for (const name of ['select', 'eq', 'gt', 'order', 'limit']) builder[name] = () => builder;
      builder.maybeSingle = async () => { state.readCalls++; return result; };
      builder.then = (resolve) => { state.readCalls++; resolve(result); };
      return builder;
    },
    async rpc(name) {
      state.calls++;
      if (name === 'append_annotation_update') {
        entered.resolve();
        if (state.hold) await gate.promise;
        if (state.appendError) return { data: null, error: state.appendError };
        return { data: { seq: ++state.seq }, error: null };
      }
      assert.equal(name, 'store_annotation_snapshot');
      if (state.holdSnapshots) await gate.promise;
      return { data: { accepted: true }, error: null };
    },
  });
}

async function open(t, { indexedDb = new IDBFactory(), outbox = null, documentId = crypto.randomUUID() } = {}) {
  const store = outbox || await createAnnotationOutbox({ indexedDb });
  const cloud = backend();
  const handle = await openAnnotationDoc({
    documentId, actorUserId: 'actor-a', supabase: cloud, outboxStore: store,
    enableLocal: false, enableRealtime: false, doc: new Y.Doc(),
    snapshotRetryDelayMs: 0,
  });
  t.after(async () => {
    cloud.hold = false;
    cloud.gate.resolve();
    await handle.destroy();
  });
  return { handle, store, cloud, indexedDb };
}

function recover(record) {
  const doc = new Y.Doc();
  for (const update of [record.checkpointUpdate, ...record.accepted.map((row) => row.update),
    ...record.pending.filter((row) => !row.publishAfterAcceptance).map((row) => row.update)].filter(Boolean)) {
    Y.applyUpdate(doc, update);
  }
  return doc;
}

function instrumentedIndexedDb() {
  const factory = new IDBFactory();
  const state = { abortStore: null, quotaStore: null, writeCount: 0 };
  return Object.assign(state, {
    open(...args) {
      const request = factory.open(...args);
      request.addEventListener('success', () => {
        const db = request.result;
        const transaction = db.transaction.bind(db);
        db.transaction = (...transactionArgs) => {
          const tx = transaction(...transactionArgs);
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = (name) => {
            const store = objectStore(name);
            const put = store.put.bind(store);
            store.put = (...putArgs) => {
              state.writeCount++;
              if (state.quotaStore === name) throw new DOMException('storage full', 'QuotaExceededError');
              const write = put(...putArgs);
              if (state.abortStore === name) {
                write.addEventListener('success', () => tx.abort(), { once: true });
              }
              return write;
            };
            return store;
          };
          return tx;
        };
      }, { once: true });
      return request;
    },
  });
}

test('outbox explicitly distinguishes persistent IndexedDB from memory fallback', async () => {
  const persistent = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  assert.equal(persistent.storageKind, 'indexeddb');
  assert.equal(createMemoryAnnotationOutbox().storageKind, 'memory');
  assert.equal((await createAnnotationOutbox({ indexedDb: null })).storageKind, 'memory');
  await persistent.close();
});

test('a local receipt waits for IndexedDB but not a hung backend and is recoverable through a new connection', { timeout: 3000 }, async (t) => {
  const { handle, store, cloud, indexedDb } = await open(t);
  handle.applyByPage({ 1: { objects: [{ type: 'rect', data: { id: 'mark' }, left: 12 }] } });
  handle.setMeta('spaces', [{ id: 'room', name: 'Room' }]);
  handle.applySurveyMarkers({ area: { id: 'area', label: 'Site' } });
  await cloud.entered.promise;
  const readsBefore = cloud.readCalls;
  const callsBefore = cloud.calls;
  const receipt = await handle.flushLocalDurability();
  assert.equal(receipt.locallyDurable, true);
  assert.equal(receipt.documentId, handle.documentId);
  assert.equal(receipt.actorUserId, 'actor-a');
  assert.equal(receipt.writerId, handle.writerId);
  assert.equal(receipt.revision, handle.getLocalRevision());
  assert.equal(cloud.readCalls, readsBefore);
  assert.equal(cloud.calls, callsBefore, 'receipt did not start a cloud snapshot or extra request');
  const reopened = await createAnnotationOutbox({ indexedDb });
  const saved = await reopened.readLocalState(handle.documentId, 'actor-a', receipt.incarnation);
  assert.ok(saved.pending.length >= 3);
  const cold = recover(saved);
  assert.deepEqual(cold.getMap('annoMeta').get('spaces'), [{ id: 'room', name: 'Room' }]);
  assert.equal(cold.getMap('annotations').size, 1);
  assert.equal(cold.getMap('surveyMarkers').size, 1);
  cold.destroy();
  await reopened.close();
  assert.equal(store.storageKind, 'indexeddb');
});

test('memory fallback never issues a local durability receipt', async (t) => {
  const { handle } = await open(t, { outbox: createMemoryAnnotationOutbox() });
  await assert.rejects(handle.flushLocalDurability(), { code: 'ANNOTATION_LOCAL_STORAGE_UNAVAILABLE' });
});

test('synchronous receipt validation rejects copied receipts, wrong scope, and later changes', async (t) => {
  const { handle } = await open(t);
  const receipt = await handle.flushLocalDurability();
  assert.equal(handle.isLocalReceiptCurrent(receipt), true);
  assert.equal(handle.isLocalReceiptCurrent({ ...receipt }), false);
  assert.equal(handle.isLocalReceiptCurrent({ ...receipt, actorUserId: 'actor-b' }), false);
  handle.setMeta('spaces', [{ id: 'new' }]);
  assert.equal(handle.isLocalReceiptCurrent(receipt), false);
});

test('a retired receipt stays valid after close but not a later shared-document mutation', async (t) => {
  const { handle } = await open(t);
  await handle.destroy();
  const receipt = await handle.getLocalCloseReceipt();
  assert.equal(handle.isLocalReceiptCurrent(receipt), true);
  handle.doc.transact(() => handle.doc.getMap('annoMeta').set('spaces', []), 'local');
  assert.equal(handle.isLocalReceiptCurrent(receipt), false);
});

test('retired revalidation returns the same receipt through a fresh read-only connection', async (t) => {
  const indexedDb = instrumentedIndexedDb();
  const { handle, cloud } = await open(t, { indexedDb });
  await handle.destroy();
  const receipt = await handle.getLocalCloseReceipt();
  const writes = indexedDb.writeCount;
  const calls = cloud.calls + cloud.readCalls;
  cloud.auth = { getSession: () => { throw new Error('must not request auth'); } };
  assert.equal(await handle.revalidateLocalReceipt(receipt), receipt);
  assert.equal(indexedDb.writeCount, writes, 'fresh validation must not rewrite any checkpoint');
  assert.equal(cloud.calls + cloud.readCalls, calls);
  delete cloud.auth;
});

test('unchanged local receipts and clean close skip duplicate checkpoint writes but still read their proof', async (t) => {
  const indexedDb = instrumentedIndexedDb();
  const { handle, store } = await open(t, { indexedDb });
  const read = store.readLocalState.bind(store);
  let reads = 0;
  store.readLocalState = (...args) => { reads++; return read(...args); };
  await handle.flushLocalDurability();
  assert.equal(indexedDb.writeCount, 1);
  await handle.flushLocalDurability();
  assert.equal(indexedDb.writeCount, 1, 'identical accepted bytes do not write another checkpoint');
  await handle.destroy();
  assert.equal((await handle.getLocalCloseReceipt()).locallyDurable, true);
  assert.equal(indexedDb.writeCount, 1, 'clean close also reuses the exact checkpoint');
  assert.equal(reads, 3, 'each receipt still checks current persisted bytes');
});

test('unchanged exact recovery inputs reuse only the last verified reconstruction while still reading storage', async (t) => {
  const { handle, store } = await open(t);
  let reconstructed = 0;
  let reads = 0;
  const destroy = Y.Doc.prototype.destroy;
  const read = store.readLocalState.bind(store);
  Y.Doc.prototype.destroy = function () {
    if (this.guid.startsWith('local-receipt-')) reconstructed++;
    return destroy.call(this);
  };
  store.readLocalState = (...args) => { reads++; return read(...args); };
  try {
    await handle.flushLocalDurability();
    assert.equal(reconstructed, 2);
    await handle.flushLocalDurability();
    assert.equal(reconstructed, 2, 'exact captured bytes and fresh recovery inputs skip detached reconstruction');
    assert.equal(reads, 2, 'cache never skips a current storage read');
    handle.doc.transact(() => handle.doc.getMap('annoMeta').set('spaces', []), 'hydrate');
    await handle.flushLocalDurability();
    assert.equal(reconstructed, 4, 'changed document bytes require a full new proof');
    await handle.flushLocalDurability();
    assert.equal(reconstructed, 4, 'the newest proof replaces the prior cache entry');
  } finally {
    Y.Doc.prototype.destroy = destroy;
  }
});

test('changed pending metadata and pending-to-accepted moves each require a new reconstruction', async (t) => {
  const { handle, store, cloud } = await open(t);
  handle.setMeta('spaces', [{ id: 'pending' }]);
  await cloud.entered.promise;
  let reconstructed = 0;
  const destroy = Y.Doc.prototype.destroy;
  Y.Doc.prototype.destroy = function () {
    if (this.guid.startsWith('local-receipt-')) reconstructed++;
    return destroy.call(this);
  };
  try {
    const receipt = await handle.flushLocalDurability();
    assert.equal(reconstructed, 2);
    await handle.revalidateLocalReceipt(receipt);
    assert.equal(reconstructed, 2);
    const [row] = await store.list(handle.documentId, 'actor-a');
    await store.put({ ...row, status: 'ambiguous' });
    await handle.revalidateLocalReceipt(receipt);
    assert.equal(reconstructed, 4, 'pending metadata is not hidden behind equal update bytes');
    await store.settleAccepted({ ...row, status: 'accepted' });
    await handle.revalidateLocalReceipt(receipt);
    assert.equal(reconstructed, 6, 'moving exact bytes between pending and accepted invalidates the proof cache');
    await handle.revalidateLocalReceipt(receipt);
    assert.equal(reconstructed, 6, 'the new exact persisted state can then be reused');
  } finally {
    Y.Doc.prototype.destroy = destroy;
  }
});

test('replacing pending bytes under the same key cannot reuse a previously verified proof', async (t) => {
  const { handle, store, cloud } = await open(t);
  handle.setMeta('spaces', [{ id: 'original' }]);
  await cloud.entered.promise;
  const receipt = await handle.flushLocalDurability();
  await handle.revalidateLocalReceipt(receipt);
  const [row] = await store.list(handle.documentId, 'actor-a');
  const replacement = new Y.Doc();
  try {
    replacement.getMap('annoMeta').set('spaces', [{ id: 'replacement' }]);
    await store.put({ ...row, update: Y.encodeStateAsUpdate(replacement) });
    await assert.rejects(handle.revalidateLocalReceipt(receipt), { code: 'ANNOTATION_LOCAL_INCOMPLETE' });
  } finally {
    replacement.destroy();
  }
});

test('compaction still journals a new accepted key even when its update bytes match the checkpoint', async () => {
  const indexedDb = instrumentedIndexedDb();
  const store = await createAnnotationOutbox({ indexedDb });
  const doc = new Y.Doc();
  try {
    doc.getMap('annoMeta').set('spaces', [{ id: 'accepted' }]);
    const update = Y.encodeStateAsUpdate(doc);
    assert.equal(await store.compactAccepted('doc', 'actor-a', update, true, 0), true);
    const row = { key: 'accepted-key', documentId: 'doc', actorUserId: 'actor-a',
      incarnation: 0, update, status: 'accepted' };
    await store.settleAccepted(row);
    const before = indexedDb.writeCount;
    assert.equal(await store.compactAccepted('doc', 'actor-a', update, true, 0), true);
    assert.equal(indexedDb.writeCount, before + 1, 'new accepted keys require an atomic checkpoint write');
    const saved = await store.readLocalState('doc', 'actor-a', 0);
    assert.deepEqual(saved.acceptedKeys, ['accepted-key']);
    assert.deepEqual(saved.accepted, [], 'compaction still removes the now-checkpointed journal row');
    assert.equal(await store.compactAccepted('doc', 'actor-a', update, true, 0), false);
    assert.equal(indexedDb.writeCount, before + 1, 'only a subsequent exact duplicate is skipped');
    doc.getMap('annoMeta').set('spaces', [{ id: 'changed' }]);
    assert.equal(await store.compactAccepted('doc', 'actor-a', Y.encodeStateAsUpdate(doc), true, 0), true);
    assert.equal(indexedDb.writeCount, before + 2, 'changed accepted bytes still write');
    await store.deleteDocument('doc');
    await assert.rejects(store.compactAccepted('doc', 'actor-a', Y.encodeStateAsUpdate(doc), true, 0),
      { code: 'ANNOTATION_DOCUMENT_DELETED' });
  } finally {
    doc.destroy();
    await store.close();
  }
});

for (const change of ['purge', 'missing', 'replacement', 'quarantine']) {
  test(`a second connection ${change} invalidates a retired receipt on fresh validation`, async (t) => {
    const { handle, indexedDb } = await open(t);
    handle.doc.transact(() => handle.doc.getMap('annoMeta').set('spaces', [{ id: 'original' }]), 'hydrate');
    await handle.destroy();
    const receipt = await handle.getLocalCloseReceipt();
    const second = await createAnnotationOutbox({ indexedDb });
    try {
      if (change === 'purge') await second.deleteDocument(handle.documentId);
      else if (change === 'quarantine') {
        await second.put({ key: 'denied-second-context', documentId: handle.documentId,
          actorUserId: 'actor-a', incarnation: 0, status: 'pending', update: new Uint8Array([0, 0]) });
        await second.markRejected(['denied-second-context'], 0);
      } else {
        await second.deleteScope(handle.documentId, 'actor-a', 0);
        if (change === 'replacement') {
          const replacement = new Y.Doc();
          replacement.getMap('annoMeta').set('spaces', [{ id: 'different' }]);
          await second.compactAccepted(handle.documentId, 'actor-a', Y.encodeStateAsUpdate(replacement), true, 0);
          replacement.destroy();
        }
      }
      assert.equal(handle.isLocalReceiptCurrent(receipt), true, 'the external context did not change this renderer');
      await assert.rejects(handle.revalidateLocalReceipt(receipt), { code: change === 'purge'
        ? 'ANNOTATION_DOCUMENT_DELETED' : change === 'quarantine'
          ? 'ANNOTATION_LOCAL_QUARANTINED' : 'ANNOTATION_LOCAL_INCOMPLETE' });
    } finally {
      await second.close();
    }
  });
}

test('fresh validation rejects a removed database without recreating it', async (t) => {
  const { handle, indexedDb } = await open(t);
  await handle.destroy();
  const receipt = await handle.getLocalCloseReceipt();
  const [{ name }] = await indexedDb.databases();
  await new Promise((resolve, reject) => {
    const request = indexedDb.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  await assert.rejects(handle.revalidateLocalReceipt(receipt), { code: 'ANNOTATION_LOCAL_STORAGE_UNAVAILABLE' });
  assert.deepEqual(await indexedDb.databases(), []);
});

test('a shared-document mutation during retired fresh validation invalidates it', async (t) => {
  const { handle, store } = await open(t);
  await handle.destroy();
  const receipt = await handle.getLocalCloseReceipt();
  const original = store.readLocalStateFresh.bind(store);
  store.readLocalStateFresh = async (...args) => {
    const stored = await original(...args);
    handle.doc.transact(() => handle.doc.getMap('annoMeta').set('spaces', []), 'local');
    return stored;
  };
  await assert.rejects(handle.revalidateLocalReceipt(receipt), { code: 'ANNOTATION_LOCAL_RECEIPT_STALE' });
});

for (const retired of [false, true]) {
  test(`purge immediately invalidates a ${retired ? 'retired' : 'live'} receipt`, async (t) => {
    const { handle } = await open(t);
    if (retired) await handle.destroy();
    const receipt = retired ? await handle.getLocalCloseReceipt() : await handle.flushLocalDurability();
    assert.equal(handle.isLocalReceiptCurrent(receipt), true);
    const purging = purgeAnnotationDoc(handle.documentId);
    assert.equal(handle.isLocalReceiptCurrent(receipt), false, 'invalidation precedes all purge awaits');
    await purging;
  });
}

for (const failure of ['abort', 'quota']) {
  test(`a ${failure} during the real checkpoint transaction cannot issue a receipt`, async (t) => {
    const indexedDb = instrumentedIndexedDb();
    const { handle } = await open(t, { indexedDb });
    handle.doc.transact(() => handle.doc.getMap('annoMeta').set('spaces', [{ id: 'changed-accepted' }]), 'hydrate');
    indexedDb[failure === 'abort' ? 'abortStore' : 'quotaStore'] = 'acceptedCheckpoints';
    await assert.rejects(handle.flushLocalDurability());
    indexedDb.abortStore = null;
    indexedDb.quotaStore = null;
    assert.equal((await handle.flushLocalDurability()).locallyDurable, true, 'a retry can prove a committed transaction');
  });
  test(`a ${failure} during pending persistence cannot confirm optimistic bytes`, async (t) => {
    const indexedDb = instrumentedIndexedDb();
    const { handle, cloud } = await open(t, { indexedDb });
    cloud.holdSnapshots = true;
    indexedDb[failure === 'abort' ? 'abortStore' : 'quotaStore'] = 'pending';
    handle.setMeta('spaces', [{ id: 'not-stored' }]);
    await assert.rejects(handle.flushLocalDurability(), { code: 'ANNOTATION_LOCAL_INCOMPLETE' });
    indexedDb.abortStore = null;
    indexedDb.quotaStore = null;
  });
}

test('a permission denial invalidates an already issued receipt before quit confirmation', async (t) => {
  const { handle, cloud } = await open(t);
  handle.setMeta('spaces', [{ id: 'pending' }]);
  await cloud.entered.promise;
  const receipt = await handle.flushLocalDurability();
  assert.equal(handle.isLocalReceiptCurrent(receipt), true);
  cloud.appendError = { code: '42501', message: 'permission denied' };
  cloud.gate.resolve();
  await handle.drain();
  assert.equal(handle.isLocalReceiptCurrent(receipt), false);
  await assert.rejects(handle.flushLocalDurability(), { code: 'ANNOTATION_LOCAL_QUARANTINED' });
});

for (const missing of ['record', 'predecessor']) {
  test(`a missing ${missing} cannot produce a local receipt`, async (t) => {
    const { handle, store, cloud } = await open(t);
    handle.setMeta('spaces', [{ id: 'space' }]);
    await cloud.entered.promise;
    const [record] = await store.list(handle.documentId, 'actor-a');
    if (missing === 'record') await store.delete(record.key, 0);
    else await store.put({ ...record, dependsOn: ['absent-predecessor'] });
    await assert.rejects(handle.flushLocalDurability(), { code: 'ANNOTATION_LOCAL_INCOMPLETE' });
  });
}

test('quarantined pending records are kept but never used for a successful receipt', async (t) => {
  const { handle, store, cloud } = await open(t);
  handle.setMeta('spaces', [{ id: 'denied' }]);
  await cloud.entered.promise;
  const [record] = await store.list(handle.documentId, 'actor-a');
  await store.markRejected([record.key], 0);
  await assert.rejects(handle.flushLocalDurability(), { code: 'ANNOTATION_LOCAL_QUARANTINED' });
  assert.equal((await store.listQuarantined(handle.documentId, 'actor-a')).length, 1);
});

test('historical quarantine conservatively requires review even when current state is clean', async (t) => {
  const { handle, store } = await open(t);
  const old = new Y.Doc();
  old.getMap('annoMeta').set('denied', true);
  const row = { key: 'old-rejected', documentId: handle.documentId, actorUserId: 'actor-a',
    incarnation: 0, update: Y.encodeStateAsUpdate(old), status: 'pending' };
  await store.put(row);
  await store.markRejected([row.key], 0);
  await store.delete(row.key, 0);
  old.destroy();
  await assert.rejects(handle.flushLocalDurability(), { code: 'ANNOTATION_LOCAL_QUARANTINED' });
});

for (const change of ['edit', 'delete', 'remote', 'account']) {
  test(`${change} while reading the local receipt invalidates it`, async (t) => {
    const { handle, store, cloud } = await open(t);
    handle.setMeta('spaces', [{ id: 'original' }]);
    await cloud.entered.promise;
    const entered = deferred();
    const gate = deferred();
    const read = store.readLocalState.bind(store);
    store.readLocalState = async (...args) => {
      const result = await read(...args);
      entered.resolve();
      await gate.promise;
      return result;
    };
    let current = true;
    const saving = handle.flushLocalDurability({ isCurrent: () => current });
    await entered.promise;
    if (change === 'account') current = false;
    else if (change === 'remote') handle.doc.transact(() => handle.doc.getMap('annoMeta').set('remote', true), 'remote');
    else handle.setMeta('spaces', change === 'delete' ? [] : [{ id: 'new' }]);
    gate.resolve();
    await assert.rejects(saving, { code: change === 'account'
      ? 'ANNOTATION_LOCAL_SCOPE_CHANGED' : 'ANNOTATION_LOCAL_REVISION_CHANGED' });
  });
}

test('wrong actor/document and a deleted document incarnation cannot issue receipts', async (t) => {
  const { handle, store } = await open(t);
  await assert.rejects(handle.flushLocalDurability({ expectedActorUserId: 'actor-b' }), { code: 'ANNOTATION_LOCAL_SCOPE_CHANGED' });
  await assert.rejects(handle.flushLocalDurability({ expectedDocumentId: 'other' }), { code: 'ANNOTATION_LOCAL_SCOPE_CHANGED' });
  await store.deleteDocument(handle.documentId);
  await assert.rejects(handle.flushLocalDurability(), { code: 'ANNOTATION_DOCUMENT_DELETED' });
});

test('deletion after the atomic scope read still invalidates its old-incarnation receipt', async (t) => {
  const { handle, store } = await open(t);
  const original = store.readLocalState.bind(store);
  store.readLocalState = async (...args) => {
    const result = await original(...args);
    await store.deleteDocument(handle.documentId);
    return result;
  };
  await assert.rejects(handle.flushLocalDurability(), { code: 'ANNOTATION_DOCUMENT_DELETED' });
});

test('local receipt persists accepted remote state that has no local pending journal row', async (t) => {
  const { handle, store } = await open(t);
  const remote = new Y.Doc();
  remote.getMap('annoMeta').set('spaces', [{ id: 'remote-room' }]);
  // This is the same trusted origin the service uses when hydrating server bytes.
  handle.doc.transact(() => Y.applyUpdate(handle.doc, Y.encodeStateAsUpdate(remote)), 'hydrate');
  remote.destroy();
  assert.equal((await store.list(handle.documentId, 'actor-a')).length, 0);
  const receipt = await handle.flushLocalDurability();
  const recovered = recover(await store.readLocalState(handle.documentId, 'actor-a', receipt.incarnation));
  assert.deepEqual(recovered.getMap('annoMeta').get('spaces'), [{ id: 'remote-room' }]);
  recovered.destroy();
});

test('a delete-only local update survives receipt and fresh recovery', async (t) => {
  const { handle, store, cloud } = await open(t);
  cloud.hold = false;
  handle.setMeta('spaces', [{ id: 'removed-room' }]);
  await handle.drain();
  cloud.hold = true;
  handle.doc.transact(() => handle.doc.getMap('annoMeta').delete('spaces'), 'local');
  const receipt = await handle.flushLocalDurability();
  const saved = await store.readLocalState(handle.documentId, 'actor-a', receipt.incarnation);
  const recovered = recover(saved);
  assert.equal(recovered.getMap('annoMeta').has('spaces'), false);
  assert.ok(saved.pending.some((row) => Y.decodeUpdate(row.update).ds.clients.size > 0));
  recovered.destroy();
});

test('a local receipt never asks a blocked auth transport for a session', async (t) => {
  const { handle, cloud } = await open(t);
  let calls = 0;
  cloud.auth = { getSession: () => { calls++; return new Promise(() => {}); } };
  assert.equal((await handle.flushLocalDurability()).locallyDurable, true);
  assert.equal(calls, 0);
  delete cloud.auth;
});

test('close exposes its local receipt immediately while backend teardown stays blocked and seals edits', { timeout: 3000 }, async (t) => {
  const { handle, cloud } = await open(t);
  handle.setMeta('spaces', [{ id: 'before-close' }]);
  await cloud.entered.promise;
  let closed = false;
  const closing = handle.destroy();
  closing.then(() => { closed = true; });
  const local = handle.getLocalCloseReceipt();
  assert.ok(local instanceof Promise);
  assert.equal(handle.destroy(), closing);
  assert.equal(handle.getLocalCloseReceipt(), local);
  assert.throws(() => handle.setMeta('spaces', []), { code: 'ANNOTATION_HANDLE_CLOSED' });
  assert.equal((await local).locallyDurable, true);
  assert.equal(closed, false, 'local receipt did not wait for the pending cloud append');
  cloud.hold = false;
  cloud.gate.resolve();
  await closing;
});
