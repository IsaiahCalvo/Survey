import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createZoomController, ZOOM_MODES, clampScale } from '../src/utils/zoomController.js';

// Source contracts for UL-06 zoom % field (intended + break + edge).
// Live proof: debug/scenarios/e2e-zoom-percent-field.spec.mjs
// Distinct from V-04 keyboard + Fit width, Fit height, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('rail zoom % field clamps 1–4000, strips letters, Escape skips blur-commit', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const skipZoomInputCommitRef = useRef\(false\)/);
  assert.match(viewer, /const digitsOnly = e\.target\.value\.replace/);
  assert.match(viewer, /if \(Number\.isFinite\(numeric\) && numeric > 4000\)/);
  assert.match(viewer, /setZoomInputValue\('4000'\)/);
  assert.match(viewer, /const commitZoomInput = useCallback\(\(liveValue\) =>/);
  assert.match(viewer, /const raw = liveValue != null \? liveValue : zoomInputValue/);
  assert.match(viewer, /const clamped = Math\.min\(Math\.max\(parsed, 1\), 4000\)/);
  assert.match(viewer, /const normalized = clampScale\(clamped \/ 100\)/);
  assert.match(viewer, /controller\.setScale\(normalized\)/);
  assert.match(viewer, /commitZoomInput\(e\.currentTarget\?\.value\)/);
  assert.match(viewer, /skipZoomInputCommitRef\.current = true/);
  assert.match(viewer, /if \(skipZoomInputCommitRef\.current\)/);
  assert.match(viewer, /commitZoomInput\(e\?\.target\?\.value\)/);
  assert.match(viewer, /activeElement === inputElement/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /aria-label="Zoom percentage"/);
  assert.match(shell, /aria-label="Edit zoom percentage"/);
  assert.match(shell, /if \(e\.key === 'Enter' \|\| e\.key === 'Escape'\) setIsEditingRailZoom\(false\)/);
  assert.doesNotMatch(shell, /Actual size/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Zoom and fit options"/);
  assert.doesNotMatch(mobile, /aria-label="Zoom percentage"/);
  assert.doesNotMatch(mobile, /aria-label="Edit zoom percentage"/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.doesNotMatch(overlay, /Zoom percentage/);
  assert.match(overlay, /description: 'Fit page'/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('controller.setScale lifts below the dynamic min and caps at 40', () => {
  let applied = null;
  const controller = createZoomController({
    initialMode: ZOOM_MODES.FIT_PAGE,
    initialManualScale: 1,
    getViewportSize: () => ({ width: 1100, height: 720 }),
    getPageSize: () => ({ width: 612, height: 792 }),
    getMinimumScale: () => 1,
    setScale: (scale) => { applied = scale; },
    persistPreferences: () => {},
  });

  assert.equal(controller.setScale(2), 2);
  assert.equal(applied, 2);
  assert.equal(controller.getMode(), ZOOM_MODES.MANUAL);

  assert.equal(controller.setScale(0), 1);
  assert.equal(applied, 1);
  assert.equal(controller.setScale(0.5), 1);
  assert.equal(controller.setScale(0.01), 1);
  assert.equal(controller.setScale(40), 40);
  assert.equal(controller.setScale(50), 40);
  assert.equal(clampScale(4000 / 100), 40);
  assert.equal(clampScale(1 / 100), 0.01);
});

test('live spec covers intended + clamp + Escape + 390 absent + file.id', () => {
  const spec = read('debug/scenarios/e2e-zoom-percent-field.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /typed 200 must commit 200%/);
  assert.match(spec, /200% must grow page width vs Fit page/);
  assert.match(spec, /blur must commit 250%/);
  assert.match(spec, /0 must lift above the typed value/);
  assert.match(spec, /50 must lift to the same engine min as 0/);
  assert.match(spec, /9999 must clamp in the field/);
  assert.match(spec, /4000% ceiling must apply/);
  assert.match(spec, /empty Enter must restore 200%/);
  assert.match(spec, /letters must restore 200%/);
  assert.match(spec, /Escape must restore 200% and not commit 333/);
  assert.match(spec, /append without select-all/);
  assert.match(spec, /page-1 rect must survive 200%/);
  assert.match(spec, /Pen-armed 175 must commit/);
  assert.match(spec, /zoom % must not change page/);
  assert.match(spec, /390 zoom % field is absent/);
  assert.match(spec, /hubPreview/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
