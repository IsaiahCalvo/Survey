// Overlay leftover: Delete is a live selected-annotation chord
// (SVGAnnotationLayer Delete/Backspace handler), and sibling Action
// shortcuts were already listed (Ctrl+Z Undo / Ctrl+Shift+Z Redo),
// but the catalog omitted Delete. Distinct from leftover-18,
// inventing Open file / UL-03, inventing Backspace-alias overlay
// rows, clipboard overlay rows, or Duplicate/z-order overlay rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists Delete selected next to Undo/Redo', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Ctrl', 'Z'\], description: 'Undo'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', 'Z'\], description: 'Redo'/);
  assert.match(overlay, /keys: \['Delete'\], description: 'Delete selected'/);
  assert.match(overlay, /live selected-annotation chord/);
  assert.match(overlay, /sibling Delete chord/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /keys: \['Backspace'\]/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
  assert.doesNotMatch(overlay, /description: 'Duplicate'/);
});

test('Delete/Backspace are live SVG selected-annotation chords', () => {
  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /Delete key handler — delete selected annotations on Delete\/Backspace/);
  assert.match(svg, /e\.key !== 'Delete' && e\.key !== 'Backspace'/);
  assert.match(svg, /deleteSelected\(\)/);
  assert.match(svg, /window\.addEventListener\('keydown', handleKeyDown\)/);
});

test('live spec covers overlay listing + Delete walk + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-delete.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay Delete intended \+ break \+ edge/);
  assert.match(spec, /390 overlay Delete intended \+ break \+ edge/);
  assert.match(spec, /Delete must remove the selected rect/);
  assert.match(spec, /lists Delete selected/);
  assert.match(spec, /must not invent Backspace/);
  assert.match(spec, /must not invent Duplicate/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /empty-selection Delete invents 0/);
  assert.match(spec, /zoom % INPUT does not steal Delete/);
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
