/**
 * Unit tests for src/utils/lineDragMath.js
 *
 * Phase 15 Plan 03 Task 1 (Wave 1 interaction) — locks the pure-JS drag-commit
 * math used by useSVGInteraction.js for the 'midpoint' drag mode and for
 * endpoint-drag auto-revert on collinear geometry.
 *
 * Contract pinned here:
 * - LINE-01 / ARROW-01: midpoint drag writes data.midpoint by translating the
 *   original midpoint by the pointer delta.
 * - LINE-02 / ARROW-02: release within 10px of baseline clears data.midpoint.
 * - LINE-03 / ARROW-03: endpoint drag preserves data.midpoint in absolute
 *   coords; auto-revert on collinear geometry at pointerup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveMidpointFromPointer,
  shouldRevertEndpointCurve,
  applyMidpointToAnnotation,
  clearMidpointFromAnnotation,
  resolveMidpointHandlePosition,
} from '../src/utils/lineDragMath.js';

test('deriveMidpointFromPointer: adds pointer delta to original midpoint', () => {
  const startSVGPoint = { x: 100, y: 100 };
  const currentSVGPoint = { x: 150, y: 130 };
  const originalMidpoint = { x: 50, y: 50 };
  const result = deriveMidpointFromPointer(startSVGPoint, currentSVGPoint, originalMidpoint);
  assert.equal(result.x, 100, 'x = 50 + (150-100) = 100');
  assert.equal(result.y, 80, 'y = 50 + (130-100) = 80');
});

test('shouldRevertEndpointCurve: returns false when midpoint undefined', () => {
  const result = shouldRevertEndpointCurve(undefined, { x: 0, y: 0 }, { x: 100, y: 0 });
  assert.equal(result, false);
});

test('shouldRevertEndpointCurve: returns true when midpoint within 10px of new baseline', () => {
  // distance from (50,3) to the segment (0,0)→(200,0) is 3px perpendicular — within 10
  const result = shouldRevertEndpointCurve(
    { x: 50, y: 3 },
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  );
  assert.equal(result, true);
});

test('shouldRevertEndpointCurve: returns false when midpoint farther than 10px from new baseline', () => {
  // distance from (50,50) to the segment (0,0)→(100,0) is 50px — well outside 10
  const result = shouldRevertEndpointCurve(
    { x: 50, y: 50 },
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  );
  assert.equal(result, false);
});

test('applyMidpointToAnnotation: sets data.midpoint without destroying other data fields', () => {
  const annotation = { data: { arrowheadStyle: 'vShape', someOther: 42 } };
  const returned = applyMidpointToAnnotation(annotation, { x: 50, y: 50 });
  // Mutation-return contract: function returns the same object
  assert.equal(returned, annotation);
  assert.equal(annotation.data.midpoint.x, 50);
  assert.equal(annotation.data.midpoint.y, 50);
  assert.equal(annotation.data.arrowheadStyle, 'vShape');
  assert.equal(annotation.data.someOther, 42);
});

test('applyMidpointToAnnotation: creates data object if missing', () => {
  const annotation = {};
  applyMidpointToAnnotation(annotation, { x: 10, y: 20 });
  assert.equal(annotation.data.midpoint.x, 10);
  assert.equal(annotation.data.midpoint.y, 20);
});

test('clearMidpointFromAnnotation: removes data.midpoint but preserves other data fields', () => {
  const annotation = {
    data: { midpoint: { x: 1, y: 2 }, arrowheadStyle: 'none', foo: 'bar' },
  };
  clearMidpointFromAnnotation(annotation);
  assert.equal(annotation.data.midpoint, undefined);
  assert.equal(annotation.data.arrowheadStyle, 'none');
  assert.equal(annotation.data.foo, 'bar');
});

test('clearMidpointFromAnnotation: no-op when data.midpoint absent', () => {
  const annotation = { data: { arrowheadStyle: 'none' } };
  clearMidpointFromAnnotation(annotation);
  assert.equal(annotation.data.arrowheadStyle, 'none');
  assert.equal(annotation.data.midpoint, undefined);
});

test('resolveMidpointHandlePosition: curved line returns saved midpoint', () => {
  const result = resolveMidpointHandlePosition(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 50 },
  );
  assert.equal(result.x, 50);
  assert.equal(result.y, 50);
});

test('resolveMidpointHandlePosition: straight line returns geometric midpoint', () => {
  const result = resolveMidpointHandlePosition(
    { x: 0, y: 0 },
    { x: 100, y: 200 },
    undefined,
  );
  assert.equal(result.x, 50);
  assert.equal(result.y, 100);
});
