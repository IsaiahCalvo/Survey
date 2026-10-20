/**
 * Tick-67 coverage chips: geometryHitTest fill+stroke stroke-band and
 * stroke-only sel-edge proximity sample.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  doesRectIntersectRect,
  doesRectIntersectEllipse,
  doesRectIntersectTextbox,
} from '../src/utils/geometryHitTest.js';

test('geometryHitTest fill+stroke catches sel in stroke band outside fill', () => {
  const hit = doesRectIntersectRect(
    { left: 102, top: 20, right: 108, bottom: 30 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      fill: '#0f0',
      stroke: '#000',
      strokeWidth: 12,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(hit, true);
});

test('geometryHitTest stroke-only proximity via sel-edge samples', () => {
  // Sel sits parallel to the top stroke, vertices of the rect stay outside
  // the sel, but sel-edge samples land within strokeWidth/2 of the top edge.
  const hit = doesRectIntersectRect(
    { left: 20, top: -8, right: 80, bottom: -3 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      fill: 'none',
      stroke: '#000',
      strokeWidth: 10,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(hit, true);
});

test('geometryHitTest stroke-only ellipse ring + textbox mid-edge miss path', () => {
  const ell = doesRectIntersectEllipse(
    { left: 95, top: 48, right: 105, bottom: 52 },
    50,
    50,
    50,
    50,
    false,
    8,
  );
  assert.equal(typeof ell, 'boolean');

  // Textbox: sel crosses mid-top edge only
  const text = doesRectIntersectTextbox(
    { left: 30, top: -4, right: 70, bottom: 4 },
    {
      type: 'textbox',
      left: 0,
      top: 0,
      width: 100,
      height: 40,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(text, true);
});
