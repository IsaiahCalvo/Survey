import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as Y from 'yjs';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexeddbPersistence, storeState } from 'y-indexeddb';
import { getLegacyYDocScopeKey } from '../src/lib/collab/legacyYDocScope.js';
import { appendLegacyYDocCloseSnapshot, verifyLegacyYDocCloseSnapshot } from '../src/lib/collab/legacyYDocCloseProof.js';

function globals(t, factory) {
  for (const [key, value] of Object.entries({ indexedDB: factory, IDBKeyRange })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
}
const complete = tx => new Promise((resolve, reject) => {
  tx.addEventListener('complete', resolve, { once: true });
  tx.addEventListener('abort', () => reject(tx.error || new Error('aborted')), { once: true });
});
async function open(factory, name) {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('updates', { autoIncrement: true });
      request.result.createObjectStore('custom');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function records(db) {
  const tx = db.transaction(['updates', 'custom'], 'readonly');
  const done = complete(tx);
  const updates = tx.objectStore('updates').getAll();
  const custom = tx.objectStore('custom').getAll();
  await done;
  return { updates: updates.result, custom: custom.result };
}
async function setup(t) {
  const documentId = 'close-doc'; const actorUserId = 'close-actor';
  const scopeKey = getLegacyYDocScopeKey(documentId, actorUserId);
  const factory = new IDBFactory();
  globals(t, factory);
  const db = await open(factory, scopeKey);
  const ydoc = new Y.Doc({ guid: scopeKey });
  const source = new Y.Doc();
  source.getMap('custom-root').set('last-edit', 'latest');
  t.after(() => { db.close(); ydoc.destroy(); source.destroy(); });
  return { factory, source, scopeKey, args: { ydoc, documentId, actorUserId,
    snapshot: Y.encodeStateAsUpdate(source), db, timeoutMs: 1000 } };
}

test('proof appends owned exact bytes, preserves existing records and cold-restores arbitrary roots', async t => {
  const { args, source, factory, scopeKey } = await setup(t);
  const seed = args.db.transaction(['updates', 'custom'], 'readwrite');
  seed.objectStore('updates').add(new Uint8Array([0, 0]));
  seed.objectStore('custom').put({ opaque: new Uint8Array([1, 7]) }, 'retain');
  await complete(seed);
  const expected = new Uint8Array(args.snapshot);
  const saving = appendLegacyYDocCloseSnapshot(args);
  args.snapshot.fill(0);
  const receipt = await saving;
  assert.equal(receipt.locallyDurable, true);
  assert.equal(receipt.scopeKey, scopeKey);
  assert.deepEqual(receipt.update, expected);
  assert.deepEqual(args.ydoc.getMap('custom-root').toJSON(), source.getMap('custom-root').toJSON());
  receipt.update.fill(0);
  const saved = await records(args.db);
  assert.deepEqual(saved.updates, [new Uint8Array([0, 0]), expected]);
  assert.deepEqual(saved.custom, [{ opaque: new Uint8Array([1, 7]) }]);
  args.db.close();
  const cold = new Y.Doc({ guid: scopeKey });
  const persistence = new IndexeddbPersistence(scopeKey, cold);
  await persistence.whenSynced;
  assert.equal(cold.getMap('custom-root').get('last-edit'), 'latest');
  await persistence.destroy(); cold.destroy();
  assert.deepEqual((await factory.databases()).map(row => row.name), [scopeKey]);
});

test('request success followed by transaction abort cannot acknowledge a save', async t => {
  const { args } = await setup(t);
  const original = args.db.transaction.bind(args.db);
  args.db.transaction = (...params) => {
    const tx = original(...params);
    const store = tx.objectStore('updates');
    const add = store.add.bind(store);
    store.add = (...values) => {
      const request = add(...values);
      request.addEventListener('success', () => tx.abort(), { once: true });
      return request;
    };
    return tx;
  };
  await assert.rejects(appendLegacyYDocCloseSnapshot(args), { code: 'LEGACY_CLOSE_STORAGE_FAILED' });
  args.db.transaction = original;
  assert.equal((await records(args.db)).updates.length, 0);
  assert.equal(args.ydoc.getMap('custom-root').get('last-edit'), 'latest', 'failed disk save must not roll back merged edits');
});

test('wrong actor, database, document, destroyed doc and invalid bytes reject before mutation or writes', async t => {
  const { args, scopeKey } = await setup(t);
  for (const changed of [
    { actorUserId: 'other' }, { documentId: 'other' },
    { db: { name: `${scopeKey}:other`, transaction: () => assert.fail('must not transact') } },
    { snapshot: new Uint8Array([255]) }, { snapshot: [0, 0] },
  ]) await assert.rejects(appendLegacyYDocCloseSnapshot({ ...args, ...changed }));
  assert.equal(args.ydoc.getMap('custom-root').size, 0);
  assert.equal((await records(args.db)).updates.length, 0);
  args.ydoc.destroy();
  await assert.rejects(appendLegacyYDocCloseSnapshot(args), { code: 'LEGACY_CLOSE_STALE' });
});

test('already canceled or stale scope rejects without applying the snapshot', async t => {
  const { args } = await setup(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(appendLegacyYDocCloseSnapshot({ ...args, signal: controller.signal }), { code: 'LEGACY_CLOSE_ABORTED' });
  await assert.rejects(appendLegacyYDocCloseSnapshot({ ...args, isCurrent: () => false }), { code: 'LEGACY_CLOSE_STALE' });
  assert.equal(args.ydoc.getMap('custom-root').size, 0);
  assert.equal((await records(args.db)).updates.length, 0);
});

test('scope retirement caused synchronously by apply rejects before explicit append', async t => {
  const { args } = await setup(t);
  let current = true;
  args.ydoc.on('update', () => { current = false; });
  await assert.rejects(appendLegacyYDocCloseSnapshot({ ...args, isCurrent: () => current }), { code: 'LEGACY_CLOSE_STALE' });
  assert.equal((await records(args.db)).updates.length, 0);
});

test('a queued write times out boundedly and cannot commit later', async t => {
  const { args } = await setup(t);
  const blocker = args.db.transaction('updates', 'readwrite');
  let keepAlive = true;
  const spin = () => { blocker.objectStore('updates').get(1).onsuccess = () => { if (keepAlive) spin(); }; };
  spin();
  const blockerDone = complete(blocker);
  try {
    await assert.rejects(appendLegacyYDocCloseSnapshot({ ...args, timeoutMs: 20 }), { code: 'LEGACY_CLOSE_TIMEOUT' });
  } finally { keepAlive = false; await blockerDone; }
  assert.equal((await records(args.db)).updates.length, 0);
});

test('cancel after request success prevents acknowledgment and rolls back the transaction', async t => {
  const { args } = await setup(t);
  const controller = new AbortController();
  const original = args.db.transaction.bind(args.db);
  args.db.transaction = (...params) => {
    const tx = original(...params);
    const store = tx.objectStore('updates');
    const add = store.add.bind(store);
    store.add = (...values) => {
      const request = add(...values);
      request.addEventListener('success', () => controller.abort(), { once: true });
      return request;
    };
    return tx;
  };
  await assert.rejects(appendLegacyYDocCloseSnapshot({ ...args, signal: controller.signal }), { code: 'LEGACY_CLOSE_ABORTED' });
  args.db.transaction = original;
  assert.equal((await records(args.db)).updates.length, 0);
});

test('scope change at transaction completion rejects even though bytes reached disk', async t => {
  const { args } = await setup(t);
  let current = true;
  const original = args.db.transaction.bind(args.db);
  args.db.transaction = (...params) => {
    const tx = original(...params);
    tx.addEventListener('complete', () => { current = false; }, { once: true });
    return tx;
  };
  await assert.rejects(appendLegacyYDocCloseSnapshot({ ...args, isCurrent: () => current }), { code: 'LEGACY_CLOSE_STALE' });
  args.db.transaction = original;
  assert.equal((await records(args.db)).updates.length, 1);
});

test('late transaction completion after deadline cannot turn failure into a receipt', async t => {
  const { args } = await setup(t);
  const original = args.db.transaction.bind(args.db);
  let deliverComplete;
  let actualComplete;
  args.db.transaction = (...params) => {
    const tx = original(...params);
    const listen = tx.addEventListener.bind(tx);
    actualComplete = new Promise(resolve => listen('complete', resolve, { once: true }));
    tx.addEventListener = (name, callback, options) => {
      if (name === 'complete') deliverComplete = () => callback(new Event('complete'));
      else listen(name, callback, options);
    };
    return tx;
  };
  let acknowledgments = 0;
  const result = appendLegacyYDocCloseSnapshot({ ...args, timeoutMs: 20 })
    .then(receipt => { acknowledgments++; return receipt; });
  await assert.rejects(result, { code: 'LEGACY_CLOSE_TIMEOUT' });
  await actualComplete;
  deliverComplete();
  await Promise.resolve();
  assert.equal(acknowledgments, 0);
  args.db.transaction = original;
  assert.equal((await records(args.db)).updates.length, 1, 'a completed transaction cannot be rolled back, but still gets no late receipt');
});

test('destroy while write is queued aborts promptly and cannot append later', async t => {
  const { args } = await setup(t);
  const blocker = args.db.transaction('updates', 'readwrite');
  let keepAlive = true;
  const spin = () => { blocker.objectStore('updates').get(1).onsuccess = () => { if (keepAlive) spin(); }; };
  spin();
  const blockerDone = complete(blocker);
  const result = appendLegacyYDocCloseSnapshot(args);
  args.ydoc.destroy();
  try { await assert.rejects(result, { code: 'LEGACY_CLOSE_STALE' }); }
  finally { keepAlive = false; await blockerDone; }
  assert.equal((await records(args.db)).updates.length, 0);
});

test('closed connection fails explicitly and a fresh retry can persist the retained snapshot', async t => {
  const { args, factory, scopeKey } = await setup(t);
  args.db.close();
  await assert.rejects(appendLegacyYDocCloseSnapshot(args), { code: 'LEGACY_CLOSE_STORAGE_FAILED' });
  assert.equal(args.ydoc.getMap('custom-root').get('last-edit'), 'latest');
  const db = await open(factory, scopeKey);
  try {
    const receipt = await appendLegacyYDocCloseSnapshot({ ...args, db });
    assert.equal(receipt.locallyDurable, true);
    assert.deepEqual((await records(db)).updates, [args.snapshot]);
  } finally { db.close(); }
});

test('successful save removes cancellation listeners and does not react to later abort', async t => {
  const { args } = await setup(t);
  const controller = new AbortController();
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  const listeners = new Set();
  controller.signal.addEventListener = (type, listener, options) => { listeners.add(listener); add(type, listener, options); };
  controller.signal.removeEventListener = (type, listener, options) => { listeners.delete(listener); remove(type, listener, options); };
  const receipt = await appendLegacyYDocCloseSnapshot({ ...args, signal: controller.signal });
  assert.equal(listeners.size, 0);
  controller.abort();
  assert.equal(receipt.locallyDurable, true);
  assert.equal((await records(args.db)).updates.length, 1);
});

test('real running y-indexeddb compaction preserves pending structs and delete-only close bytes', async t => {
  const { args, scopeKey } = await setup(t);
  const live = new IndexeddbPersistence(scopeKey, args.ydoc);
  await live.whenSynced;
  t.after(async () => { await live.destroy(); });
  const pending = new Y.Doc(); const writer = new Y.Doc(); const deleter = new Y.Doc();
  t.after(() => { pending.destroy(); writer.destroy(); deleter.destroy(); });
  const updates = []; writer.on('update', update => updates.push(update));
  writer.getMap('pending-root').set('base', 1);
  writer.getMap('pending-root').set('tail', 2);
  const deletes = []; deleter.on('update', update => deletes.push(update));
  deleter.getMap('deleted-root').set('gone', 1);
  deleter.getMap('deleted-root').delete('gone');
  Y.applyUpdate(pending, updates[1]); Y.applyUpdate(pending, deletes[1]);
  assert.ok(pending.store.pendingStructs); assert.ok(pending.store.pendingDs);
  const compaction = storeState(live, true); // starts a real transaction before close append
  await appendLegacyYDocCloseSnapshot({ ...args, db: live.db, snapshot: Y.encodeStateAsUpdate(pending) });
  await compaction;
  assert.ok(args.ydoc.store.pendingStructs); assert.ok(args.ydoc.store.pendingDs);
  await storeState(live, true); // later compaction must not discard the pending evidence either
  // Queue a read behind compaction's real readwrite transaction, not its early-returning promise.
  await records(live.db);
  await live.destroy();
  const cold = new Y.Doc({ guid: scopeKey });
  const reloaded = new IndexeddbPersistence(scopeKey, cold);
  await reloaded.whenSynced;
  assert.ok(cold.store.pendingStructs); assert.ok(cold.store.pendingDs);
  Y.applyUpdate(cold, updates[0]); Y.applyUpdate(cold, deletes[0]);
  assert.equal(cold.getMap('pending-root').get('tail'), 2);
  assert.equal(cold.getMap('deleted-root').has('gone'), false);
  await reloaded.destroy(); cold.destroy();
});

test('fresh verification covers a compacted superset without changing source bytes or live doc', async t => {
  const { args, factory } = await setup(t);
  await appendLegacyYDocCloseSnapshot(args);
  args.ydoc.getMap('extra-root').set('later', 2);
  const live = new IndexeddbPersistence(args.db.name, args.ydoc);
  await live.whenSynced;
  await storeState(live, true);
  const before = await records(live.db);
  await live.destroy();
  const liveBytes = Y.encodeStateAsUpdate(args.ydoc);
  const receipt = await verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory });
  assert.equal(receipt.locallyDurable, true);
  assert.deepEqual(receipt.update, args.snapshot);
  receipt.update.fill(0);
  assert.deepEqual(await records(args.db), before);
  assert.deepEqual(Y.encodeStateAsUpdate(args.ydoc), liveBytes);
});

test('database deleted after a prior acknowledgment fails verification without recreation', async t => {
  const { args, factory, scopeKey } = await setup(t);
  await appendLegacyYDocCloseSnapshot(args);
  args.db.close();
  await new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(scopeKey);
    request.onsuccess = resolve; request.onerror = () => reject(request.error);
  });
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory }), { code: 'LEGACY_CLOSE_INCOMPLETE' });
  assert.deepEqual(await factory.databases(), []);
});

