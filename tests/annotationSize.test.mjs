import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOTATION_WIDTH_DECIMALS,
  COUNTER_SIZE_MAX,
  COUNTER_SIZE_MIN,
  normalizeAnnotationSize,
  sanitizeAnnotationSizeDraft,
} from '../src/utils/annotationSize.js';

test('annotation size normalization rounds to whole numbers and clamps bounds', () => {
  assert.equal(normalizeAnnotationSize(5.4, 1, 100), 5);
  assert.equal(normalizeAnnotationSize(5.5, 1, 100), 6);
  assert.equal(normalizeAnnotationSize(-10, 4, 50), 4);
  assert.equal(normalizeAnnotationSize(999, 1, 100), 100);
  assert.equal(normalizeAnnotationSize('', 4, 50), 4);
  assert.equal(normalizeAnnotationSize('not-a-number', 4, 50), 4);
});

test('annotation size drafts allow empty or up to three digits only', () => {
  assert.equal(sanitizeAnnotationSizeDraft(''), '');
  assert.equal(sanitizeAnnotationSizeDraft('0'), '0');
  assert.equal(sanitizeAnnotationSizeDraft('100'), '100');
  assert.equal(sanitizeAnnotationSizeDraft('5.5'), null);
  assert.equal(sanitizeAnnotationSizeDraft('-5'), null);
  assert.equal(sanitizeAnnotationSizeDraft('1e2'), null);
  assert.equal(sanitizeAnnotationSizeDraft('1000'), null);
});

// 2026-09-09 (cloud-fill-knockout): the whole-number contract above is kept
// for Counter Size / Eraser Size (decimals default 0). The line Width field
// now passes ANNOTATION_WIDTH_DECIMALS so the Cloud style's approved 2.5
// default reads back and commits as 2.5 instead of 3.
test('line widths keep one decimal place when the field asks for it', () => {
  assert.equal(ANNOTATION_WIDTH_DECIMALS, 1);
  assert.equal(normalizeAnnotationSize(2.5, 1, 50, ANNOTATION_WIDTH_DECIMALS), 2.5);
  assert.equal(normalizeAnnotationSize('2.5', 1, 50, ANNOTATION_WIDTH_DECIMALS), 2.5);
  assert.equal(normalizeAnnotationSize(2.55, 1, 50, ANNOTATION_WIDTH_DECIMALS), 2.6);
  assert.equal(normalizeAnnotationSize(0.2, 1, 50, ANNOTATION_WIDTH_DECIMALS), 1);
  assert.equal(normalizeAnnotationSize(2.5, 1, 50), 3, 'default stays whole numbers');
  assert.equal(sanitizeAnnotationSizeDraft('2.5', ANNOTATION_WIDTH_DECIMALS), '2.5');
  assert.equal(sanitizeAnnotationSizeDraft('2.', ANNOTATION_WIDTH_DECIMALS), '2.');
  assert.equal(sanitizeAnnotationSizeDraft('.5', ANNOTATION_WIDTH_DECIMALS), '.5');
  assert.equal(sanitizeAnnotationSizeDraft('2.55', ANNOTATION_WIDTH_DECIMALS), null);
  assert.equal(sanitizeAnnotationSizeDraft('1e2', ANNOTATION_WIDTH_DECIMALS), null);
  assert.equal(sanitizeAnnotationSizeDraft('1000', ANNOTATION_WIDTH_DECIMALS), null);
});

test('counter sizes support every approved preset through 76', () => {
  assert.equal(COUNTER_SIZE_MIN, 4);
  assert.equal(COUNTER_SIZE_MAX, 76);
  assert.equal(normalizeAnnotationSize(64, COUNTER_SIZE_MIN, COUNTER_SIZE_MAX), 64);
  assert.equal(normalizeAnnotationSize(76, COUNTER_SIZE_MIN, COUNTER_SIZE_MAX), 76);
  assert.equal(normalizeAnnotationSize(77, COUNTER_SIZE_MIN, COUNTER_SIZE_MAX), 76);
});
