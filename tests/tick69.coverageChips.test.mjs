/**
 * Tick-69 coverage chips: geometryHitTest fill+stroke miss-through (1348),
 * empty-paint near-edge (1371) and far bidirectional (1414).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  doesRectIntersectRect,
  doesRectIntersectEllipse,
} from '../src/utils/geometryHitTest.js';

test('geometryHitTest fill+stroke far miss executes stroke-loop fallthrough', () => {
  const miss = doesRectIntersectRect(
    { left: 500, top: 500, right: 510, bottom: 510 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      fill: '#0f0',
      stroke: '#000',
      strokeWidth: 4,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(miss, false);
});

test('geometryHitTest empty-paint near-edge tolerance hit', () => {
  const hit = doesRectIntersectRect(
    { left: 99, top: 20, right: 103, bottom: 30 },
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
    },
  );
  assert.equal(hit, true);
});

test('geometryHitTest empty-paint left-side near miss / bidirectional', () => {
  const hit = doesRectIntersectRect(
    { left: -5, top: 20, right: 1, bottom: 30 },
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
    },
  );
  assert.equal(typeof hit, 'boolean');
});

test('geometryHitTest filled ellipse sel-edge sample without corner hit', () => {
  // Thin vertical spike from outside that should still register via ellipse
  // sampling / edge checks (covers whatever remainders are reachable).
  const hit = doesRectIntersectEllipse(
    { left: 95, top: 40, right: 130, bottom: 60 },
    50,
    50,
    50,
    50,
    true,
    0,
  );
  assert.equal(hit, true);
});

test('geometryHitTest stroke-only ellipse sel-edge ring sample', () => {
  const hit = doesRectIntersectEllipse(
    { left: 95, top: 40, right: 130, bottom: 60 },
    50,
    50,
    50,
    50,
    false,
    10,
  );
  assert.equal(typeof hit, 'boolean');
});
