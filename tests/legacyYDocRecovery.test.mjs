import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { IDBFactory } from 'fake-indexeddb';
import { getOrCreateYDoc, summarizeRegisteredYDoc, snapshotRegisteredYDoc, _getRefCountForTest, _evictForTest } from '../src/lib/collab/ydocRegistry.js';
import { probeLegacyYDocRecovery, inspectLegacyYDocRecovery, buildLegacyYDocRecoveryExport, LegacyYDocRecoveryLimitError } from '../src/lib/collab/legacyYDocRecovery.js';

const exceeds = limit => error => error instanceof LegacyYDocRecoveryLimitError
  && error.code === 'LEGACY_RECOVERY_LIMIT' && error.limit === limit && error.actual > error.maximum;

// Independent test oracle uses Node's UTF-8 encoder over the returned graph.
function retainedTextBytes(value, seen = new Set()) {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (!value || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  const count = entry => retainedTextBytes(entry, seen);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return 0;
  if (value instanceof Blob) return count(value.type) + (typeof value.name === 'string' ? count(value.name) : 0);
  if (value instanceof RegExp) return count(value.source) + count(value.flags);
  if (value instanceof Map) return [...value].reduce((sum, [key, entry]) => sum + count(key) + count(entry), 0);
  if (value instanceof Set) return [...value].reduce((sum, entry) => sum + count(entry), 0);
  let total = 0;
  if (value instanceof Error) for (const key of ['name', 'message', 'stack', 'cause']) {
    if (key in value && !Object.prototype.propertyIsEnumerable.call(value, key)) total += count(key) + count(value[key]);
  }
  for (const key of Object.keys(value)) total += count(key) + count(value[key]);
  return total;
}

test('inspection text limit exactly counts UTF-8 values, keys, schema and result metadata', async () => {
  for (const value of ['aé漢😀\ud800\udc00\ud800\udc00\ud800\u0000', { '鍵😀\udc00': 'é\ud800' }]) {
    const indexedDB = new IDBFactory(); const id = crypto.randomUUID();
    await seedBudgetValue(indexedDB, id, value);
    const before = await inspectLegacyYDocRecovery(id, { indexedDB });
    const bytes = retainedTextBytes(before);
    const exact = await inspectLegacyYDocRecovery(id, { indexedDB, limits: { maxTextBytes: bytes } });
    assert.equal(retainedTextBytes(exact), bytes);
    await assert.rejects(inspectLegacyYDocRecovery(id, { indexedDB, limits: { maxTextBytes: bytes - 1 } }), exceeds('maxTextBytes'));
    assert.deepEqual((await inspectLegacyYDocRecovery(id, { indexedDB })).indexedDB, before.indexedDB);
  }
});

test('inspection text cap includes non-enumerable Error name/message/stack and nested cause', async () => {
  const indexedDB = new IDBFactory(); const id = crypto.randomUUID();
  const error = new TypeError('é'.repeat(1000), { cause: new Error('cause😀') });
  error.stack = 'stack\ud800'.repeat(1000); error.cause.stack = 'inner stack';
  await seedBudgetValue(indexedDB, id, error);
  const before = await inspectLegacyYDocRecovery(id, { indexedDB });
  const restored = before.indexedDB.stores[0].records[0].value;
  assert.equal(restored.name, 'TypeError');
  assert.equal(restored.message, error.message); assert.equal(restored.stack, error.stack);
  assert.equal(restored.cause.message, error.cause.message);
  const bytes = retainedTextBytes(before);
  await inspectLegacyYDocRecovery(id, { indexedDB, limits: { maxTextBytes: bytes } });
  await assert.rejects(inspectLegacyYDocRecovery(id, { indexedDB, limits: { maxTextBytes: bytes - 1 } }), exceeds('maxTextBytes'));
  await assert.rejects(inspectLegacyYDocRecovery(id, { indexedDB, limits: { maxTextBytes: 1000 } }), exceeds('maxTextBytes'));
  assert.deepEqual((await inspectLegacyYDocRecovery(id, { indexedDB })).indexedDB, before.indexedDB);
});

test('aggregate text limit stops multi-record cursors early and leaves all text unchanged', async () => {
  const factory = new IDBFactory(); const id = crypto.randomUUID();
  await seedBudgetValue(factory, id, 'x'.repeat(4000));
  const db = await new Promise((resolve, reject) => {
    const request = factory.open(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const tx = db.transaction('data', 'readwrite');
  for (let index = 0; index < 100; index++) tx.objectStore('data').put('x'.repeat(4000), index);
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
  db.close();
  const before = await inspectLegacyYDocRecovery(id, { indexedDB: factory });
  let reads = 0;
  const wrapped = { open(name) {
    const request = factory.open(name);
    request.addEventListener('success', () => {
      const database = request.result; const transaction = database.transaction.bind(database);
      database.transaction = (...args) => {
        const read = transaction(...args); const objectStore = read.objectStore.bind(read);
        read.objectStore = storeName => {
          const store = objectStore(storeName); const openCursor = store.openCursor.bind(store);
          store.openCursor = () => { const cursor = openCursor(); cursor.addEventListener('success', () => { if (cursor.result) reads++; }); return cursor; };
          return store;
        };
        return read;
      };
    });
    return request;
  } };
  await assert.rejects(inspectLegacyYDocRecovery(id, { indexedDB: wrapped, limits: { maxTextBytes: 8192 } }), exceeds('maxTextBytes'));
  assert.ok(reads >= 2 && reads <= 3, `must stop before retaining all 101 rows, got ${reads}`);
  assert.deepEqual((await inspectLegacyYDocRecovery(id, { indexedDB: factory })).indexedDB, before.indexedDB);
});

async function seedBudgetValue(factory, id, value) {
  const db = await new Promise((resolve, reject) => {
    const request = factory.open(id);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const tx = db.transaction('data', 'readwrite');
  tx.objectStore('data').put(value, 'value');
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
  db.close();
}

test('recovery limit options require known positive safe integers before accessing storage', async () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '2', null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(inspectLegacyYDocRecovery('limits', { limits: { maxRecords: bad }, indexedDB: { open() { assert.fail('must not open'); } } }), TypeError);
    await assert.rejects(buildLegacyYDocRecoveryExport({}, { limits: { maxGraphNodes: bad } }), TypeError);
  }
  await assert.rejects(buildLegacyYDocRecoveryExport({}, { limits: { typo: 5 } }), TypeError);
  await assert.rejects(inspectLegacyYDocRecovery('limits', { limits: [] }), TypeError);
});

test('inspection record cap is shared across stores and failure leaves all records unchanged', async () => {
  const indexedDB = new IDBFactory(); const id = crypto.randomUUID();
  await seed(indexedDB, id);
  const before = await inspectLegacyYDocRecovery(id, { indexedDB, limits: { maxRecords: 6 } });
  assert.equal(before.indexedDB.stores.reduce((total, store) => total + store.records.length, 0), 6);
  await assert.rejects(inspectLegacyYDocRecovery(id, { indexedDB, limits: { maxRecords: 5 } }), exceeds('maxRecords'));
  const after = await inspectLegacyYDocRecovery(id, { indexedDB });
  assert.deepEqual(after.indexedDB, before.indexedDB);
  assert.equal((await probeLegacyYDocRecovery(id, { indexedDB })).state, 'present');
});

test('inspection counts unique full backing buffers and limits primitive/deep traversal without mutation', async () => {
  const indexedDB = new IDBFactory(); const id = crypto.randomUUID();
  const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
  const value = { backing, a: new Uint8Array(backing, 2, 2), b: new DataView(backing, 1, 3) };
  value.self = value;
  await seedBudgetValue(indexedDB, id, value);
  const before = await inspectLegacyYDocRecovery(id, { indexedDB, limits: { maxBinaryBytes: 8 } });
  await assert.rejects(inspectLegacyYDocRecovery(id, { indexedDB, limits: { maxBinaryBytes: 7 } }), exceeds('maxBinaryBytes'));
  assert.deepEqual((await inspectLegacyYDocRecovery(id, { indexedDB })).indexedDB, before.indexedDB);
  const hugeId = crypto.randomUUID();
  await seedBudgetValue(indexedDB, hugeId, new Array(20_000).fill(1));
  await assert.rejects(inspectLegacyYDocRecovery(hugeId, { indexedDB, limits: { maxValues: 100 } }), exceeds('maxValues'));
  assert.equal((await inspectLegacyYDocRecovery(hugeId, { indexedDB })).indexedDB.stores[0].records[0].value.length, 20_000);
  const deepId = crypto.randomUUID();
  await seedBudgetValue(indexedDB, deepId, { a: { b: { c: 1 } } });
  await assert.rejects(inspectLegacyYDocRecovery(deepId, { indexedDB, limits: { maxDepth: 2 } }), exceeds('maxDepth'));
  assert.deepEqual((await inspectLegacyYDocRecovery(deepId, { indexedDB })).indexedDB.stores[0].records[0].value, { a: { b: { c: 1 } } });
});

test('inspection registry budget failure retains pending Yjs bytes and does not touch disk', async t => {
  const id = crypto.randomUUID(); const doc = getOrCreateYDoc(id);
  t.after(() => { _evictForTest(id); doc.destroy(); });
  doc.getMap('pending').set('value', 'still here');
  const before = snapshotRegisteredYDoc(id);
  await assert.rejects(inspectLegacyYDocRecovery(id, { limits: { maxBinaryBytes: 1 }, indexedDB: { open() { assert.fail('registry fails first'); } } }), exceeds('maxBinaryBytes'));
  assert.deepEqual(snapshotRegisteredYDoc(id), before);
});

test('export exact binary budget includes unique backing bytes and duplicate visible view output', async () => {
  const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer;
  const view = new Uint8Array(backing, 2, 2);
  const value = { backing, view, alias: view, other: new DataView(backing, 1, 3) };
  const result = await buildLegacyYDocRecoveryExport(value, { limits: { maxBinaryBytes: 13, maxGraphNodes: 4 } });
  const restored = decodeRecoveryExport(result);
  assert.equal(restored.view, restored.alias);
  assert.equal(restored.view.buffer, restored.backing);
  await assert.rejects(buildLegacyYDocRecoveryExport(value, { limits: { maxBinaryBytes: 12 } }), exceeds('maxBinaryBytes'));
  await assert.rejects(buildLegacyYDocRecoveryExport(value, { limits: { maxGraphNodes: 3 } }), exceeds('maxGraphNodes'));
  assert.deepEqual([...new Uint8Array(backing)], [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('export JSON cap exactly counts complete envelope, escapes, Unicode, nodes and punctuation', async () => {
  const cycle = {}; cycle.self = cycle;
  for (const value of [null, 'é😀\ud800\udc00\ud800\u0000\b\n\\"', { '名\n': ['é', NaN, -0, undefined, 123n], nested: { ok: true } }, new Uint8Array([0, 255]), new Map([['a', 'b'], ['next', cycle]]), new Set(['a', 'b', cycle]), new Error('message', { cause: cycle })]) {
    const complete = await buildLegacyYDocRecoveryExport(value);
    const bytes = Buffer.byteLength(JSON.stringify(complete), 'utf8');
    assert.deepEqual(await buildLegacyYDocRecoveryExport(value, { limits: { maxJsonBytes: bytes } }), complete);
    await assert.rejects(buildLegacyYDocRecoveryExport(value, { limits: { maxJsonBytes: bytes - 1 } }), exceeds('maxJsonBytes'));
  }
});

test('aggregate JSON cap stops fresh string getters before retaining a whole flat object or array', async () => {
  for (const source of [{}, []]) {
    let reads = 0;
    for (let index = 0; index < 10_000; index++) {
      Object.defineProperty(source, index, { enumerable: true, get() { reads++; return `${index}:`.padEnd(4000, 'x'); } });
    }
    await assert.rejects(buildLegacyYDocRecoveryExport(source, { limits: { maxJsonBytes: 8192 } }), exceeds('maxJsonBytes'));
    assert.ok(reads <= 3, `only the first bounded values may be read, got ${reads}`);
    assert.ok(Object.getOwnPropertyDescriptor(source, '9999').get, 'later source getters remain untouched');
  }
});

test('aggregate JSON cap stops lazy Map/Set entries and counts shared reference entries', async () => {
  for (const Base of [Map, Set]) {
    let reads = 0;
    class FreshValues extends Base {
      *[Symbol.iterator]() {
        for (let index = 0; index < 10_000; index++) {
          reads++;
          const text = `${index}:`.padEnd(4000, 'x');
          yield Base === Map ? [index, text] : text;
        }
      }
    }
    await assert.rejects(buildLegacyYDocRecoveryExport(new FreshValues(), { limits: { maxJsonBytes: 8192 } }), exceeds('maxJsonBytes'));
    assert.ok(reads <= 3, `only bounded entries may be fetched, got ${reads}`);
  }
  const child = {}; let reads = 0; const source = {};
  for (let index = 0; index < 10_000; index++) Object.defineProperty(source, index, { enumerable: true, get() { reads++; return child; } });
  await assert.rejects(buildLegacyYDocRecoveryExport(source, { limits: { maxJsonBytes: 8192 } }), exceeds('maxJsonBytes'));
  assert.ok(reads < 1000, `references must consume the aggregate byte budget, got ${reads}`);
});

test('export values and depth caps stop huge primitive arrays and deep nesting while cycles remain valid', async () => {
  const array = new Array(20_000).fill(1);
  await assert.rejects(buildLegacyYDocRecoveryExport(array, { limits: { maxValues: 100 } }), exceeds('maxValues'));
  assert.equal(array.length, 20_000);
  assert.deepEqual(decodeRecoveryExport(await buildLegacyYDocRecoveryExport([1], { limits: { maxValues: 3 } })), [1]);
  await assert.rejects(buildLegacyYDocRecoveryExport([1], { limits: { maxValues: 2 } }), exceeds('maxValues'));
  const cycle = {}; cycle.self = cycle;
  const decoded = decodeRecoveryExport(await buildLegacyYDocRecoveryExport(cycle, { limits: { maxDepth: 1, maxGraphNodes: 1 } }));
  assert.equal(decoded.self, decoded);
  const deep = { a: { b: { c: 1 } } };
  await buildLegacyYDocRecoveryExport(deep, { limits: { maxDepth: 3 } });
  await assert.rejects(buildLegacyYDocRecoveryExport(deep, { limits: { maxDepth: 2 } }), exceeds('maxDepth'));
  let veryDeep = {}; for (let i = 0; i < 10_000; i++) veryDeep = { nested: veryDeep };
  await assert.rejects(buildLegacyYDocRecoveryExport(veryDeep), exceeds('maxDepth'));
});

test('cancelled inspect/export reject explicitly without reading, partial exports, or source changes', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectLegacyYDocRecovery('cancel', { signal: controller.signal, indexedDB: { open() { assert.fail('must not open'); } } }), { name: 'AbortError', code: 'LEGACY_RECOVERY_ABORTED' });
  await assert.rejects(buildLegacyYDocRecoveryExport({}, { signal: controller.signal }), { name: 'AbortError' });
  const during = new AbortController(); const values = new Array(20_000).fill('unchanged');
  const promise = buildLegacyYDocRecoveryExport(values, { signal: during.signal });
  setTimeout(() => during.abort(), 0);
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(values.length, 20_000); assert.equal(values[0], 'unchanged');
  const late = new AbortController(); let request;
  const pending = inspectLegacyYDocRecovery('cancel-open', { signal: late.signal, indexedDB: { open() { return (request = {}); } } });
  late.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  let closed = 0; request.result = { close() { closed++; } }; request.onsuccess();
  assert.equal(closed, 1);
});

test('export cancels an outstanding Blob read and ignores its later result without changing the Blob', async () => {
  let finish;
  class SlowBlob extends Blob { arrayBuffer() { return new Promise(resolve => { finish = resolve; }); } }
  const blob = new SlowBlob(['abc']); const controller = new AbortController();
  const exporting = buildLegacyYDocRecoveryExport(blob, { signal: controller.signal });
  assert.equal(typeof finish, 'function');
  controller.abort();
  await assert.rejects(exporting, { name: 'AbortError', code: 'LEGACY_RECOVERY_ABORTED' });
  finish(new Uint8Array([97, 98, 99]).buffer);
  assert.equal(blob.size, 3);
  await assert.rejects(buildLegacyYDocRecoveryExport(blob, { limits: { maxBinaryBytes: 2 } }), exceeds('maxBinaryBytes'));
  await assert.rejects(buildLegacyYDocRecoveryExport({}, { signal: {} }), TypeError);
});

test('cancellation during real IndexedDB cursors aborts only the read and preserves all source rows', async () => {
  const factory = new IDBFactory(); const id = crypto.randomUUID(); await seed(factory, id);
  const before = await inspectLegacyYDocRecovery(id, { indexedDB: factory });
  const controller = new AbortController(); let reads = 0;
  const wrapped = { open(name) {
    const request = factory.open(name);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...args) => {
        const tx = transaction(...args); const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = name => {
          const store = objectStore(name); const openCursor = store.openCursor.bind(store);
          store.openCursor = () => {
            const cursor = openCursor(); cursor.addEventListener('success', () => { if (++reads === 2) controller.abort(); }); return cursor;
          };
          return store;
        };
        return tx;
      };
    });
    return request;
  } };
  await assert.rejects(inspectLegacyYDocRecovery(id, { indexedDB: wrapped, signal: controller.signal }), { name: 'AbortError', code: 'LEGACY_RECOVERY_ABORTED' });
  assert.deepEqual((await inspectLegacyYDocRecovery(id, { indexedDB: factory })).indexedDB, before.indexedDB);
});

// Test-only decoder: roundtrip the export graph rather than merely finding a
// matching base64 string. Allocate buffers before views so forward references
// and multiple views over one backing buffer retain their exact identity.
function decodeRecoveryExport(exported) {
  const values = new Map();
  const viewTypes = { Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView };
  const bytes = node => Uint8Array.from(Buffer.from(node.bytes, 'base64'));
  for (const node of exported.nodes) {
    if (node.type === 'ArrayBuffer') values.set(node.id, bytes(node).buffer);
    else if (node.type === 'Object') values.set(node.id, {});
    else if (node.type === 'Array') values.set(node.id, new Array(node.length));
    else if (node.type === 'Map') values.set(node.id, new Map());
    else if (node.type === 'Set') values.set(node.id, new Set());
    else if (node.type === 'Date') values.set(node.id, new Date(node.value === null ? NaN : node.value));
    else if (!Object.hasOwn(viewTypes, node.type)) throw new Error(`Unsupported test decode node: ${node.type}`);
  }
  function resolve(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Object.hasOwn(value, 'ref')) {
      assert.ok(values.has(value.ref), `unresolved export reference ${value.ref}`);
      return values.get(value.ref);
    }
    if (value.type === 'undefined') return undefined;
    if (value.type === 'bigint') return BigInt(value.value);
    if (value.type === 'number') return value.value === '-0' ? -0 : Number(value.value);
    throw new Error('Unsupported test decode value');
  }
  for (const node of exported.nodes) {
    if (!Object.hasOwn(viewTypes, node.type)) continue;
    const buffer = resolve(node.buffer);
    assert.ok(buffer instanceof ArrayBuffer, 'every view must reference its complete backing buffer');
    const Constructor = viewTypes[node.type];
    values.set(node.id, node.type === 'DataView'
      ? new DataView(buffer, node.byteOffset, node.byteLength)
      : new Constructor(buffer, node.byteOffset, node.length));
  }
  for (const node of exported.nodes) {
    const value = values.get(node.id);
    if (node.type === 'Object' || node.type === 'Array') {
      for (const [key, entry] of node.entries) {
        Object.defineProperty(value, key, { value: resolve(entry), enumerable: true, configurable: true, writable: true });
      }
    } else if (node.type === 'Map') {
      for (const [key, entry] of node.entries) value.set(resolve(key), resolve(entry));
    } else if (node.type === 'Set') {
      for (const entry of node.values) value.add(resolve(entry));
    }
  }
  return resolve(exported.root);
}

async function seed(factory, name, { empty = false } = {}) {
  const db = await new Promise((resolve, reject) => {
    const request = factory.open(name, 3);
    request.onupgradeneeded = () => {
      if (empty) return;
      request.result.createObjectStore('updates', { autoIncrement: true });
      request.result.createObjectStore('custom');
      request.result.createObjectStore('unknown').createIndex('probe-schema', ['tag', 'kind'], { unique: false });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  if (empty) { db.close(); return; }
  const tx = db.transaction(['updates', 'custom', 'unknown'], 'readwrite');
  tx.objectStore('updates').put(new Uint8Array([255, 0, 1]), 7); // intentionally not a valid Yjs update
  tx.objectStore('updates').put({ opaque: new Uint16Array([0, 65535]) }, 'unexpected-update-key');
  tx.objectStore('custom').put({ nested: new Uint8Array([6, 9]), when: new Date('2020-01-01') }, ['custom', 2]);
  tx.objectStore('custom').put('binary-key', new Uint8Array([4, 5]).buffer);
  tx.objectStore('custom').put('date-key', new Date('2021-01-01'));
  tx.objectStore('unknown').put(new Map([['opaque', new ArrayBuffer(3)]]), 4);
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
  db.close();
}

test('absent inspection neither registers a document nor leaves a new IndexedDB database', async () => {
  const indexedDB = new IDBFactory();
  const id = crypto.randomUUID();
  assert.equal(snapshotRegisteredYDoc(id).state, 'absent');
  const result = await inspectLegacyYDocRecovery(id, { indexedDB });
  assert.equal(result.state, 'absent');
  assert.equal(_getRefCountForTest(id), 0);
  assert.deepEqual(await indexedDB.databases(), []);
  assert.equal(snapshotRegisteredYDoc(id).state, 'absent');
});

test('registry snapshot includes unresolved structs and delete-only evidence without mutation or ref acquisition', t => {
  const id = crypto.randomUUID();
  const registered = getOrCreateYDoc(id);
  t.after(() => { _evictForTest(id); registered.destroy(); });
  const writer = new Y.Doc(); const updates = [];
  writer.on('update', update => updates.push(update));
  writer.getMap('map').set('predecessor', 'first');
  writer.getMap('map').set('pending', 'second');
  Y.applyUpdate(registered, updates[1]);
  const deleter = new Y.Doc(); const deletes = [];
  deleter.on('update', update => deletes.push(update));
  deleter.getMap('deleted').set('gone', 'remove me');
  deleter.getMap('deleted').delete('gone');
  Y.applyUpdate(registered, deletes[1]);
  assert.ok(registered.store.pendingStructs);
  assert.ok(registered.store.pendingDs);
  let changes = 0; registered.on('update', () => changes++);
  const refCount = _getRefCountForTest(id);
  const result = snapshotRegisteredYDoc(id);
  assert.equal(changes, 0);
  assert.equal(_getRefCountForTest(id), refCount);
  assert.ok(result.pending.structs.length);
  assert.ok(result.pending.deleteSet.length);
  assert.ok(result.pending.missing.length);
  const restored = new Y.Doc();
  Y.applyUpdate(restored, result.update);
  Y.applyUpdate(restored, updates[0]); Y.applyUpdate(restored, deletes[0]);
  assert.equal(restored.getMap('map').get('pending'), 'second');
  assert.equal(restored.getMap('deleted').has('gone'), false);
  assert.equal(restored.store.pendingStructs, null);
  assert.equal(restored.store.pendingDs, null);
  const original = registered.store.pendingStructs.update[0];
  result.pending.structs.fill(0); result.pending.deleteSet.fill(0); result.update.fill(0);
  assert.equal(registered.store.pendingStructs.update[0], original, 'returned bytes do not alias live Yjs buffers');
  writer.destroy(); deleter.destroy(); restored.destroy();
});

test('registry-only pending data stays present even when disk is absent', async t => {
  const id = crypto.randomUUID(); const doc = getOrCreateYDoc(id);
  t.after(() => { _evictForTest(id); doc.destroy(); });
  doc.getMap('local').set('unsynced', true);
  const result = await inspectLegacyYDocRecovery(id, { indexedDB: new IDBFactory() });
  assert.equal(result.state, 'present');
  assert.equal(result.registry.state, 'present');
  assert.equal(result.indexedDB.state, 'absent');
  assert.deepEqual(result.provenance, { actorUserId: null, attribution: 'unknown-legacy', automaticImportAllowed: false });
});

test('all old store records, raw keys, and opaque update bytes are read in one readonly transaction unchanged', async () => {
  const indexedDB = new IDBFactory(); const id = crypto.randomUUID();
  await seed(indexedDB, id);
  const modes = [];
  const instrumented = { open: (...args) => {
    const request = indexedDB.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (stores, mode) => { modes.push({ stores: [...stores], mode }); return transaction(stores, mode); };
    });
    return request;
  } };
  const first = await inspectLegacyYDocRecovery(id, { indexedDB: instrumented });
  assert.equal(first.indexedDB.state, 'present');
  assert.deepEqual(modes, [{ stores: ['custom', 'unknown', 'updates'], mode: 'readonly' }]);
  const snapshot = structuredClone(first.indexedDB);
  first.indexedDB.stores.find(store => store.name === 'updates').records[0].value.fill(0);
  const second = await inspectLegacyYDocRecovery(id, { indexedDB });
  assert.deepEqual(second.indexedDB, snapshot);
  assert.equal(second.indexedDB.version, 3);
  assert.ok(second.indexedDB.stores.some(store => store.name === 'unknown'));
  const custom = second.indexedDB.stores.find(store => store.name === 'custom').records;
  assert.ok(custom.some(record => record.key instanceof ArrayBuffer && record.value === 'binary-key'));
  assert.ok(custom.some(record => record.key instanceof Date && record.value === 'date-key'));
});

test('an existing empty unsupported database is present, not silently absent or modified', async () => {
  const indexedDB = new IDBFactory(); const id = crypto.randomUUID();
  await seed(indexedDB, id, { empty: true });
  const result = await inspectLegacyYDocRecovery(id, { indexedDB });
  assert.equal(result.indexedDB.state, 'present');
  assert.deepEqual(result.indexedDB.stores, []);
  assert.equal((await indexedDB.databases())[0].version, 3);
});

test('unavailable, throwing, timed-out, and aborted reads report failure rather than absence', async () => {
  for (const indexedDB of [null, { open() { throw new DOMException('blocked', 'SecurityError'); } }, { open: () => ({}) }]) {
    const result = await inspectLegacyYDocRecovery(crypto.randomUUID(), { indexedDB, timeoutMs: 5 });
    assert.equal(result.state, 'read-failed'); assert.equal(result.indexedDB.state, 'read-failed');
  }
  const factory = new IDBFactory(); const id = crypto.randomUUID(); await seed(factory, id);
  const aborting = { open: (...args) => {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => { const tx = transaction(...parameters); queueMicrotask(() => tx.abort()); return tx; };
    }); return request;
  } };
  assert.equal((await inspectLegacyYDocRecovery(id, { indexedDB: aborting })).indexedDB.state, 'read-failed');
  assert.equal((await inspectLegacyYDocRecovery(id, { indexedDB: factory })).indexedDB.state, 'present');
});

test('JSON export keeps binary slices, opaque values, dates, maps, cycles and unknown provenance', async () => {
  const indexedDB = new IDBFactory(); const id = crypto.randomUUID(); await seed(indexedDB, id);
  const result = await inspectLegacyYDocRecovery(id, { indexedDB });
  result.extra = { bytes: new Uint8Array([99, 2, 3, 88]).subarray(1, 3), blob: new Blob([new Uint8Array([8, 9])]), bigint: 42n, missing: undefined };
  result.extra.self = result.extra;
  const serialized = JSON.parse(JSON.stringify(await buildLegacyYDocRecoveryExport(result)));
  assert.equal(serialized.provenance.actorUserId, null);
  assert.equal(serialized.provenance.automaticImportAllowed, false);
  const binaries = serialized.nodes.filter(node => node.encoding === 'base64').map(node => [...Buffer.from(node.bytes, 'base64')]);
  assert.ok(binaries.some(bytes => JSON.stringify(bytes) === '[255,0,1]'));
  assert.ok(binaries.some(bytes => JSON.stringify(bytes) === '[2,3]'));
  assert.ok(binaries.some(bytes => JSON.stringify(bytes) === '[8,9]'));
  assert.ok(serialized.nodes.some(node => node.type === 'Date' && node.value === '2020-01-01T00:00:00.000Z'));
  assert.ok(serialized.nodes.some(node => node.type === 'Map'));
  assert.ok(serialized.nodes.some(node => node.entries?.some(([key, value]) => key === 'self' && value.ref === node.id)));
});

test('a late successful open after a blocked failure closes its connection', async () => {
  const request = {};
  let closed = 0;
  const pending = inspectLegacyYDocRecovery('late-open-test', { indexedDB: { open: () => request } });
  request.onblocked();
  assert.equal((await pending).indexedDB.state, 'read-failed');
  request.result = { close: () => { closed++; } };
  request.onsuccess();
  assert.equal(closed, 1);
});

test('export refuses unsupported values explicitly and leaves the raw bundle unchanged', async () => {
  class OpaqueValue { constructor() { this.evidence = new Uint8Array([4, 8]); } }
  const raw = { value: new OpaqueValue() };
  await assert.rejects(buildLegacyYDocRecoveryExport(raw), /Unsupported recovery export object/);
  assert.deepEqual([...raw.value.evidence], [4, 8]);
  assert.equal(raw.value.constructor, OpaqueValue);
});

test('real IndexedDB view records roundtrip offsets, full backing bytes, aliases and zero-length windows', async () => {
  const indexedDB = new IDBFactory();
  const id = crypto.randomUUID();
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(id, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('updates');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const backing = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88]).buffer;
  const shared = {
    view: new Uint8Array(backing, 1, 3),
    backing,
    words: new Uint16Array(backing, 2, 2),
    data: new DataView(backing, 3, 2),
    empty: new Uint8Array(backing, 8, 0),
  };
  shared.alias = shared.view;
  shared.self = shared;
  const standalone = new Uint8Array([101, 102, 103, 104]).subarray(1, 2);
  const transaction = db.transaction('updates', 'readwrite');
  transaction.objectStore('updates').put(shared, 'shared');
  transaction.objectStore('updates').put(standalone, 'standalone');
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
  const inspected = await inspectLegacyYDocRecovery(id, { indexedDB });
  const originalStores = structuredClone(inspected.indexedDB.stores);
  const exported = JSON.parse(JSON.stringify(await buildLegacyYDocRecoveryExport(inspected)));
  const restored = decodeRecoveryExport(exported);
  assert.deepEqual(restored.indexedDB.stores, originalStores);
  const records = restored.indexedDB.stores[0].records;
  const actual = records.find(record => record.key === 'shared').value;
  assert.equal(actual.self, actual);
  assert.equal(actual.alias, actual.view);
  for (const name of ['view', 'words', 'data', 'empty']) assert.equal(actual[name].buffer, actual.backing);
  assert.equal(actual.view.byteOffset, 1);
  assert.equal(actual.words.byteOffset, 2);
  assert.equal(actual.data.byteOffset, 3);
  assert.equal(actual.empty.byteOffset, 8);
  assert.equal(actual.empty.byteLength, 0);
  assert.deepEqual([...new Uint8Array(actual.backing)], [11, 22, 33, 44, 55, 66, 77, 88]);
  const actualStandalone = records.find(record => record.key === 'standalone').value;
  assert.equal(actualStandalone.byteOffset, 1);
  assert.deepEqual([...actualStandalone], [102]);
  assert.deepEqual([...new Uint8Array(actualStandalone.buffer)], [101, 102, 103, 104]);
  actual.view[1] = 200;
  assert.equal(new Uint8Array(actual.backing)[2], 200, 'restored aliases share actual memory');
  assert.deepEqual(inspected.indexedDB.stores, originalStores, 'export and restored edits leave the inspection unchanged');
  const reread = await inspectLegacyYDocRecovery(id, { indexedDB });
  assert.deepEqual(reread.indexedDB.stores, originalStores, 'source IndexedDB remains unchanged');
});

