// Overlay leftover: Ctrl+S is a live viewer chord (handleSaveDocument
// app-state save), and sibling Action shortcuts were already listed
// (Ctrl+O Open document / Ctrl+F Search text), but the catalog omitted
// Ctrl+S. Distinct from leftover-18, local ?testPdf= save/reload,
// inventing Open file / UL-03, clipboard overlay rows, or Fit-options
// Manual chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists Ctrl+S Save document next to Open / Search', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Ctrl', 'O'\], description: 'Open document'/);
  assert.match(overlay, /keys: \['Ctrl', 'S'\], description: 'Save document'/);
  assert.match(overlay, /description: 'Search text'/);
  assert.match(overlay, /live Save document chord/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
});

test('Ctrl+S is a live viewer chord that calls handleSaveDocument', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(key === 's'\)/);
  assert.match(viewer, /handleSaveDocument\(\)/);
  assert.match(viewer, /Save document \(Cmd\/Ctrl\+S\)/);
  assert.match(viewer, /if \(!isFormField && \(e\.metaKey \|\| e\.ctrlKey\)\)/);
  const start = viewer.indexOf("if (key === 's')");
  assert.notEqual(start, -1);
  assert.doesNotMatch(viewer.slice(start, start + 400), /setActiveTool\('measure'\)|MEASURE/);
});

test('live spec covers overlay listing + Ctrl+S save + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-ctrl-s-save.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay Ctrl\+S Save document intended \+ break \+ edge/);
  assert.match(spec, /390 overlay Ctrl\+S Save document intended \+ break \+ edge/);
  assert.match(spec, /Ctrl\+S must fire handleSaveDocument app-state-save/);
  assert.match(spec, /lists Save document/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /zoom % INPUT does not steal Ctrl\+S/);
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
