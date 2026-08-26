// Overlay leftover: Space is the live hold-to-pan chord
// (PdfjsViewerContainer activateSpacePan), and sibling
// Navigation shortcuts were already listed (page arrows /
// Home / End next to Zoom), but the catalog omitted that
// view-pan chord. V-01 already proved the hold-Space
// behavior — this pass only lists the live chord.
// Distinct from leftover-18, inventing Open file / UL-03,
// inventing clipboard overlay rows, inventing Duplicate
// overlay rows, or inventing Backspace / Y / G alias rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists Hold to pan next to Last page', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['End'\], description: 'Last page'/);
  assert.match(overlay, /keys: \['Space'\], description: 'Hold to pan'/);
  assert.match(overlay, /keys: \['Ctrl', '\+'\], description: 'Zoom in'/);
  assert.match(overlay, /live hold-to-pan chord/);
  assert.match(overlay, /sibling view-pan/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /keys: \['Backspace'\]/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
  assert.doesNotMatch(overlay, /description: 'Duplicate'/);
});

test('Space is a live PdfjsViewerContainer hold-to-pan chord', () => {
  const viewer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewer, /const isSpaceKey = \(event\) => event\?\.code === 'Space'/);
  assert.match(viewer, /const activateSpacePan = \(event\) => \{/);
  assert.match(viewer, /if \(!isSpaceKey\(event\)\) return;/);
  assert.match(viewer, /spacePanRef\.current = true;/);
  assert.match(viewer, /window\.addEventListener\('keydown', activateSpacePan, true\)/);
  assert.match(viewer, /data-space-pan/);
});

test('live spec covers overlay listing + Space arm + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-space-hold-to-pan.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay Hold to pan intended \+ break \+ edge/);
  assert.match(spec, /390 overlay Hold to pan intended \+ break \+ edge/);
  assert.match(spec, /Space must arm data-space-pan/);
  assert.match(spec, /lists Hold to pan/);
  assert.match(spec, /must not invent Duplicate/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /Search INPUT Space must type a space/);
  assert.match(spec, /zoom INPUT Space must not arm pan/);
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