test('startup probe reports absence without creating a registry entry or database', async () => {
  const indexedDB = new IDBFactory();
  const id = crypto.randomUUID();
  assert.equal(summarizeRegisteredYDoc(id).state, 'absent');
  const result = await probeLegacyYDocRecovery(id, { indexedDB });
  assert.equal(result.kind, 'probe');
  assert.equal(result.contentRead, false);
  assert.equal(result.state, 'absent');
  assert.equal(result.registry.state, 'absent');
  assert.equal(result.indexedDB.state, 'absent');
  assert.equal(_getRefCountForTest(id), 0);
  assert.deepEqual(await indexedDB.databases(), []);
  assert.equal(result.provenance.actorUserId, null);
  assert.equal(result.provenance.automaticImportAllowed, false);
});

test('startup registry summary does not encode or traverse Yjs content and does not acquire a ref', async t => {
  const id = crypto.randomUUID();
  const doc = getOrCreateYDoc(id);
  doc.getMap('annotations').set('private-content', 'must not be read');
  const originalClients = Object.getOwnPropertyDescriptor(doc.store, 'clients');
  let contentReads = 0;
  Object.defineProperty(doc.store, 'clients', { configurable: true, get() {
    contentReads += 1;
    throw new Error('Yjs payload read forbidden in startup probe');
  } });
  t.after(() => {
    Object.defineProperty(doc.store, 'clients', originalClients);
    _evictForTest(id);
    doc.destroy();
  });
  const refs = _getRefCountForTest(id);
  const summary = summarizeRegisteredYDoc(id);
  assert.equal(summary.state, 'present');
  assert.equal(summary.metadata.rootCount, 1);
  assert.equal(Object.hasOwn(summary, 'update'), false);
  const probe = await probeLegacyYDocRecovery(id, { indexedDB: new IDBFactory() });
  assert.equal(probe.registry.state, 'present');
  assert.equal(contentReads, 0);
  assert.equal(_getRefCountForTest(id), refs);
  assert.equal(JSON.stringify(probe).includes('private-content'), false);
});

