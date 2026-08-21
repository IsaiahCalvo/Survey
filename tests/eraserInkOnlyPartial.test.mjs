import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getEraserOperation,
  isPartialEraseEligible,
} from '../src/utils/eraserPolicy.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  eraserStrokeTouchesObject,
} from '../src/utils/eraserHitTest.js';
import {
  getSurveyMarkerEraserHitIds,
} from '../src/utils/surveyMarkerEraser.js';

const ink = (id, y = 50, overrides = {}) => ({
  type: 'path',
  id,
  annotationId: id,
  tool: 'pen',
  path: [['M', 0, y], ['L', 100, y]],
  left: 0,
  top: 0,
  stroke: '#d11b2d',
  strokeWidth: 20,
  fill: null,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  data: { id, tool: 'pen' },
  ...overrides,
});

const rect = (id, overrides = {}) => ({
  type: 'rect',
  id,
  annotationId: id,
  tool: 'rect',
  left: 20,
  top: 30,
  width: 60,
  height: 40,
  fill: '#2563eb',
  stroke: '#111111',
  strokeWidth: 2,
  data: { id },
  ...overrides,
});

const erasePartial = (objects, points, overrides = {}) => erasePageAnnotations({
  pageAnnotations: { objects },
  eraserPoints: points,
  eraserRadius: 8,
  mode: 'partial',
  ...overrides,
});

test('intended use: partial mode carves ink and never whole-deletes it on a mid-stroke bite', () => {
  const stroke = ink('ink-only');
  const result = erasePartial([stroke], [{ x: 50, y: 50 }]);

  assert.equal(getEraserOperation(stroke, 'partial'), 'partial');
  assert.equal(isPartialEraseEligible(stroke), true);
  assert.equal(result.didChange, true);
  assert.deepEqual(result.deletedIds, []);
  assert.deepEqual(result.changedIds, ['ink-only']);
  assert.equal(result.pageAnnotations.objects.length, 1);
  assert.notEqual(result.pageAnnotations.objects[0], stroke);
});

test('overlapping ink: one partial pass carves every intersecting pen stroke', () => {
  const lower = ink('ink-lower', 50, { stroke: '#111111' });
  const upper = ink('ink-upper', 52, { stroke: '#e11d48' });
  const far = ink('ink-far', 200);
  const result = erasePartial([lower, upper, far], [{ x: 50, y: 51 }]);

  assert.equal(result.didChange, true);
  assert.deepEqual(result.changedIds.sort(), ['ink-lower', 'ink-upper']);
  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.pageAnnotations.objects.length, 3);
  assert.equal(result.pageAnnotations.objects[2], far);
  assert.notEqual(result.pageAnnotations.objects[0], lower);
  assert.notEqual(result.pageAnnotations.objects[1], upper);
});

test('shape-under-ink: partial pass carves the ink and leaves the rectangle', () => {
  const shape = rect('shape-under');
  const stroke = ink('ink-over', 50);
  const point = { x: 50, y: 50 };

  assert.equal(
    eraserStrokeTouchesObject({ eraserPoints: [point], eraserRadius: 8, object: shape }),
    true,
    'eraser disk also intersects the filled rect under the ink',
  );
  assert.equal(getEraserOperation(shape, 'partial'), 'skip');
  assert.equal(getEraserOperation(stroke, 'partial'), 'partial');

  const result = erasePartial([shape, stroke], [point]);

  assert.equal(result.didChange, true);
  assert.deepEqual(result.changedIds, ['ink-over']);
  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.pageAnnotations.objects.length, 2);
  assert.equal(result.pageAnnotations.objects[0], shape);
  assert.notEqual(result.pageAnnotations.objects[1], stroke);
});

test('empty stroke, empty page, and locked objects are no-ops in partial mode', () => {
  const stroke = ink('locked-ink');
  const shape = rect('locked-shape');
  const page = { objects: [stroke, shape] };

  const emptyPoints = erasePageAnnotations({
    pageAnnotations: page,
    eraserPoints: [],
    eraserRadius: 8,
    mode: 'partial',
  });
  assert.equal(emptyPoints.didChange, false);
  assert.equal(emptyPoints.pageAnnotations, page);

  const emptyPage = erasePageAnnotations({
    pageAnnotations: { objects: [] },
    eraserPoints: [{ x: 50, y: 50 }],
    eraserRadius: 8,
    mode: 'partial',
  });
  assert.equal(emptyPage.didChange, false);
  assert.deepEqual(emptyPage.pageAnnotations.objects, []);

  const locked = erasePartial([stroke, shape], [{ x: 50, y: 50 }], {
    canErase: () => false,
  });
  assert.equal(locked.didChange, false);
  assert.deepEqual(locked.deletedIds, []);
  assert.deepEqual(locked.changedIds, []);
  assert.equal(locked.pageAnnotations.objects[0], stroke);
  assert.equal(locked.pageAnnotations.objects[1], shape);

  const lockedShapeOnly = erasePartial([stroke, shape], [{ x: 50, y: 50 }], {
    canErase: (object) => object.id === 'locked-ink',
  });
  assert.equal(lockedShapeOnly.didChange, true);
  assert.deepEqual(lockedShapeOnly.changedIds, ['locked-ink']);
  assert.deepEqual(lockedShapeOnly.deletedIds, []);
  assert.equal(lockedShapeOnly.pageAnnotations.objects[1], shape);
});

test('survey-marker empty and lock gates stay fail-closed in partial mode', () => {
  const marker = {
    annotationId: 'marker-1',
    x: 10,
    y: 20,
    width: 40,
    height: 20,
    color: 'rgba(255,235,59,0.25)',
  };
  const point = { x: 25, y: 30 };

  assert.deepEqual(getSurveyMarkerEraserHitIds({
    surveyMarkers: [marker],
    visibleIds: new Set(['marker-1']),
    eraserPoints: [point],
    eraserRadius: 4,
    canErase: () => true,
    mode: 'partial',
  }), []);
  assert.deepEqual(getSurveyMarkerEraserHitIds({
    surveyMarkers: [],
    visibleIds: new Set(['marker-1']),
    eraserPoints: [point],
    eraserRadius: 4,
    canErase: () => true,
    mode: 'entire',
  }), []);
  assert.deepEqual(getSurveyMarkerEraserHitIds({
    surveyMarkers: [marker],
    visibleIds: new Set(['marker-1']),
    eraserPoints: [point],
    eraserRadius: 4,
    canErase: () => false,
    mode: 'entire',
  }), []);
});
