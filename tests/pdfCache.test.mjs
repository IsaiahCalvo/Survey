import test from 'node:test';
import assert from 'node:assert/strict';

import { PageRenderCache } from '../src/utils/pdfCache.js';

test('PageRenderCache get/set/has and clear work with bitmap fallback', async () => {
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ close() {} });
  try {
    const cache = new PageRenderCache(2);
    assert.equal(cache.get(1, 1), null);
    await cache.set(1, 1, {}, { width: 10 });
    assert.equal(cache.has(1, 1), true);
    assert.equal(cache.get(1, 1).pageNumber, 1);

    await cache.set(2, 1, {}, { width: 10 });
    await cache.set(3, 1, {}, { width: 10 }); // evicts LRU
    assert.equal(cache.has(1, 1), false);
    assert.equal(cache.has(3, 1), true);

    cache.clearForScale(1);
    assert.equal(cache.has(3, 1), false);

    await cache.set(4, 2, {}, { width: 10 });
    cache.clear();
    assert.equal(cache.get(4, 2), null);
  } finally {
    if (original === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = original;
  }
});

test('PageRenderCache tolerates createImageBitmap failure', async () => {
  const original = globalThis.createImageBitmap;
  const originalWarn = console.warn;
  console.warn = () => {};
  globalThis.createImageBitmap = async () => {
    throw new Error('no bitmap');
  };
  try {
    const cache = new PageRenderCache();
    const value = await cache.set(1, 1.25, {}, { width: 1 });
    assert.equal(value.bitmap, null);
    assert.equal(cache.has(1, 1.25), true);
  } finally {
    console.warn = originalWarn;
    if (original === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = original;
  }
});

test('PageRenderCache swallows bitmap.close errors on eviction and clear', async () => {
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({
    close() { throw new Error('close failed'); },
  });
  try {
    const cache = new PageRenderCache(1);
    await cache.set(1, 1, {}, { width: 1 });
    await cache.set(2, 1, {}, { width: 1 }); // evict page 1 → close throws
    assert.equal(cache.has(1, 1), false);
    await cache.set(3, 2, {}, { width: 1 });
    cache.clearForScale(2);
    assert.equal(cache.has(3, 2), false);
    await cache.set(4, 1, {}, { width: 1 });
    cache.clear();
    assert.equal(cache.get(4, 1), null);
  } finally {
    if (original === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = original;
  }
});