test('startup probe reads only schema metadata, never cursor/value/count/write APIs', async () => {
  const indexedDB = new IDBFactory();
  const id = crypto.randomUUID();
  await seed(indexedDB, id);
  const modes = [];
  let forbiddenCalls = 0;
  const instrumented = { open: (...args) => {
    const request = indexedDB.open(...args);
    request.addEventListener('success', () => {
      const db = request.result;
      const transaction = db.transaction.bind(db);
      db.transaction = (stores, mode) => {
        modes.push(mode);
        assert.equal(mode, 'readonly');
        const tx = transaction(stores, mode);
        const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = (name) => {
          const store = objectStore(name);
          const index = store.index.bind(store);
          store.index = (indexName) => {
            const result = index(indexName);
            for (const method of ['get', 'getAll', 'getAllKeys', 'getKey', 'openCursor', 'openKeyCursor', 'count']) {
              result[method] = () => { forbiddenCalls += 1; throw new Error('Startup index content access forbidden'); };
            }
            return result;
          };
          for (const method of ['get', 'getAll', 'getAllKeys', 'getKey', 'openCursor', 'openKeyCursor', 'count', 'put', 'add', 'delete', 'clear']) {
            store[method] = () => { forbiddenCalls += 1; throw new Error('Startup content access forbidden'); };
          }
          return store;
        };
        return tx;
      };
    });
    return request;
  } };
  const probe = await probeLegacyYDocRecovery(id, { indexedDB: instrumented });
  assert.equal(probe.state, 'present');
  assert.equal(probe.registry.state, 'absent');
  assert.equal(probe.indexedDB.state, 'present');
  assert.equal(probe.indexedDB.version, 3);
  assert.deepEqual(probe.indexedDB.stores.map(store => store.name), ['custom', 'unknown', 'updates']);
  assert.deepEqual(probe.indexedDB.stores.find(store => store.name === 'unknown').indexes,
    [{ name: 'probe-schema', keyPath: ['tag', 'kind'], unique: false, multiEntry: false }]);
  assert.ok(probe.indexedDB.stores.every(store => !Object.hasOwn(store, 'records')));
  assert.deepEqual(modes, ['readonly']);
  assert.equal(forbiddenCalls, 0);
  const full = await inspectLegacyYDocRecovery(id, { indexedDB });
  assert.equal(full.indexedDB.stores.find(store => store.name === 'updates').records.length, 2);
});

