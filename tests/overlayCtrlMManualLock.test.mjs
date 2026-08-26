// Overlay leftover: Ctrl+M is a live viewer chord (locks ZOOM_MODES.MANUAL
// at the current scale), and sibling Fit/Zoom shortcuts were already
// listed (Ctrl+0 / Ctrl+1 / Ctrl+2 next to Zoom in/out), but the catalog
// omitted Ctrl+M. Distinct from leftover-18, V-04 Fit width keyboard,
// Ctrl+2 / Ctrl+M apply leftover, rail Zoom ±, UL-06 Zoom %, and
// inventing Open file / UL-03, clipboard overlay rows, or Manual lock
// chrome that does not exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ZOOM_MODES } from '../src/utils/zoomController.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists Ctrl+M Manual lock next to Ctrl+0 / Ctrl+1 / Ctrl+2', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Ctrl', '0'\], description: 'Fit page'/);
  assert.match(overlay, /keys: \['Ctrl', '1'\], description: 'Fit width'/);
  assert.match(overlay, /keys: \['Ctrl', '2'\], description: 'Fit height'/);
  assert.match(overlay, /keys: \['Ctrl', 'M'\], description: 'Manual lock'/);
  assert.match(overlay, /live Manual lock chord/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
});

test('Ctrl+M is a live viewer chord that locks MANUAL at the current scale', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(key === 'm'\)/);
  assert.match(viewer, /zoomControllerRef\.current\?\.setMode\(ZOOM_MODES\.MANUAL, \{ scale: scaleRef\.current \}\)/);
  assert.match(viewer, /if \(!isFormField && \(e\.metaKey \|\| e\.ctrlKey\)\)/);
  assert.doesNotMatch(viewer.slice(
    viewer.indexOf("if (key === 'm')"),
    viewer.indexOf("if (key === 'm')") + 400,
  ), /setActiveTool\('measure'\)|MEASURE/);
  assert.equal(ZOOM_MODES.MANUAL, 'manual');

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /if \(option\.id === ZOOM_MODES\.MANUAL\) return null;/);
});

test('live spec covers overlay listing + Ctrl+M lock + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-ctrl-m-manual-lock.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay Ctrl\+M Manual lock intended \+ break \+ edge/);
  assert.match(spec, /390 overlay Ctrl\+M Manual lock intended \+ break \+ edge/);
  assert.match(spec, /Ctrl\+M must leave Fit height active/);
  assert.match(spec, /Ctrl\+M holds current scale/);
  assert.match(spec, /Ctrl\+M is not measure/);
  assert.match(spec, /lists Manual lock/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /zoom % INPUT does not steal Ctrl\+M/);
  assert.match(spec, /hubPreview must not mount the overlay/);
  assert.match(spec, /must not stamp file.id/);
  assert.match(spec, /0 0 612 792/);
  assert.match(spec, /getByRole\('button', \{ name: \/Manual\/i \}\)/);
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
