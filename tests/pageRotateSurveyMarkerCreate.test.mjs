import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';

// Source contracts for survey-marker create AFTER the page is already
// CW-rotated (viewBox 0 0 792 612). Rect+pen create after CW is
// e2e-page-rotate-create (screenToSVG → Fabric left/top). Callout create
// after CW is e2e-page-rotate-callout-create (0–1 fractions). Line create
// after CW is e2e-page-rotate-line-create (bbox + CENTER-relative x1..y2).
// Textbox create after CW is e2e-page-rotate-textbox-create
// ([data-text-preview] then isNewText). Counter create after CW is
// e2e-page-rotate-counter-create ([data-counter-overlay] origin +
// pointerAngle). Survey-marker is SHAPE_CREATION_TOOLS rubber-band via
// screenToSVG then onSurveyMarkerCreated({ x, y, width, height }) into
// bounds {x,y,width,height,angle}. Live proof:
// debug/scenarios/e2e-page-rotate-survey-marker-create.spec.mjs
// Distinct from leftover-18 / X-01 / remapped rect/callout/ink/counter/
// survey-marker/midpoint / remapped mt/mtr/br / remapped-page export /
// rect+pen create / callout create / line create / textbox create /
// counter create. Do not pad rotateSurveyMarkerBounds. Do not invent a
// checklist seed.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const FIRST_BOX = { x0: 0.22, y0: 0.30, x1: 0.46, y1: 0.48 };

// SVGAnnotationLayer survey-marker:create: min(start,end) + abs size,
// then onSurveyMarkerCreated({ x, y, width, height }) when w>2 && h>2.
function mapMarkerBounds(pageSize, box) {
  const x0 = pageSize.width * box.x0;
  const y0 = pageSize.height * box.y0;
  const x1 = pageSize.width * box.x1;
  const y1 = pageSize.height * box.y1;
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  return { x, y, width, height, angle: 0 };
}

function commitMarkerBounds(bounds) {
  if (!(bounds.width > 2 && bounds.height > 2)) return null;
  return {
    bounds: { ...bounds, angle: Number.isFinite(bounds.angle) ? bounds.angle : 0 },
  };
}

test('survey-marker create on swapped 792×612 lands in displayed space; stale 612×792 is a different point', () => {
  const displayed = { width: 792, height: 612 };
  const stale = { width: 612, height: 792 };
  const live = commitMarkerBounds(mapMarkerBounds(displayed, FIRST_BOX));
  const staleMapped = commitMarkerBounds(mapMarkerBounds(stale, FIRST_BOX));

  assert.ok(live, 'swapped-page rubber-band must pass the 2pt gate');
  assert.ok(staleMapped, 'portrait-fraction drag is a different, still-valid marker');
  assert.equal(live.bounds.angle, 0);
  assert.equal('left' in live, false, 'store is bounds, not Fabric left');
  assert.equal('top' in live, false, 'store is bounds, not Fabric top');
  assert.ok(live.bounds.width > 8 && live.bounds.height > 8);
  assert.ok(live.bounds.x + live.bounds.width <= 792 + 1e-6, 'new marker stays on swapped width');
  assert.ok(live.bounds.y + live.bounds.height <= 612 + 1e-6, 'new marker stays on swapped height');
  assert.ok(Math.abs(live.bounds.x - displayed.width * FIRST_BOX.x0) < 1e-6);
  assert.ok(Math.abs(live.bounds.y - displayed.height * FIRST_BOX.y0) < 1e-6);
  assert.ok(Math.abs(staleMapped.bounds.x - stale.width * FIRST_BOX.x0) < 1e-6);
  assert.ok(Math.abs(staleMapped.bounds.y - stale.height * FIRST_BOX.y0) < 1e-6);
  assert.ok(Math.abs(live.bounds.x - staleMapped.bounds.x) > 20, 'must not use stale portrait width');
  assert.ok(Math.abs(live.bounds.y - staleMapped.bounds.y) > 20, 'must not use stale portrait height');

  const liveCx = live.bounds.x + live.bounds.width / 2;
  const liveCy = live.bounds.y + live.bounds.height / 2;
  const staleCx = staleMapped.bounds.x + staleMapped.bounds.width / 2;
  const staleCy = staleMapped.bounds.y + staleMapped.bounds.height / 2;
  assert.ok(Math.abs(liveCx - (displayed.width * (FIRST_BOX.x0 + FIRST_BOX.x1) / 2)) < 1e-6);
  assert.ok(Math.abs(liveCy - (displayed.height * (FIRST_BOX.y0 + FIRST_BOX.y1) / 2)) < 1e-6);
  assert.ok(Math.abs(liveCx - staleCx) > 20);
  assert.ok(Math.abs(liveCy - staleCy) > 20);
});

