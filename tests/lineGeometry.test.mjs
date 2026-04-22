// tests/lineGeometry.test.mjs
// Phase 15 Wave 0 scaffold — pure math contract for line/arrow curvature.
//
// Exercises the already-ported math in src/utils/lineGeometry.js. These tests
// PASS on first run against the existing library (the math was ported in a
// previous phase from combined-tools/src/lib/lineGeometry.ts) — Plan 15-01
// adds this file to lock the contract so Plans 15-02 / 15-03 cannot
// accidentally regress any of the helpers they consume.
//
// UX: tests guard LINE-01/02 (curved line + snap-to-straight math) and
// ARROW-01/02 (arrow curvature + snap) at the geometry layer. Any change to
// the bezier math would break these before it ever shipped into renderers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMidpoint,
  distanceToLineSegment,
  shouldSnapToLinear,
  getCurvedPath,
  getCurveEndAngle,
  getPointOnCurve,
  getControlPoint,
} from '../src/utils/lineGeometry.js';

test('getCurvedPath: passes through midpoint at t=0.5 (B(0.5) === midpoint within 1e-9)', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };
  const midpoint = { x: 50, y: 50 };
  const result = getPointOnCurve(start, end, midpoint, 0.5);
  assert.ok(Math.abs(result.x - 50) < 1e-9, `expected x≈50, got ${result.x}`);
  assert.ok(Math.abs(result.y - 50) < 1e-9, `expected y≈50, got ${result.y}`);
});

test('getCurvedPath: format is "M sx,sy Q cx,cy ex,ey"', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };
  const midpoint = { x: 50, y: 50 };
  const d = getCurvedPath(start, end, midpoint);
  assert.ok(d.startsWith('M 0,0 Q '), `expected d to start with "M 0,0 Q ", got "${d}"`);
  assert.ok(d.endsWith(' 100,0'), `expected d to end with " 100,0", got "${d}"`);
  assert.match(d, /^M \S+ Q \S+ \S+$/);
});

test('getControlPoint: cx = 2*mx - 0.5*sx - 0.5*ex (closed-form solution)', () => {
  const start = { x: 10, y: 20 };
  const end = { x: 30, y: 40 };
  const midpoint = { x: 25, y: 50 };
  const ctrl = getControlPoint(start, end, midpoint);
  assert.equal(ctrl.x, 2 * 25 - 0.5 * 10 - 0.5 * 30); // 30
  assert.equal(ctrl.y, 2 * 50 - 0.5 * 20 - 0.5 * 40); // 70
});

test('getCurveEndAngle: tangent at t=1 returns degrees; symmetric upward bulge yields atan2(-100, 50)', () => {
  // Screen-space: start=(0,0), end=(100,0), midpoint=(50,-50). Control = (50, -100).
  // Tangent at end = atan2(0 - (-100), 100 - 50) = atan2(100, 50) ≈ 63.43°.
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };
  const midpoint = { x: 50, y: -50 };
  const deg = getCurveEndAngle(start, end, midpoint);
  const expected = Math.atan2(100, 50) * (180 / Math.PI);
  assert.ok(Math.abs(deg - expected) < 1e-9, `expected ${expected}, got ${deg}`);
  assert.ok(Math.abs(deg - 63.43494882292201) < 1e-6, `expected ≈63.4349, got ${deg}`);
});

test('shouldSnapToLinear: returns true within 10px threshold (at 0, 5, 10 px)', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };
  // Baseline is the x-axis y=0 — perpendicular distance = |midpoint.y|.
  assert.equal(shouldSnapToLinear({ x: 50, y: 0 }, start, end), true);
  assert.equal(shouldSnapToLinear({ x: 50, y: 5 }, start, end), true);
  assert.equal(shouldSnapToLinear({ x: 50, y: 10 }, start, end), true);
});

test('shouldSnapToLinear: returns false at 11px and beyond', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };
  assert.equal(shouldSnapToLinear({ x: 50, y: 11 }, start, end), false);
  assert.equal(shouldSnapToLinear({ x: 50, y: 100 }, start, end), false);
});

test('shouldSnapToLinear: custom threshold arg overrides default', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };
  const midAt5 = { x: 50, y: 5 };
  assert.equal(shouldSnapToLinear(midAt5, start, end, 3), false);
  assert.equal(shouldSnapToLinear(midAt5, start, end), true);
});

test('distanceToLineSegment: returns 0 for point on line (perpendicular-distance semantics, NOT segment-clamped)', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };
  const point = { x: 50, y: 0 };
  assert.equal(distanceToLineSegment(point, start, end), 0);
});

test('distanceToLineSegment: returns point-to-start distance when start === end (zero-length edge case)', () => {
  const start = { x: 5, y: 5 };
  const end = { x: 5, y: 5 };
  const point = { x: 8, y: 9 };
  assert.equal(distanceToLineSegment(point, start, end), Math.sqrt(9 + 16)); // 5
});

test('getMidpoint: geometric mean of endpoints', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 200 };
  const mid = getMidpoint(start, end);
  assert.deepEqual(mid, { x: 50, y: 100 });
});
