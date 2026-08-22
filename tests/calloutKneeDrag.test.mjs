import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateCalloutConnection,
  constrainKneePosition,
  MIN_KNEE_TO_ARROW_DISTANCE,
  MIN_KNEE_TO_BOX_EDGE_DISTANCE,
} from '../src/utils/calloutGeometry.js';

// Pure geometry + source wiring for callout knee / leader / arrowTip drag.
// Live proof: debug/scenarios/e2e-callout-knee-drag.spec.mjs
// T-02 create/clone is a different path (not this file).

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('knee / leader / arrowTip connection: box stays put; knee is independent', () => {
  const box = { left: 200, top: 300, w: 120, h: 40 };
  const knee = { x: 140, y: 250 };
  const arrowTip = { x: 80, y: 180 };

  const conn = calculateCalloutConnection(box.left, box.top, box.w, box.h, knee, arrowTip, 0);
  assert.equal(typeof conn.line1Start.x, 'number');
  assert.equal(typeof conn.line2Start.x, 'number');
  assert.ok(conn.effectiveKnee);
  // line1 starts on the text-box edge, not at the stored knee.
  assert.ok(
    conn.line1Start.x >= box.left - 0.01 && conn.line1Start.x <= box.left + box.w + 0.01,
    'line1 starts on the box',
  );
  // line2 runs knee → arrowTip (leader).
  assert.ok(Math.hypot(conn.line2Start.x - knee.x, conn.line2Start.y - knee.y) < 1.5
    || Math.hypot(conn.effectiveKnee.x - knee.x, conn.effectiveKnee.y - knee.y) < 1.5);

  const border = { x: box.left, y: box.top };
  const pulledIntoBox = constrainKneePosition(
    { x: 210, y: 310 },
    arrowTip,
    box.left,
    box.top,
    box.left + box.w,
    box.top + box.h,
    border,
  );
  const distToArrow = Math.hypot(pulledIntoBox.x - arrowTip.x, pulledIntoBox.y - arrowTip.y);
  const insideX = pulledIntoBox.x > box.left && pulledIntoBox.x < box.left + box.w;
  const insideY = pulledIntoBox.y > box.top && pulledIntoBox.y < box.top + box.h;
  assert.ok(!(insideX && insideY), 'constrained knee stays outside the text box');
  assert.ok(distToArrow + 1e-6 >= MIN_KNEE_TO_ARROW_DISTANCE);
  assert.ok(MIN_KNEE_TO_BOX_EDGE_DISTANCE > 0);
});

test('SVG + interaction wire knee / arrowTip / textBox / leader; Esc is marquee-only', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(layer, /data-callout-part="knee"/);
  assert.match(layer, /data-callout-part="arrowTip"/);
  assert.match(layer, /data-callout-part="line1"/);
  assert.match(layer, /data-callout-part="line2"/);
  assert.match(renderers, /data-callout-part="textBox"/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.match(layer, /isFreehandCreationTool/);
  // Pen / shape creation returns before handleSvgPointerDown.
  const penIdx = layer.indexOf('if ((isShapeCreationTool || isFreehandCreationTool)');
  const svgDownIdx = layer.lastIndexOf('handleSvgPointerDown(e)');
  assert.ok(penIdx > 0 && svgDownIdx > penIdx, 'Pen intercepts before callout-part drag');

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /partType: null,[\s\S]*'arrowTip' \| 'knee' \| 'textBox' \| 'whole'/);
  assert.match(hook, /case 'arrowTip':/);
  assert.match(hook, /case 'knee':/);
  assert.match(hook, /case 'textBox':/);
  assert.match(hook, /case 'whole':/);
  assert.match(hook, /if \(partType === 'line1' \|\| partType === 'line2'\) partType = 'whole'/);
  // Esc cancels marquee only — not callout-part drag.
  assert.match(hook, /Escape cancels an in-progress marquee/);
  assert.doesNotMatch(hook, /if \(e\.key === 'Escape'\)[\s\S]{0,200}mode === 'callout-part'/);
  assert.match(hook, /onUpdateCallout\(ds\.calloutId, finalCalloutPatch/);
  // Zoom is page-normalized (viewBox), not a JS scale rewrite.
  assert.match(hook, /dxNorm = dxPage \/ W/);
  assert.match(hook, /constrainToPage/);
});
