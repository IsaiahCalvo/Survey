import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { buildNewTextCommitJSON } from '../src/utils/textEditCommit.js';
import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';

// Source contracts for Textbox create AFTER the page is already CW-rotated
// (viewBox 0 0 792 612). Rect+pen create after CW is e2e-page-rotate-create
// (screenToSVG page px). Callout create after CW is e2e-page-rotate-callout-create
// (0–1 fractions). Line create after CW is e2e-page-rotate-line-create
// (bbox + CENTER-relative x1..y2). Textbox is [data-text-preview] then
// setEditingAnnotation({ isNewText: true }) — not SHAPE_CREATION_TOOLS.
// Live proof: debug/scenarios/e2e-page-rotate-textbox-create.spec.mjs
// Distinct from leftover-18 / X-01 / remapped rect/callout/ink/counter/
// survey-marker/midpoint / remapped mt/mtr/br / remapped-page export /
// rect+pen create / callout create / line create. Do not pad rotatePageSpaceInk.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const TEXT_BOX = { x0: 0.18, y0: 0.24, x1: 0.52, y1: 0.40 };

// PDFViewer text overlay: effectiveScale = rect.width / resolvedPageSize.width
// then clickPosition = offset / effectiveScale and
// textBoxWidth = isDrag ? dx / effectiveScale : undefined.
function mapTextDrag(pageSize, overlay, box) {
  const effectiveScale = overlay.width / pageSize.width;
  const dx = overlay.width * (box.x1 - box.x0);
  const dy = overlay.height * (box.y1 - box.y0);
  return {
    x: (overlay.width * box.x0) / effectiveScale,
    y: (overlay.height * box.y0) / effectiveScale,
    textBoxWidth: dx / effectiveScale,
    isDrag: dx > 10 || dy > 10,
  };
}

test('textbox create on swapped 792×612 lands in displayed space; stale 612×792 is a different point', () => {
  const displayed = { width: 792, height: 612 };
  const stale = { width: 612, height: 792 };
  const overlay = { width: 990, height: 765 };
  const live = mapTextDrag(displayed, overlay, TEXT_BOX);
  const staleMapped = mapTextDrag(stale, overlay, TEXT_BOX);

  assert.equal(live.isDrag, true);
  assert.ok(Math.abs(live.x - displayed.width * TEXT_BOX.x0) < 1e-6);
  assert.ok(Math.abs(live.y - displayed.height * TEXT_BOX.y0) < 1e-6);
  assert.ok(Math.abs(live.textBoxWidth - displayed.width * (TEXT_BOX.x1 - TEXT_BOX.x0)) < 1e-6);
  assert.ok(live.x >= -1e-6 && live.x <= 792 + 1e-6);
  assert.ok(live.y >= -1e-6 && live.y <= 612 + 1e-6);
  assert.ok(live.x + live.textBoxWidth <= 792 + 1e-6);

  assert.ok(Math.abs(staleMapped.x - stale.width * TEXT_BOX.x0) < 1e-6);
  assert.ok(Math.abs(live.x - staleMapped.x) > 20, 'must not use stale portrait width');
  assert.ok(Math.abs(live.y - staleMapped.y) > 20, 'must not use stale portrait height');
  assert.ok(Math.abs(live.textBoxWidth - staleMapped.textBoxWidth) > 20);

  const committed = buildNewTextCommitJSON({
    text: 'A',
    left: live.x,
    top: live.y,
    innerWrapWidth: live.textBoxWidth,
    maxLineWidth: 0,
    lineCount: 2,
    naturalInnerHeight: 20,
  });
  assert.ok(committed);
  assert.equal(committed.angle || 0, 0);
  assert.equal(committed.fontFamily, 'Helvetica');
  assert.ok(Math.abs(committed.left - live.x) < 1e-6);
  assert.ok(Math.abs(committed.top - live.y) < 1e-6);
  assert.ok(committed.width > 8);
  assert.ok(committed.height > 8);
  assert.ok(committed.left + committed.width <= 792 + 8);
  assert.ok(committed.top + committed.height <= 612 + 8);

  const staleCommit = buildNewTextCommitJSON({
    text: 'A',
    left: staleMapped.x,
    top: staleMapped.y,
    innerWrapWidth: staleMapped.textBoxWidth,
    maxLineWidth: 0,
    lineCount: 2,
    naturalInnerHeight: 20,
  });
  assert.ok(Math.abs(staleCommit.left - committed.left) > 20);
  assert.ok(Math.abs(staleCommit.top - committed.top) > 20);
});

