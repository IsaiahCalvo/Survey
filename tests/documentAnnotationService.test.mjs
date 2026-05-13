import test from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { chunkRowsForAnnotationUpsert } from '../src/utils/annotationBatching.js';

test('chunkRowsForAnnotationUpsert splits large annotation pushes into bounded batches', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }));

  const chunks = chunkRowsForAnnotationUpsert(rows, 3);

  equal(chunks.length, 3);
  deepEqual(chunks.map((chunk) => chunk.map((row) => row.id)), [[1, 2, 3], [4, 5, 6], [7]]);
});

test('chunkRowsForAnnotationUpsert handles empty and invalid inputs safely', () => {
  deepEqual(chunkRowsForAnnotationUpsert([], 3), []);
  deepEqual(chunkRowsForAnnotationUpsert(null, 3), []);
  deepEqual(chunkRowsForAnnotationUpsert([{ id: 1 }], 0), [[{ id: 1 }]]);
});
