/**
 * Runs early so crdtDualWriteQueue.js sees globalThis.window when evaluated
 * and installs window.__clearDualWriteQueue (lines 289-291).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

const mod = await import('../src/lib/collab/crdtDualWriteQueue.js');
assert.equal(typeof globalThis.window.__clearDualWriteQueue, 'function');
assert.equal(mod.clearAllDualWriteQueuesAndFlags, globalThis.window.__clearDualWriteQueue);

test('crdtDualWriteQueue exposes DevTools clear helper on window', () => {
  const result = globalThis.window.__clearDualWriteQueue();
  assert.ok(result);
  assert.ok('cleared' in result);
});