test('startup probe preserves failed-source status beside present registry or database state', async t => {
  const id = crypto.randomUUID();
  const doc = getOrCreateYDoc(id);
  t.after(() => { _evictForTest(id); doc.destroy(); });
  for (const indexedDB of [null, { open() { throw new DOMException('unavailable', 'SecurityError'); } }, { open: () => ({}) }]) {
    const result = await probeLegacyYDocRecovery(id, { indexedDB, timeoutMs: 5 });
    assert.equal(result.state, 'present');
    assert.equal(result.registry.state, 'present');
    assert.equal(result.indexedDB.state, 'read-failed');
    assert.equal(result.hasReadFailure, true);
  }
  const indexedDB = new IDBFactory();
  await seed(indexedDB, id, { empty: true });
  const originalGuid = Object.getOwnPropertyDescriptor(doc, 'guid');
  Object.defineProperty(doc, 'guid', { configurable: true, get() { throw new Error('Registry summary unavailable'); } });
  try {
    const result = await probeLegacyYDocRecovery(id, { indexedDB });
    assert.equal(result.state, 'present');
    assert.equal(result.registry.state, 'read-failed');
    assert.equal(result.indexedDB.state, 'present');
    assert.deepEqual(result.indexedDB.stores, []);
    assert.equal(result.hasReadFailure, true);
  } finally { Object.defineProperty(doc, 'guid', originalGuid); }
});

