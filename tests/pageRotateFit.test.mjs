import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';
import { clampScale } from '../src/utils/zoomController.js';

// Source contracts: Fit page / Fit width AFTER page CW (viewBox 0 0 792 612).
// Unrotated V-04 is e2e-fit-page / e2e-zoom-keyboard-fit-width (portrait).
// Fit must use the swapped 792×612 page, not leftover 612×792.
// Live proof: debug/scenarios/e2e-page-rotate-fit.spec.mjs
// Distinct from leftover-18 / X-01 / remapper / create-after-rotate /
// History-restore / eraser-on-remap / mtr / page-ops / after-CW
// Select-text / Search / thumbnails / form widgets. Do not invent dest remapping.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function fitScales(viewport, pageSize) {
  const widthScale = clampScale(viewport.width / pageSize.width);
  const heightScale = clampScale(viewport.height / pageSize.height);
  return {
    fitWidth: widthScale,
    fitPage: clampScale(Math.min(widthScale, heightScale)),
  };
}

test('CW rewrite peeks swapped 792×612; leftover 612×792 Fit is not landscape Fit', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const before = await peekDisplayedPageSize(sourceBytes, 1);
  assert.deepEqual(before, { width: 612, height: 792 });

  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 1, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });

  const wide = { width: 1100, height: 720 };
  const leftover = fitScales(wide, { width: 612, height: 792 });
  const swapped = fitScales(wide, { width: 792, height: 612 });
  assert.ok(leftover.fitWidth > leftover.fitPage, 'leftover portrait Fit width exceeds Fit page');
  assert.ok(swapped.fitWidth !== swapped.fitPage, 'Fit page ≠ Fit width on landscape 792×612');
  assert.ok(Math.abs(swapped.fitPage - leftover.fitPage) > 0.04, 'swapped Fit page must leave leftover 612×792');
  assert.ok(Math.abs(swapped.fitWidth - leftover.fitWidth) > 0.04, 'swapped Fit width must leave leftover 612×792');
});

test('fit after CW reads live pageSizes, not a leftover 612×792 fallback; SVG falls through; no JS zoom', () => {
  const viewer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewer, /target === 'fit' \|\| target === 'fitw'/);
  assert.match(viewer, /fitToPage: \(\) => zoomToScale\('fit'\)/);
  assert.match(viewer, /fitToWidth: \(\) => zoomToScale\('fitw'\)/);
  assert.match(viewer, /pageSizes\[Math\.max\(0, range\[0\]\)\] \|\| pageSizes\[0\] \|\| \{ w: 612, h: 792 \}/);

  const pdfViewer = read('src/PDFViewer.jsx');
  assert.match(pdfViewer, /magnification\.fitToPage\(\)/);
  assert.match(pdfViewer, /magnification\.fitToWidth\(\)/);
  assert.match(pdfViewer, /setZoomGeneration\(prev => prev \+ 1\)/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(svg, /zoomGeneration/);
  assert.doesNotMatch(svg, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
});

test('live spec covers Fit page / Fit width after CW + leftover 612×792 + 390; skip leftover-18', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-fit.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Fit page \/ Fit width after page CW intended \+ break \+ edge/);
  assert.match(spec, /390 Fit page after page CW edge/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /page rotate must keep swapped viewBox/);
  assert.match(spec, /Fit page after CW must use the swapped 792×612 page, not leftover 612×792/);
  assert.match(spec, /Fit page host must be landscape, not leftover portrait/);
  assert.match(spec, /Fit page must leave leftover 612×792 %/);
  assert.match(spec, /Fit page ≠ Fit width on landscape host/);
  assert.match(spec, /Fit width must fill the landscape host width/);
  assert.match(spec, /empty CW invents 0 annotations/);
  assert.match(spec, /viewBox held after Fit page \/ Fit width/);
  assert.match(spec, /390 Pages rotate is not cheap \(sheet backdrop\)/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);

  const unrotatedPage = read('debug/scenarios/e2e-fit-page.spec.mjs');
  assert.match(unrotatedPage, /desktop Fit page intended \+ break \+ edge/);
  assert.doesNotMatch(unrotatedPage, /page rotate must keep swapped viewBox/);

  const unrotatedWidth = read('debug/scenarios/e2e-zoom-keyboard-fit-width.spec.mjs');
  assert.match(unrotatedWidth, /desktop zoom keyboard \+ Fit width intended \+ break \+ edge/);
  assert.doesNotMatch(unrotatedWidth, /Fit page after CW must use the swapped 792×612 page/);

  const forms = read('debug/scenarios/e2e-page-rotate-form-widgets.spec.mjs');
  assert.match(forms, /form layer must be landscape, not leftover portrait/);
  assert.doesNotMatch(forms, /Fit page after CW must use the swapped 792×612 page/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
