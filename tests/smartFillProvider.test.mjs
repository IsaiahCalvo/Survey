// Owner 2026-10-20: Smart fill provider — still-loading canvas and per-tap worker limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropAroundTap, readSmartFillOutline, readSmartFillOutlineAsync } from '../src/survey/smartFillProvider.js';

const PLACEHOLDER = { width: 300, height: 150 };
const PLOT_2_TO_1 = { width: 2592, height: 1296 }; // 36×18 in
const LETTER = { width: 612, height: 792 };
const TAP = { point: { x: 120, y: 80 } };

test('undrawn 300×150 canvas is not ready, including 2:1 plot sheets', () => {
  assert.equal(cropAroundTap({ ...TAP, pageSize: PLOT_2_TO_1, pageCanvas: PLACEHOLDER }), null);
  assert.equal(readSmartFillOutline({ ...TAP, pageSize: PLOT_2_TO_1, pageCanvas: PLACEHOLDER }).reason, 'not-ready');
  assert.equal(cropAroundTap({ ...TAP, pageSize: LETTER, pageCanvas: PLACEHOLDER }), null);
  assert.equal(cropAroundTap({ ...TAP, pageSize: LETTER, pageCanvas: { width: 612, height: 200 } }), null);
});

class FakeWorker {
  constructor() {
    FakeWorker.instances.push(this);
    this.listeners = { message: [], error: [] };
    this.terminated = false;
    this.messages = [];
  }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  removeEventListener(type, fn) {
    const list = this.listeners[type];
    if (list) this.listeners[type] = list.filter((h) => h !== fn);
  }
  postMessage(data) { this.messages.push(data); }
  terminate() { this.terminated = true; }
}
FakeWorker.instances = [];

function installFakeDocument() {
  globalThis.document = {
    createElement() {
      const data = new Uint8ClampedArray(16);
      return {
        width: 2,
        height: 2,
        getContext() {
          return {
            fillStyle: '',
            fillRect() {},
            drawImage() {},
            getImageData() { return { data }; },
          };
        },
      };
    },
  };
}

test('timeout and abort terminate the shared worker so the next tap is not queued behind it', async (t) => {
  installFakeDocument();
  FakeWorker.instances = [];
  const previousWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const ctx = { ...TAP, pageSize: PLOT_2_TO_1, pageCanvas: { width: 2592, height: 1296 } };
    const first = readSmartFillOutlineAsync(ctx);
    assert.equal(FakeWorker.instances.length, 1);
    const w1 = FakeWorker.instances[0];
    t.mock.timers.tick(2500);
    assert.deepEqual(await first, { ok: false, reason: 'timeout' });
    assert.equal(w1.terminated, true);

    const ac = new AbortController();
    const second = readSmartFillOutlineAsync({ ...ctx, signal: ac.signal });
    assert.equal(FakeWorker.instances.length, 2, 'a new worker starts the next tap');
    const w2 = FakeWorker.instances[1];
    ac.abort();
    assert.deepEqual(await second, { ok: false, reason: 'aborted' });
    assert.equal(w2.terminated, true);

    readSmartFillOutlineAsync(ctx);
    assert.equal(FakeWorker.instances.length, 3, 'abort also frees the worker for the following tap');
    assert.equal(FakeWorker.instances[2].terminated, false);
  } finally {
    t.mock.timers.reset();
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
  }
});
