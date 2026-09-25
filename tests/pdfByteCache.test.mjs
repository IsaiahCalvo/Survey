/* w36 (2026-09-25): device cache for cloud PDF bytes (stay inside Supabase
   Free). Driven against the real IndexedDB code path via fake-indexeddb.

   The rule it must keep (services/storageDownloads.js, #802): every open still
   passes the server's CURRENT access check. So the check runs on every read,
   cached bytes need the check to succeed and name the cached version, and
   anything else downloads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  createPdfByteCache,
  readPdfThroughCache,
  bindPdfCacheToAuth,
  pdfCacheKey,
  pdfCacheStamp,
  isStorageRefusal,
  seedPdfCacheFromUpload,
} from '../src/services/pdfByteCache.js';

const PATH = 'user-a/abc123.pdf';
const pdfBytes = (n, fill = 7) => {
  const bytes = new Uint8Array(n);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  bytes.fill(fill, 5);
  return bytes;
};
const infoFor = (bytes, version = 'v1') => ({
  data: { version, etag: `"etag-${version}"`, size: bytes.byteLength, lastModified: '2026-09-25T10:00:00Z' },
  error: null,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function harness({ budgetBytes, maxEntryBytes, now } = {}) {
  const cache = createPdfByteCache({ indexedDb: new IDBFactory(), timeoutMs: 2000, budgetBytes, maxEntryBytes, now });
  const server = { bytes: pdfBytes(1000), version: 'v1', refuse: null, offline: false };
  const calls = { info: 0, download: 0 };
  const read = (actorId = 'user-a', path = PATH) => readPdfThroughCache({
    cache,
    actorId,
    path,
    fetchInfo: async () => {
      calls.info += 1;
      if (server.offline) throw new TypeError('Failed to fetch');
      if (server.refuse) return { data: null, error: server.refuse };
      return infoFor(server.bytes, server.version);
    },
    download: async () => {
      calls.download += 1;
      if (server.offline) throw new TypeError('Failed to fetch');
      if (server.refuse) throw server.refuse;
      return new Blob([server.bytes], { type: 'application/pdf' });
    },
  });
  return { cache, server, calls, read };
}

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

test('reopening an unchanged PDF downloads nothing, but still asks Storage every time', async () => {
  const { read, calls, server } = harness();
  const first = await read();
  assert.deepEqual(await bytesOf(first), server.bytes);
  assert.equal(calls.download, 1);
  await settle();

  for (let i = 0; i < 3; i += 1) {
    const again = await read();
    assert.deepEqual(await bytesOf(again), server.bytes, 'the cached copy is the same bytes');
    assert.equal(again.type, 'application/pdf');
  }
  assert.equal(calls.download, 1, 'three reopens, zero downloads');
  assert.equal(calls.info, 4, 'every read, cached or not, passed the Storage access check');
});

test('a replaced file (new version) downloads again and the new bytes are cached', async () => {
  const { read, calls, server } = harness();
  await read();
  await settle();
  server.bytes = pdfBytes(1200, 9);
  server.version = 'v2';
  const changed = await read();
  assert.deepEqual(await bytesOf(changed), server.bytes, 'never the stale copy');
  assert.equal(calls.download, 2);
  await settle();
  await read();
  assert.equal(calls.download, 2, 'the new version is served from the cache next time');
});

test('same size, new version: the stamp, not the length, decides', async () => {
  const { read, calls, server } = harness();
  await read();
  await settle();
  server.bytes = pdfBytes(1000, 3);
  server.version = 'v2';
  assert.deepEqual(await bytesOf(await read()), server.bytes);
  assert.equal(calls.download, 2);
});

test('access revoked: the cached copy is never served and is dropped', async () => {
  const { read, calls, server, cache } = harness();
  await read();
  await settle();
  server.refuse = Object.assign(new Error('Object not found'), { status: 400 });
  await assert.rejects(read(), /not found/i, 'the open fails exactly as it would without a cache');
  assert.equal(calls.download, 2, 'fell through to the real download, which the server refused');
  assert.equal((await cache.stats()).entries, 0, 'the refused file left this device');
  server.refuse = null;
  await read();
  assert.equal(calls.download, 3, 'access back: downloaded again (nothing was kept)');
});

test('offline or a failed check never serves cached bytes (fails closed)', async () => {
  const { read, calls, server, cache } = harness();
  await read();
  await settle();
  server.offline = true;
  await assert.rejects(read(), /Failed to fetch/);
  assert.equal(calls.download, 2);
  assert.equal((await cache.stats()).entries, 1, 'a network error is not a refusal: the copy stays for the next online open');
  server.offline = false;
  await read();
  assert.equal(calls.download, 2, 'back online: served from the cache again');
});

test('accounts never share cached bytes', async () => {
  const { read, calls } = harness();
  await read('user-a');
  await settle();
  await read('user-b');
  assert.equal(calls.download, 2, 'user B pays its own download (and its own access check)');
  assert.notEqual(pdfCacheKey('user-a', PATH), pdfCacheKey('user-b', PATH));
  assert.equal(pdfCacheKey(null, PATH), null, 'signed out: no key, no cache');
});

test('signed out (no account id): straight download, nothing stored', async () => {
  const { read, calls, cache } = harness();
  await read(null);
  await settle();
  await read(null);
  assert.equal(calls.download, 2);
  assert.equal(calls.info, 0);
  assert.equal((await cache.stats()).entries, 0);
});

test('non-PDF storage files (survey data JSON) are not cached', async () => {
  const { read, calls } = harness();
  await read('user-a', 'project/doc_data.json');
  await settle();
  await read('user-a', 'project/doc_data.json');
  assert.equal(calls.download, 2);
  assert.equal(calls.info, 0);
});

test('bytes whose length disagrees with the named version are not cached', async () => {
  const { cache, calls } = harness();
  const real = pdfBytes(1000);
  const read = () => readPdfThroughCache({
    cache,
    actorId: 'user-a',
    path: PATH,
    fetchInfo: async () => infoFor(pdfBytes(900), 'v1'), // replaced between the check and the download
    download: async () => { calls.download += 1; return new Blob([real]); },
  });
  await read();
  await settle();
  await read();
  assert.equal(calls.download, 2);
  assert.equal((await cache.stats()).entries, 0);
});

test('no version and no etag: nothing trustworthy to compare, so no cache', () => {
  assert.equal(pdfCacheStamp({ size: 10 }), null);
  assert.equal(pdfCacheStamp({ etag: 'x', size: 0 }), null);
  assert.ok(pdfCacheStamp({ etag: 'x', size: 10 }));
  assert.notEqual(pdfCacheStamp({ version: 'a', etag: 'x', size: 10 }), pdfCacheStamp({ version: 'b', etag: 'x', size: 10 }));
});

test('bounded: least-recently-used files are evicted to stay under the budget', async () => {
  let clock = 1;
  const cache = createPdfByteCache({ indexedDb: new IDBFactory(), timeoutMs: 2000, budgetBytes: 2500, now: () => clock++ });
  const stamp = (v) => JSON.stringify([v]);
  const put = (path, n) => cache.put({ actorId: 'a', path, stamp: stamp(path), bytes: pdfBytes(n).buffer });
  assert.equal(await put('a/1.pdf', 1000), true);
  assert.equal(await put('a/2.pdf', 1000), true);
  assert.ok(await cache.get(pdfCacheKey('a', 'a/1.pdf'), stamp('a/1.pdf')), 'touch 1: 2 is now the oldest');
  await settle();
  assert.equal(await put('a/3.pdf', 1000), true);
  assert.equal(await cache.get(pdfCacheKey('a', 'a/2.pdf'), stamp('a/2.pdf')), null, 'least recently used went');
  assert.ok(await cache.get(pdfCacheKey('a', 'a/1.pdf'), stamp('a/1.pdf')));
  assert.ok(await cache.get(pdfCacheKey('a', 'a/3.pdf'), stamp('a/3.pdf')));
  const stats = await cache.stats();
  assert.equal(stats.entries, 2);
  assert.equal(stats.bytes, 2000);
  assert.equal(await put('a/huge.pdf', 3000), false, 'a file bigger than the whole budget is not kept');
  assert.equal((await cache.stats()).entries, 2, 'and evicts nothing');
});

test('replacing a path keeps the byte total exact', async () => {
  const cache = createPdfByteCache({ indexedDb: new IDBFactory(), timeoutMs: 2000, budgetBytes: 10_000 });
  await cache.put({ actorId: 'a', path: 'a/1.pdf', stamp: 's1', bytes: pdfBytes(1000).buffer });
  await cache.put({ actorId: 'a', path: 'a/1.pdf', stamp: 's2', bytes: pdfBytes(1500).buffer });
  assert.deepEqual(await cache.stats(), { entries: 1, bytes: 1500 });
  assert.equal(await cache.get(pdfCacheKey('a', 'a/1.pdf'), 's1'), null, 'old stamp no longer matches');
  await cache.removePath('a/1.pdf');
  assert.deepEqual(await cache.stats(), { entries: 0, bytes: 0 });
});

test('a local upload/replace/delete of a path drops every account\'s copy of it', async () => {
  const cache = createPdfByteCache({ indexedDb: new IDBFactory(), timeoutMs: 2000 });
  await cache.put({ actorId: 'a', path: 'x/1.pdf', stamp: 's', bytes: pdfBytes(100).buffer });
  await cache.put({ actorId: 'b', path: 'x/1.pdf', stamp: 's', bytes: pdfBytes(100).buffer });
  await cache.put({ actorId: 'a', path: 'x/2.pdf', stamp: 's', bytes: pdfBytes(100).buffer });
  await cache.removePath('x/1.pdf');
  assert.deepEqual(await cache.stats(), { entries: 1, bytes: 100 });
});

test('sign-out empties the cache; a different account signing in keeps only its own entries', async () => {
  const cache = createPdfByteCache({ indexedDb: new IDBFactory(), timeoutMs: 2000 });
  let emit;
  bindPdfCacheToAuth({ auth: { onAuthStateChange(fn) { emit = fn; } } }, cache);
  await cache.put({ actorId: 'a', path: 'a/1.pdf', stamp: 's', bytes: pdfBytes(100).buffer });
  await cache.put({ actorId: 'b', path: 'b/1.pdf', stamp: 's', bytes: pdfBytes(100).buffer });
  emit('INITIAL_SESSION', { user: { id: 'a' } });
  await settle();
  assert.deepEqual(await cache.stats(), { entries: 1, bytes: 100 }, "b's bytes left when a signed in");
  emit('TOKEN_REFRESHED', { user: { id: 'a' } });
  await settle();
  assert.equal((await cache.stats()).entries, 1, 'a token refresh keeps the cache');
  emit('SIGNED_OUT', null);
  await settle();
  assert.deepEqual(await cache.stats(), { entries: 0, bytes: 0 }, 'sign-out leaves nothing on this device');
});

test('a signed-out start clears what a previous session left (its clear never committed)', async () => {
  const factory = new IDBFactory();
  const before = createPdfByteCache({ indexedDb: factory, timeoutMs: 2000 });
  await before.put({ actorId: 'a', path: 'a/1.pdf', stamp: 's', bytes: pdfBytes(100).buffer });
  await before.close();
  const after = createPdfByteCache({ indexedDb: factory, timeoutMs: 2000 });
  let emit;
  bindPdfCacheToAuth({ auth: { onAuthStateChange(fn) { emit = fn; } } }, after);
  emit('INITIAL_SESSION', null);
  await settle();
  assert.equal((await after.stats()).entries, 0);
});

test('a write in flight when the account signs out does not survive the clear', async () => {
  const cache = createPdfByteCache({ indexedDb: new IDBFactory(), timeoutMs: 2000 });
  const pending = cache.put({ actorId: 'a', path: 'a/1.pdf', stamp: 's', bytes: pdfBytes(100).buffer });
  await cache.clear();
  await pending;
  await settle();
  assert.equal((await cache.stats()).entries, 0);
});

test('the cache survives a reload (a new instance over the same database)', async () => {
  const factory = new IDBFactory();
  const first = createPdfByteCache({ indexedDb: factory, timeoutMs: 2000 });
  await first.put({ actorId: 'a', path: 'a/1.pdf', stamp: 's', bytes: pdfBytes(100).buffer });
  await first.close();
  const second = createPdfByteCache({ indexedDb: factory, timeoutMs: 2000 });
  const hit = await second.get(pdfCacheKey('a', 'a/1.pdf'), 's');
  assert.equal(hit.byteLength, 100);
});

test('no IndexedDB (private mode): every read is a plain download', async () => {
  const cache = createPdfByteCache({ indexedDb: undefined });
  assert.equal(cache.isDisabled, true);
  let downloads = 0;
  let infos = 0;
  const read = () => readPdfThroughCache({
    cache, actorId: 'a', path: PATH,
    fetchInfo: async () => { infos += 1; return infoFor(pdfBytes(10)); },
    download: async () => { downloads += 1; return new Blob([pdfBytes(10)]); },
  });
  await read();
  await read();
  assert.equal(downloads, 2);
  assert.equal(infos, 0, 'no cache, no extra metadata request');
});

test('storage refusals are recognised; network errors are not', () => {
  assert.equal(isStorageRefusal({ status: 400, message: 'Object not found' }), true);
  assert.equal(isStorageRefusal({ statusCode: 403 }), true);
  assert.equal(isStorageRefusal({ originalError: { status: 404 } }), true);
  assert.equal(isStorageRefusal(new TypeError('Failed to fetch')), false);
  assert.equal(isStorageRefusal({ status: 500, message: 'Internal' }), false);
});

test('an upload seeds the cache, so the uploader\'s first reopen downloads nothing', async () => {
  const { cache, read, calls, server } = harness();
  const file = new Blob([server.bytes], { type: 'application/pdf' });
  const seeded = await seedPdfCacheFromUpload({
    cache, actorId: 'user-a', path: PATH, file, fetchInfo: async () => infoFor(server.bytes, server.version),
  });
  assert.equal(seeded, true);
  assert.deepEqual(await bytesOf(await read()), server.bytes);
  assert.equal(calls.download, 0);
  assert.equal(calls.info, 1, 'the reopen still passed the access check');
});

test('an upload is not seeded when Storage names a different size or refuses', async () => {
  const cache = createPdfByteCache({ indexedDb: new IDBFactory(), timeoutMs: 2000 });
  const file = new Blob([pdfBytes(100)]);
  assert.equal(await seedPdfCacheFromUpload({ cache, actorId: 'a', path: PATH, file, fetchInfo: async () => infoFor(pdfBytes(99)) }), false);
  assert.equal(await seedPdfCacheFromUpload({ cache, actorId: 'a', path: PATH, file, fetchInfo: async () => ({ error: { status: 400 } }) }), false);
  assert.equal(await seedPdfCacheFromUpload({ cache, actorId: 'a', path: 'a/data.json', file, fetchInfo: async () => infoFor(pdfBytes(100)) }), false);
  assert.equal((await cache.stats()).entries, 0);
});
