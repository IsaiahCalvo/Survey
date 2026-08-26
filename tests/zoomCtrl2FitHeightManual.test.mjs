import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { ZOOM_MODES } from '../src/utils/zoomController.js';

// Ctrl+2 Fit height keyboard + Ctrl+M MANUAL lock.
// Menu Fit height is fitHeightZoom / e2e-fit-height (click only).
// Live proof: debug/scenarios/e2e-zoom-ctrl2-fit-height-manual.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / Ctrl+0 / Ctrl+1.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Ctrl+2 wires FIT_HEIGHT; Ctrl+M locks MANUAL at live scale; overlay lists Fit height and omits Ctrl+M', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(key === '2'\)/);
  assert.match(viewer, /handleZoomModeSelectRef\.current\?\.\(ZOOM_MODES\.FIT_HEIGHT\)/);
  assert.match(viewer, /if \(key === 'm'\)/);
  assert.match(viewer, /zoomControllerRef\.current\?\.setMode\(ZOOM_MODES\.MANUAL, \{ scale: scaleRef\.current \}\)/);
  assert.match(viewer, /if \(!isFormField && \(e\.metaKey \|\| e\.ctrlKey\)\)/);
  assert.doesNotMatch(viewer.slice(
    viewer.indexOf("if (key === 'm')"),
    viewer.indexOf("if (key === 'm')") + 400,
  ), /setActiveTool\('measure'\)|MEASURE/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /Ctrl', '0'[\s\S]*Fit page/);
  assert.match(overlay, /keys: \['Ctrl', '1'\], description: 'Fit width'/);
  assert.match(overlay, /keys: \['Ctrl', '2'\], description: 'Fit height'/);
  assert.doesNotMatch(overlay, /Ctrl', 'M'/);

  assert.equal(ZOOM_MODES.FIT_HEIGHT, 'fitHeight');
  assert.equal(ZOOM_MODES.MANUAL, 'manual');
});

test('live spec covers Ctrl+2 + Ctrl+M intended + break + edge; skip leftover-18', () => {
  const spec = read('debug/scenarios/e2e-zoom-ctrl2-fit-height-manual.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Ctrl\+2 Fit height \+ Ctrl\+M manual intended \+ break \+ edge/);
  assert.match(spec, /390 Ctrl\+2 Fit height edge/);
  assert.match(spec, /Ctrl\+2 must leave Fit width/);
  assert.match(spec, /Ctrl\+2 matches menu Fit height/);
  assert.match(spec, /Ctrl\+M must leave Fit height active/);
  assert.match(spec, /Ctrl\+M holds current scale/);
  assert.match(spec, /Ctrl\+M is not measure/);
  assert.match(spec, /Zoom % INPUT steals Ctrl\+2/);
  assert.match(spec, /resize after Ctrl\+M must not re-fit height/);
  assert.match(spec, /hubPreview has no Draw/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);

  const menu = read('debug/scenarios/e2e-fit-height.spec.mjs');
  assert.match(menu, /selectDesktopFit\(page, 'Fit height'\)/);
  assert.doesNotMatch(menu, /Control\+2/);
  assert.doesNotMatch(menu, /Control\+m/);

  const width = read('debug/scenarios/e2e-zoom-keyboard-fit-width.spec.mjs');
  assert.match(width, /Control\+1/);
  assert.doesNotMatch(width, /Control\+2/);
  assert.doesNotMatch(width, /Control\+m/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
