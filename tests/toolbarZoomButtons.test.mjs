import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLBAR_ZOOM_STEP_FACTOR } from '../src/viewerShared.js';
import { clampScale } from '../src/utils/zoomController.js';

// Desktop rail / 390-More Zoom in / Zoom out click.
// Live proof: debug/scenarios/e2e-toolbar-zoom-buttons.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / dismiss-family /
// V-04 keyboard Ctrl++/− / UL-06 Zoom % / Ctrl+wheel / Fit chords.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('AppShell rail Zoom in/out calls api.zoomIn/zoomOut; step is 1.25', () => {
  assert.equal(TOOLBAR_ZOOM_STEP_FACTOR, 1.25);
  assert.equal(clampScale(1 * TOOLBAR_ZOOM_STEP_FACTOR), 1.25);
  assert.equal(clampScale(1.25 / TOOLBAR_ZOOM_STEP_FACTOR), 1);
  assert.equal(clampScale(40 * TOOLBAR_ZOOM_STEP_FACTOR), 40);
  assert.equal(clampScale(0.01 / TOOLBAR_ZOOM_STEP_FACTOR), 0.01);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /aria-label="Zoom in"/);
  assert.match(shell, /aria-label="Zoom out"/);
  assert.match(shell, /onClick=\{api\.zoomIn\}/);
  assert.match(shell, /onClick=\{api\.zoomOut\}/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const zoomIn = useCallback\(\(\) => \{/);
  assert.match(viewer, /const zoomOut = useCallback\(\(\) => \{/);
  assert.match(viewer, /const nextScale = clampScale\(basisScale \* TOOLBAR_ZOOM_STEP_FACTOR\)/);
  assert.match(viewer, /const nextScale = clampScale\(basisScale \/ TOOLBAR_ZOOM_STEP_FACTOR\)/);
  assert.match(viewer, /zoomIn,/);
  assert.match(viewer, /zoomOut,/);
});

test('keyboard leftover stays Ctrl++/−; overlay lists chords not rail-click', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /description: 'Zoom in'/);
  assert.match(overlay, /description: 'Zoom out'/);
  assert.match(overlay, /keys: \['Ctrl', '\+'\]/);
  assert.match(overlay, /keys: \['Ctrl', '-'\]/);

  const keyboard = read('debug/scenarios/e2e-zoom-keyboard-fit-width.spec.mjs');
  assert.match(keyboard, /Ctrl\+= must raise zoom %/);
  assert.doesNotMatch(keyboard, /Zoom in click must raise zoom %/);
  assert.doesNotMatch(keyboard, /Zoom out click must lower zoom % after Zoom in/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /label="More document options"/);
  assert.match(mobile, /bottomToolbarApi\?\.zoomIn\?\.\(\)/);
  assert.match(mobile, /bottomToolbarApi\?\.zoomOut\?\.\(\)/);
});

test('live spec covers rail click intended + break + edge; skip leftover-18 and keyboard replay', () => {
  const spec = read('debug/scenarios/e2e-toolbar-zoom-buttons.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop rail Zoom in\/out click intended \+ break \+ edge/);
  assert.match(spec, /390 More-menu Zoom in\/out click edge/);
  assert.match(spec, /Zoom in click must raise zoom %/);
  assert.match(spec, /Zoom out click must lower zoom % after Zoom in/);
  assert.match(spec, /Zoom out click at the engine floor must no-op/);
  assert.match(spec, /Zoom in click at 4000% must clamp/);
  assert.match(spec, /Zoom in click must still zoom while Zoom % INPUT is focused/);
  assert.match(spec, /hubPreview Zoom in 0/);
  assert.match(spec, /page-1 rect must survive Zoom in click/);
  assert.match(spec, /Pen-armed Zoom in click must still zoom/);
  assert.match(spec, /Zoom in click must not change page/);
  assert.match(spec, /390 More Zoom in click must grow page width/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+=/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
