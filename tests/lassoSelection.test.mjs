import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPointInLasso,
  normalizeLassoPolygon,
  resolveLassoHits,
  shouldSampleLassoPoint,
  simplifyLassoPoints,
} from '../src/utils/lassoSelection.js';

const box = (left, top, right, bottom) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
];

test('screen-space sampling stays constant when page zoom changes', () => {
  assert.equal(shouldSampleLassoPoint({ x: 0, y: 0 }, { x: 3, y: 0 }, 1, 4), false);
  assert.equal(shouldSampleLassoPoint({ x: 0, y: 0 }, { x: 5, y: 0 }, 1, 4), true);
  assert.equal(shouldSampleLassoPoint({ x: 0, y: 0 }, { x: 9, y: 0 }, 0.5, 4), true);
  assert.equal(shouldSampleLassoPoint({ x: 0, y: 0 }, { x: 3, y: 0 }, 2, 4), false);
});

test('line-preserving simplify drops jitter but keeps a sharp turn', () => {
  const result = simplifyLassoPoints([
    { x: 0, y: 0 }, { x: 5, y: 0.1 }, { x: 10, y: 0 },
    { x: 10, y: 10 }, { x: 0, y: 10 },
  ], 0.5);
  assert.deepEqual(result, [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]);
});

test('concave lasso uses the concave polygon, not its bounds', () => {
  const polygon = normalizeLassoPolygon([
    { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 4 },
    { x: 4, y: 4 }, { x: 4, y: 12 }, { x: 0, y: 12 },
  ]);
  assert.ok(polygon);
  assert.equal(isPointInLasso({ x: 2, y: 10 }, polygon), true);
  assert.equal(isPointInLasso({ x: 9, y: 9 }, polygon), false);
});

test('self-crossing lasso is rejected instead of using an unclear fill rule', () => {
  assert.equal(normalizeLassoPolygon([
    { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 },
  ]), null);
});

test('exact lasso boundary counts as inside', () => {
  const polygon = normalizeLassoPolygon(box(0, 0, 10, 10));
  assert.equal(isPointInLasso({ x: 0, y: 5 }, polygon), true);
  assert.equal(isPointInLasso({ x: 10, y: 10 }, polygon), true);
});

test('full containment rejects a partly enclosed thick line', () => {
  const result = resolveLassoHits({
    lassoPolygon: box(0, 0, 100, 100),
    annotations: { objects: [
      { type: 'line', left: 10, top: 99, width: 70, height: 0, x1: -35, y1: 0, x2: 35, y2: 0, strokeWidth: 8 },
    ] },
    callouts: [], pageWidth: 100, pageHeight: 100,
  });
  assert.deepEqual(result.annotationIndices, []);
});

test('page-edge objects are selected when their outline lies on the lasso edge', () => {
  const result = resolveLassoHits({
    lassoPolygon: box(0, 0, 100, 100),
    annotations: { objects: [
      { type: 'rect', left: 0, top: 0, width: 20, height: 20, fill: '#fff', strokeWidth: 0 },
    ] },
    callouts: [], pageWidth: 100, pageHeight: 100,
  });
  assert.deepEqual(result.annotationIndices, [0]);
});

test('logical groups select as one unit only when every visible member is enclosed', () => {
  const annotations = { objects: [
    { type: 'rect', left: 10, top: 10, width: 10, height: 10, data: { groupId: 'g1' } },
    { type: 'rect', left: 70, top: 70, width: 10, height: 10, data: { groupId: 'g1' } },
  ] };
  assert.deepEqual(resolveLassoHits({
    lassoPolygon: box(0, 0, 40, 40), annotations, callouts: [],
    pageWidth: 100, pageHeight: 100,
  }).annotationIndices, []);
  assert.deepEqual(resolveLassoHits({
    lassoPolygon: box(0, 0, 90, 90), annotations, callouts: [],
    pageWidth: 100, pageHeight: 100,
  }).annotationIndices, [0, 1]);
});

test('lasso hit result is page-space data and does not depend on display zoom or rotation', () => {
  const annotation = { type: 'rect', left: 30, top: 30, width: 20, height: 10, angle: 45, fill: '#fff' };
  const args = {
    lassoPolygon: box(10, 10, 80, 80), annotations: { objects: [annotation] },
    callouts: [], pageWidth: 100, pageHeight: 100,
  };
  assert.deepEqual(resolveLassoHits(args).annotationIndices, [0]);
  assert.deepEqual(resolveLassoHits({ ...args, displayScale: 4, pageRotation: 270 }).annotationIndices, [0]);
});
