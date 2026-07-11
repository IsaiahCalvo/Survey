import test from 'node:test';
import assert from 'node:assert/strict';

import {
  eraserDiameterToPageRadius,
} from '../src/utils/eraserSizing.js';

test('eraser size is a diameter, not a radius', () => {
  assert.equal(eraserDiameterToPageRadius(20), 10);
});

test('page radius stays half the page-space diameter at every viewer scale', () => {
  assert.equal(eraserDiameterToPageRadius(24, 1.5, 0.75), 12);
});
