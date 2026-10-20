/**
 * Tick-63 coverage chips: svgPathAttrs filled-outline mode, callout final
 * re-route (arrow inside / on border), geometryHitTest line sample hit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderPathToSvgAttrs } from '../src/utils/svgPathAttrs.js';
import {
  calculateCalloutConnection,
  constrainKneePosition,
} from '../src/utils/calloutGeometry.js';
import { doesRectIntersectLine } from '../src/utils/geometryHitTest.js';

test('svgPathAttrs filled-outline mode + evenodd eraser geometry', () => {
  const filledMode = renderPathToSvgAttrs({
    pdfInkRenderMode: 'filled-outline',
    fill: '#abc',
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['L', 20, 20],
      ['L', 0, 20],
      ['Z'],
    ],
  });
  assert.equal(filledMode.stroke, 'none');
  assert.equal(filledMode.strokeWidth, 0);
  assert.equal(filledMode.fill, '#abc');

  const viaData = renderPathToSvgAttrs({
    data: { pdfInkRenderMode: 'filled-outline' },
    stroke: '#112233',
    path: [
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 10, 10],
      ['Z'],
    ],
  });
  assert.equal(viaData.stroke, 'none');
  assert.equal(viaData.fill, '#112233');

  const evenodd = renderPathToSvgAttrs({
    fillRule: 'evenodd',
    fill: '#ff0',
    path: [['M', 0, 0], ['L', 5, 0], ['L', 5, 5], ['Z']],
  });
  assert.equal(evenodd.fillRule, 'evenodd');
  assert.equal(evenodd.strokeWidth, 0);

  // Closed by returning to start (Z alone doesn't feed collectSubpaths points)
  const thinClosed = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    strokeWidth: 0.5,
    fill: '#112233',
    stroke: 'none',
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['L', 20, 20],
      ['L', 0, 20],
      ['L', 0, 0],
    ],
  });
  assert.equal(thinClosed.strokeWidth, 0);
  assert.equal(thinClosed.fill, '#112233');
});

test('calloutGeometry arrow-inside final re-route + constrains', () => {
  // Knee outside, arrow inside → line crosses, effectiveKnee may land inside → 562+
  const crossed = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 200, y: 20 },
    { x: 50, y: 20 },
    0,
  );
  assert.ok(crossed.effectiveKnee);
  assert.ok(Number.isFinite(crossed.line1Start.x));

  // Arrow nearly on border while knee outside → short-distance branch
  const nearBorder = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 200, y: 20 },
    { x: 100.5, y: 20 },
    0,
  );
  assert.ok(nearBorder.effectiveKnee);

  // Arrow exactly on border → distance≈0 final else (596+) if knee ends inside
  const onBorder = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 50, y: 20 },
    { x: 100, y: 20 },
    0,
  );
  assert.ok(onBorder.effectiveKnee);

  // Knee inside, far arrow (early return path)
  const inside = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 50, y: 20 },
    { x: 200, y: 20 },
    1,
  );
  assert.ok(inside.effectiveKnee);

  // Knee inside, arrow almost on border → tight distance branch
  const tight = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 50, y: 20 },
    { x: 105, y: 20 },
    0,
  );
  assert.ok(tight.effectiveKnee);

  const constrained = constrainKneePosition(
    { x: 101, y: 20 },
    { x: 200, y: 20 },
    0,
    0,
    100,
    40,
    { x: 100, y: 20 },
  );
  assert.ok(constrained.x >= 100);
  assert.ok(Number.isFinite(constrained.y));

  const far = constrainKneePosition(
    { x: 180, y: 20 },
    { x: 200, y: 20 },
    0,
    0,
    100,
    40,
    { x: 100, y: 20 },
  );
  assert.ok(far.x < 200);
});

test('doesRectIntersectLine samples interior point', () => {
  const hit = doesRectIntersectLine(
    { left: 40, top: -5, right: 60, bottom: 5 },
    {
      type: 'line',
      left: 0,
      top: 0,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 0,
      strokeWidth: 2,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(hit, true);
});
