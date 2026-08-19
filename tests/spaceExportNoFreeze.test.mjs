import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// KAL-445 (2026-08-19): "exporting a space appears to hang the app".
//
// The space PDF export used to call `sourcePage.render({ canvasContext, viewport })`
// directly, i.e. with pdf.js's default `intent: 'display'`. pdf.js steps a
// display render forward with requestAnimationFrame, and browsers stop issuing
// animation frames when the window is hidden, minimised or fully covered. The
// export paints an OFF-SCREEN canvas, so nothing else forces frames either — the
// render stopped part-way and its promise never settled. The user got no file,
// no error and no message: a paid feature that looked frozen.
//
// These are source-text guards: both handlers live inside the 34k-line
// PDFViewer component and are not unit-mountable here.
const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

function spacePdfExportBody() {
  const start = VIEWER_SOURCE.indexOf('const handleExportSpaceToPDF');
  assert.notEqual(start, -1, 'handleExportSpaceToPDF must still exist');
  const end = VIEWER_SOURCE.indexOf('const handleSpaceDelete', start);
  assert.notEqual(end, -1, 'expected handleSpaceDelete to follow handleExportSpaceToPDF');
  return VIEWER_SOURCE.slice(start, end);
}

function spaceCsvExportBody() {
  const start = VIEWER_SOURCE.indexOf('const handleExportSpaceToCSV');
  assert.notEqual(start, -1, 'handleExportSpaceToCSV must still exist');
  const end = VIEWER_SOURCE.indexOf('const handleExportSpaceToPDF', start);
  assert.notEqual(end, -1, 'expected handleExportSpaceToPDF to follow handleExportSpaceToCSV');
  return VIEWER_SOURCE.slice(start, end);
}

test('space PDF export goes through the off-screen page renderer', () => {
  const body = spacePdfExportBody();

  assert.match(
    body,
    /await renderPdfPageForExport\(\{/,
    'the export must use the shared off-screen renderer (print intent + timeout)'
  );
  assert.match(
    VIEWER_SOURCE,
    /import \{ renderPdfPageForExport \} from '\.\/utils\/spacePdfPageRender\.js';/
  );
});

test('space PDF export never renders a page with the animation-frame-driven default intent', () => {
  const body = spacePdfExportBody();

  // The exact call shape that caused the freeze must not come back.
  assert.doesNotMatch(
    body,
    /\.render\(\s*\{[^}]*\}\s*\)\s*\.promise/s,
    'a bare sourcePage.render({...}).promise here hangs whenever the window is not producing animation frames'
  );
});

test('space PDF export tells the user it started, finished, or failed', () => {
  const body = spacePdfExportBody();

  assert.match(body, /showToast\('Preparing the space PDF/, 'the user must see the export start');
  assert.match(body, /showToast\('Space exported to PDF[^']*', 'success'\)/, 'the user must see the export finish');
  assert.match(body, /showToast\('Unable to export this space to PDF[^']*', 'error'\)/, 'a failure must be visible, never silent');
  assert.match(body, /\} finally \{\s*\n\s*spacePdfExportInFlightRef\.current = false;/, 'the in-flight guard must always be released');
});

test('space CSV export reports success and failure instead of finishing in silence', () => {
  const body = spaceCsvExportBody();

  assert.match(body, /showToast\('Space exported to CSV[^']*', 'success'\)/);
  assert.match(body, /showToast\('Unable to export this space to CSV[^']*', 'error'\)/);
});