test('missing update store and corrupt or opaque records fail without source writes', async t => {
  const { args, factory } = await setup(t);
  const bad = args.db.transaction('updates', 'readwrite');
  bad.objectStore('updates').add({ opaque: new Uint8Array([1]) });
  await complete(bad);
  const before = await records(args.db);
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory }), { code: 'LEGACY_CLOSE_INVALID_UPDATE' });
  assert.deepEqual(await records(args.db), before);
  const corrupt = args.db.transaction('updates', 'readwrite');
  corrupt.objectStore('updates').put(new Uint8Array([255]), 1);
  await complete(corrupt);
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory }), { code: 'LEGACY_CLOSE_INVALID_UPDATE' });
  args.db.close();
  const upgrade = factory.open(args.db.name, 2);
  upgrade.onupgradeneeded = () => upgrade.result.deleteObjectStore('updates');
  const changed = await new Promise(resolve => { upgrade.onsuccess = () => resolve(upgrade.result); });
  changed.close();
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory }), { code: 'LEGACY_CLOSE_STORAGE_FAILED' });
});

test('verification detects missing pending structs and pending deletion evidence, then accepts exact full bytes', async t => {
  const { args, factory } = await setup(t);
  const pending = new Y.Doc(); const writer = new Y.Doc(); const deleter = new Y.Doc();
  t.after(() => { pending.destroy(); writer.destroy(); deleter.destroy(); });
  const updates = []; writer.on('update', update => updates.push(update));
  writer.getMap('pending-root').set('before', 1); writer.getMap('pending-root').set('after', 2);
  const deletes = []; deleter.on('update', update => deletes.push(update));
  deleter.getMap('deleted-root').set('gone', 1); deleter.getMap('deleted-root').delete('gone');
  Y.applyUpdate(pending, updates[1]); Y.applyUpdate(pending, deletes[1]);
  const snapshot = Y.encodeStateAsUpdate(pending);
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, snapshot, indexedDB: factory }), { code: 'LEGACY_CLOSE_INCOMPLETE' });
  const tx = args.db.transaction('updates', 'readwrite');
  tx.objectStore('updates').add(updates[1]);
  await complete(tx);
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, snapshot, indexedDB: factory }), { code: 'LEGACY_CLOSE_INCOMPLETE' });
  await appendLegacyYDocCloseSnapshot({ ...args, snapshot });
  assert.equal((await verifyLegacyYDocCloseSnapshot({ ...args, snapshot, indexedDB: factory })).locallyDurable, true);
});

