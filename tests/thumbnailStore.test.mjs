/* Durable thumbnail cache (owner call 2026-08-07: thumbnails "should be
   basically instant").

   Driven against the REAL IndexedDB code path via fake-indexeddb, which is
   already a devDependency — the store takes an injectable `indexedDb` purely
   so this suite can do that. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import {
  checkedPreviewThumbCacheKey,
  createThumbnailStore,
  thumbCacheKey,
  THUMB_CACHE_BUDGET_BYTES,
} from '../src/services/thumbnailStore.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const thumb = (url = 'data:image/jpeg;base64,AAAA', aspect = 0.7727) => ({ url, aspect });

test('a thumbnail survives a close and reopen — the whole point of the cache', async () => {
  const store = createThumbnailStore({ indexedDb: fakeIndexedDB, timeoutMs: 2000 });
  const key = 'doc-1::u1/abc.pdf';
  assert.equal(await store.get(key), null, 'cold cache misses');

  assert.equal(await store.put(key, thumb()), true);
  const hit = await store.get(key);
  assert.equal(hit.url, 'data:image/jpeg;base64,AAAA');
  assert.equal(hit.aspect, 0.7727);
  await store.close();

  // A NEW store instance over the same database — this models a page reload,
  // which previously re-downloaded and re-rendered every visible thumbnail.
  const reopened = createThumbnailStore({ indexedDb: fakeIndexedDB, timeoutMs: 2000 });
  const afterReload = await reopened.get(key);
  assert.equal(afterReload.url, 'data:image/jpeg;base64,AAAA', 'the render survives a reload');
  await reopened.clear();
  await reopened.close();
});

test('the cache key changes when the file changes, so a re-upload never shows the old page', () => {
  // Content-addressed path: the sha is IN the path, so the key moves with it.
  const v1 = thumbCacheKey({ id: 'doc-1', file_path: 'u1/aaaaaa.pdf' });
  const v2 = thumbCacheKey({ id: 'doc-1', file_path: 'u1/bbbbbb.pdf' });
  assert.notEqual(v1, v2);
  // Legacy path: a fresh epoch-ms filename per upload does the same job.
  assert.notEqual(
    thumbCacheKey({ id: 'doc-1', file_path: 'u1/proj/1778559571622.pdf' }),
    thumbCacheKey({ id: 'doc-1', file_path: 'u1/proj/1780769046309.pdf' }),
  );
  // content_sha256 wins when present, but most rows in the wild carry null —
  // hence the fallback rather than a hard requirement.
  assert.equal(thumbCacheKey({ id: 'd', content_sha256: 'sha1', file_path: 'p' }), 'd::sha1');
  assert.equal(thumbCacheKey({ id: 'd', file_path: 'p' }), 'd::p');
  // Two documents never collide even when they share bytes.
  assert.notEqual(
    thumbCacheKey({ id: 'doc-1', content_sha256: 'same' }),
    thumbCacheKey({ id: 'doc-2', content_sha256: 'same' }),
  );
  // Nothing stable to key on → no caching at all, rather than a wrong hit.
  assert.equal(thumbCacheKey(null), null);
  assert.equal(thumbCacheKey({ id: 'd' }), null);
  assert.equal(thumbCacheKey({ file_path: 'p' }), null);
});

test('the cache is bounded and prunes oldest-first', async () => {
  // A tiny budget so the prune is observable without writing 40MB.
  const store = createThumbnailStore({ indexedDb: fakeIndexedDB, timeoutMs: 2000, budgetBytes: 300 });
  const big = 'd'.repeat(200);
  await store.put('a', thumb(big));
  await new Promise((r) => setTimeout(r, 2));
  await store.put('b', thumb(big));
  await new Promise((r) => setTimeout(r, 2));
  await store.put('c', thumb(big));

  // 3 x 200 bytes over a 300-byte budget: the oldest entries go first.
  assert.notEqual(await store.get('c'), null, 'the newest write is kept');
  assert.equal(await store.get('a'), null, 'the oldest write is evicted');
  // The cache is genuinely bounded, not merely reordered.
  const surviving = (await Promise.all(['a', 'b', 'c'].map((k) => store.get(k)))).filter(Boolean);
  assert.ok(surviving.length < 3, 'the budget actually evicts');
  await store.clear();
  await store.close();

  assert.equal(THUMB_CACHE_BUDGET_BYTES, 40 * 1024 * 1024);
});

test('a broken IndexedDB degrades to no cache instead of breaking thumbnails', async () => {
  // No indexedDB at all (SSR, or a browser in a mode that forbids it).
  const none = createThumbnailStore({ indexedDb: undefined });
  assert.equal(none.isDisabled, true);
  assert.equal(await none.get('k'), null);
  assert.equal(await none.put('k', thumb()), false, 'a write is a no-op, never a throw');

  // An indexedDB whose open always fails.
  const broken = createThumbnailStore({
    indexedDb: { open: () => { const r = {}; setTimeout(() => r.onerror && r.onerror(), 0); return r; } },
    timeoutMs: 200,
  });
  assert.equal(await broken.get('k'), null);
  assert.equal(await broken.put('k', thumb()), false);
});

test('checked preview cache keys bind actor, document, generation, and model', () => {
  const descriptor = {
    version: 1,
    mode: 'checked',
    actorUserId: 'ca000000-0000-4000-8000-000000000001',
    documentId: 'ca000000-0000-4000-8000-000000000002',
    pdfGenerationId: 'ca000000-0000-4000-8000-000000000003',
    contentModelVersion: 2,
  };
  descriptor.cacheKey = JSON.stringify(['document-preview-v1', descriptor.actorUserId,
    descriptor.documentId, descriptor.pdfGenerationId, descriptor.contentModelVersion]);
  assert.equal(checkedPreviewThumbCacheKey(descriptor), descriptor.cacheKey);
  assert.equal(checkedPreviewThumbCacheKey({ ...descriptor, documentId: 'ca000000-0000-4000-8000-000000000004' }), null);
  assert.equal(checkedPreviewThumbCacheKey({ ...descriptor, cacheKey: `${descriptor.cacheKey}-wrong` }), null);
  assert.equal(checkedPreviewThumbCacheKey({ ...descriptor, mode: 'legacy', cacheKey: null }), null);
});

test('PdfPageThumb checks the durable cache before downloading or queueing', () => {
  // Keep the cloud cache-first ordering explicit; mounted local-source and
  // queue-priority behavior is covered by thumbnailLocalCoalescing.test.mjs.
  const THUMB = read('../src/home/PdfPageThumb.jsx');
  assert.match(THUMB, /import \{ checkedPreviewThumbCacheKey, thumbnailStore, thumbCacheKey \} from '\.\.\/services\/thumbnailStore'/);

  const body = THUMB.match(/let persistKey = doc\?\.file \|\| doc\?\.dataUrl \? null : thumbCacheKey\(doc\);[\s\S]*?\}\)\(\);/)[0];
  const idbAt = body.indexOf('thumbnailStore().get(persistKey)');
  const downloadAt = body.indexOf('resolvePdfBytes(doc, downloadDocument)');
  const slotAt = body.indexOf('acquireSlot(priority, requestKey)');
  assert.ok(idbAt > -1 && downloadAt > -1 && slotAt > -1);
  assert.ok(idbAt < downloadAt, 'the durable cache is read BEFORE the PDF is downloaded');
  assert.ok(idbAt < slotAt, 'a cache hit never waits on the render queue');
  // A hit returns immediately — it must not fall through into the render path.
  assert.match(body, /if \(stored\) return stored;/);
  // Stable cloud sources persist for later visits. Supplied local bytes may
  // have replaced the metadata path's original PDF, so bypass that old key.
  assert.match(body, /if \(persistKey\) void thumbnailStore\(\)\.put\(persistKey, result\)/);
});
