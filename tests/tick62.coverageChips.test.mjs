/**
 * Tick-62 coverage chips: geometryHitTest empty paint rect, svg path with
 * non-numeric commands, line bbox diag null-obj branch via enabled diag.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isPointOnRect } from '../src/utils/geometryHitTest.js';
import { getAnnotationBBox } from '../src/utils/svgBoundingBox.js';

test('isPointOnRect hits empty-paint tolerance branch', () => {
  const hit = isPointOnRect(
    { x: 5, y: 5 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 20,
      height: 20,
      fill: null,
      stroke: null,
      strokeWidth: 0,
      originX: 'left',
      originY: 'top',
    },
    2,
  );
  assert.equal(hit, true);
});

test('getAnnotationBBox path with non-numeric segments returns empty box', () => {
  const box = getAnnotationBBox({
    type: 'path',
    left: 0,
    top: 0,
    path: [['M', 'x', 'y'], ['L', null, undefined], ['Z']],
  });
  assert.equal(box.width, 0);
  assert.equal(box.height, 0);
});

test('getAnnotationBBox polygon points with no numeric coords', () => {
  const box = getAnnotationBBox({
    type: 'polygon',
    left: 0,
    top: 0,
    points: [{}, { x: 'a', y: 'b' }],
  });
  // fallbacks coerce to 0,0 — still a finite box
  assert.ok(box);
});
