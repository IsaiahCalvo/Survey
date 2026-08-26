// Genuine hunt of remaining overlay vs live-handler leftovers after
// tip efedf1f2 / product 162aa1f5. No unique LIVE leftover. Do not
// invent clipboard overlay rows, Open file / UL-03, Duplicate /
// Backspace / Y / G alias rows, Ctrl+P, or Electron-only Export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay already lists every live web viewer chord; omits aliases / Electron-only Export', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Space'\], description: 'Hold to pan'/);
  assert.match(overlay, /keys: \['Ctrl', '1'\], description: 'Fit width'/);
  assert.match(overlay, /keys: \['Ctrl', '2'\], description: 'Fit height'/);
  assert.match(overlay, /keys: \['Ctrl', 'M'\], description: 'Manual lock'/);
  assert.match(overlay, /keys: \['Ctrl', 'S'\], description: 'Save document'/);
  assert.match(overlay, /keys: \['Ctrl', 'Z'\], description: 'Undo'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', 'Z'\], description: 'Redo'/);
  assert.match(overlay, /keys: \['Delete'\], description: 'Delete selected'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', '\]'\], description: 'Bring to front'/);
  assert.match(overlay, /keys: \['Ctrl', '\]'\], description: 'Bring forward'/);
  assert.match(overlay, /keys: \['Ctrl', '\['\], description: 'Send backward'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', '\['\], description: 'Send to back'/);
  assert.match(overlay, /keys: \['F3'\], description: 'Find next'/);
  assert.match(overlay, /keys: \['Shift', 'F3'\], description: 'Find previous'/);
  assert.match(overlay, /keys: \['Shift', 'E'\], description: 'Partial erase'/);
  assert.doesNotMatch(overlay, /description: 'Duplicate'/);
  assert.doesNotMatch(overlay, /keys: \['Backspace'\]/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /description: 'Export'/);
  assert.doesNotMatch(overlay, /description: 'Print'/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /e\.key === 'p' \|\| e\.key === 'P'/);
  assert.match(viewer, /setActiveTool\('pen'\)/);
  assert.doesNotMatch(viewer, /setActiveTool\('rect'\)/);
  assert.doesNotMatch(viewer, /setActiveTool\('ellipse'\)/);
  assert.doesNotMatch(viewer, /setActiveTool\('duplicate'\)/);
  assert.match(viewer, /onExportAnnotatedPdfMenu/);
  const electron = read('src/electron-main.js');
  assert.match(electron, /accelerator:\s*'CmdOrCtrl\+Shift\+E'/);
});

test('live spec covers remaining-chord hunt + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-after-overlay-hold-to-pan-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop remaining overlay chords already listed/);
  assert.match(spec, /bare R must not arm Rectangle/);
  assert.match(spec, /live P must still arm Pen/);
  assert.match(spec, /web Ctrl\+Shift\+E must not invent Export/);
  assert.match(spec, /must not invent Duplicate/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /hubPreview must not mount the overlay/);
  assert.match(spec, /390 overlay exists/);
  assert.match(spec, /must not stamp file.id/);
  assert.match(spec, /0 0 612 792/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
