import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getLassoPolygonValidation,
  getLassoModeFromTrail,
  getLassoPointerSamples,
  getLassoGestureIntent,
  cycleLassoMode,
  isPointInLasso,
  normalizeLassoPolygon,
  resolveLassoHits,
  shouldSampleLassoPoint,
  simplifyLassoPoints,
} from '../src/utils/lassoSelection.js';

const SVG_INTERACTION_SOURCE = readFileSync(
  new URL('../src/hooks/useSVGInteraction.js', import.meta.url),
  'utf8',
);

test('lasso pointer sampling falls back to the live move when Chrome returns no coalesced events', () => {
  const liveMove = { clientX: 42, clientY: 19 };
  const event = {
    nativeEvent: {
      ...liveMove,
      getCoalescedEvents: () => [],
    },
  };
  assert.deepEqual(getLassoPointerSamples(event), [event.nativeEvent]);

  const coalesced = [{ clientX: 40, clientY: 18 }, liveMove];
  event.nativeEvent.getCoalescedEvents = () => coalesced;
  assert.equal(getLassoPointerSamples(event), coalesced);
});

const box = (left, top, right, bottom) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
];

test('lasso direction latches from the first stable horizontal move and Space cycles modes', () => {
  assert.equal(getLassoModeFromTrail([{ x: 50, y: 0 }, { x: 47, y: 10 }, { x: 40, y: 20 }]), 'crossing');
  assert.equal(getLassoModeFromTrail([{ x: 50, y: 0 }, { x: 53, y: 10 }, { x: 60, y: 20 }]), 'window');
  assert.equal(getLassoModeFromTrail([{ x: 50, y: 0 }, { x: 52, y: 20 }]), null);
  assert.equal(cycleLassoMode('window'), 'crossing');
  assert.equal(cycleLassoMode('crossing'), 'fence');
  assert.equal(cycleLassoMode('fence'), 'window');
});

test('touch lasso controls map to the same add, subtract, and catch state as keys', () => {
  assert.deepEqual(getLassoGestureIntent({ pointerType: 'mouse', shiftKey: true }), {
    shiftHeld: true, altHeld: false, modeOverride: null,
  });
  assert.deepEqual(getLassoGestureIntent({ pointerType: 'mouse', altKey: true }, 'add', 'fence'), {
    shiftHeld: false, altHeld: true, modeOverride: null,
  });
  assert.deepEqual(getLassoGestureIntent({ pointerType: 'touch' }, 'add', 'crossing'), {
    shiftHeld: true, altHeld: false, modeOverride: 'crossing',
  });
  assert.deepEqual(getLassoGestureIntent({ pointerType: 'pen' }, 'subtract', 'fence'), {
    shiftHeld: false, altHeld: true, modeOverride: 'fence',
  });
});

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

test('self-crossing lasso is rejected before it can replace the selection', () => {
  const points = [
    { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 },
  ];
  assert.equal(normalizeLassoPolygon(points), null);
  assert.deepEqual(getLassoPolygonValidation(points), {
    polygon: null,
    issue: 'self-intersection',
  });
});

test('invalid and cancelled lasso gestures stay silent', () => {
  assert.doesNotMatch(SVG_INTERACTION_SOURCE, /showToast\([^\n]*Lasso/i);
});

test('crossing lasso selects geometry touched by the closed lasso', () => {
  const result = resolveLassoHits({
    lassoPolygon: box(0, 0, 50, 50),
    mode: 'crossing',
    annotations: { objects: [
      { type: 'rect', left: 45, top: 20, width: 20, height: 20, fill: '#fff' },
      { type: 'rect', left: 70, top: 20, width: 20, height: 20, fill: '#fff' },
    ] },
    callouts: [], pageWidth: 100, pageHeight: 100,
  });
  assert.deepEqual(result.annotationIndices, [0]);
});

test('crossing lasso inside a filled shape hits, but blank hollow interior does not', () => {
  const args = { lassoPolygon: box(20, 20, 30, 30), mode: 'crossing', callouts: [], pageWidth: 100, pageHeight: 100 };
  assert.deepEqual(resolveLassoHits({
    ...args, annotations: { objects: [{ type: 'rect', left: 0, top: 0, width: 50, height: 50, fill: '#fff', stroke: '#111' }] },
  }).annotationIndices, [0]);
  assert.deepEqual(resolveLassoHits({
    ...args, annotations: { objects: [{ type: 'rect', left: 0, top: 0, width: 50, height: 50, fill: 'none', stroke: '#111' }] },
  }).annotationIndices, []);
});

test('fence lasso selects only geometry crossed by the trail', () => {
  const result = resolveLassoHits({
    lassoPolygon: box(0, 0, 50, 50),
    mode: 'fence',
    annotations: { objects: [
      { type: 'rect', left: 45, top: 20, width: 20, height: 20, fill: '#fff' },
      { type: 'rect', left: 10, top: 10, width: 10, height: 10, fill: '#fff' },
    ] },
    callouts: [], pageWidth: 100, pageHeight: 100,
  });
  assert.deepEqual(result.annotationIndices, [0]);
});

test('fence accepts a straight open trail and does not add a hidden closing edge', () => {
  const annotations = { objects: [
    { type: 'rect', left: 40, top: 40, width: 20, height: 20, fill: 'transparent', stroke: '#000' },
    { type: 'rect', left: 40, top: 20, width: 20, height: 10, fill: 'transparent', stroke: '#000' },
  ] };
  assert.deepEqual(resolveLassoHits({
    lassoPolygon: [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 0 }],
    mode: 'fence', annotations, callouts: [], pageWidth: 100, pageHeight: 100,
  }).annotationIndices, [0]);
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

test('fully locked app text markup remains lasso-selectable and atomic', () => {
  const mark = {
    type: 'group', id: 'mark-1', left: 10, top: 10, width: 70, height: 30,
    lockMovementX: true, lockMovementY: true,
    lockScalingX: true, lockScalingY: true, lockRotation: true,
    data: {
      type: 'text-markup', markupType: 'squiggly', selectionGroupId: 'range-1',
      quads: [
        { x1: 10, y1: 10, x2: 40, y2: 10, x3: 10, y3: 20, x4: 40, y4: 20 },
        { x1: 50, y1: 30, x2: 80, y2: 30, x3: 50, y3: 40, x4: 80, y4: 40 },
      ],
    },
  };
  const args = { annotations: { objects: [mark] }, callouts: [], pageWidth: 100, pageHeight: 100 };
  assert.deepEqual(resolveLassoHits({ ...args, lassoPolygon: box(0, 0, 90, 50) }).annotationIndices, [0]);
  assert.deepEqual(resolveLassoHits({ ...args, lassoPolygon: box(0, 0, 45, 25) }).annotationIndices, []);
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
