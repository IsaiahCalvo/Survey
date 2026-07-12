import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emitTextSearchDiag,
  buildTextSearchDiagLogSection,
} from '../src/utils/textSearchDiag.js';

test('text search diag is a no-op buffer without window', () => {
  const original = globalThis.window;
  delete globalThis.window;
  try {
    emitTextSearchDiag('noop');
    assert.equal(buildTextSearchDiagLogSection(), '');
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});

test('emitTextSearchDiag buffers and formats diagnostics', () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  globalThis.window = { __textSearchDiagBuffer: undefined };
  try {
    emitTextSearchDiag('query', { q: 'door' });
    emitTextSearchDiag('done', { hits: 2 });
    assert.equal(globalThis.window.__textSearchDiagBuffer.length, 2);
    assert.match(logs[0], /\[TextSearchDiag\] query/);
    const section = buildTextSearchDiagLogSection(1);
    assert.match(section, /===== Text Search Diagnostics =====/);
    assert.match(section, /done/);
    assert.doesNotMatch(section, /query/);
  } finally {
    console.log = originalLog;
    delete globalThis.window;
  }
});

test('emitTextSearchDiag ignores console.log failures', () => {
  globalThis.window = { __textSearchDiagBuffer: [] };
  const originalLog = console.log;
  console.log = () => {
    throw new Error('console blocked');
  };
  try {
    assert.doesNotThrow(() => emitTextSearchDiag('logged'));
    assert.equal(globalThis.window.__textSearchDiagBuffer.length, 1);
  } finally {
    console.log = originalLog;
    delete globalThis.window;
  }
});

test('emitTextSearchDiag caps the ring buffer and survives circular detail', () => {
  const originalLog = console.log;
  console.log = () => {};
  globalThis.window = { __textSearchDiagBuffer: [] };
  try {
    for (let i = 0; i < 205; i += 1) emitTextSearchDiag(`e${i}`);
    assert.equal(globalThis.window.__textSearchDiagBuffer.length, 200);
    const circular = {};
    circular.self = circular;
    emitTextSearchDiag('circular', circular);
    assert.match(globalThis.window.__textSearchDiagBuffer.at(-1), /\[TextSearchDiag\] circular$/);
  } finally {
    console.log = originalLog;
    delete globalThis.window;
  }
});
