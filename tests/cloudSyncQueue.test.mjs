import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enqueueSync,
  getQueueSize,
  drainQueue,
} from '../src/services/cloudSyncQueue.js';

async function withLocalStorage(fn) {
  const store = new Map();
  const mock = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
  };
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: mock,
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    } else {
      delete globalThis.localStorage;
    }
  }
}

test('cloudSyncQueue enqueues and drains successful entries', async () => {
  await withLocalStorage(async () => {
    enqueueSync('doc-ok', { kind: 'fabric', payload: { a: 1 } });
    enqueueSync('doc-ok', { kind: 'delete', payload: { id: 'x' } });
    assert.equal(getQueueSize('doc-ok'), 2);
    const result = await drainQueue('doc-ok', async () => ({ success: true }));
    assert.deepEqual(result, { flushed: 2, remaining: 0 });
    assert.equal(getQueueSize('doc-ok'), 0);
  });
});

test('cloudSyncQueue keeps failed and thrown entries for retry', async () => {
  await withLocalStorage(async () => {
    enqueueSync('doc-retry', { kind: 'fabric', payload: 1 });
    enqueueSync('doc-retry', { kind: 'fabric', payload: 2 });
    enqueueSync('doc-retry', { kind: 'fabric', payload: 3 });
    let n = 0;
    const result = await drainQueue('doc-retry', async () => {
      n += 1;
      if (n === 1) return { success: true };
      if (n === 2) return { success: false };
      throw new Error('boom');
    });
    assert.equal(result.flushed, 1);
    assert.equal(result.remaining, 2);
    assert.equal(getQueueSize('doc-retry'), 2);
  });
});

test('cloudSyncQueue no-ops without document id', async () => {
  await withLocalStorage(async () => {
    enqueueSync(null, { kind: 'fabric' });
    assert.equal(getQueueSize(null), 0);
    assert.deepEqual(await drainQueue(null, async () => ({ success: true })), {
      flushed: 0,
      remaining: 0,
    });
  });
});

test('cloudSyncQueue tolerates corrupt storage and write failures', async () => {
  await withLocalStorage(async () => {
    globalThis.localStorage.setItem('cloudSyncQueue_doc-bad', '{not-json');
    assert.equal(getQueueSize('doc-bad'), 0);

    globalThis.localStorage.setItem('cloudSyncQueue_doc-obj', JSON.stringify({ not: 'array' }));
    assert.equal(getQueueSize('doc-obj'), 0);

    const original = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => { throw new Error('quota'); };
    enqueueSync('doc-quota', { kind: 'fabric', payload: 1 });
    assert.equal(getQueueSize('doc-quota'), 0);
    globalThis.localStorage.setItem = original;
  });
});
