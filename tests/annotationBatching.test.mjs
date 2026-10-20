import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkRowsForAnnotationUpsert } from '../src/utils/annotationBatching.js';

test('chunkRowsForAnnotationUpsert returns empty for non-arrays', () => {
  assert.deepEqual(chunkRowsForAnnotationUpsert(null), []);
  assert.deepEqual(chunkRowsForAnnotationUpsert(undefined), []);
});

test('chunkRowsForAnnotationUpsert splits on the requested batch size', () => {
  const rows = [1, 2, 3, 4, 5];
  assert.deepEqual(chunkRowsForAnnotationUpsert(rows, 2), [[1, 2], [3, 4], [5]]);
});

test('chunkRowsForAnnotationUpsert coerces invalid batch sizes to defaults', () => {
  const rows = Array.from({ length: 251 }, (_, i) => i);
  assert.equal(chunkRowsForAnnotationUpsert(rows, 0).length, 2);
  assert.equal(chunkRowsForAnnotationUpsert(rows, 'nope').length, 2);
  assert.equal(chunkRowsForAnnotationUpsert(rows, -5)[0].length, 1);
});
