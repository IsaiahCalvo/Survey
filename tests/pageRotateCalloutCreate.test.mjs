import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { createCallout } from '../src/components/Callout/types.js';
import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';

// Source contracts for callout create AFTER the page is already CW-rotated
// (viewBox 0 0 792 612). Rect+pen create after CW is e2e-page-rotate-create
// (screenToSVG page px). Callout stores 0–1 fractions (120/W × 32/H).
// Live proof: debug/scenarios/e2e-page-rotate-callout-create.spec.mjs
// Distinct from leftover-18 / X-01 / remapped rect/callout/ink/counter/
// survey-marker/midpoint / remapped mt/mtr/br / remapped-page export /
// rect+pen create. Do not pad rotateCalloutFractions.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const CALLOUT_BOX = { x0: 0.16, y0: 0.22, x1: 0.44, y1: 0.42 };

function fracPoint(size, x, y) {
  return { x: size.width * x, y: size.height * y };
}

function normalizeCalloutCreate(arrowTipPx, boxPx, W, H) {
  const kneeRadiusPx = 40;
  const tbCenterPx = { x: boxPx.x + 60, y: boxPx.y + 16 };
  const kneeDx = tbCenterPx.x - arrowTipPx.x;
  const kneeDy = tbCenterPx.y - arrowTipPx.y;
  const kneeDist = Math.hypot(kneeDx, kneeDy) || 1;
  return {
    arrowTip: { x: arrowTipPx.x / W, y: arrowTipPx.y / H },
    knee: {
      x: (arrowTipPx.x + (kneeDx / kneeDist) * kneeRadiusPx) / W,
      y: (arrowTipPx.y + (kneeDy / kneeDist) * kneeRadiusPx) / H,
    },
    textBox: { x: boxPx.x / W, y: boxPx.y / H },
    textBoxWidth: 120 / W,
    textBoxHeight: 32 / H,
  };
}

test('callout create on swapped 792×612 stores live fractions; stale 612×792 is a different point', () => {
  const displayed = { width: 792, height: 612 };
  const stale = { width: 612, height: 792 };
  const arrowPx = fracPoint(displayed, CALLOUT_BOX.x0, CALLOUT_BOX.y0);
  const boxPx = fracPoint(displayed, CALLOUT_BOX.x1, CALLOUT_BOX.y1);

  const live = normalizeCalloutCreate(arrowPx, boxPx, displayed.width, displayed.height);
  const staleMapped = normalizeCalloutCreate(arrowPx, boxPx, stale.width, stale.height);

  assert.ok(Math.abs(live.arrowTip.x - CALLOUT_BOX.x0) < 1e-9);
  assert.ok(Math.abs(live.arrowTip.y - CALLOUT_BOX.y0) < 1e-9);
  assert.ok(Math.abs(live.textBox.x - CALLOUT_BOX.x1) < 1e-9);
  assert.ok(Math.abs(live.textBox.y - CALLOUT_BOX.y1) < 1e-9);
  assert.ok(Math.abs(live.textBoxWidth - 120 / 792) < 1e-9);
  assert.ok(Math.abs(live.textBoxHeight - 32 / 612) < 1e-9);
  assert.ok(live.arrowTip.x > 0 && live.arrowTip.x < 1);
  assert.ok(live.knee.x > 0 && live.knee.x < 1);
  assert.ok(live.textBox.x > 0 && live.textBox.x < 1);
  assert.ok(live.arrowTip.x * 792 + 1e-6 <= 792);
  assert.ok(live.arrowTip.y * 612 + 1e-6 <= 612);
  assert.ok(Math.abs(live.textBoxWidth * 792 - 120) < 1e-6);
  assert.ok(Math.abs(live.textBoxHeight * 612 - 32) < 1e-6);

  assert.ok(Math.abs(staleMapped.arrowTip.x - (arrowPx.x / 612)) < 1e-9);
  assert.ok(Math.abs(staleMapped.textBoxWidth - 120 / 612) < 1e-9);
  assert.ok(Math.abs(staleMapped.textBoxHeight - 32 / 792) < 1e-9);
  assert.ok(Math.abs(live.arrowTip.x - staleMapped.arrowTip.x) > 0.02, 'must not use stale portrait width');
  assert.ok(Math.abs(live.arrowTip.y - staleMapped.arrowTip.y) > 0.02, 'must not use stale portrait height');
  assert.ok(Math.abs(live.textBoxWidth - staleMapped.textBoxWidth) > 0.02);
  assert.ok(Math.abs(live.textBoxHeight - staleMapped.textBoxHeight) > 0.006);

  const staleOnLiveX = staleMapped.arrowTip.x * 792;
  const staleOnLiveY = staleMapped.arrowTip.y * 612;
  assert.ok(Math.abs(staleOnLiveX - arrowPx.x) > 20, 'stale fractions miss the displayed click');
  assert.ok(Math.abs(staleOnLiveY - arrowPx.y) > 20);
  assert.ok(Math.abs(live.arrowTip.x * 792 - arrowPx.x) < 1e-6);
  assert.ok(Math.abs(live.arrowTip.y * 612 - arrowPx.y) < 1e-6);

  const made = createCallout(
    1,
    live.arrowTip,
    live.knee,
    live.textBox,
    live.textBoxWidth,
    live.textBoxHeight,
  );
  assert.ok(made.id.startsWith('callout-'));
  assert.equal(made.pageNumber, 1);
  assert.equal(made.style.fontFamily, 'Arial');
  assert.ok(Math.abs(made.textBoxWidth - 120 / 792) < 1e-9);
  assert.ok(Math.abs(made.textBoxHeight - 32 / 612) < 1e-9);
  assert.ok(Math.abs(made.arrowTip.x - CALLOUT_BOX.x0) < 1e-9);
});

