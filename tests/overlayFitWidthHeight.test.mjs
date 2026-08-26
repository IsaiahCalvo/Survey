// Overlay leftover: Ctrl+1 Fit width and Ctrl+2 Fit height are live
// viewer chords, and sibling fit shortcuts were already listed
// (Ctrl+0 Fit page next to Zoom in/out), but the catalog omitted the
// sibling chords. Distinct from leftover-18, V-04 Fit width keyboard,
// Ctrl+2 / Ctrl+M apply leftover, rail Zoom ±, UL-06 Zoom %, and
// inventing Open file / UL-03 or clipboard overlay rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists Ctrl+1 Fit width and Ctrl+2 Fit height next to Ctrl+0', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Ctrl', '0'\], description: 'Fit page'/);
  assert.match(overlay, /keys: \['Ctrl', '1'\], description: 'Fit width'/);
  assert.match(overlay, /keys: \['Ctrl', '2'\], description: 'Fit height'/);
  assert.match(overlay, /three live fit-mode chords/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
});

test('Ctrl+1 / Ctrl+2 are live viewer chords that select Fit width / Fit height', () => {
  const viewer = read('src/PDFViewer.jsx');
  const zoomBlock = viewer.slice(
    viewer.indexOf("if (key === '0')"),
    viewer.indexOf("if (key === '=' || key === '+')"),
  );
  assert.match(zoomBlock, /key === '0'/);
  assert.match(zoomBlock, /ZOOM_MODES\.FIT_PAGE/);
  assert.match(zoomBlock, /key === '1'/);
  assert.match(zoomBlock, /ZOOM_MODES\.FIT_WIDTH/);
  assert.match(zoomBlock, /key === '2'/);
  assert.match(zoomBlock, /ZOOM_MODES\.FIT_HEIGHT/);
});

test('live spec covers overlay listing + Ctrl+1 / Ctrl+2 + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-fit-width-height.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay Fit width \/ Fit height intended \+ break \+ edge/);
  assert.match(spec, /390 overlay Fit width \/ Fit height intended \+ break \+ edge/);
  assert.match(spec, /Ctrl\+1 forces Fit width/);
  assert.match(spec, /Ctrl\+2 forces Fit height/);
  assert.match(spec, /lists Fit width/);
  assert.match(spec, /lists Fit height/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /zoom % INPUT does not steal Ctrl\+1/);
  assert.match(spec, /zoom INPUT Ctrl\+1 does not apply Fit width/);
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
