import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createZoomController, ZOOM_MODES, clampScale } from '../src/utils/zoomController.js';
import { ZOOM_MODE_LABELS, ZOOM_MODE_OPTIONS } from '../src/viewerShared.js';

// Fit page is a distinct ZOOM_MODE: min(widthScale, heightScale) via
// magnification.fitToPage() + Ctrl+0. Fit height and Fit width already
// have dedicated intended+break+edge. Fit page was only a baseline
// contrast / UL-04 "50% then Ctrl+0 left 50%" sample.
// Live proof: debug/scenarios/e2e-fit-page.spec.mjs
// Distinct from leftover-18, UL-06 zoom %, W4-02 pinch.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function controllerFor(viewport, pageSize) {
  let applied = null;
  const controller = createZoomController({
    initialMode: ZOOM_MODES.MANUAL,
    initialManualScale: 1,
    getViewportSize: () => viewport,
    getPageSize: () => pageSize,
    setScale: (scale) => { applied = scale; },
    persistPreferences: () => {},
  });
  return { controller, applied: () => applied };
}

test('Fit page scale is min(width, height) and is not Fit width or Fit height', () => {
  assert.equal(ZOOM_MODES.FIT_PAGE, 'fitPage');
  assert.equal(ZOOM_MODE_LABELS[ZOOM_MODES.FIT_PAGE], 'Fit page');
  assert.equal(ZOOM_MODE_OPTIONS[0].id, 'fitPage');

  // Wide desktop vs letter: height is tighter → Fit page === Fit height < Fit width.
  const wide = controllerFor(
    { width: 1100, height: 720 },
    { width: 612, height: 792 },
  );
  const wideWidth = wide.controller.setMode(ZOOM_MODES.FIT_WIDTH);
  const wideHeight = wide.controller.setMode(ZOOM_MODES.FIT_HEIGHT);
  const widePage = wide.controller.setMode(ZOOM_MODES.FIT_PAGE);
  assert.equal(wideWidth, clampScale(1100 / 612));
  assert.equal(wideHeight, clampScale(720 / 792));
  assert.equal(widePage, clampScale(Math.min(1100 / 612, 720 / 792)));
  assert.equal(widePage, wideHeight);
  assert.ok(wideWidth > widePage, `wide Fit width ${wideWidth} should exceed Fit page ${widePage}`);
  assert.notEqual(widePage, wideWidth);

  // Narrow phone vs letter: width is tighter → Fit page === Fit width < Fit height.
  const narrow = controllerFor(
    { width: 320, height: 760 },
    { width: 612, height: 792 },
  );
  const narrowWidth = narrow.controller.setMode(ZOOM_MODES.FIT_WIDTH);
  const narrowHeight = narrow.controller.setMode(ZOOM_MODES.FIT_HEIGHT);
  const narrowPage = narrow.controller.setMode(ZOOM_MODES.FIT_PAGE);
  assert.equal(narrowPage, clampScale(Math.min(320 / 612, 760 / 792)));
  assert.equal(narrowPage, narrowWidth);
  assert.ok(narrowHeight > narrowPage, `narrow Fit height ${narrowHeight} should exceed Fit page ${narrowPage}`);
  assert.notEqual(narrowPage, narrowHeight);

  const missing = controllerFor(null, { width: 612, height: 792 });
  assert.equal(missing.controller.setMode(ZOOM_MODES.FIT_PAGE), 1);

  const zero = controllerFor({ width: 0, height: 0 }, { width: 612, height: 792 });
  assert.equal(zero.controller.setMode(ZOOM_MODES.FIT_PAGE), 0.01);

  const before = wide.controller.getScale();
  assert.equal(wide.controller.setMode('actualSize'), before);
  assert.equal(wide.controller.setMode('rotateView'), before);
  assert.equal(wide.controller.getMode(), ZOOM_MODES.FIT_PAGE);
});

test('viewer maps Ctrl+0 to fitToPage; overlay lists it; Actual size is absent', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Ctrl', '0'\]/);
  assert.match(overlay, /description: 'Fit page'/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(!isFormField && \(e\.metaKey \|\| e\.ctrlKey\)\)/);
  assert.match(viewer, /key === '0'/);
  assert.match(viewer, /handleZoomModeSelectRef\.current\?\.\(ZOOM_MODES\.FIT_PAGE\)/);
  assert.match(viewer, /mode === ZOOM_MODES\.FIT_PAGE/);
  assert.match(viewer, /magnification\.fitToPage\(\)/);
  assert.match(viewer, /pendingInitialFitPageRef/);
  assert.match(viewer, /activeElement\.tagName === 'INPUT'/);
  assert.doesNotMatch(viewer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const pdfjs = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(pdfjs, /fitToPage: \(\) => zoomToScale\('fit'\)/);
  assert.match(pdfjs, /fitToWidth: \(\) => zoomToScale\('fitw'\)/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /ZOOM_MODE_OPTIONS\.map/);
  assert.match(shell, /aria-label="Fit options"/);
  assert.doesNotMatch(shell, /Actual size/);
  assert.doesNotMatch(shell, /Rotate view/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Zoom and fit options"/);
  assert.doesNotMatch(mobile, /Actual size/);
  assert.doesNotMatch(mobile, /Rotate view/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);

  const highlighter = read('src/PDFViewer.jsx');
  assert.match(highlighter, /const showTextMarkupHighlightMenu = false/);

  const tabBar = read('src/TabBar.jsx');
  assert.match(tabBar, /Home tab is pinned, non-draggable/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers intended + Ctrl+0 + INPUT steal + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-fit-page.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Fit page intended \+ break \+ edge/);
  assert.match(spec, /390 Fit page intended \+ break \+ edge/);
  assert.match(spec, /Fit page must leave Fit width/);
  assert.match(spec, /Fit page % must be below Fit width on a wide desktop/);
  assert.match(spec, /Fit page must fit both axes/);
  assert.match(spec, /Ctrl\+0 must restore Fit page %/);
  assert.match(spec, /re-click Fit page stays/);
  assert.match(spec, /zoom INPUT Ctrl\+0 must not steal/);
  assert.match(spec, /bare 0 must not change zoom/);
  assert.match(spec, /typed 200% then Ctrl\+0 must restore Fit page/);
  assert.match(spec, /Pen-armed Ctrl\+0 must still fit page/);
  assert.match(spec, /Ctrl\+0 must not change page/);
  assert.match(spec, /390 Fit page collapses to Fit width/);
  assert.match(spec, /390 Fit height must exceed Fit page/);
  assert.match(spec, /390 Ctrl\+0 must restore Fit page width/);
  assert.match(spec, /390 page INPUT Ctrl\+0 must not steal zoom/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
