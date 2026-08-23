import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-fit-options-menu-dismiss.spec.mjs
// Unique leftover after Home-tab click.
// Fit options popup dismiss (open / Escape / click-outside / Enter).
// Space stays the global temporary-pan chord.
// Distinct from leftover-18 / menu Fit height apply / Ctrl+2 / Ctrl+0 / Ctrl+1.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop Fit options is a named popup trigger, not an unimplemented listbox', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /aria-label="Fit options"/);
  assert.match(shell, /aria-haspopup="true"/);
  assert.match(shell, /aria-expanded=\{api\.isZoomMenuOpen\}/);
  assert.match(shell, /onClick=\{api\.toggleZoomMenu\}/);
  assert.match(shell, /type="button"\s+onClick=\{\(\) => api\.handleZoomModeSelect\(option\.id\)\}/);
  assert.doesNotMatch(shell, /aria-haspopup="listbox"/);
  assert.doesNotMatch(shell, /role="listbox"/);
  assert.doesNotMatch(shell, /Actual size/);
  assert.doesNotMatch(shell, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(shell, /setCopyModeActive\(true\)/);

  const viewer = read('src/PDFViewer.jsx');
  const zoomMenuSlice = viewer.slice(
    viewer.indexOf('if (!isZoomMenuOpen) return;'),
    viewer.indexOf('if (!isZoomMenuOpen) return;') + 900,
  );
  assert.match(zoomMenuSlice, /if \(event\.key === 'Escape'\)/);
  assert.match(zoomMenuSlice, /setIsZoomMenuOpen\(false\)/);
  assert.match(zoomMenuSlice, /handleClickOutside/);

  const container = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(container, /Space is the global temporary-pan chord|isSpaceKey/);
  assert.match(container, /isEditableTarget\(event\.target\)/);
  assert.match(container, /tagName === 'input'/);
  assert.doesNotMatch(container.slice(
    container.indexOf('const isEditableTarget'),
    container.indexOf('const isEditableTarget') + 400,
  ), /tagName === 'button'/);
});

test('live spec covers Fit options dismiss intended + break + edge; skip leftover-18 and fit-apply replay', () => {
  const spec = read('debug/scenarios/e2e-fit-options-menu-dismiss.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Fit options menu dismiss intended \+ break \+ edge/);
  assert.match(spec, /390 Zoom and fit options dismiss edge/);
  assert.match(spec, /Escape must close Fit options/);
  assert.match(spec, /click-outside must close Fit options/);
  assert.match(spec, /Space on Fit options stays temporary-pan/);
  assert.match(spec, /Space must not open Fit options/);
  assert.match(spec, /hubPreview has no Fit options/);
  assert.match(spec, /file\.id must stay null/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /Control\+0/);
  assert.doesNotMatch(spec, /Control\+1/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(spec, /getByRole\('tab', \{ name: 'Home'/);
  assert.doesNotMatch(spec, /name: 'Close tab'[^;\n]*\.click\(/);

  const apply = read('debug/scenarios/e2e-fit-height.spec.mjs');
  assert.match(apply, /selectDesktopFit\(page, 'Fit height'\)/);
  assert.doesNotMatch(apply, /Escape must close Fit options/);

  const chords = read('debug/scenarios/e2e-zoom-ctrl2-fit-height-manual.spec.mjs');
  assert.match(chords, /Control\+2/);
  assert.doesNotMatch(chords, /Escape must close Fit options/);

  const overlay = read('debug/scenarios/e2e-shortcuts-overlay.spec.mjs');
  assert.match(overlay, /data-keyboard-shortcuts-modal/);
  assert.doesNotMatch(overlay, /Escape must close Fit options/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
