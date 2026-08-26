import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for the keyboard-shortcut matrix cluster.
// Live proof is debug/scenarios/e2e-keyboard-shortcut-matrix.spec.mjs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay catalogs tools/Esc/search/Delete/Bring to front and omits Duplicate', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['P'\], description: 'Pen'/);
  assert.match(overlay, /keys: \['V'\], description: 'Select annotations'/);
  assert.match(overlay, /keys: \['Shift', 'V'\], description: 'Select text on the page'/);
  assert.match(overlay, /keys: \['E'\], description: 'Eraser'/);
  assert.match(overlay, /keys: \['Shift', 'E'\], description: 'Partial erase'/);
  assert.match(overlay, /description: 'Search text'/);
  assert.match(overlay, /keys: \['Esc'\], description: 'Close dialogs\/cancel'/);
  assert.match(overlay, /keys: \['Delete'\], description: 'Delete selected'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', '\]'\], description: 'Bring to front'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', '\['\], description: 'Send to back'/);
  assert.doesNotMatch(overlay, /description: 'Duplicate'/);
  assert.doesNotMatch(overlay, /description: 'Bring forward'/);
  assert.doesNotMatch(overlay, /description: 'Send backward'/);
  assert.doesNotMatch(overlay, /keys: \['Backspace'\]/);
});

test('AppShell hides overlay on viewer; DevTestRoute remounts it; z-order/Delete/tool keys stay live', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /KeyboardShortcutsOverlay only renders on the home tab/);
  assert.match(shell, /isDevTestPdfRoute/);
  assert.match(shell, /has\('testPdf'\)/);
  assert.match(shell, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  assert.doesNotMatch(shell, /!isViewerVisible && <KeyboardShortcutsOverlay \/>/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /<KeyboardShortcutsOverlay \/>/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /e\.key !== 'Delete' && e\.key !== 'Backspace'/);
  assert.match(svg, /code === 'BracketRight'/);
  assert.match(svg, /code === 'BracketLeft'/);
  assert.match(svg, /e\.shiftKey \? 'front' : 'forward'/);
  assert.match(svg, /e\.shiftKey \? 'back' : 'backward'/);
  assert.match(svg, /Cmd\+G and Cmd\+Shift\+G shortcuts are short-circuited/);
  assert.match(svg, /useEffect\(\(\) => \{\s*return;/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /key === 'f'/);
  assert.match(viewer, /openSearchPanel\(\{ focus: true, select: true \}\)/);
  assert.match(viewer, /e\.key === 'p' \|\| e\.key === 'P'/);
  assert.doesNotMatch(viewer, /setActiveTool\('duplicate'\)/);

  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(menu, /Cmd\+Shift\+\]  → Bring to Front/);
  assert.doesNotMatch(menu, /item\('Duplicate'/);
});
