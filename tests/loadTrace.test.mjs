import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadTraceReset,
  loadTrace,
} from '../src/utils/loadTrace.js';

// dumpLoadTrace() was deleted as a dead export in 6749a7d28; read the trace
// back from the copy loadTrace persists to localStorage instead.
const persistedTrace = () => JSON.parse(globalThis.localStorage.getItem('surveyLoadTrace') ?? '[]').join('\n');

function withLocalStorage(store, fn) {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem(key, value) { store[key] = String(value); },
      removeItem(key) { delete store[key]; },
    },
  });
  try {
    return fn(store);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
  }
}

test('loadTrace records stages and persists them', () => {
  withLocalStorage({}, () => {
    const originalLog = console.log;
    console.log = () => {};
    try {
      loadTraceReset('doc-a');
      loadTrace('hydrate', { pages: 2 });
      loadTrace('ready');
      const dump = persistedTrace();
      assert.match(dump, /OPEN START — doc-a/);
      assert.match(dump, /hydrate/);
      assert.match(dump, /ready/);
      assert.ok(globalThis.localStorage.getItem('surveyLoadTrace'));
    } finally {
      console.log = originalLog;
    }
  });
});

test('loadTraceReset rolls prior buffer into previous key', () => {
  withLocalStorage({}, () => {
    const originalLog = console.log;
    console.log = () => {};
    try {
      loadTraceReset('first');
      loadTrace('step-1');
      loadTraceReset('second');
      assert.ok(globalThis.localStorage.getItem('surveyLoadTracePrev'));
      assert.match(persistedTrace(), /OPEN START — second/);
    } finally {
      console.log = originalLog;
    }
  });
});

test('loadTrace tolerates non-serializable extras and storage failures', () => {
  const originalLog = console.log;
  console.log = () => {};
  const circular = {};
  circular.self = circular;
  const store = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem(key, value) {
        if (key.includes('Prev') || key.includes('Trace')) {
          // Allow first writes, then fail subsequent persist/reset rolls
          if (store.__fail) throw new Error('denied');
        }
        store[key] = String(value);
      },
      removeItem(key) { delete store[key]; },
    },
  });
  try {
    loadTraceReset('seed');
    loadTrace('step');
    store.__fail = true;
    assert.doesNotThrow(() => loadTraceReset('x'));
    let line;
    assert.doesNotThrow(() => { line = loadTrace('extra', circular); });
    assert.match(line, /extra/);
  } finally {
    console.log = originalLog;
    delete globalThis.localStorage;
  }
});
