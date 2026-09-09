import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createGenerationLegacyRecovery, GENERATION_LEGACY_RECOVERY_DATABASE as DATABASE,
  GENERATION_LEGACY_RECOVERY_STORE as STORE } from '../src/lib/collab/generationLegacyRecovery.js';
import { getOrCreateYDoc, snapshotRegisteredYDoc, _evictForTest, _getRefCountForTest,
  releaseYDoc } from '../src/lib/collab/ydocRegistry.js';
import { getLegacyYDocScopeKey } from '../src/lib/collab/legacyYDocScope.js';

const code = suffix => ({ code: `GENERATION_LEGACY_RECOVERY_${suffix}` });
const done = tx => new Promise((resolve, reject) => {
  tx.addEventListener('complete', resolve, { once: true });
  tx.addEventListener('abort', () => reject(tx.error), { once: true });
});
const open = indexedDb => new Promise((resolve, reject) => {
  const r = indexedDb.open(DATABASE); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
async function records(indexedDb) {
  const db = await open(indexedDb);
  try { const tx = db.transaction(STORE), end = done(tx), r = tx.objectStore(STORE).getAll(); await end; return r.result; }
  finally { db.close(); }
}
async function changeRecord(indexedDb, change) {
  const db = await open(indexedDb);
  try {
    const tx = db.transaction(STORE, 'readwrite'), end = done(tx), store = tx.objectStore(STORE), r = store.getAll();
    r.onsuccess = () => change(store, r.result); await end;
  } finally { db.close(); }
}
// Decode only the known graph value kinds used by registry snapshots. This
// verifies actual binary/state contents, not a copy of the archive algorithm.
function decodeExport(json) {
  const graph = JSON.parse(json), memo = new Map();
  function value(v) {
    if (!v || typeof v !== 'object') return v;
    if (v.type === 'undefined') return undefined;
    if (!Object.hasOwn(v, 'ref')) throw new Error('unexpected encoded value');
    if (memo.has(v.ref)) return memo.get(v.ref);
    const node = graph.nodes[v.ref];
    if (node.encoding === 'base64') {
      const bytes = new Uint8Array(Buffer.from(node.bytes, 'base64'));
      memo.set(v.ref, bytes); return bytes;
    }
    const result = node.type === 'Array' ? [] : {};
    memo.set(v.ref, result);
    for (const [key, item] of node.entries) result[key] = value(item);
    return result;
  }
  return value(graph.root);
}
function fixture(t, { absent = false } = {}) {
  const documentId = crypto.randomUUID(), actorUserId = crypto.randomUUID(), pdfGenerationId = crypto.randomUUID();
  const indexedDb = new IDBFactory(), scopedKey = getLegacyYDocScopeKey(documentId, actorUserId), docs = [];
  const create = key => { const doc = getOrCreateYDoc(key); docs.push([key, doc]); return doc; };
  const raw = absent ? null : create(documentId), scoped = absent ? null : create(scopedKey);
  raw?.getMap('old').set('raw', 'unattributed'); scoped?.getMap('old').set('mine', 'unsaved');
  let current = true;
  const options = { documentId, actorUserId, pdfGenerationId, indexedDb, isCurrent: () => current, timeoutMs: 1000 };
  t.after(() => { for (const [key, doc] of docs) { doc.destroy(); _evictForTest(key); } });
  return { ...options, options, indexedDb, scopedKey, raw, scoped, create,
    recovery: createGenerationLegacyRecovery(options), invalidate: () => { current = false; } };
}

test('archives raw and scoped registry bytes without creating, attaching, changing or attributing raw work', async t => {
  const f = fixture(t), before = [snapshotRegisteredYDoc(f.documentId), snapshotRegisteredYDoc(f.scopedKey)];
  const refs = [f.documentId, f.scopedKey].map(_getRefCountForTest);
  const receipt = await f.recovery.prepare();
  assert.equal(await f.recovery.validate(receipt), true); assert.equal(f.recovery.isCurrent(receipt), true);
  assert.deepEqual([f.documentId, f.scopedKey].map(snapshotRegisteredYDoc), before);
  assert.deepEqual([f.documentId, f.scopedKey].map(_getRefCountForTest), refs);
  assert.deepEqual((await f.indexedDb.databases()).map(d => d.name), [DATABASE]);
  const [record] = await records(f.indexedDb), body = decodeExport(record.exportJson);
  assert.equal(record.documentId, f.documentId); assert.equal(record.actorUserId, f.actorUserId);
  assert.equal(record.pdfGenerationId, f.pdfGenerationId);
  assert.equal(record.id, `sha256:${createHash('sha256').update(record.exportJson).digest('hex')}`);
  assert.equal(body.sources.length, 2);
  for (let i = 0; i < 2; i++) {
    const s = body.sources[i];
    assert.equal(s.documentId, f.documentId); assert.equal(s.registry.documentId, f.documentId);
    assert.equal(s.sourceRegistryKey, [f.documentId, f.scopedKey][i]);
    assert.deepEqual(s.registry.update, before[i].update);
    assert.equal(s.provenance.actorUserId, i ? f.actorUserId : null);
    assert.equal(s.provenance.automaticImportAllowed, false);
    assert.ok(!Object.hasOwn(s.registry.metadata, 'refCount'));
    const detached = new Y.Doc();
    try { Y.applyUpdate(detached, s.registry.update); assert.deepEqual(detached.getMap('old').toJSON(), [f.raw, f.scoped][i].getMap('old').toJSON()); }
    finally { detached.destroy(); }
  }
});

test('reopened archive and concurrent preparations reuse exact immutable content despite refcount changes', async t => {
  const f = fixture(t);
  const [a, b] = await Promise.all([f.recovery.prepare(), f.recovery.prepare()]);
  getOrCreateYDoc(f.scopedKey);
  const fresh = createGenerationLegacyRecovery(f.options), c = await fresh.prepare({ readOnly: true });
  releaseYDoc(f.scopedKey);
  assert.equal(a.archiveId, b.archiveId); assert.equal(a.archiveId, c.archiveId);
  assert.equal((await records(f.indexedDb)).length, 1); assert.equal(await fresh.validate(c), true);
  assert.equal(fresh.isCurrent(a), false, 'Receipts cannot cross factory lifetimes');
});

test('readOnly never creates a database or writes a missing/new archive', async t => {
  const f = fixture(t);
  await assert.rejects(f.recovery.prepare({ readOnly: true }), code('INCOMPLETE'));
  assert.deepEqual(await f.indexedDb.databases(), []);
  await f.recovery.prepare();
  const saved = await f.recovery.prepare({ readOnly: true }); assert.equal(await f.recovery.validate(saved), true);
  f.scoped.getMap('old').set('later', 1);
  await assert.rejects(f.recovery.prepare({ readOnly: true }), code('INCOMPLETE'));
  assert.equal((await records(f.indexedDb)).length, 1);
});

test('both absent sources need no storage; either later appearance invalidates the receipt', async t => {
  const f = fixture(t, { absent: true });
  const recovery = createGenerationLegacyRecovery({ ...f.options, indexedDb: null });
  const receipt = await recovery.prepare({ readOnly: true });
  assert.equal(receipt.archiveId, null); assert.equal(await recovery.validate(receipt), true);
  assert.deepEqual(await f.indexedDb.databases(), []);
  f.create(f.scopedKey); assert.equal(recovery.isCurrent(receipt), false);
  await assert.rejects(recovery.validate(receipt), code('STALE'));
});

test('missing, blocked and unavailable storage never authorize a present source close', async t => {
  const f = fixture(t);
  await assert.rejects(createGenerationLegacyRecovery({ ...f.options, indexedDb: null }).prepare(), code('UNAVAILABLE'));
  const blocked = { open() { const request = {}; setImmediate(() => request.onblocked()); return request; } };
  await assert.rejects(createGenerationLegacyRecovery({ ...f.options, indexedDb: blocked }).prepare(), code('BLOCKED'));
  const receipt = await f.recovery.prepare();
  await new Promise((resolve, reject) => { const r = f.indexedDb.deleteDatabase(DATABASE); r.onsuccess = resolve; r.onerror = () => reject(r.error); });
  await assert.rejects(f.recovery.validate(receipt), code('INCOMPLETE'));
  assert.deepEqual(await f.indexedDb.databases(), []); assert.equal(f.scoped.getMap('old').get('mine'), 'unsaved');
});

test('mutation of either source, new empty roots, replacement and forged receipts fail closed', async t => {
  const f = fixture(t), receipt = await f.recovery.prepare();
  assert.equal(f.recovery.isCurrent({ ...receipt }), false);
  await assert.rejects(f.recovery.validate({ ...receipt }), code('STALE'));
  f.raw.getMap('old').set('late', 1); assert.equal(f.recovery.isCurrent(receipt), false);
  const b = await f.recovery.prepare(); f.scoped.getArray('new-root'); assert.equal(f.recovery.isCurrent(b), false);
  const c = await f.recovery.prepare(), bytes = Y.encodeStateAsUpdate(f.scoped);
  _evictForTest(f.scopedKey); Y.applyUpdate(f.create(f.scopedKey), bytes);
  assert.equal(f.recovery.isCurrent(c), false);
});

test('direct JSON edits and destroyed source objects invalidate live receipts', async t => {
  const f = fixture(t); f.scoped.getMap('plain').set('shape', { color: 'red' });
  const receipt = await f.recovery.prepare();
  f.scoped.getMap('plain').get('shape').color = 'blue'; assert.equal(f.recovery.isCurrent(receipt), false);
  const next = await f.recovery.prepare(); f.raw.destroy(); assert.equal(f.recovery.isCurrent(next), false);
});

test('pending structs, missing-clock evidence and delete sets survive exact archival', async t => {
  const f = fixture(t), source = new Y.Doc(); t.after(() => source.destroy());
  source.getText('pending').insert(0, 'a'); const first = Y.encodeStateVector(source);
  source.getText('pending').insert(1, 'b'); Y.applyUpdate(f.scoped, Y.encodeStateAsUpdate(source, first));
  const beforeDelete = Y.encodeStateVector(source); source.getText('pending').delete(0, 1);
  Y.applyUpdate(f.raw, Y.encodeStateAsUpdate(source, beforeDelete));
  assert.ok(f.scoped.store.pendingStructs); assert.ok(f.raw.store.pendingDs);
  const snapshots = [f.documentId, f.scopedKey].map(snapshotRegisteredYDoc);
  const receipt = await f.recovery.prepare(), body = decodeExport((await records(f.indexedDb))[0].exportJson);
  assert.deepEqual(body.sources.map(s => s.registry.pending), snapshots.map(s => s.pending));
  assert.equal(await f.recovery.validate(receipt), true);
  Y.applyUpdate(f.scoped, Y.encodeStateAsUpdate(source)); assert.equal(f.recovery.isCurrent(receipt), false);
});

test('actor and generation changes cannot reuse another scope or claim foreign registry work', async t => {
  const f = fixture(t), receipt = await f.recovery.prepare(), foreignActor = crypto.randomUUID();
  const foreignKey = getLegacyYDocScopeKey(f.documentId, foreignActor);
  f.create(foreignKey).getMap('private').set('foreign', 'not part of this archive');
  const other = createGenerationLegacyRecovery({ ...f.options, actorUserId: foreignActor });
  assert.equal(other.isCurrent(receipt), false);
  await assert.rejects(other.prepare({ readOnly: true }), code('INCOMPLETE'));
  const nextGeneration = createGenerationLegacyRecovery({ ...f.options, pdfGenerationId: crypto.randomUUID() });
  await assert.rejects(nextGeneration.prepare({ readOnly: true }), code('INCOMPLETE'));
  assert.equal((await records(f.indexedDb)).length, 1);
  assert.ok(!JSON.stringify(decodeExport((await records(f.indexedDb))[0].exportJson)).includes('not part of this archive'));
  f.invalidate(); assert.equal(f.recovery.isCurrent(receipt), false);
});

test('quota failure preserves both source bytes and permits an explicit later retry', async t => {
  const f = fixture(t), before = [f.documentId, f.scopedKey].map(snapshotRegisteredYDoc), original = IDBObjectStore.prototype.add;
  try {
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === STORE) throw new DOMException('owned quota failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
    await assert.rejects(f.recovery.prepare());
  } finally { IDBObjectStore.prototype.add = original; }
  assert.deepEqual([f.documentId, f.scopedKey].map(snapshotRegisteredYDoc), before);
  const receipt = await f.recovery.prepare(); assert.equal(await f.recovery.validate(receipt), true);
});

test('fresh validation detects deleted, altered and malformed archive records', async t => {
  const f = fixture(t), receipt = await f.recovery.prepare();
  await changeRecord(f.indexedDb, (store, rows) => store.put({ ...rows[0], exportJson: '{}' }));
  await assert.rejects(f.recovery.validate(receipt), code('INCOMPLETE'));
  await assert.rejects(f.recovery.prepare(), code('INCOMPLETE'), 'Never overwrite an existing content key');
  await changeRecord(f.indexedDb, (store, rows) => store.delete(rows[0].id));
  await assert.rejects(f.recovery.validate(receipt), code('INCOMPLETE'));
});

test('source or provider scope changes during final disk read invalidate the receipt', async t => {
  for (const scopeChange of [false, true]) {
    const f = fixture(t), receipt = await f.recovery.prepare(), original = IDBObjectStore.prototype.get;
    try {
      IDBObjectStore.prototype.get = function (...args) {
        const request = original.apply(this, args);
        if (this.name === STORE) request.addEventListener('success', () => {
          if (scopeChange) f.invalidate(); else f.scoped.getMap('old').set('during-read', true);
        }, { once: true });
        return request;
      };
      await assert.rejects(f.recovery.validate(receipt), code('STALE'));
    } finally { IDBObjectStore.prototype.get = original; }
  }
});

test('bounded stalled storage fails without a receipt and late upgrade cannot create a DB', async t => {
  const f = fixture(t); let late;
  const stalled = { open() { late = {}; return late; } };
  const recovery = createGenerationLegacyRecovery({ ...f.options, indexedDb: stalled, timeoutMs: 100 });
  await assert.rejects(recovery.prepare(), code('TIMEOUT'));
  let aborted = 0; late.transaction = { abort() { aborted++; } };
  late.onupgradeneeded({ oldVersion: 0 }); assert.equal(aborted, 1);
  let closed = 0; late.result = { close() { closed++; } }; late.onsuccess(); assert.equal(closed, 1);
});

test('malformed existing schema fails closed without changing it', async t => {
  const f = fixture(t);
  const db = await new Promise((resolve, reject) => {
    const r = f.indexedDb.open(DATABASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'wrong' });
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  }); db.close();
  await assert.rejects(f.recovery.prepare(), code('SCHEMA'));
  const reopened = await open(f.indexedDb);
  try { assert.equal(reopened.transaction(STORE).objectStore(STORE).keyPath, 'wrong'); } finally { reopened.close(); }
});

test('invalid scopes/options fail before storage access', async t => {
  const f = fixture(t);
  for (const changes of [{ documentId: 'scope:key' }, { actorUserId: null }, { pdfGenerationId: null },
    { isCurrent: null }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 60_001 }]) {
    assert.throws(() => createGenerationLegacyRecovery({ ...f.options, ...changes }), TypeError);
  }
  await assert.rejects(f.recovery.prepare({ readOnly: 'true' }), TypeError);
  f.invalidate(); await assert.rejects(f.recovery.prepare(), code('STALE'));
  assert.deepEqual(await f.indexedDb.databases(), []);
});

