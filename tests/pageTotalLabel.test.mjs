import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPageTotal, PAGE_TOTAL_UNKNOWN } from '../src/utils/pageTotalLabel.js';

test('unknown page count shows a dash while the file loads', () => {
  for (const v of [0, undefined, null, NaN, -1]) assert.equal(formatPageTotal(v), PAGE_TOTAL_UNKNOWN);
});

test('known page count shows the number', () => {
  assert.equal(formatPageTotal(8), '8');
  assert.equal(formatPageTotal(1), '1');
});

test('a space with no pages still shows 0', () => {
  assert.equal(formatPageTotal(8, true), '0');
  assert.equal(formatPageTotal(0, true), '0');
});
