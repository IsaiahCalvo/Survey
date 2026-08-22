import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createZoomController, ZOOM_MODES, clampScale } from '../src/utils/zoomController.js';
import { ZOOM_MODE_LABELS, ZOOM_MODE_OPTIONS } from '../src/viewerShared.js';

// Fit height is a distinct ZOOM_MODE with its own pdf.js path
// (wrapperH / realPageH → zoomTo). V-04 / UL-05 / mobile chrome
// only hard-asserted Fit page + Fit width. Live proof:
// debug/scenarios/e2e-fit-height.spec.mjs

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

test('Fit height scale is viewportH/pageH and is not Fit page or Fit width', () => {
  // Narrow phone chrome (390×844 minus rails) vs letter page.
  // Width is the tighter fit → Fit page === Fit width < Fit height.
  const { controller, applied } = controllerFor(
    { width: 320, height: 760 },
    { width: 612, height: 792 },
  );

  const fitWidth = controller.setMode(ZOOM_MODES.FIT_WIDTH);
  assert.equal(fitWidth, clampScale(320 / 612));
  assert.equal(applied(), fitWidth);

  const fitHeight = controller.setMode(ZOOM_MODES.FIT_HEIGHT);
  assert.equal(fitHeight, clampScale(760 / 792));
  assert.equal(applied(), fitHeight);

  const fitPage = controller.setMode(ZOOM_MODES.FIT_PAGE);
  assert.equal(fitPage, clampScale(Math.min(320 / 612, 760 / 792)));

  assert.ok(fitHeight > fitWidth, `height ${fitHeight} should exceed width ${fitWidth}`);
  assert.equal(fitPage, fitWidth);
  assert.notEqual(fitHeight, fitPage);
  assert.notEqual(fitHeight, fitWidth);

  // Invalid mode is a no-op (stays at last applied fit-page scale).
  const before = controller.getScale();
  assert.equal(controller.setMode('actualSize'), before);
  assert.equal(controller.setMode('rotateView'), before);
  assert.equal(controller.getMode(), ZOOM_MODES.FIT_PAGE);
});

test('Fit height falls back and clamps; missing viewport does not invent a mode', () => {
  const missing = controllerFor(null, { width: 612, height: 792 });
  assert.equal(missing.controller.setMode(ZOOM_MODES.FIT_HEIGHT), 1);

  const zero = controllerFor({ width: 400, height: 0 }, { width: 612, height: 792 });
  assert.equal(zero.controller.setMode(ZOOM_MODES.FIT_HEIGHT), 1);

  const huge = controllerFor({ width: 400, height: 80_000 }, { width: 10, height: 10 });
  assert.equal(huge.controller.setMode(ZOOM_MODES.FIT_HEIGHT), 40);

  const tiny = controllerFor({ width: 400, height: 0.01 }, { width: 10, height: 1000 });
  assert.equal(tiny.controller.setMode(ZOOM_MODES.FIT_HEIGHT), 0.01);
});

test('Fit height is a live menu option; Actual size and rotate-view are not', () => {
  assert.equal(ZOOM_MODES.FIT_HEIGHT, 'fitHeight');
  assert.equal(ZOOM_MODE_LABELS[ZOOM_MODES.FIT_HEIGHT], 'Fit height');
  assert.deepEqual(ZOOM_MODE_OPTIONS.map((o) => o.id), [
    'fitPage',
    'fitWidth',
    'fitHeight',
    'manual',
  ]);
  assert.ok(!Object.values(ZOOM_MODES).includes('actualSize'));
  assert.ok(!ZOOM_MODE_OPTIONS.some((o) => /actual size/i.test(o.label)));

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /ZOOM_FIT_OPTIONS = ZOOM_MODE_OPTIONS\.filter\(\(option\) => option\.id !== 'manual'\)/);
  assert.match(mobile, /surfacing Fit Height/);
  assert.match(mobile, /aria-label="Zoom and fit options"/);
  assert.doesNotMatch(mobile, /Actual size/);
  assert.doesNotMatch(mobile, /Rotate view/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /option\.id === ZOOM_MODES\.MANUAL\) return null/);
  assert.match(shell, /m === ZOOM_MODES\.FIT_HEIGHT/);
  assert.match(shell, /aria-label="Fit options"/);
  assert.doesNotMatch(shell, /Actual size/);
  assert.doesNotMatch(shell, /Rotate view/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /mode === ZOOM_MODES\.FIT_HEIGHT/);
  assert.match(viewer, /const heightScale = clampScale\(wrapperH \/ realPageH\)/);
  assert.match(viewer, /magnification\.zoomTo\(Math\.round\(heightScale \* 100\)\)/);
  assert.match(viewer, /handleZoomModeSelectRef\.current\?\.\(ZOOM_MODES\.FIT_HEIGHT\)/);
});
