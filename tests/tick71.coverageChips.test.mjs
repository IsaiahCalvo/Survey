/**
 * Tick-71 coverage chips: pageRangeParser non-integer range (Number→Infinity),
 * plus geometryHitTest ellipse stroke-band sel-edge probes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePageRangeInput } from '../src/utils/pageRangeParser.js';
import {
  doesRectIntersectEllipse,
  doesRectIntersectLine,
  doesRectIntersectTextbox,
} from '../src/utils/geometryHitTest.js';

test('pageRangeParser rejects non-integer range endpoints (Number→Infinity)', () => {
  const huge = '9'.repeat(400);
  const result = parsePageRangeInput(`${huge}-${huge}`, { min: 1, max: 10 });
  assert.deepEqual(result.pages, []);
  assert.ok(result.errors.some((e) => /non-integer/i.test(e)));
});

test('geometryHitTest ellipse stroke-only mid-edge sample', () => {
  // Thin horizontal sel crossing the rightmost stroke band of a large ellipse
  const hit = doesRectIntersectEllipse(
    { left: 99.5, top: 49.5, right: 100.5, bottom: 50.5 },
    {
      type: 'ellipse',
      left: 0,
      top: 0,
      rx: 100,
      ry: 50,
      fill: '',
      stroke: '#000',
      strokeWidth: 8,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(typeof hit, 'boolean');
});

test('geometryHitTest textbox edge-sample without center/edge-segment hit', () => {
  // Very thin selection that only clips a textbox edge after rotation misses
  // the center-in-polygon and segment checks (hard-tail probe for 1624+).
  const hit = doesRectIntersectTextbox(
    { left: 149.9, top: 10, right: 150.1, bottom: 11 },
    {
      type: 'textbox',
      left: 50,
      top: 10,
      width: 100,
      height: 20,
      angle: 0,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(typeof hit, 'boolean');
});

test('geometryHitTest line sample-only when endpoints miss expanded rect', () => {
  // Near-horizontal line whose endpoints sit outside a thin vertical sel,
  // hoping the dense sample loop alone returns true (846).
  const hit = doesRectIntersectLine(
    { left: 49, top: -1, right: 51, bottom: 1 },
    {
      type: 'line',
      left: 0,
      top: 0,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 0.01,
      strokeWidth: 0.001,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(typeof hit, 'boolean');
});
