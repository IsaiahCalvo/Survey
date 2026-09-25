// jsonEqual must answer exactly like comparing JSON.stringify output (w29:
// it replaces two whole-document stringifies per change in the viewer's
// "unsaved annotations" check).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { jsonEqual } from '../src/utils/jsonEqual.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('jsonEqual agrees with JSON.stringify on tricky values', () => {
  const fn = () => 1;
  const date = new Date(0);
  const cases = [
    [undefined, undefined], [undefined, null], [undefined, fn], [null, null],
    [0, -0], [NaN, null], [NaN, Infinity], [1, '1'], ['a', 'a'], [true, 1],
    [{}, []], [[], []], [[1, 2], [1, 2]], [[1, 2], [2, 1]],
    [{ a: 1, b: 2 }, { a: 1, b: 2 }], [{ a: 1, b: 2 }, { b: 2, a: 1 }],
    [{ a: 1, b: undefined }, { a: 1 }], [{ a: fn }, {}], [{ a: Symbol('s') }, {}],
    [[undefined], [null]], [[fn], [null]], [[, 1], [null, 1]], // eslint-disable-line no-sparse-arrays
    [{ d: date }, { d: new Date(0) }], [{ d: date }, { d: '1970-01-01T00:00:00.000Z' }],
    [{ t: { toJSON: () => 'x' } }, { t: 'x' }],
    [{ a: { toJSON() { return undefined; } } }, {}], [[{ toJSON() { return undefined; } }], [null]],
    [{ k: { toJSON(key) { return key; } } }, { k: 'k' }], [{ toJSON(key) { return `top${key}`; } }, 'top'],
    [new Number(1), new Number(2)], [new Number(1), 1], [new String('ab'), 'ab'], [new Boolean(false), false],
    [{ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 2 }] } }],
    [{ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 3 }] } }],
    [{ a: [1, 2, 3] }, { a: [1, 2] }],
    [Object.assign(Object.create({ inherited: 1 }), { own: 2 }), { own: 2 }],
    [new Map([[1, 2]]), {}], [new Set([1]), {}],
  ];
  for (const [a, b] of cases) {
    assert.equal(jsonEqual(a, b), same(a, b), `${String(JSON.stringify(a))} vs ${String(JSON.stringify(b))}`);
    assert.equal(jsonEqual(b, a), same(b, a));
  }
});

test('jsonEqual on page maps: equal copies, one changed field, one extra mark', () => {
  const page = (n, stroke = '#f00') => ({
    objects: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, type: 'path', path: [['M', i, 0], ['L', i + 1, 2]], stroke, data: { id: `m${i}`, extra: undefined } })),
  });
  const a = { 1: page(50), 2: page(20) };
  const b = structuredClone({ 1: page(50), 2: page(20) });
  assert.equal(jsonEqual(a, b), same(a, b));
  assert.equal(jsonEqual(a, b), true);
  const c = { 1: page(50), 2: page(20, '#00f') };
  assert.equal(jsonEqual(a, c), false);
  const d = { 1: page(51), 2: page(20) };
  assert.equal(jsonEqual(a, d), false);
  assert.equal(jsonEqual(a, {}), false);
  assert.equal(jsonEqual({}, {}), true);
});
