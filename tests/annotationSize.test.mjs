import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnnotationSize, sanitizeAnnotationSizeDraft } from '../src/utils/annotationSize.js';

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