test('verification waits for readonly transaction completion and rejects abort after read success', async t => {
  const { args, factory } = await setup(t);
  await appendLegacyYDocCloseSnapshot(args);
  const original = factory.open.bind(factory);
  factory.open = (...params) => {
    const request = original(...params);
    request.addEventListener('success', () => {
      const db = request.result;
      const transact = db.transaction.bind(db);
      db.transaction = (...values) => {
        assert.equal(values[1], 'readonly');
        const tx = transact(...values);
        const store = tx.objectStore('updates');
        const getAll = store.getAll.bind(store);
        store.getAll = (...keys) => {
          const read = getAll(...keys);
          read.addEventListener('success', () => tx.abort(), { once: true });
          return read;
        };
        return tx;
      };
    });
    return request;
  };
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory }), { code: 'LEGACY_CLOSE_STORAGE_FAILED' });
  assert.equal((await records(args.db)).updates.length, 1);
});

test('verification bounds blocked opens and closes a late successful connection', async t => {
  const { args } = await setup(t);
  for (const mode of ['blocked', 'timeout']) {
    const request = {}; let closed = 0;
    const result = verifyLegacyYDocCloseSnapshot({ ...args, timeoutMs: 10, indexedDB: { open: () => request } });
    if (mode === 'blocked') request.onblocked();
    await assert.rejects(result, { code: mode === 'blocked' ? 'LEGACY_CLOSE_STORAGE_BLOCKED' : 'LEGACY_CLOSE_TIMEOUT' });
    request.result = { close: () => closed++ };
    request.onsuccess();
    assert.equal(closed, 1);
  }
});