test('tiny click invents 0; empty rotate peeks swapped displayed size', async () => {
  const tiny = commitMarkerBounds({
    x: 174.24,
    y: 183.6,
    width: 1,
    height: 1,
    angle: 0,
  });
  assert.equal(tiny, null);

  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 1, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
});

test('survey-marker create after rotate uses live viewBox + screenToSVG bounds; no remapper kind; skip file.id', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const viewer = read('src/PDFViewer.jsx');
  const ops = read('src/hooks/usePageOperations.js');
  const spec = read('debug/scenarios/e2e-page-rotate-survey-marker-create.spec.mjs');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /const SHAPE_CREATION_TOOLS = \['rect', 'ellipse', 'line', 'arrow', 'survey-marker'\]/);
  assert.match(layer, /const point = screenToSVG\(svgRef\.current, e\.clientX, e\.clientY\)/);
  assert.match(layer, /if \(tool === 'survey-marker'\)/);
  assert.match(layer, /onSurveyMarkerCreated\(\{ x: left, y: top, width: markerWidth, height: markerHeight \}\)/);
  assert.match(layer, /markerWidth > 2 && markerHeight > 2/);
  assert.match(layer, /never commit partial work/);
  assert.match(layer, /pointercancel/);
  assert.match(layer, /zoomGeneration/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  assert.match(viewer, /x: Number\(bounds\.x\) \|\| 0/);
  assert.match(viewer, /onSurveyMarkerCreated=\{handleSurveyMarkerCreated\}/);
  assert.match(viewer, /setPageSizes\(\{ 1: \{ width: firstViewport\.width, height: firstViewport\.height \} \}\)/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.doesNotMatch(viewer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  assert.match(ops, /peekDisplayedPageSize/);
  assert.match(ops, /pageWidth: displayed\.width/);
  assert.match(ops, /pageHeight: displayed\.height/);

  assert.match(dev, /Do NOT set file\.id/);
  assert.match(dev, /surveyTransitionE2ETemplates/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  const seeds = dev.slice(
    dev.indexOf('const surveyTransitionE2ETemplates'),
    dev.indexOf('const SURVEY_TEMPLATE_WORKFLOW_STORAGE_KEY'),
  );
  assert.doesNotMatch(seeds, /checklist\s*:/);
  assert.doesNotMatch(seeds, /checklistItems:/);

  assert.match(spec, /testPdf=clickable-link-test\.pdf&surveyTransitionE2E=1/);
  assert.match(spec, /create starts on the swapped viewBox/);
  assert.match(spec, /new marker must land in displayed 792×612, not pre-rotate 612×792/);
  assert.match(spec, /must not use stale portrait pageSize for bounds\.x/);
  assert.match(spec, /tiny click invents 0/);
  assert.match(spec, /pointercancel invents 0/);
  assert.match(spec, /second marker must keep its id/);
  assert.match(spec, /viewBox held after new survey-marker/);
  assert.match(spec, /390 survey-marker-create-after-rotate edge/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /checklistItems/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds|rotatePageSpaceCounter/);
});
