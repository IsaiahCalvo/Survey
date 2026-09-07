import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createThumbnailStore } from '../src/services/thumbnailStore.js';

const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onabort = () => reject(tx.error || new Error('aborted'));
});
const open = (idb, version) => new Promise((resolve, reject) => {
  const request = idb.open('survey-thumbnail-cache-v1', version);
  request.onerror = () => reject(request.error);
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore('thumbs', { keyPath: 'key' });
    store.createIndex('savedAt', 'savedAt');
  };
  request.onsuccess = () => resolve(request.result);
});

test('v1 upgrade preserves thumbnails and backfills usage before budget eviction', async () => {
  const idb = new IDBFactory();
  const legacy = await open(idb, 1);
  const tx = legacy.transaction('thumbs', 'readwrite');
  const committed = done(tx);
  tx.objectStore('thumbs').put({ key: 'old', url: 'a'.repeat(200), aspect: 1, savedAt: 1 });
  await committed;
  legacy.close();
  const store = createThumbnailStore({ indexedDb: idb, budgetBytes: 300 });
  assert.equal((await store.get('old')).url.length, 200);
  assert.equal(await store.put('new', { url: 'b'.repeat(200), aspect: 2 }), true);
  assert.equal(await store.get('old'), null);
  assert.equal((await store.get('new')).aspect, 2);
  await store.close();
});

test('writes never load every JPEG and concurrent instances keep an atomic byte budget', async () => {
  const idb = new IDBFactory();
  const a = createThumbnailStore({ indexedDb: idb, budgetBytes: 300 });
  const b = createThumbnailStore({ indexedDb: idb, budgetBytes: 300 });
  const getAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = () => { throw new Error('unbounded blob scan'); };
  try {
    assert.deepEqual(await Promise.all(Array.from({ length: 30 }, (_, i) =>
      (i % 2 ? a : b).put(`k${i}`, { url: 'x'.repeat(100), aspect: 1 }),
    )), Array(30).fill(true));
    const rows = await Promise.all(Array.from({ length: 30 }, (_, i) => a.get(`k${i}`)));
    assert.equal(rows.filter(Boolean).length, 3);
    assert.equal(await a.put('k29', { url: 'y'.repeat(250), aspect: 2 }), true);
    assert.equal((await a.get('k29')).url.length, 250);
    assert.equal(await a.get('k28'), null);
    assert.equal(await a.put('huge', { url: 'z'.repeat(301) }), false);
    assert.ok(await a.get('k29'), 'oversized entry must not evict useful cached work');
  } finally {
    IDBObjectStore.prototype.getAll = getAll;
    await a.close(); await b.close();
  }
});

test('an abort after put success is reported false and rolls back all eviction', async () => {
  const idb = new IDBFactory();
  const store = createThumbnailStore({ indexedDb: idb, budgetBytes: 300 });
  await store.put('old', { url: 'x'.repeat(250) });
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...args) {
    const request = put.call(this, value, ...args);
    if (this.name === 'thumbs' && value.key === 'fail') {
      request.addEventListener('success', () => this.transaction.abort());
    }
    return request;
  };
  try {
    assert.equal(await store.put('fail', { url: 'y'.repeat(250) }), false);
    assert.ok(await store.get('old'));
    assert.equal(await store.get('fail'), null);
  } finally { IDBObjectStore.prototype.put = put; }
  assert.equal(await store.put('retry', { url: 'r'.repeat(250) }), true);
  assert.equal(await store.get('old'), null);
  await store.clear();
  assert.equal(await store.put('after-clear', { url: 'a'.repeat(300) }), true);
  assert.ok(await store.get('after-clear'));
  await store.close();
});
