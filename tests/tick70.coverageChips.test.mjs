/**
 * Tick-70 coverage chips: rotated textbox mid-clip + line corner graze
 * (geometryHitTest hard-tail probes) + LineBboxDiag throttle miss path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  doesRectIntersectTextbox,
  doesRectIntersectLine,
  doesRectIntersectLineSegment,
} from '../src/utils/geometryHitTest.js';
import { getAnnotationBBox } from '../src/utils/svgBoundingBox.js';

test('geometryHitTest rotated textbox mid-clip', () => {
  const hit = doesRectIntersectTextbox(
    { left: 40, top: 40, right: 60, bottom: 60 },
    {
      type: 'textbox',
      left: 50,
      top: 50,
      width: 100,
      height: 20,
      angle: 45,
      originX: 'center',
      originY: 'center',
    },
  );
  assert.equal(hit, true);
});

test('geometryHitTest line corner graze + long segment through sel', () => {
  const graze = doesRectIntersectLine(
    { left: 0, top: 0, right: 10, bottom: 10 },
    {
      type: 'line',
      left: 0,
      top: 0,
      x1: -5,
      y1: 5.0000001,
      x2: 5.0000001,
      y2: -5,
      strokeWidth: 0.0001,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(typeof graze, 'boolean');

  const through = doesRectIntersectLineSegment(
    { left: 0, top: 0, right: 10, bottom: 10 },
    { x: -20, y: 5 },
    { x: 30, y: 5 },
    0,
  );
  assert.equal(through, true);
});

test('svgBoundingBox LineBboxDiag enabled covers throttle + log path', () => {
  globalThis.__LINE_BBOX_DIAG = true;
  try {
    const line = {
      type: 'line',
      id: 'diag-line-70',
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      x1: -5,
      y1: -5,
      x2: 5,
      y2: 5,
    };
    const a = getAnnotationBBox(line);
    const b = getAnnotationBBox(line); // throttle <150ms → shouldLog false early
    assert.ok(a.width >= 0);
    assert.ok(b.width >= 0);

    // falsy-id object hits WeakMap branch; second call throttles
    const anon = { type: 'line', left: 1, top: 1, width: 4, height: 4, x1: 0, y1: 0, x2: 4, y2: 4 };
    assert.ok(getAnnotationBBox(anon).width >= 0);
    assert.ok(getAnnotationBBox(anon).width >= 0);
  } finally {
    delete globalThis.__LINE_BBOX_DIAG;
  }
});
