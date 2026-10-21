import test from 'node:test';
import assert from 'node:assert/strict';
import { keepScreenAwake } from '../src/agent/keepAwake.js';

function fakes() {
  const locks = [];
  const listeners = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  const nav = {
    wakeLock: {
      async request(kind) {
        const lock = { kind, released: false, handlers: [], addEventListener(t, fn) { this.handlers.push(fn); }, async release() { this.released = true; this.handlers.forEach((f) => f()); } };
        locks.push(lock);
        return lock;
      },
    },
  };
  return { locks, listeners, doc, nav };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('takes a screen lock, takes it again when the page comes back, and lets go', async () => {
  const { locks, listeners, doc, nav } = fakes();
  const awake = keepScreenAwake({ nav, doc });
  await tick();
  assert.equal(locks.length, 1);
  assert.equal(locks[0].kind, 'screen');
  // Hidden: the browser drops the lock; visible again: taken again.
  await locks[0].release();
  doc.visibilityState = 'visible';
  listeners.visibilitychange();
  await tick();
  assert.equal(locks.length, 2);
  awake.release();
  assert.equal(locks[1].released, true);
  assert.equal(listeners.visibilitychange, undefined);
});

test('no Wake Lock: nothing happens', () => {
  const awake = keepScreenAwake({ nav: {}, doc: null });
  assert.equal(awake.supported, false);
  awake.release();
});
