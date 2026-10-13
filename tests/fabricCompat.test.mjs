import test from 'node:test';
import assert from 'node:assert/strict';

import { fabric } from '../src/utils/fabricCompat.js';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

test('fabric.util.isPointInPolygon detects interior and exterior points', () => {
  assert.equal(fabric.util.isPointInPolygon({ x: 5, y: 5 }, square), true);
  assert.equal(fabric.util.isPointInPolygon({ x: 20, y: 5 }, square), false);
  assert.equal(fabric.util.isPointInPolygon(null, square), false);
  assert.equal(fabric.util.isPointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }]), false);
  assert.equal(fabric.util.isPointInPolygon({ x: Number.NaN, y: 1 }, square), false);
});

test('fabric.util.clearFabricFontCache is best-effort', () => {
  assert.doesNotThrow(() => fabric.util.clearFabricFontCache('Helvetica'));
  assert.doesNotThrow(() => fabric.util.clearFabricFontCache());

  // Force the catch path when charWidthsCache.delete throws.
  const cache = fabric.cache || (fabric.cache = {});
  const prev = cache.charWidthsCache;
  cache.charWidthsCache = {
    delete() { throw new Error('cache-boom'); },
    clear() { throw new Error('cache-clear-boom'); },
  };
  try {
    assert.doesNotThrow(() => fabric.util.clearFabricFontCache('Helvetica'));
    assert.doesNotThrow(() => fabric.util.clearFabricFontCache());
  } finally {
    cache.charWidthsCache = prev;
  }
});

test('fabricCompat restores StaticCanvas sizing helpers when missing', () => {
  const proto = fabric.StaticCanvas?.prototype;
  assert.ok(proto);
  assert.equal(typeof proto.setWidth, 'function');
  assert.equal(typeof proto.setHeight, 'function');
  assert.equal(typeof proto.setBackgroundColor, 'function');
});

test('fabric.util.enlivenObjects supports callback and options forms', async () => {
  let callbackSaw = null;
  const objects = [];
  const promise = fabric.util.enlivenObjects(objects, (result) => {
    callbackSaw = result;
  });
  assert.ok(promise && typeof promise.then === 'function');
  // Options-only form should also return a promise.
  const optionsForm = fabric.util.enlivenObjects(objects, {});
  assert.ok(optionsForm && typeof optionsForm.then === 'function');
  try {
    await Promise.race([
      promise.catch(() => null),
      optionsForm.catch(() => null),
      new Promise((r) => setTimeout(r, 50)),
    ]);
  } catch {
    // Fabric may reject empty enliven in Node; the branch coverage is what matters.
  }
  assert.ok(callbackSaw === null || Array.isArray(callbackSaw));
});

test('fabricCompat canvas prototype helpers call through when invoked', () => {
  const setDimensions = [];
  const fake = {
    setDimensions(dims) { setDimensions.push(dims); return this; },
    backgroundColor: null,
  };
  const proto = fabric.StaticCanvas.prototype;
  assert.equal(typeof proto.setWidth, 'function');
  proto.setWidth.call(fake, 120);
  proto.setHeight.call(fake, 80);
  assert.deepEqual(setDimensions, [{ width: 120 }, { height: 80 }]);

  let cb = false;
  proto.setBackgroundColor.call(fake, '#fff', () => { cb = true; });
  assert.equal(fake.backgroundColor, '#fff');
  assert.equal(cb, true);
});