test('already canceled prepare and validate reject without storage access or unhandled rejection', async t => {
  const f = fixture(t), controller = new AbortController(), unhandled = [];
  const listener = error => unhandled.push(error); process.on('unhandledRejection', listener);
  try {
    controller.abort();
    await assert.rejects(f.recovery.prepare({ signal: controller.signal }), code('ABORTED'));
    assert.deepEqual(await f.indexedDb.databases(), []);
    const receipt = await f.recovery.prepare();
    await assert.rejects(f.recovery.validate(receipt, { signal: controller.signal }), code('ABORTED'));
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', listener); }
});

test('cancel after add success aborts the transaction before commit and keeps source bytes', async t => {
  const f = fixture(t), original = IDBObjectStore.prototype.add, controller = new AbortController();
  const before = [f.documentId, f.scopedKey].map(snapshotRegisteredYDoc);
  try {
    IDBObjectStore.prototype.add = function (...args) {
      const r = original.apply(this, args);
      if (this.name === STORE) r.addEventListener('success', () => controller.abort(), { once: true });
      return r;
    };
    await assert.rejects(f.recovery.prepare({ signal: controller.signal }), code('ABORTED'));
  } finally { IDBObjectStore.prototype.add = original; }
  assert.deepEqual(await records(f.indexedDb), []);
  assert.deepEqual([f.documentId, f.scopedKey].map(snapshotRegisteredYDoc), before);
  const receipt = await f.recovery.prepare(); assert.equal(await f.recovery.validate(receipt), true);
});

test('read-only validation cancel during exact read aborts without rewriting the archive', async t => {
  const f = fixture(t), receipt = await f.recovery.prepare(), before = await records(f.indexedDb);
  const original = IDBObjectStore.prototype.get, controller = new AbortController();
  try {
    IDBObjectStore.prototype.get = function (...args) {
      const r = original.apply(this, args);
      if (this.name === STORE) {
        assert.equal(this.transaction.mode, 'readonly');
        r.addEventListener('success', () => controller.abort(), { once: true });
      }
      return r;
    };
    await assert.rejects(f.recovery.validate(receipt, { signal: controller.signal }), code('ABORTED'));
  } finally { IDBObjectStore.prototype.get = original; }
  assert.deepEqual(await records(f.indexedDb), before);
});

test('cancel during crypto stops late work before it can open or write storage', async t => {
  const f = fixture(t), original = crypto.subtle.digest, controller = new AbortController();
  let finish, entered;
  const reached = new Promise(resolve => { entered = resolve; });
  try {
    crypto.subtle.digest = async function (...args) {
      entered(); await new Promise(resolve => { finish = resolve; });
      return original.apply(this, args);
    };
    const pending = f.recovery.prepare({ signal: controller.signal });
    await reached; controller.abort(); await assert.rejects(pending, code('ABORTED'));
    finish(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await f.indexedDb.databases(), []);
  } finally { crypto.subtle.digest = original; finish?.(); }
});
