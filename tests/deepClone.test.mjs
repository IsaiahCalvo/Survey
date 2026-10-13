import test from 'node:test';
import assert from 'node:assert/strict';

import { deepClone } from '../src/utils/deepClone.js';

test('deepClone returns nullish values unchanged', () => {
  assert.equal(deepClone(null), null);
  assert.equal(deepClone(undefined), undefined);
});

test('deepClone clones plain objects and arrays', () => {
  const src = { a: 1, nested: { b: [2, 3] } };
  const copy = deepClone(src);
  assert.deepEqual(copy, src);
  assert.notEqual(copy, src);
  assert.notEqual(copy.nested, src.nested);
  copy.nested.b.push(4);
  assert.deepEqual(src.nested.b, [2, 3]);
});

test('deepClone preserves Dates via structuredClone', () => {
  const src = { when: new Date('2026-07-12T00:00:00.000Z') };
  const copy = deepClone(src);
  assert.ok(copy.when instanceof Date);
  assert.equal(copy.when.toISOString(), src.when.toISOString());
  assert.notEqual(copy.when, src.when);
});

test('deepClone falls back to JSON when structuredClone rejects the value', () => {
  const original = globalThis.structuredClone;
  globalThis.structuredClone = () => {
    throw new Error('reject');
  };
  try {
    const src = { a: 1, skip: undefined };
    const copy = deepClone(src);
    assert.deepEqual(copy, { a: 1 });
  } finally {
    globalThis.structuredClone = original;
  }
});

test('deepClone returns null when both structuredClone and JSON fail', () => {
  const original = globalThis.structuredClone;
  globalThis.structuredClone = () => {
    throw new Error('reject');
  };
  try {
    // Circular objects fail JSON.stringify.
    const circular = {};
    circular.self = circular;
    assert.equal(deepClone(circular), null);
  } finally {
    globalThis.structuredClone = original;
  }
});

test('deepClone uses JSON path when structuredClone is unavailable', () => {
  const original = globalThis.structuredClone;
  // eslint-disable-next-line no-global-assign
  globalThis.structuredClone = undefined;
  try {
    assert.deepEqual(deepClone({ ok: true }), { ok: true });
  } finally {
    globalThis.structuredClone = original;
  }
});
