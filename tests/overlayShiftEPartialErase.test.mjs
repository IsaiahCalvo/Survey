// Overlay leftover: Shift+E is a live chord (forces Partial erase) and
// sibling erase shortcuts were already listed, but the catalog omitted
// Shift+E. Distinct from leftover-18, D-03 type apply, Eraser Type caret
// / menuitem, and inventing Open file / UL-03 for overlay Ctrl+O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists Shift+E Partial erase next to live E / Shift+V pairings', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['E'\], description: 'Eraser'/);
  assert.match(overlay, /keys: \['Shift', 'E'\], description: 'Partial erase'/);
  assert.match(overlay, /keys: \['Shift', 'V'\], description: 'Select text on the page'/);
  assert.match(overlay, /Shift\+E listed next to E the same way/);
  assert.doesNotMatch(overlay, /Full stroke erase/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
});

test('Shift+E is a live viewer chord that forces Partial erase; E keeps mode', () => {
  const viewer = read('src/PDFViewer.jsx');
  const plainE = viewer.slice(
    viewer.indexOf("// 'E' key to switch to Eraser Tool"),
    viewer.indexOf("// 'Shift+E' key to switch to Partial Erase Tool"),
  );
  assert.match(plainE, /setActiveTool\('eraser'\)/);
  assert.doesNotMatch(plainE, /setEraserMode/);
  const shiftE = viewer.slice(
    viewer.indexOf("// 'Shift+E' key to switch to Partial Erase Tool"),
    viewer.indexOf("// 'T' key to switch to Text Tool"),
  );
  assert.match(shiftE, /setActiveTool\('eraser'\)/);
  assert.match(shiftE, /setEraserMode\('partial'\)/);
});

test('live spec covers overlay listing + E vs Shift+E + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-shift-e-partial-erase.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay Shift\+E Partial erase intended \+ break \+ edge/);
  assert.match(spec, /390 overlay Shift\+E Partial erase intended \+ break \+ edge/);
  assert.match(spec, /Shift\+E forces Partial erase/);
  assert.match(spec, /E keeps remembered Full stroke erase/);
  assert.match(spec, /lists Partial erase/);
  assert.match(spec, /must not invent Full stroke erase shortcut/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /zoom % INPUT does not steal E/);
  assert.match(spec, /hubPreview must not mount the overlay/);
  assert.match(spec, /must not stamp file.id/);
  assert.match(spec, /0 0 612 792/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
