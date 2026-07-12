/**
 * Runs early so loadTrace.js installs window.__loadTrace helpers (lines 59-75).
 * Node's navigator is a getter-only global — redefine via defineProperty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    clipboard: {
      writeText: async () => {},
    },
  },
});

await import('../src/utils/loadTrace.js');
const { loadTraceReset, dumpLoadTrace } = await import('../src/utils/loadTrace.js');

test('loadTrace window helpers copy and clear', async () => {
  assert.equal(typeof globalThis.window.__loadTrace, 'function');
  assert.equal(typeof globalThis.window.__lastLoadTrace, 'function');
  assert.equal(typeof globalThis.window.__clearLoadTrace, 'function');

  loadTraceReset('tick63');
  const live = globalThis.window.__loadTrace();
  assert.match(live, /OPEN START/);
  assert.ok(dumpLoadTrace().includes('OPEN START'));

  const prev = globalThis.window.__lastLoadTrace();
  assert.ok(typeof prev === 'string');

  globalThis.window.__clearLoadTrace();
  assert.equal(dumpLoadTrace(), '');
});