test('sub-10px band invents 0; empty rotate peeks swapped displayed size', async () => {
  const overlay = { width: 990, height: 765 };
  const tiny = mapTextDrag({ width: 792, height: 612 }, overlay, {
    x0: 0.12,
    y0: 0.55,
    x1: 0.12 + 4 / overlay.width,
    y1: 0.55 + 3 / overlay.height,
  });
  assert.equal(tiny.isDrag, false);

  const blank = buildNewTextCommitJSON({
    text: '',
    left: 142.56,
    top: 146.88,
    innerWrapWidth: 269.28,
    naturalInnerHeight: 20,
  });
  assert.equal(blank, null);

  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 1, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
});

test('textbox create after rotate uses live pageSize + overlay scale; no remapper kind; skip file.id', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const commit = read('src/utils/textEditCommit.js');
  const overlay = read('src/components/TextEditOverlay.jsx');
  const viewer = read('src/PDFViewer.jsx');
  const ops = read('src/hooks/usePageOperations.js');
  const spec = read('debug/scenarios/e2e-page-rotate-textbox-create.spec.mjs');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /const SHAPE_CREATION_TOOLS = \['rect', 'ellipse', 'line', 'arrow', 'survey-marker'\]/);
  assert.doesNotMatch(layer, /SHAPE_CREATION_TOOLS = \[[^\]]*text/);
  assert.match(layer, /zoomGeneration/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  assert.match(viewer, /data-text-overlay=\{pageNumber\}/);
  assert.match(viewer, /data-text-preview/);
  assert.match(viewer, /const effectiveScale = rect\.width \/ resolvedPageSize\.width/);
  assert.match(viewer, /if \(dx > 10 \|\| dy > 10\)/);
  assert.match(viewer, /isNewText: true/);
  assert.match(viewer, /textBoxWidth: isDrag \? dx \/ effectiveScale : undefined/);
  assert.match(viewer, /const isDrag = dx > 10 \|\| dy > 10/);
  assert.match(viewer, /setPageSizes\(\{ 1: \{ width: firstViewport\.width, height: firstViewport\.height \} \}\)/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.doesNotMatch(viewer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  assert.match(overlay, /DEFAULT_FONT_FAMILY = 'Helvetica'/);
  assert.match(overlay, /left: clickPosition\?\.x \?\? 0/);
  assert.match(overlay, /outerW: Math\.max\(8 \+ 2 \* pad, textBoxWidth \|\| 160\)/);
  assert.doesNotMatch(overlay, /file\.id\s*=/);
  assert.doesNotMatch(commit, /\b612\b/);
  assert.doesNotMatch(commit, /\b792\b/);
  assert.match(commit, /fontFamily: 'Helvetica'/);

  assert.match(ops, /peekDisplayedPageSize/);
  assert.match(ops, /pageWidth: displayed\.width/);
  assert.match(ops, /pageHeight: displayed\.height/);

  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /create starts on the swapped viewBox/);
  assert.match(spec, /new textbox must land in displayed 792×612, not pre-rotate 612×792/);
  assert.match(spec, /must not use stale portrait pageSize for left/);
  assert.match(spec, /drag width uses swapped 792/);
  assert.match(spec, /pointerup mounts T-01 auto-edit/);
  assert.match(spec, /sub-10px band invents 0/);
  assert.match(spec, /tool-switch invents 0/);
  assert.match(spec, /viewBox held after new textbox/);
  assert.match(spec, /390 textbox-create-after-rotate edge/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
});
