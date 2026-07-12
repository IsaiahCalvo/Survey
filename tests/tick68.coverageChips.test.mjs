/**
 * Tick-68 coverage chips: geometryHitTest empty-paint getBoundingRect
 * success + throw fallbacks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { doesRectIntersectRect } from '../src/utils/geometryHitTest.js';

test('geometryHitTest empty-paint getBoundingRect fallback hit', () => {
  const hit = doesRectIntersectRect(
    { left: 200, top: 200, right: 250, bottom: 250 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      fill: 'none',
      stroke: 'none',
      strokeWidth: 0,
      originX: 'left',
      originY: 'top',
      // Geometry is far away; fabricated bounds still intersect the sel.
      getBoundingRect: () => ({ left: 200, top: 200, width: 50, height: 50 }),
    },
  );
  assert.equal(hit, true);
});

test('geometryHitTest empty-paint getBoundingRect throw falls through', () => {
  const miss = doesRectIntersectRect(
    { left: 200, top: 200, right: 250, bottom: 250 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      fill: 'transparent',
      stroke: null,
      strokeWidth: 0,
      originX: 'left',
      originY: 'top',
      getBoundingRect: () => {
        throw new Error('bbox-boom');
      },
    },
  );
  assert.equal(miss, false);
});