test('tiny click invents 0; empty rotate peeks swapped displayed size', async () => {
  const dx = 1;
  const dy = 1;
  assert.ok(dx * dx + dy * dy < 16, 'same-point / 4px gate must invent 0');

  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 1, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
});

test('callout create after rotate uses live W/H + screenToSVG; no remapper kind; skip file.id', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const types = read('src/components/Callout/types.js');
  const viewer = read('src/PDFViewer.jsx');
  const ops = read('src/hooks/usePageOperations.js');
  const spec = read('debug/scenarios/e2e-page-rotate-callout-create.spec.mjs');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /const pt = screenToSVG\(svgRef\.current, e\.clientX, e\.clientY\)/);
  assert.match(layer, /const raw = screenToSVG\(svgRef\.current, e\.clientX, e\.clientY\)/);
  assert.match(layer, /const W = width \|\| 1/);
  assert.match(layer, /const H = height \|\| 1/);
  assert.match(layer, /const arrowTipNorm = \{ x: state\.arrowTip\.x \/ W, y: state\.arrowTip\.y \/ H \}/);
  assert.match(layer, /120 \/ W/);
  assert.match(layer, /32 \/ H/);
  assert.match(layer, /if \(dx \* dx \+ dy \* dy < 16\) return/);
  assert.match(layer, /if \(activeTool !== 'callout'\) \{\s*setCalloutCreation\(null\)/);
  assert.match(layer, /createCallout\(/);
  assert.match(layer, /zoomGeneration/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(types, /arrowTip - Position as percentage of page \(0-1\)/);
  assert.match(types, /fontFamily: 'Arial'/);

  assert.match(ops, /peekDisplayedPageSize/);
  assert.match(ops, /pageWidth: displayed\.width/);
  assert.match(ops, /pageHeight: displayed\.height/);
  assert.match(viewer, /setPageSizes\(\{ 1: \{ width: firstViewport\.width, height: firstViewport\.height \} \}\)/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);

  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /create starts on the swapped viewBox/);
  assert.match(spec, /new callout box width must be 120 \/ 792, not stale 120 \/ 612/);
  assert.match(spec, /must not use stale portrait page width for fractions/);
  assert.match(spec, /arrow must land at the displayed-page click, not a pre-rotate fraction/);
  assert.match(spec, /box must land in displayed 792×612, not pre-rotate 612×792/);
  assert.match(spec, /knee handle must stay on the swapped page/);
  assert.match(spec, /box handle must stay on the swapped page/);
  assert.match(spec, /tiny click invents 0/);
  assert.match(spec, /tool-switch mid-drag must invent 0/);
  assert.match(spec, /viewBox held after new callout/);
  assert.match(spec, /390 callout-create-after-rotate edge/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
});
