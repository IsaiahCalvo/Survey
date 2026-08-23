import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { buildLineCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';

// Source contracts for Line create AFTER the page is already CW-rotated
// (viewBox 0 0 792 612). Rect+pen create after CW is e2e-page-rotate-create
// (screenToSVG page px). Callout create after CW is e2e-page-rotate-callout-create
// (0–1 fractions). Line stores page-space bbox + CENTER-relative x1..y2.
// Live proof: debug/scenarios/e2e-page-rotate-line-create.spec.mjs
// Distinct from leftover-18 / X-01 / remapped rect/callout/ink/counter/
// survey-marker/midpoint / remapped mt/mtr/br / remapped-page export /
// rect+pen create / callout create. Do not pad rotatePageSpaceInk.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const LINE_BOX = { x0: 0.22, y0: 0.30, x1: 0.55, y1: 0.48 };

const shared = {
  id: 'xf-rot-line-create',
  strokeColor: '#111111',
  strokeOpacity: 100,
  strokeWidth: 3,
  lineBorderStyle: 'solid',
  cloudIntensity: 2,
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

function fracEnds(size, box) {
  return {
    start: { x: size.width * box.x0, y: size.height * box.y0 },
    end: { x: size.width * box.x1, y: size.height * box.y1 },
  };
}

function displayedEnds(json) {
  const cx = json.left + json.width / 2;
  const cy = json.top + json.height / 2;
  return {
    px1: cx + json.x1,
    py1: cy + json.y1,
    px2: cx + json.x2,
    py2: cy + json.y2,
  };
}

test('line create on swapped 792×612 lands in displayed space; stale 612×792 is a different point', () => {
  const displayed = { width: 792, height: 612 };
  const stale = { width: 612, height: 792 };
  const live = buildLineCommitJSON({
    ...shared,
    tool: 'line',
    ...fracEnds(displayed, LINE_BOX),
  });
  const staleMapped = buildLineCommitJSON({
    ...shared,
    id: 'xf-stale-line',
    tool: 'line',
    ...fracEnds(stale, LINE_BOX),
  });
  assert.ok(live, 'swapped-page rubber-band must pass the 3pt gate');
  assert.ok(staleMapped, 'portrait-fraction drag is a different, still-valid line');
  assert.equal(live.angle || 0, 0);
  assert.equal(live.data.arrowheadStyle, undefined);
  assert.ok(Math.hypot(live.x2 - live.x1, live.y2 - live.y1) > 8);

  const ends = displayedEnds(live);
  const staleEnds = displayedEnds(staleMapped);
  assert.ok(Math.abs(ends.px1 - displayed.width * LINE_BOX.x0) < 1e-6);
  assert.ok(Math.abs(ends.py1 - displayed.height * LINE_BOX.y0) < 1e-6);
  assert.ok(Math.abs(ends.px2 - displayed.width * LINE_BOX.x1) < 1e-6);
  assert.ok(Math.abs(ends.py2 - displayed.height * LINE_BOX.y1) < 1e-6);
  assert.ok(ends.px1 >= -1e-6 && ends.px1 <= 792 + 1e-6);
  assert.ok(ends.py1 >= -1e-6 && ends.py1 <= 612 + 1e-6);
  assert.ok(ends.px2 >= -1e-6 && ends.px2 <= 792 + 1e-6);
  assert.ok(ends.py2 >= -1e-6 && ends.py2 <= 612 + 1e-6);
  assert.ok(live.left + live.width <= 792 + 1e-6);
  assert.ok(live.top + live.height <= 612 + 1e-6);

  assert.ok(Math.abs(staleEnds.px1 - stale.width * LINE_BOX.x0) < 1e-6);
  assert.ok(Math.abs(staleEnds.py1 - stale.height * LINE_BOX.y0) < 1e-6);
  assert.ok(Math.abs(ends.px1 - staleEnds.px1) > 20, 'must not use stale portrait width');
  assert.ok(Math.abs(ends.py1 - staleEnds.py1) > 20, 'must not use stale portrait height');
  assert.ok(Math.abs(ends.px2 - staleEnds.px2) > 20);
  assert.ok(Math.abs(ends.py2 - staleEnds.py2) > 20);
});

test('tiny click invents 0; empty rotate peeks swapped displayed size', async () => {
  const tiny = buildLineCommitJSON({
    ...shared,
    tool: 'line',
    start: { x: 174.24, y: 183.6 },
    end: { x: 175.24, y: 184.6 },
  });
  assert.equal(tiny, null);

  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 1, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
});

test('line create after rotate uses live viewBox + screenToSVG; no remapper kind; skip file.id', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const commit = read('src/utils/annotationCreationCommit.js');
  const viewer = read('src/PDFViewer.jsx');
  const ops = read('src/hooks/usePageOperations.js');
  const spec = read('debug/scenarios/e2e-page-rotate-line-create.spec.mjs');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /const point = screenToSVG\(svgRef\.current, e\.clientX, e\.clientY\)/);
  assert.match(layer, /buildLineCommitJSON/);
  assert.match(layer, /never commit partial work/);
  assert.match(layer, /pointercancel/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /shapeCreation\.tool === 'line' \|\| shapeCreation\.tool === 'arrow'/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(commit, /if \(!\(Math\.hypot\(dx, dy\) > 3\)\) return null/);
  assert.doesNotMatch(commit, /\b612\b/);
  assert.doesNotMatch(commit, /\b792\b/);

  assert.match(ops, /peekDisplayedPageSize/);
  assert.match(ops, /pageWidth: displayed\.width/);
  assert.match(ops, /pageHeight: displayed\.height/);
  assert.match(viewer, /setPageSizes\(\{ 1: \{ width: firstViewport\.width, height: firstViewport\.height \} \}\)/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);

  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /create starts on the swapped viewBox/);
  assert.match(spec, /new line start must land in displayed 792×612, not pre-rotate 612×792/);
  assert.match(spec, /must not use stale portrait pageSize for start X/);
  assert.match(spec, /new line end uses swapped width/);
  assert.match(spec, /tiny click invents 0/);
  assert.match(spec, /pointercancel invents 0/);
  assert.match(spec, /viewBox held after new line/);
  assert.match(spec, /390 line-create-after-rotate edge/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
});
