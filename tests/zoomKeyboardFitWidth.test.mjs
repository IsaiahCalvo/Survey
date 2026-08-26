import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createZoomController, ZOOM_MODES, clampScale } from '../src/utils/zoomController.js';
import { TOOLBAR_ZOOM_STEP_FACTOR, ZOOM_MODE_LABELS } from '../src/viewerShared.js';

// Source contracts for V-04 zoom keyboard + Fit width (intended + break + edge).
// Live proof: debug/scenarios/e2e-zoom-keyboard-fit-width.spec.mjs
// Distinct from Fit height (e2e-fit-height), UL-06 zoom % field,
// W4-02 pinch, V-05 page-nav, leftover-18.

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

test('overlay lists Ctrl+/-/0; viewer maps =/+/- and Ctrl+1 Fit width; step is 1.25', () => {
  assert.equal(TOOLBAR_ZOOM_STEP_FACTOR, 1.25);
  assert.equal(ZOOM_MODES.FIT_WIDTH, 'fitWidth');
  assert.equal(ZOOM_MODE_LABELS[ZOOM_MODES.FIT_WIDTH], 'Fit width');

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Ctrl', '\+'\]/);
  assert.match(overlay, /description: 'Zoom in'/);
  assert.match(overlay, /keys: \['Ctrl', '-'\]/);
  assert.match(overlay, /description: 'Zoom out'/);
  assert.match(overlay, /keys: \['Ctrl', '0'\]/);
  assert.match(overlay, /description: 'Fit page'/);
  assert.match(overlay, /keys: \['Ctrl', '1'\]/);
  assert.match(overlay, /description: 'Fit width'/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(!isFormField && \(e\.metaKey \|\| e\.ctrlKey\)\)/);
  assert.match(viewer, /key === '=' \|\| key === '\+'/);
  assert.match(viewer, /zoomIn\(\)/);
  assert.match(viewer, /key === '-'/);
  assert.match(viewer, /zoomOut\(\)/);
  assert.match(viewer, /key === '1'/);
  assert.match(viewer, /handleZoomModeSelectRef\.current\?\.\(ZOOM_MODES\.FIT_WIDTH\)/);
  assert.match(viewer, /mode === ZOOM_MODES\.FIT_WIDTH/);
  assert.match(viewer, /magnification\.fitToWidth\(\)/);
  assert.match(viewer, /const nextScale = clampScale\(basisScale \* TOOLBAR_ZOOM_STEP_FACTOR\)/);
  assert.match(viewer, /const nextScale = clampScale\(basisScale \/ TOOLBAR_ZOOM_STEP_FACTOR\)/);
  assert.match(viewer, /activeElement\.tagName === 'INPUT'/);
  assert.match(viewer, /activeElement\.tagName === 'TEXTAREA'/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /ZOOM_MODE_OPTIONS\.map/);
  assert.match(shell, /aria-label="Fit options"/);
  assert.doesNotMatch(shell, /Actual size/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Zoom and fit options"/);
  assert.doesNotMatch(mobile, /Actual size/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('Fit width scale is viewportW/pageW and is not Fit height; zoom step clamps', () => {
  // Wide desktop vs letter page: height is tighter → Fit page === Fit height < Fit width.
  const { controller, applied } = controllerFor(
    { width: 1100, height: 720 },
    { width: 612, height: 792 },
  );

  const fitWidth = controller.setMode(ZOOM_MODES.FIT_WIDTH);
  assert.equal(fitWidth, clampScale(1100 / 612));
  assert.equal(applied(), fitWidth);

  const fitHeight = controller.setMode(ZOOM_MODES.FIT_HEIGHT);
  assert.equal(fitHeight, clampScale(720 / 792));

  const fitPage = controller.setMode(ZOOM_MODES.FIT_PAGE);
  assert.equal(fitPage, clampScale(Math.min(1100 / 612, 720 / 792)));

  assert.ok(fitWidth > fitHeight, `width ${fitWidth} should exceed height ${fitHeight}`);
  assert.equal(fitPage, fitHeight);
  assert.notEqual(fitWidth, fitPage);
  assert.notEqual(fitWidth, fitHeight);

  assert.equal(clampScale(1 * TOOLBAR_ZOOM_STEP_FACTOR), 1.25);
  assert.equal(clampScale(1.25 / TOOLBAR_ZOOM_STEP_FACTOR), 1);
  assert.equal(clampScale(40 * TOOLBAR_ZOOM_STEP_FACTOR), 40);
  assert.equal(clampScale(0.01 / TOOLBAR_ZOOM_STEP_FACTOR), 0.01);

  const missing = controllerFor(null, { width: 612, height: 792 });
  assert.equal(missing.controller.setMode(ZOOM_MODES.FIT_WIDTH), 1);

  const zero = controllerFor({ width: 0, height: 720 }, { width: 612, height: 792 });
  assert.equal(zero.controller.setMode(ZOOM_MODES.FIT_WIDTH), 0.01);
});

test('live spec covers intended + INPUT steal + floor/ceiling + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-zoom-keyboard-fit-width.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /Ctrl\+= must raise zoom %/);
  assert.match(spec, /Ctrl\+- must lower zoom % after Ctrl\+=/);
  assert.match(spec, /Fit width menu must fill viewer width/);
  assert.match(spec, /Fit width % must exceed Fit page on a wide desktop/);
  assert.match(spec, /Ctrl\+1 must restore Fit width %/);
  assert.match(spec, /Ctrl\+- at the engine floor must no-op/);
  assert.match(spec, /Ctrl\+= at 4000% must clamp/);
  assert.match(spec, /zoom INPUT chords must not steal/);
  assert.match(spec, /bare \+\/- must not zoom/);
  assert.match(spec, /page-1 rect must survive Ctrl\+=/);
  assert.match(spec, /Pen-armed Ctrl\+= must still zoom/);
  assert.match(spec, /Ctrl\+= must not change page/);
  assert.match(spec, /390 Ctrl\+= must grow page width/);
  assert.match(spec, /390 Ctrl\+1 must fill viewer width/);
  assert.match(spec, /390 page INPUT chords must not steal zoom/);
  assert.match(spec, /hubPreview/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
