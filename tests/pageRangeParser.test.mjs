import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizePageRangeInput,
  parsePageRangeInput,
  formatPageList,
} from '../src/utils/pageRangeParser.js';

test('sanitizePageRangeInput strips non-range characters and leading zeros', () => {
  assert.equal(sanitizePageRangeInput(null), '');
  assert.equal(sanitizePageRangeInput(12), '');
  assert.equal(sanitizePageRangeInput('01, 03-07;x'), '1,3-7');
  assert.equal(sanitizePageRangeInput('0'), '');
});

test('parsePageRangeInput validates empty and malformed input', () => {
  assert.deepEqual(parsePageRangeInput(''), {
    pages: [],
    errors: ['No page numbers provided.'],
  });
  assert.deepEqual(parsePageRangeInput(null), {
    pages: [],
    errors: ['No page numbers provided.'],
  });
  assert.deepEqual(parsePageRangeInput('   ,  ;;'), {
    pages: [],
    errors: ['No page numbers provided.'],
  });
  const bad = parsePageRangeInput('abc', { min: 1, max: 10 });
  assert.deepEqual(bad.pages, []);
  assert.match(bad.errors[0], /Unable to parse "abc"/);
});

test('parsePageRangeInput accepts singles and ranges with clamping', () => {
  assert.deepEqual(parsePageRangeInput('1,3,5-7', { min: 1, max: 10 }), {
    pages: [1, 3, 5, 6, 7],
    errors: [],
  });
  const outOfRange = parsePageRangeInput('0,99', { min: 1, max: 10 });
  assert.deepEqual(outOfRange.pages, []);
  assert.equal(outOfRange.errors.length, 1);
  assert.match(outOfRange.errors[0], /out of the valid range/);

  const clamped = parsePageRangeInput('8-20', { min: 1, max: 10 });
  assert.deepEqual(clamped.pages, [8, 9, 10]);
  assert.equal(clamped.errors.length, 1);

  const reversed = parsePageRangeInput('7-5', { min: 1, max: 10 });
  assert.deepEqual(reversed.pages, [5, 6, 7]);
  assert.deepEqual(reversed.errors, []);
});

test('parsePageRangeInput uses open-ended range text when max is infinite', () => {
  const result = parsePageRangeInput('9999', { min: 1, max: Infinity });
  assert.deepEqual(result.pages, [9999]);
  assert.deepEqual(result.errors, []);
});

test('formatPageList collapses consecutive pages into ranges', () => {
  assert.equal(formatPageList(null), '');
  assert.equal(formatPageList([]), '');
  assert.equal(formatPageList([1, 3, 5, 6, 7, 10]), '1, 3, 5-7, 10');
  assert.equal(formatPageList([4, 2, 3, 1]), '1-4');
});