test('verification cancels an opening request, closes late connection and never returns a receipt', async t => {
  const { args } = await setup(t);
  const controller = new AbortController(); const request = {}; let closed = 0;
  const result = verifyLegacyYDocCloseSnapshot({ ...args, signal: controller.signal, indexedDB: { open: () => request } });
  controller.abort();
  await assert.rejects(result, { code: 'LEGACY_CLOSE_ABORTED' });
  request.result = { close: () => closed++ };
  request.onsuccess();
  assert.equal(closed, 1);
});

test('restricted global IndexedDB getter becomes a typed verification error', async t => {
  const { args } = await setup(t);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new Error('restricted'); } });
  try { await assert.rejects(verifyLegacyYDocCloseSnapshot(args), { code: 'LEGACY_CLOSE_STORAGE_FAILED' }); }
  finally { Object.defineProperty(globalThis, 'indexedDB', previous); }
});

test('scope change after fresh read invalidates verification, even with stored bytes intact', async t => {
  const { args, factory } = await setup(t);
  await appendLegacyYDocCloseSnapshot(args);
  let current = true;
  const original = factory.open.bind(factory);
  factory.open = (...params) => {
    const request = original(...params);
    request.addEventListener('success', () => {
      const db = request.result;
      const transact = db.transaction.bind(db);
      db.transaction = (...values) => {
        const tx = transact(...values);
        tx.addEventListener('complete', () => { current = false; }, { once: true });
        return tx;
      };
    });
    return request;
  };
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory, isCurrent: () => current }), { code: 'LEGACY_CLOSE_STALE' });
});

