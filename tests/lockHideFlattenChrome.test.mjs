import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts: Lock / hide / flatten annotation chrome has no user
// item on ?testPdf=. Live proof:
// debug/scenarios/e2e-lock-hide-flatten-chrome.spec.mjs
// Distinct from X-03 print flatten, Documents Lock persist, import lock
// flags, and region Hide/Show. Do not invent flatten-to-PDF export.

const FORBIDDEN_ITEMS = [
  "item('Lock'",
  "item('Unlock'",
  "item('Hide'",
  "item('Show'",
  "item('Flatten'",
  "item('Lock annotation'",
  "item('Hide annotation'",
  "item('Flatten annotation'",
  "item('Unhide'",
];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('annotation context menu has no Lock / Hide / Flatten items', () => {
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  for (const item of FORBIDDEN_ITEMS) {
    assert.doesNotMatch(menu, new RegExp(item.replace(/[()']/g, '\\$&')));
  }
  assert.match(menu, /item\('Cut', 'cut'/);
  assert.match(menu, /item\('Bring to front', 'bringToFront'/);
  assert.match(menu, /Group \/ Ungroup items intentionally omitted/);
});

test('toolbar / overlay / mobile have no annotation Lock Hide Flatten chrome', () => {
  const shell = read('src/AppShell.jsx');
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  const viewer = read('src/PDFViewer.jsx');

  assert.doesNotMatch(shell, /aria-label="Lock annotation"|aria-label="Hide annotation"|aria-label="Flatten annotation"/);
  assert.doesNotMatch(shell, /label="Lock"|label="Hide"|label="Flatten"/);
  assert.doesNotMatch(overlay, /Lock annotation|Hide annotation|Flatten annotation/);
  assert.doesNotMatch(overlay, /description: 'Lock'|description: 'Hide'|description: 'Flatten'/);
  assert.doesNotMatch(mobile, /id: 'lock'|id: 'hide'|id: 'flatten'/);
  assert.doesNotMatch(viewer, /setActiveTool\(['"]lock['"]\)/);
  assert.doesNotMatch(viewer, /setActiveTool\(['"]hide['"]\)/);
  assert.doesNotMatch(viewer, /setActiveTool\(['"]flatten['"]\)/);
});

test('flatten-to-PDF stays print-path; import lock is flags-only', () => {
  const printLib = read('src/utils/pdfAnnotationsPdfLib.js');
  const svg = read('src/components/SVGAnnotationLayer.jsx');
  const importer = read('src/utils/pdfAnnotationImporter.js');

  assert.match(printLib, /savePDFWithFlattenedRegularAnnotationsForPrint/);
  assert.match(svg, /isSelectDeleteOnlyPdfTextMarkupObject/);
  assert.match(importer, /lockMovementX/);
  assert.doesNotMatch(svg, /setActiveTool\(['"]flatten['"]\)/);
});

test('live spec covers absence + break + edge and does not invent flatten-to-PDF', () => {
  const spec = read('debug/scenarios/e2e-lock-hide-flatten-chrome.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /LOCK_HIDE_FLATTEN/);
  assert.match(spec, /empty page/);
  assert.match(spec, /owned rect/);
  assert.match(spec, /callout/);
  assert.match(spec, /Pen-armed/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /390/);
  assert.match(spec, /hubPreview/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /Control\+p/);
  assert.doesNotMatch(spec, /Control\+Shift\+p/);
  assert.doesNotMatch(spec, /PRINT_PANEL_ENABLED = true/);
  assert.doesNotMatch(spec, /renderer=canvas/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  for (const name of ['Lock', 'Hide', 'Flatten']) {
    assert.match(spec, new RegExp(`'${name}'`));
  }
});
