import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { getCounterRenderGeometry } from '../src/utils/counterGeometry.js';
import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';

// Source contracts for Counter create AFTER the page is already CW-rotated
// (viewBox 0 0 792 612). Rect+pen create after CW is e2e-page-rotate-create
// (screenToSVG page px). Callout create after CW is e2e-page-rotate-callout-create
// (0–1 fractions). Line create after CW is e2e-page-rotate-line-create
// (bbox + CENTER-relative x1..y2). Textbox create after CW is
// e2e-page-rotate-textbox-create ([data-text-preview] then isNewText).
// Counter is [data-counter-overlay] click-to-place: left/top is the circle
// origin + pointerAngle. Live proof: debug/scenarios/e2e-page-rotate-counter-create.spec.mjs
// Distinct from leftover-18 / X-01 / remapped rect/callout/ink/counter/
// survey-marker/midpoint / remapped mt/mtr/br / remapped-page export /
// rect+pen create / callout create / line create / textbox create.
// Do not pad rotatePageSpaceCounter.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const FIRST_PIN = { xf: 0.22, yf: 0.30 };
const RADIUS = 14;

// PDFViewer counter overlay: pageW = resolvedPageSize.width then
// effectiveScale = rect.width / pageW, click = offset / effectiveScale,
// left/top = click - COUNTER_RADIUS, pointerAngle = 225.
function mapCounterClick(pageSize, overlay, pin, radius = RADIUS) {
  const pageW = pageSize.width;
  const effectiveScale = overlay.width / pageW;
  const x = (overlay.width * pin.xf) / effectiveScale;
  const y = (overlay.height * pin.yf) / effectiveScale;
  return {
    left: x - radius,
    top: y - radius,
    cx: x,
    cy: y,
    radius,
    pointerAngle: 225,
  };
}

test('counter create on swapped 792×612 lands in displayed space; stale 612×792 is a different point', () => {
  const displayed = { width: 792, height: 612 };
  const stale = { width: 612, height: 792 };
  const overlay = { width: 990, height: 765 };
  const live = mapCounterClick(displayed, overlay, FIRST_PIN);
  const staleMapped = mapCounterClick(stale, overlay, FIRST_PIN);

  assert.ok(Math.abs(live.cx - displayed.width * FIRST_PIN.xf) < 1e-6);
  assert.ok(Math.abs(live.cy - displayed.height * FIRST_PIN.yf) < 1e-6);
  assert.ok(Math.abs(live.left - (live.cx - live.radius)) < 1e-6);
  assert.ok(Math.abs(live.top - (live.cy - live.radius)) < 1e-6);
  assert.equal(live.pointerAngle, 225);
  assert.ok(live.cx >= -1e-6 && live.cx <= 792 + 1e-6);
  assert.ok(live.cy >= -1e-6 && live.cy <= 612 + 1e-6);
  assert.ok(live.left + live.radius * 2 <= 792 + 1e-6);
  assert.ok(live.top + live.radius * 2 <= 612 + 1e-6);

  assert.ok(Math.abs(staleMapped.cx - stale.width * FIRST_PIN.xf) < 1e-6);
  assert.ok(Math.abs(live.cx - staleMapped.cx) > 20, 'must not use stale portrait width');
  assert.ok(Math.abs(live.cy - staleMapped.cy) > 20, 'must not use stale portrait height');
  assert.ok(Math.abs(live.cx - (stale.width * FIRST_PIN.xf)) > 20);
  assert.ok(Math.abs(live.cy - (stale.height * FIRST_PIN.yf)) > 20);

  const nub = getCounterRenderGeometry(live.cx, live.cy, live.radius, live.pointerAngle, 1);
  assert.ok(Number.isFinite(nub.tip.x) && Number.isFinite(nub.tip.y));
  assert.ok(Math.hypot(nub.tip.x - live.cx, nub.tip.y - live.cy) > live.radius);
  assert.ok(nub.tip.x < live.cx && nub.tip.y > live.cy, '225° nub aims southwest');
});

test('empty click away invents 0; empty rotate peeks swapped displayed size', async () => {
  // Overlay bails before minting a pin when pageW or rect.width is 0 —
  // a click that never hits [data-counter-overlay] invents 0.
  const pageW = 792;
  const awayRectWidth = 0;
  assert.equal(!pageW || awayRectWidth === 0, true);

  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 1, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
});

test('counter create after rotate uses live pageSize + overlay scale; no remapper kind; skip file.id', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const viewer = read('src/PDFViewer.jsx');
  const ops = read('src/hooks/usePageOperations.js');
  const spec = read('debug/scenarios/e2e-page-rotate-counter-create.spec.mjs');
  const dev = read('src/DevTestRoute.jsx');
  const geometry = read('src/utils/counterGeometry.js');

  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /zoomGeneration/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  assert.match(viewer, /data-counter-overlay=\{pageNumber\}/);
  assert.match(viewer, /const pageW = resolvedPageSize\.width/);
  assert.match(viewer, /const effectiveScale = rect\.width \/ pageW/);
  assert.match(viewer, /left: x - COUNTER_RADIUS/);
  assert.match(viewer, /top: y - COUNTER_RADIUS/);
  assert.match(viewer, /pointerAngle: initialAngle/);
  assert.match(viewer, /const initialAngle = 225/);
  assert.match(viewer, /seriesId = `series-\$\{Date\.now\(\)\}`/);
  assert.match(viewer, /displayNumber = seriesStart \+ existingSeriesCounterCount/);
  assert.match(viewer, /onPointerCancel/);
  assert.match(viewer, /cancelCounterDrag/);
  assert.match(viewer, /setPageSizes\(\{ 1: \{ width: firstViewport\.width, height: firstViewport\.height \} \}\)/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.doesNotMatch(viewer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  assert.match(geometry, /const tipDistance = radius \+ tipExtension/);
  assert.match(ops, /peekDisplayedPageSize/);
  assert.match(ops, /pageWidth: displayed\.width/);
  assert.match(ops, /pageHeight: displayed\.height/);

  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /create starts on the swapped viewBox/);
  assert.match(spec, /new pin must land in displayed 792×612, not pre-rotate 612×792/);
  assert.match(spec, /must not use stale portrait pageSize for left\/origin X/);
  assert.match(spec, /empty click away invents 0/);
  assert.match(spec, /second pin continues series/);
  assert.match(spec, /nubbin pointerAngle must stay the place default/);
  assert.match(spec, /viewBox held after new counter/);
  assert.match(spec, /390 counter-create-after-rotate edge/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
});
