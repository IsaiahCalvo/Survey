import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { buildBoundaryShapeCommitJSON, buildFreehandCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';

// Source contracts for create AFTER the page is already CW-rotated
// (viewBox 0 0 792 612). Remappers rewrite existing objects; this path
// rubber-bands a new rect / live pen onto the swapped page. Live proof:
// debug/scenarios/e2e-page-rotate-create.spec.mjs
// Distinct from leftover-18 / X-01 / remapped rect/callout/ink/counter/
// survey-marker/midpoint / remapped mt/mtr/br / remapped-page export.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const RECT_BOX = { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 };
const PEN_BOX = { x0: 0.55, y0: 0.25, x1: 0.78, y1: 0.48 };

const shared = {
  id: 'xf-rot-create',
  strokeColor: '#00FFFF',
  strokeOpacity: 100,
  fillColor: 'transparent',
  fillOpacity: 100,
  strokeWidth: 3,
  lineBorderStyle: 'solid',
  cloudIntensity: 2,
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

function fracBox(size, box) {
  return {
    start: { x: size.width * box.x0, y: size.height * box.y0 },
    end: { x: size.width * box.x1, y: size.height * box.y1 },
  };
}

test('create on swapped 792×612 lands in displayed space; stale 612×792 is a different point', () => {
  const displayed = { width: 792, height: 612 };
  const stale = { width: 612, height: 792 };
  const live = buildBoundaryShapeCommitJSON({
    ...shared,
    tool: 'rect',
    ...fracBox(displayed, RECT_BOX),
  });
  const staleMapped = buildBoundaryShapeCommitJSON({
    ...shared,
    id: 'xf-stale',
    tool: 'rect',
    ...fracBox(stale, RECT_BOX),
  });
  assert.ok(live, 'swapped-page rubber-band must pass the 2pt gate');
  assert.ok(staleMapped, 'portrait-fraction drag is a different, still-valid rect');
  assert.equal(live.angle, 0);
  assert.ok(live.width > 8 && live.height > 8);
  assert.ok(live.left + live.width <= 792 + 1e-6, 'new rect stays on swapped width');
  assert.ok(live.top + live.height <= 612 + 1e-6, 'new rect stays on swapped height');
  assert.ok(Math.abs(live.left - displayed.width * RECT_BOX.x0) < 4);
  assert.ok(Math.abs(live.top - displayed.height * RECT_BOX.y0) < 4);
  assert.ok(Math.abs(staleMapped.left - stale.width * RECT_BOX.x0) < 4);
  assert.ok(Math.abs(staleMapped.top - stale.height * RECT_BOX.y0) < 4);
  assert.ok(Math.abs(live.left - staleMapped.left) > 20, 'must not use stale portrait width');
  assert.ok(Math.abs(live.top - staleMapped.top) > 20, 'must not use stale portrait height');

  const ink = buildFreehandCommitJSON({
    tool: 'pen',
    id: 'xf-rot-create-ink',
    points: [
      { x: displayed.width * PEN_BOX.x0, y: displayed.height * PEN_BOX.y0 },
      { x: displayed.width * ((PEN_BOX.x0 + PEN_BOX.x1) / 2), y: displayed.height * ((PEN_BOX.y0 + PEN_BOX.y1) / 2) },
      { x: displayed.width * PEN_BOX.x1, y: displayed.height * PEN_BOX.y1 },
    ],
    strokeColor: '#111111',
    highlightColor: null,
    strokeWidth: 4,
    selectedModuleId: null,
    stampRegionId: null,
    activeRegionId: null,
  });
  assert.ok(ink);
  assert.equal(ink.left, 0);
  assert.equal(ink.angle || 0, 0);
  const first = ink.paperCenterline?.[0] || {};
  assert.ok(Math.abs(Number(first.x) - displayed.width * PEN_BOX.x0) < 1e-6);
  assert.ok(Math.abs(Number(first.y) - displayed.height * PEN_BOX.y0) < 1e-6);
  assert.ok(Number(first.x) <= 792);
  assert.ok(Number(first.y) <= 612);
  assert.ok(Math.abs(Number(first.x) - stale.width * PEN_BOX.x0) > 20);
  assert.ok(Math.abs(Number(first.y) - stale.height * PEN_BOX.y0) > 20);
});

test('tiny click and empty ink invent 0; empty rotate peeks swapped displayed size', async () => {
  const tiny = buildBoundaryShapeCommitJSON({
    ...shared,
    tool: 'rect',
    start: { x: 174.24, y: 183.6 },
    end: { x: 175.24, y: 184.6 },
  });
  assert.equal(tiny, null);

  const emptyInk = buildFreehandCommitJSON({
    tool: 'pen',
    id: 'xf-empty-ink',
    points: [],
    strokeColor: '#111111',
    highlightColor: null,
    strokeWidth: 4,
    selectedModuleId: null,
    stampRegionId: null,
    activeRegionId: null,
  });
  assert.equal(emptyInk, null);

  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 1, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
});

test('create after rotate uses live viewBox + screenToSVG; no remapper kind; skip file.id', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const commit = read('src/utils/annotationCreationCommit.js');
  const viewer = read('src/PDFViewer.jsx');
  const ops = read('src/hooks/usePageOperations.js');
  const spec = read('debug/scenarios/e2e-page-rotate-create.spec.mjs');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /const point = screenToSVG\(svgRef\.current, e\.clientX, e\.clientY\)/);
  assert.match(layer, /buildBoundaryShapeCommitJSON/);
  assert.match(layer, /buildFreehandCommitJSON/);
  assert.match(layer, /never commit partial work/);
  assert.match(layer, /pointercancel/);
  assert.match(layer, /zoomGeneration/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
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
  assert.match(spec, /new rect must land in displayed 792×612, not pre-rotate 612×792/);
  assert.match(spec, /must not use stale portrait pageSize/);
  assert.match(spec, /pen centerline uses swapped width/);
  assert.match(spec, /tiny click invents 0/);
  assert.match(spec, /pointercancel invents 0/);
  assert.match(spec, /viewBox held after new rect/);
  assert.match(spec, /390 create-after-rotate edge/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
});
