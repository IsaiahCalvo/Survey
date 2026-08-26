import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Overlay-listed P-04 tool-key arming (V/P/H/E/T/Q/L/A/C).
// Live proof: debug/scenarios/e2e-tool-key-arming.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / Ctrl+2 / Ctrl+M /
// rail Previous/Next / ⇧V / Shift+E / toolbar create clicks.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('PDFViewer wires overlay tool letters and derives the matching category dropdown', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /e\.key === 'v' \|\| e\.key === 'V'/);
  assert.match(viewer, /setActiveTool\('select'\)/);
  assert.match(viewer, /setActiveTool\('text-select'\)/);
  assert.match(viewer, /setActiveTool\('pen'\)/);
  assert.match(viewer, /setActiveTool\('highlighter'\)/);
  assert.match(viewer, /setActiveTool\('eraser'\)/);
  assert.match(viewer, /setActiveTool\('text'\)/);
  assert.match(viewer, /setActiveTool\('callout'\)/);
  assert.match(viewer, /setActiveTool\('line'\)/);
  assert.match(viewer, /setActiveTool\('arrow'\)/);
  assert.match(viewer, /setActiveTool\('counter'\)/);
  assert.match(viewer, /if \(isFormField\)/);
  assert.match(viewer, /setActiveCategoryDropdown\(\(prev\) => \(prev === 'draw' \? prev : 'draw'\)\)/);
  assert.match(viewer, /setActiveCategoryDropdown\(\(prev\) => \(prev === 'shape' \? prev : 'shape'\)\)/);
  assert.match(viewer, /setActiveCategoryDropdown\(\(prev\) => \(prev === 'review' \? prev : 'review'\)\)/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /description: 'Select annotations'/);
  assert.match(overlay, /description: 'Pen'/);
  assert.match(overlay, /description: 'Highlighter'/);
  assert.match(overlay, /description: 'Eraser'/);
  assert.match(overlay, /description: 'Text'/);
  assert.match(overlay, /description: 'Callout'/);
  assert.match(overlay, /description: 'Line'/);
  assert.match(overlay, /description: 'Arrow'/);
  assert.match(overlay, /description: 'Counter'/);
  assert.doesNotMatch(overlay, /description: 'Rectangle'/);
  assert.doesNotMatch(overlay, /keys: \['R'\]/);
});

test('keyboard leftover stays tool letters; overlay lists page-nav arrows not rail Previous/Next', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /Previous\/Next page/);
  assert.doesNotMatch(overlay, /description: 'Previous page'/);
  assert.match(overlay, /Fit height/);
  assert.match(overlay, /Ctrl', '2'/);

  const toolbar = read('debug/scenarios/e2e-page-nav-toolbar.spec.mjs');
  assert.match(toolbar, /Next page click must move a page/);
  assert.doesNotMatch(toolbar, /P must arm Pen/);

  const zoom = read('debug/scenarios/e2e-zoom-ctrl2-fit-height-manual.spec.mjs');
  assert.match(zoom, /Control\+2/);
  assert.doesNotMatch(zoom, /P must arm Pen/);
});

test('live spec covers tool-key arming intended + break + edge; skip leftover-18 and zoom/CW/page-nav replay', () => {
  const spec = read('debug/scenarios/e2e-tool-key-arming.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay tool-key arming intended \+ break \+ edge/);
  assert.match(spec, /390 overlay tool-key arming edge/);
  assert.match(spec, /V must arm Select annotations/);
  assert.match(spec, /P must arm Pen/);
  assert.match(spec, /H must arm Highlighter/);
  assert.match(spec, /E must arm Eraser/);
  assert.match(spec, /T must arm Text tool/);
  assert.match(spec, /Q must arm Callout/);
  assert.match(spec, /L must arm Line/);
  assert.match(spec, /A must arm Arrow/);
  assert.match(spec, /C must arm Counter/);
  assert.match(spec, /re-press P stays Pen/);
  assert.match(spec, /undocumented letters must not leave Select/);
  assert.match(spec, /Zoom % INPUT steals P/);
  assert.match(spec, /Search field steals T/);
  assert.match(spec, /hubPreview has no Draw/);
  assert.match(spec, /tool keys invent 0 annotations/);
  assert.match(spec, /Search Match case compile-hidden/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /Control\+m/);
  assert.doesNotMatch(spec, /Next page click must move a page/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);

  const matrix = read('debug/scenarios/e2e-keyboard-shortcut-matrix.spec.mjs');
  assert.match(matrix, /tool letters/);
  assert.doesNotMatch(matrix, /Zoom % INPUT steals P/);

  const selectText = read('debug/scenarios/e2e-select-text.spec.mjs');
  assert.match(selectText, /Shift\+V|text-select|Select text/);
  assert.doesNotMatch(selectText, /P must arm Pen/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
