import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Classification: remaining compile-hidden tools have no Print-class
// reachable fail-closed chrome (no shortcut intercept, no disabled item,
// no flag-off panel). Live: debug/scenarios/e2e-compile-hidden-tools-unreachable.spec.mjs
// Does not flip flags. Does not invent stamp / measure / Group / Extract /
// Note-Link / Forms backends. Does not replay Print.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('stamp create is compile-hidden / import-preserve only', () => {
  const viewer = read('src/PDFViewer.jsx');
  const shell = read('src/AppShell.jsx');
  const shared = read('src/viewerShared.js');
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  const importer = read('src/utils/pdfAnnotationImporter.js');
  const notice = read('src/utils/unsupportedAnnotationNotice.js');

  assert.match(shared, /export const REVIEW_TOOL_IDS = \['text', 'callout'\]/);
  assert.doesNotMatch(shared, /REVIEW_TOOL_IDS = \[[^\]]*stamp/);
  assert.doesNotMatch(viewer, /setActiveTool\(['"]stamp['"]\)/);
  assert.doesNotMatch(shell, /aria-label="Stamp"/);
  assert.doesNotMatch(mobile, /id: 'stamp'/);
  assert.match(importer, /Stamp, Link, Widget/);
  assert.match(notice, /Stamp: \['stamp', 'stamps'\]/);
});

test('measurement has no user tool; Cmd+M is zoom MANUAL', () => {
  const viewer = read('src/PDFViewer.jsx');
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');

  assert.doesNotMatch(viewer, /setActiveTool\(['"]measure['"]\)/);
  assert.doesNotMatch(viewer, /setActiveTool\(['"]dimension['"]\)/);
  assert.doesNotMatch(mobile, /id: 'measure'/);
  assert.doesNotMatch(overlay, /Measure|Dimension/);

  const manualZoom = viewer.indexOf("if (key === 'm')");
  const manualMode = viewer.indexOf('ZOOM_MODES.MANUAL', manualZoom);
  assert.ok(manualZoom > 0 && manualMode > manualZoom && manualMode - manualZoom < 250);
});

test('Group / Ungroup shortcuts are short-circuited; menus omit the items', () => {
  const svg = read('src/components/SVGAnnotationLayer.jsx');
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');

  assert.match(svg, /Group \/ Ungroup feature is HIDDEN app-wide/);
  const effect = svg.indexOf('Group / Ungroup feature is HIDDEN app-wide');
  const earlyReturn = svg.indexOf('return;', effect);
  const addListener = svg.indexOf("window.addEventListener('keydown', handleKeyDown)", effect);
  assert.ok(earlyReturn > effect && earlyReturn < addListener, 'listener must stay dead after the early return');

  assert.match(menu, /Group \/ Ungroup items intentionally omitted/);
  assert.doesNotMatch(overlay, /Ungroup|Group selected/);
});

test('Extract Pages is absent from Pages panel + page ops', () => {
  const panel = read('src/sidebar/PagesPanel.jsx');
  const ops = read('src/utils/pageContextOps.js');
  const hook = read('src/hooks/usePageOperations.js');

  assert.doesNotMatch(panel, /Extract/);
  assert.match(ops, /Extract is not a handler — do not invent one/);
  assert.doesNotMatch(hook, /extractPages|onExtract|Extract Pages/);
});

test('Note / Link create are commented or have zero toolbar callers', () => {
  const viewer = read('src/PDFViewer.jsx');
  const shared = read('src/viewerShared.js');
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');

  assert.match(viewer, /TODO: Revisit the user-created Note tool later/);
  assert.match(viewer, /\/\/ \{ id: 'note', label: 'Note'/);
  assert.match(shared, /export const REVIEW_TOOL_IDS = \['text', 'callout'\]/);
  assert.doesNotMatch(viewer, /setActiveTool\(['"]note['"]\)/);
  assert.doesNotMatch(viewer, /setActiveTool\(['"]link['"]\)/);
  assert.doesNotMatch(mobile, /id: 'note'/);
  assert.doesNotMatch(mobile, /id: 'link'/);
});

test('Forms category is compile-hidden; only that button opens the subtoolbar', () => {
  const shell = read('src/AppShell.jsx');
  const viewer = read('src/PDFViewer.jsx');
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');

  assert.match(shell, /Hidden for first release/);
  const gate = shell.indexOf('{false && (');
  const formsBtn = shell.indexOf('data-testid="forms-category-button"');
  const formsAria = shell.indexOf('aria-label="Forms"');
  assert.ok(gate > 0 && formsBtn > gate && formsAria > formsBtn);

  assert.match(viewer, /activeCategoryDropdown === 'forms'/);
  assert.doesNotMatch(viewer, /setActiveCategoryDropdown\(['"]forms['"]\)/);
  assert.doesNotMatch(mobile, /id: 'form-textbox'/);
});

test('live spec classifies chrome absence and does not flip flags', () => {
  const live = read('debug/scenarios/e2e-compile-hidden-tools-unreachable.spec.mjs');

  assert.match(live, /COMPILE_HIDDEN_TOOLS_UNREACHABLE_PROOF/);
  assert.match(live, /testPdf=clickable-link-test.pdf/);
  assert.match(live, /hubPreview=1/);
  assert.match(live, /width: 390/);
  assert.match(live, /forms-category-button/);
  assert.match(live, /Extract Pages/);
  assert.match(live, /Control\+g/);
  assert.doesNotMatch(live, /PRINT_PANEL_ENABLED = true/);
  assert.doesNotMatch(live, /renderer=canvas/);
  assert.doesNotMatch(live, /Control\+Shift\+v/);
  assert.doesNotMatch(live, /Control\+p/);
  assert.doesNotMatch(live, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(live, /setInputFiles/);
});
