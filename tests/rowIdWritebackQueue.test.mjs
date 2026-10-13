import test from 'node:test';
import assert from 'node:assert/strict';

import {
  queueKey,
  enqueueWriteback,
  listWriteback,
  countWriteback,
  clearWriteback,
} from '../src/services/rowIdWritebackQueue.js';

function memoryStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
  };
}

test('rowIdWritebackQueue keys, enqueues, lists, counts, and clears', () => {
  const storage = memoryStorage();
  assert.equal(queueKey(null), null);
  assert.equal(queueKey('doc-1'), 'rowIdWritebackQueue:doc-1');
  assert.equal(enqueueWriteback(null, { markerId: 'm1' }, storage), false);
  assert.equal(enqueueWriteback('doc-1', {}, storage), false);

  assert.equal(enqueueWriteback('doc-1', {
    markerId: 'm1',
    sheetName: 'Sheet1',
    rowLocator: 2,
  }, storage), true);
  assert.equal(enqueueWriteback('doc-1', {
    markerId: 'm1',
    sheetName: 'Sheet1',
    rowLocator: 3,
  }, storage), true);
  assert.equal(countWriteback('doc-1', storage), 1);
  assert.equal(listWriteback('doc-1', storage)[0].rowLocator, 3);
  assert.equal(listWriteback('doc-1', storage)[0].retryState, 'pending');

  assert.equal(clearWriteback('doc-1', 'missing', storage), true);
  assert.equal(clearWriteback('doc-1', 'm1', storage), true);
  assert.equal(countWriteback('doc-1', storage), 0);
  assert.equal(clearWriteback(null, 'm1', storage), false);
});

test('rowIdWritebackQueue survives corrupt JSON, setItem failures, and broken global storage', () => {
  const corrupt = {
    getItem: () => '{bad',
    setItem: () => {},
  };
  assert.deepEqual(listWriteback('doc-x', corrupt), []);
  assert.equal(countWriteback('doc-x', corrupt), 0);

  const failingWrite = {
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
  };
  assert.equal(enqueueWriteback('doc-y', {
    markerId: 'm1',
    sheetName: 'S',
    rowLocator: 1,
  }, failingWrite), false);

  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('blocked'); },
  });
  try {
    assert.equal(enqueueWriteback('doc-z', {
      markerId: 'm1',
      sheetName: 'S',
      rowLocator: 1,
    }), false);
    assert.deepEqual(listWriteback('doc-z'), []);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