test('verification of another actor never reads or creates that actor database', async t => {
  const { args, factory, scopeKey } = await setup(t);
  await appendLegacyYDocCloseSnapshot(args);
  const before = await records(args.db);
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, actorUserId: 'another-actor', indexedDB: factory }), { code: 'LEGACY_CLOSE_INCOMPLETE' });
  assert.deepEqual((await factory.databases()).map(row => row.name), [scopeKey]);
  assert.deepEqual(await records(args.db), before);
});

test('queued readonly verification times out, aborts and leaves all source bytes intact', async t => {
  const { args, factory } = await setup(t);
  await appendLegacyYDocCloseSnapshot(args);
  const before = await records(args.db);
  const blocker = args.db.transaction('updates', 'readwrite');
  let keepAlive = true;
  const spin = () => { blocker.objectStore('updates').get(1).onsuccess = () => { if (keepAlive) spin(); }; };
  spin();
  const done = complete(blocker);
  try {
    await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory, timeoutMs: 20 }), { code: 'LEGACY_CLOSE_TIMEOUT' });
  } finally { keepAlive = false; await done; }
  assert.deepEqual(await records(args.db), before);
});

test('verification destroys its detached scratch on both success and incomplete proof', async t => {
  const { args, factory, source } = await setup(t);
  await appendLegacyYDocCloseSnapshot(args);
  const destroy = Y.Doc.prototype.destroy;
  let scratchDestroyed = 0;
  Y.Doc.prototype.destroy = function () {
    if (this.guid.startsWith('legacy-close-verify:')) scratchDestroyed++;
    return destroy.call(this);
  };
  try {
    await verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory });
    source.getMap('custom-root').set('not-on-disk', true);
    await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory,
      snapshot: Y.encodeStateAsUpdate(source) }), { code: 'LEGACY_CLOSE_INCOMPLETE' });
    assert.equal(scratchDestroyed, 2);
  } finally { Y.Doc.prototype.destroy = destroy; }
});

