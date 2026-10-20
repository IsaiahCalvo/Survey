/**
 * Sets globalThis.window before crdtDualWriteQueue.js is evaluated so it
 * installs the window.__clearDualWriteQueue DevTools helper.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

await import('../src/lib/collab/crdtDualWriteQueue.js');

test('crdtDualWriteQueue exposes DevTools clear helper on window', () => {
  assert.equal(typeof globalThis.window.__clearDualWriteQueue, 'function');
  const result = globalThis.window.__clearDualWriteQueue();
  assert.ok(result);
  assert.ok('cleared' in result);
});
