// Overlay leftover: Ctrl+Z / Ctrl+Shift+Z are live Undo / Redo chords
// (PDFViewer handleUndo / handleRedo via undoRedoHotkeys), and sibling
// Action shortcuts were already listed (Ctrl+O / Ctrl+S), but the catalog
// omitted Undo+Redo as one listing block. Distinct from leftover-18,
// E-05 undo/redo apply leftover, inventing Open file / UL-03, inventing
// Ctrl+Y overlay rows, clipboard overlay rows, or Duplicate/z-order
// overlay rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists Ctrl+Z Undo and Ctrl+Shift+Z Redo next to Save', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Ctrl', 'S'\], description: 'Save document'/);
  assert.match(overlay, /keys: \['Ctrl', 'Z'\], description: 'Undo'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', 'Z'\], description: 'Redo'/);
  assert.match(overlay, /live Undo \/ Redo chords/);
  assert.match(overlay, /Undo\s+and Redo share this one listing block/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /Ctrl\+Y|⌘Y|Cmd\+Y|keys: \['Y'\]|keys: \['Ctrl', 'Y'\]/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
  assert.doesNotMatch(overlay, /description: 'Duplicate'/);
});

test('Ctrl+Z / Ctrl+Shift+Z are live viewer undo/redo chords', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /isUndoKeyEvent/);
  assert.match(viewer, /isRedoKeyEvent/);
  assert.match(viewer, /isUndoRedoBlocked/);
  assert.match(viewer, /addEventListener\('keydown', handleUndoRedoKey, \{ capture: true \}/);
  assert.match(viewer, /handleUndoRef\.current\?\.\(\)/);
  assert.match(viewer, /handleRedoRef\.current\?\.\(\)/);
  const hotkeys = read('src/utils/undoRedoHotkeys.js');
  assert.match(hotkeys, /UNDO = Cmd\+Z or Ctrl\+Z/);
  assert.match(hotkeys, /REDO = Cmd\+Shift\+Z, Ctrl\+Shift\+Z, Cmd\+Y, or Ctrl\+Y/);
  assert.match(hotkeys, /export const isUndoKeyEvent/);
  assert.match(hotkeys, /export const isRedoKeyEvent/);
});

test('live spec covers overlay listing + Ctrl+Z / Shift+Z walk + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-undo-redo.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay Undo\/Redo intended \+ break \+ edge/);
  assert.match(spec, /390 overlay Undo\/Redo intended \+ break \+ edge/);
  assert.match(spec, /Ctrl\+Z must drop the rect/);
  assert.match(spec, /Ctrl\+Shift\+Z must restore the rect/);
  assert.match(spec, /lists Undo/);
  assert.match(spec, /lists Redo/);
  assert.match(spec, /must not invent Ctrl\+Y/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /empty-stack Ctrl\+Z invents 0/);
  assert.match(spec, /zoom % INPUT does not steal Ctrl\+Z/);
  assert.match(spec, /hubPreview must not mount the overlay/);
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
