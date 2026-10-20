/**
 * Unit tests for src/utils/lineDragMath.js
 *
 * Phase 15 Plan 03 Task 1 (Wave 1 interaction) — locks the pure-JS drag-commit
 * math used by useSVGInteraction.js for the 'midpoint' drag mode and for
 * endpoint-drag auto-revert on collinear geometry.
 *
 * Contract pinned here:
 * - LINE-01 / ARROW-01: the displayed peak follows the pointer delta;
 *   data.midpoint stores the solved t=0.5 through-point.
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
  midpointForCurveHandle,
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

test('resolveMidpointHandlePosition: symmetric curved line returns its middle peak', () => {
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

// An off-centre bend reaches its tightest turn away from t=0.5.
test('curve handle follows the peak when pulled near an endpoint', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };
  const midpoint = { x: 95, y: 35 };
  const peak = resolveMidpointHandlePosition(start, end, midpoint);
  assert.ok(Math.hypot(peak.x - midpoint.x, peak.y - midpoint.y) > 5);
  const control = { x: 2 * midpoint.x - 50, y: 2 * midpoint.y };
  const ax = end.x - 2 * control.x;
  const ay = -2 * control.y;
  const t = -(control.x * ax + control.y * ay) / (ax * ax + ay * ay);
  assert.ok(t > 0 && t < 1);
  const vx = control.x + ax * t;
  const vy = control.y + ay * t;
  assert.ok(Math.abs(vx * ax + vy * ay) < 1e-8);
  assert.ok(Math.abs(peak.x - (2 * (1 - t) * t * control.x + t * t * end.x)) < 1e-8);
});


test('peak drag solves the reviewer example rather than translating the saved through-point', () => {
  const start={x:0,y:0},end={x:100,y:0},midpoint={x:30,y:50};
  const peak=resolveMidpointHandlePosition(start,end,midpoint);
  const target={x:peak.x+10,y:peak.y};
  const wrong=resolveMidpointHandlePosition(start,end,deriveMidpointFromPointer(peak,target,midpoint));
  assert.ok(Math.hypot(wrong.x-target.x,wrong.y-target.y)>3);
  const solved=midpointForCurveHandle(start,end,target);
  const actual=resolveMidpointHandlePosition(start,end,solved);
  assert.ok(Math.hypot(actual.x-target.x,actual.y-target.y)<1e-9);
});

for (const angle of [0,30,90,180,270]) test(`peak inversion preserves its target under ${angle} degree rotation`,()=>{
  const rad=angle*Math.PI/180,rotate=point=>({x:123+point.x*Math.cos(rad)-point.y*Math.sin(rad),y:-47+point.x*Math.sin(rad)+point.y*Math.cos(rad)});
  const start=rotate({x:0,y:0}),end=rotate({x:100,y:0});
  for(const point of [{x:10,y:20},{x:30,y:50},{x:95,y:-35},{x:-25,y:30},{x:140,y:45}]) {
    const target=rotate(point),midpoint=midpointForCurveHandle(start,end,target),actual=resolveMidpointHandlePosition(start,end,midpoint);
    assert.ok(Math.hypot(actual.x-target.x,actual.y-target.y)<1e-8,JSON.stringify({target,actual}));
  }
});

test('peak inversion has no movement at grab and handles coincident endpoints',()=>{
  const start={x:0,y:0},end={x:100,y:0},midpoint={x:30,y:50};
  const restored=midpointForCurveHandle(start,end,resolveMidpointHandlePosition(start,end,midpoint));
  assert.ok(Math.hypot(restored.x-midpoint.x,restored.y-midpoint.y)<1e-9);
  assert.deepEqual(midpointForCurveHandle(start,start,{x:0,y:0}),{x:0,y:0});
  const target={x:5,y:30},solved=midpointForCurveHandle(start,start,target);
  const actual=resolveMidpointHandlePosition(start,start,solved);
  assert.ok(Math.hypot(actual.x-target.x,actual.y-target.y)<1e-9);
});


test('peak inversion stays finite and continuous near and beyond endpoints',()=>{
  const start={x:0,y:0},end={x:1000,y:0};
  for(const target of [{x:0.001,y:11},{x:999.999,y:-11},{x:-1000,y:11},{x:10000,y:1000}]) {
    const midpoint=midpointForCurveHandle(start,end,target),actual=resolveMidpointHandlePosition(start,end,midpoint);
    assert.ok(Number.isFinite(midpoint.x)&&Number.isFinite(midpoint.y));
    assert.ok(Math.hypot(actual.x-target.x,actual.y-target.y)<1e-7);
    const nearby=midpointForCurveHandle(start,end,{x:target.x+0.001,y:target.y+0.001});
    assert.ok(Math.hypot(nearby.x-midpoint.x,nearby.y-midpoint.y)<0.5);
  }
});


test('an exact endpoint falls back to a straight curve rather than an unbounded control point',()=>{
  const start={x:0,y:0},end={x:100,y:0};
  assert.deepEqual(midpointForCurveHandle(start,end,start),{x:50,y:0});
  assert.deepEqual(midpointForCurveHandle(start,end,end),{x:50,y:0});
});