test('startup metadata transaction abort reports read failure, leaving the source available', async () => {
  const indexedDB = new IDBFactory(); const id = crypto.randomUUID(); await seed(indexedDB, id);
  const aborting = { open: (...args) => {
    const request = indexedDB.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => {
        const tx = transaction(...parameters);
        queueMicrotask(() => tx.abort());
        return tx;
      };
    }); return request;
  } };
  const failed = await probeLegacyYDocRecovery(id, { indexedDB: aborting });
  assert.equal(failed.state, 'read-failed');
  assert.equal(failed.indexedDB.state, 'read-failed');
  assert.equal((await probeLegacyYDocRecovery(id, { indexedDB })).state, 'present');
});

test('startup probe contains a throwing browser IndexedDB getter within its disk failure state', async t => {
  const id = crypto.randomUUID();
  const doc = getOrCreateYDoc(id);
  t.after(() => { _evictForTest(id); doc.destroy(); });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new DOMException('Blocked origin', 'SecurityError'); } });
  try {
    const result = await probeLegacyYDocRecovery(id);
    assert.equal(result.registry.state, 'present');
    assert.equal(result.indexedDB.state, 'read-failed');
    assert.equal(result.indexedDB.error.name, 'SecurityError');
    assert.equal(result.hasReadFailure, true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else delete globalThis.indexedDB;
  }
});

