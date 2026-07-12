/**
 * Tick-73 coverage chips: svgBoundingBox NaN polygon points (684-685).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { getAnnotationBBox } from '../src/utils/svgBoundingBox.js';

test('getAnnotationBBox polygon with NaN points returns empty box', () => {
  const box = getAnnotationBBox({
    type: 'polygon',
    left: 10,
    top: 20,
    points: [{ x: NaN, y: NaN }, { x: NaN, y: 5 }],
  });
  assert.deepEqual(box, { left: 0, top: 0, width: 0, height: 0, angle: 0 });
});

test('getAnnotationBBox polyline with NaN points returns empty box', () => {
  const box = getAnnotationBBox({
    type: 'polyline',
    left: 0,
    top: 0,
    points: [{ x: NaN, y: NaN }],
  });
  assert.deepEqual(box, { left: 0, top: 0, width: 0, height: 0, angle: 0 });
});
