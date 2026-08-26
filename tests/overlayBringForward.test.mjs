// Overlay leftover: Ctrl+] is the live Bring forward chord
// (SVGAnnotationLayer BracketRight without shift → 'forward'),
// and sibling Action shortcuts were already listed (Bring to
// front / Send to back), but the catalog omitted that z-order
// chord. Duplicate is not a live annotation chord (Ctrl+D does
// not clone) — do not invent a Duplicate overlay row. Distinct
// from leftover-18, inventing Open file / UL-03, inventing
// clipboard overlay rows, inventing Backspace-alias overlay
// rows, or inventing Send backward this pass (one sibling gap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists Bring forward next to Bring to front', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Ctrl', 'Shift', '\]'\], description: 'Bring to front'/);
  assert.match(overlay, /keys: \['Ctrl', '\]'\], description: 'Bring forward'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', '\['\], description: 'Send to back'/);
  assert.match(overlay, /live Bring forward chord/);
  assert.match(overlay, /sibling z-order chord/);
  assert.match(overlay, /one sibling gap/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /keys: \['Backspace'\]/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
  assert.doesNotMatch(overlay, /description: 'Duplicate'/);
  assert.doesNotMatch(overlay, /description: 'Send backward'/);
});

test('Ctrl+] is a live SVG selected-annotation z-order chord', () => {
  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /code === 'BracketRight'/);
  assert.match(svg, /e\.shiftKey \? 'front' : 'forward'/);
  assert.match(svg, /onReorderAnnotation\(pageNumber, annotationIndex, e\.shiftKey \? 'front' : 'forward'\)/);
  assert.match(svg, /window\.addEventListener\('keydown', handleKeyDown\)/);
  assert.match(svg, /Cmd\+\]          → Bring Forward/);
});

test('live spec covers overlay listing + Bring forward walk + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-bring-forward.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay Bring forward intended \+ break \+ edge/);
  assert.match(spec, /390 overlay Bring forward intended \+ break \+ edge/);
  assert.match(spec, /Ctrl\+\] must place A in front of B/);
  assert.match(spec, /lists Bring forward/);
  assert.match(spec, /must not invent Duplicate/);
  assert.match(spec, /must not invent Send backward/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /empty-selection Ctrl\+\] invents 0/);
  assert.match(spec, /zoom % INPUT does not steal Ctrl\+\]/);
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