test('full inspection preserves registry snapshot when the browser IndexedDB getter throws', async t => {
  const id = crypto.randomUUID();
  const doc = getOrCreateYDoc(id);
  doc.getMap('annotations').set('pending', 'available in memory');
  t.after(() => { _evictForTest(id); doc.destroy(); });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new DOMException('Blocked origin', 'SecurityError'); } });
  try {
    const result = await inspectLegacyYDocRecovery(id);
    assert.equal(result.state, 'present');
    assert.equal(result.registry.state, 'present');
    assert.ok(result.registry.update.byteLength > 0);
    assert.equal(result.indexedDB.state, 'read-failed');
    assert.equal(result.indexedDB.error.name, 'SecurityError');
    const recovered = new Y.Doc();
    try {
      Y.applyUpdate(recovered, result.registry.update);
      assert.equal(recovered.getMap('annotations').get('pending'), 'available in memory');
    } finally { recovered.destroy(); }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else delete globalThis.indexedDB;
  }
});

test('synchronous schema/cursor setup failures abort the readonly transaction and clear its timer', async () => {
  for (const failureStage of ['schema', 'cursor']) {
    const indexedDB = new IDBFactory(); const id = crypto.randomUUID(); await seed(indexedDB, id);
    let aborts = 0;
    const failing = { open: (...args) => {
      const request = indexedDB.open(...args);
      request.addEventListener('success', () => {
        const db = request.result; const transaction = db.transaction.bind(db);
        db.transaction = (...parameters) => {
          const tx = transaction(...parameters);
          const abort = tx.abort.bind(tx);
          tx.abort = () => { aborts += 1; return abort(); };
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = name => {
            if (failureStage === 'schema') throw new Error('Injected schema setup failure');
            const store = objectStore(name);
            store.openCursor = () => { throw new Error('Injected cursor setup failure'); };
            return store;
          };
          return tx;
        };
      }); return request;
    } };
    const nativeSetTimeout = globalThis.setTimeout;
    const nativeClearTimeout = globalThis.clearTimeout;
    const pendingTimers = new Set();
    globalThis.setTimeout = (callback, delay, ...args) => {
      const timer = nativeSetTimeout(() => { pendingTimers.delete(timer); callback(...args); }, delay);
      if (delay === 5000) pendingTimers.add(timer);
      return timer;
    };
    globalThis.clearTimeout = timer => { pendingTimers.delete(timer); return nativeClearTimeout(timer); };
    try {
      const result = await inspectLegacyYDocRecovery(id, { indexedDB: failing });
      assert.equal(result.indexedDB.state, 'read-failed');
      assert.match(result.indexedDB.error.message, /Injected .* setup failure/);
      assert.equal(aborts, 1, 'setup failure must abort instead of leaving a live transaction');
      assert.equal(pendingTimers.size, 0, 'no five-second recovery timer remains after rejection');
    } finally {
      for (const timer of pendingTimers) nativeClearTimeout(timer);
      globalThis.setTimeout = nativeSetTimeout;
      globalThis.clearTimeout = nativeClearTimeout;
    }
    assert.equal((await inspectLegacyYDocRecovery(id, { indexedDB })).indexedDB.state, 'present');
  }
});
