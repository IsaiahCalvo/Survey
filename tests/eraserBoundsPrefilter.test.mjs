import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOUNDS_PAD,
  boundsIntersect,
  inflateBounds,
  objectStrokeInflation,
  segmentQueryBounds,
} from '../src/utils/eraserBoundsPrefilter.js';
import { isPointOnObject } from '../src/utils/geometryHitTest.js';

// Centerline getBBox of a horizontal path from (100,300) to (500,300): zero
// height (getBBox excludes stroke), exactly what the browser reports.
const centerlineBox = { minX: 100, minY: 300, maxX: 500, maxY: 300 };

const widePath = (strokeWidth) => ({
  type: 'path',
  stroke: '#d11b2d',
  strokeWidth,
  path: [
    ['M', 100, 300],
    ['L', 500, 300],
  ],
});

test('segmentQueryBounds pads by radius + BOUNDS_PAD', () => {
  const q = segmentQueryBounds([{ x: 300, y: 320 }], 10);
  assert.equal(q.minX, 300 - (10 + BOUNDS_PAD));
  assert.equal(q.maxY, 320 + (10 + BOUNDS_PAD));
});

test('objectStrokeInflation is half the widest stroke (self or nested children)', () => {
  assert.equal(objectStrokeInflation({ strokeWidth: 24 }), 12);
  assert.equal(
    objectStrokeInflation({ strokeWidth: 6, objects: [{ strokeWidth: 30 }, { strokeWidth: 4 }] }),
    15,
  );
  assert.equal(objectStrokeInflation(null), 0);
  assert.equal(objectStrokeInflation({}), 0);
});

test('REGRESSION: un-inflated bounds fast-reject a real near-edge hit on wide ink', () => {
  const strokeWidth = 30; // half-width 15, well past BOUNDS_PAD (4)
  const radius = 8;
  // A point 20px below the centerline: within strokeWidth/2 + radius (15+8=23),
  // so the real hit test says it IS on the object.
  const grazePoint = { x: 300, y: 320 };
  assert.equal(
    isPointOnObject(grazePoint, widePath(strokeWidth), radius),
    true,
    'sanity: the real engine treats this graze as a hit',
  );

  const query = segmentQueryBounds([grazePoint], radius);

  // Before the fix: the raw centerline box (height 0 at y=300) is 20px away
  // while the query only reaches radius+PAD = 12px down → dropped.
  assert.equal(
    boundsIntersect(centerlineBox, query),
    false,
    'raw getBBox bounds wrongly reject the hit (the intermittent bug)',
  );

  // After the fix: inflate by stroke half-width (15) → box reaches y=315,
  // query reaches y=320 → overlap → hit survives to the real test.
  const inflated = inflateBounds(centerlineBox, objectStrokeInflation(widePath(strokeWidth)));
  assert.equal(
    boundsIntersect(inflated, query),
    true,
    'stroke-inflated bounds keep the real hit alive',
  );
});

test('inflation still fast-rejects a genuinely far object (speedup preserved)', () => {
  const far = { minX: 100, minY: 900, maxX: 500, maxY: 900 };
  const query = segmentQueryBounds([{ x: 300, y: 320 }], 8);
  const inflated = inflateBounds(far, objectStrokeInflation(widePath(30)));
  assert.equal(boundsIntersect(inflated, query), false);
});

test('inflateBounds is a no-op for zero/negative amounts', () => {
  assert.equal(inflateBounds(centerlineBox, 0), centerlineBox);
  assert.equal(inflateBounds(centerlineBox, -5), centerlineBox);
});