test('verification uses only readonly value requests and invalid inputs never open storage', async t => {
  const { args, factory } = await setup(t);
  await appendLegacyYDocCloseSnapshot(args);
  let opens = 0; let reads = 0;
  const original = factory.open.bind(factory);
  factory.open = (...params) => {
    opens++;
    assert.deepEqual(params, [args.db.name], 'no version request that could upgrade existing storage');
    const request = original(...params);
    request.addEventListener('success', () => {
      const db = request.result;
      const transact = db.transaction.bind(db);
      db.transaction = (...values) => {
        assert.equal(values[1], 'readonly'); reads++;
        return transact(...values);
      };
    });
    return request;
  };
  await assert.rejects(verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory, snapshot: new Uint8Array([255]) }), { code: 'LEGACY_CLOSE_INVALID_UPDATE' });
  assert.equal(opens, 0);
  await verifyLegacyYDocCloseSnapshot({ ...args, indexedDB: factory });
  assert.equal(opens, 1); assert.equal(reads, 1);
});

test('actual coordinator and disk verifier use a fixed number of live encodes as stored rows grow', async t => {
  const { args } = await setup(t);
  // Execute the actual coordinator source with only Y.encodeStateAsUpdate
  // instrumented. Its real verifier still opens and reconstructs real fake-IDB
  // rows; no mocked current checks or storage proof can hide per-row work.
  const source = (await readFile(new URL('../src/lib/collab/legacyYDocCloseCoordinator.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '')
    .replace('export function createLegacyYDocCloseCoordinator', 'function createLegacyYDocCloseCoordinator');
  let liveEncodes = 0;
  const countedY = { ...Y, encodeStateAsUpdate(doc, ...options) {
    if (doc === args.ydoc) liveEncodes++;
    return Y.encodeStateAsUpdate(doc, ...options);
  } };
  const createCoordinator = new Function('Y', 'getLegacyYDocScopeKey',
    'appendLegacyYDocCloseSnapshot', 'verifyLegacyYDocCloseSnapshot', `${source}; return createLegacyYDocCloseCoordinator;`)
    (countedY, getLegacyYDocScopeKey, appendLegacyYDocCloseSnapshot, verifyLegacyYDocCloseSnapshot);
  const coordinator = createCoordinator({ ydoc: args.ydoc, documentId: args.documentId,
    actorUserId: args.actorUserId, senderId: 'perf-leader', send() {},
    getRole: () => 'leader', getDatabase: () => args.db, isCurrent: () => true });
  coordinator.onReady();
  t.after(() => coordinator.dispose());
  const measurements = [];
  for (const rowCount of [3, 101]) {
    const updates = [];
    const collect = update => updates.push(new Uint8Array(update));
    args.ydoc.on('update', collect);
    for (let index = 0; index < rowCount; index++) {
      args.ydoc.getMap('perf-root').set(`${rowCount}:${index}`, 'x'.repeat(1000));
    }
    args.ydoc.off('update', collect);
    const tx = args.db.transaction('updates', 'readwrite');
    for (const update of updates) tx.objectStore('updates').add(update);
    await complete(tx);
    const receipt = await coordinator.prepareLocalClose();
    liveEncodes = 0;
    assert.equal(await coordinator.validateLocalCloseReceipt(receipt), true);
    measurements.push({ storedRows: (await records(args.db)).updates.length, liveEncodes });
    assert.ok(liveEncodes >= 2, 'retain exact live-byte checks before and after the awaited proof');
    assert.ok(liveEncodes <= 4, 'full live encoding must not occur once per stored row');
  }
  assert.ok(measurements[1].storedRows > measurements[0].storedRows + 100);
  assert.equal(measurements[1].liveEncodes, measurements[0].liveEncodes);
  t.diagnostic(`Stored rows / live encodes: ${measurements.map(row => `${row.storedRows} / ${row.liveEncodes}`).join(', ')}`);
  const receipt = await coordinator.prepareLocalClose();
  const pending = new Y.Doc(); const updates = [];
  pending.on('update', update => updates.push(update));
  pending.getMap('pending-perf-root').set('predecessor', 1);
  pending.getMap('pending-perf-root').set('tail', 2);
  Y.applyUpdate(args.ydoc, updates[1]); // unresolved bytes may not emit a live update event
  assert.ok(args.ydoc.store.pendingStructs);
  assert.equal(coordinator.isLocalCloseReceiptCurrent(receipt), false, 'optimization must retain exact pending-byte invalidation');
  await assert.rejects(coordinator.validateLocalCloseReceipt(receipt), { code: 'LOCAL_CLOSE_STALE' });
  pending.destroy();
  const withPending = await coordinator.prepareLocalClose();
  const deleter = new Y.Doc(); const deletes = [];
  deleter.on('update', update => deletes.push(update));
  deleter.getMap('deleted-perf-root').set('gone', 1);
  deleter.getMap('deleted-perf-root').delete('gone');
  Y.applyUpdate(args.ydoc, deletes[1]);
  assert.ok(args.ydoc.store.pendingDs);
  assert.equal(coordinator.isLocalCloseReceiptCurrent(withPending), false, 'delete-only pending bytes also invalidate the exact proof');
  await assert.rejects(coordinator.validateLocalCloseReceipt(withPending), { code: 'LOCAL_CLOSE_STALE' });
  deleter.destroy();
});
