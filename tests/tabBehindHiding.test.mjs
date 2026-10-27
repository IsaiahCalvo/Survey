// Back tabs keep their styles (docs/TAB-SWITCHING.md, S9). A tab behind the
// front one is hidden with content-visibility and clip-path instead of
// display: none (never inert or visibility, which are inherited), so coming
// back to it does not restyle the whole viewer. Its elements now report real
// sizes, so code that picks "the" page must look under its own tab or skip
// tabs behind. The frame check runs in
// tests/e2e-signed-in/tab-switch-smooth.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

async function loadTabBehind(supportsContentVisibility) {
  const before = globalThis.CSS;
  globalThis.CSS = { supports: (prop, value) => supportsContentVisibility && prop === 'content-visibility' && value === 'hidden' };
  try {
    return await import(`../src/utils/tabBehind.js?cv=${supportsContentVisibility ? 1 : 0}`);
  } finally {
    if (before === undefined) delete globalThis.CSS; else globalThis.CSS = before;
  }
}

test('the tab wrapper hides a tab behind with the shared style and the marker, without inert', () => {
  const shell = read('AppShell.jsx');
  const start = shell.indexOf('data-viewer-tab={tab.id}');
  assert.ok(start > 0, 'each viewer tab wrapper carries data-viewer-tab');
  const wrapper = shell.slice(start, start + 900);
  assert.match(wrapper, /data-tab-behind=\{isVisible \? undefined : 'true'\}/);
  // inert is inherited: toggling it restyled all ~12k elements of the tab.
  assert.doesNotMatch(wrapper.slice(0, wrapper.indexOf('style={{')), /\binert=/);
  assert.match(wrapper, /\.\.\.tabWrapperHiding\(isVisible\)/);
  assert.doesNotMatch(shell, /display: isVisible \? 'block' : 'none'/, 'the viewer wrapper no longer toggles display');
});

test('a tab behind keeps its styles: content-visibility, clipped, moved off screen, never visibility', async () => {
  const { tabWrapperHiding } = await loadTabBehind(true);
  const behind = tabWrapperHiding(false);
  assert.equal(behind.contentVisibility, 'hidden');
  assert.equal(behind.clipPath, 'inset(100%)');
  assert.match(behind.transform, /^translateX\(-\d{6,}px\)$/);
  assert.notEqual(behind.display, 'none');
  assert.equal(behind.visibility, undefined, 'toggling visibility restyles the whole tab');
  assert.deepEqual({ ...tabWrapperHiding(true) }, { display: 'block' });
});

test('without content-visibility (iOS before 18) a tab behind falls back to display: none', async () => {
  const { tabWrapperHiding } = await loadTabBehind(false);
  assert.deepEqual({ ...tabWrapperHiding(false) }, { display: 'none' });
  assert.deepEqual({ ...tabWrapperHiding(true) }, { display: 'block' });
});

test('isInTabBehind and queryFrontTab skip a tab behind', async () => {
  const { isInTabBehind, queryFrontTab } = await loadTabBehind(true);
  const { window } = new JSDOM(`<body>
    <div data-viewer-tab="a" data-tab-behind="true"><div class="survey-pdfjs-page-div" id="a1"><span id="a-text">x</span></div></div>
    <div data-viewer-tab="b"><div class="survey-pdfjs-page-div" id="b1"></div></div>
  </body>`);
  const doc = window.document;
  assert.equal(isInTabBehind(doc.getElementById('a1')), true);
  assert.equal(isInTabBehind(doc.getElementById('a-text').firstChild), true, 'text nodes count too');
  assert.equal(isInTabBehind(doc.getElementById('b1')), false);
  assert.equal(isInTabBehind(null), false);
  assert.equal(queryFrontTab('.survey-pdfjs-page-div', doc)?.id, 'b1');
  assert.equal(queryFrontTab('.nothing', doc), null);
});

// Page and overlay markers every open tab renders. A document-wide query for
// one of these finds a tab behind first whenever it comes earlier in the DOM.
const PAGE_MARKERS = /_pageDiv_|survey-pdfjs-page-div|survey-pdfjs-viewer|data-diag-svg-wrapper|data-diag-eraser-wrapper|data-pal-root|data-svg-annotation-layer|data-annotation-real-surface|data-annotation-presentation-canvas|data-annotation-detail-canvas|data-page-number/;
// The one kept: the debug trackpad stress API, after the viewer's own container.
const ALLOWED = [/pdfjsViewerRef\.current\?\.getViewerContainer\?\.\(\)\s*\|\|\s*document\.querySelector\('\.survey-pdfjs-viewer'\)/];

test('PDFViewer looks for pages and overlays under its own tab, never document-wide', () => {
  let source = read('PDFViewer.jsx');
  for (const allowed of ALLOWED) source = source.replace(allowed, '');
  const hits = [];
  const re = /document\.(querySelector|querySelectorAll)\(([^;\n]{0,160})/g;
  for (let m; (m = re.exec(source));) {
    if (PAGE_MARKERS.test(m[2])) hits.push(`line ${source.slice(0, m.index).split('\n').length}: ${m[0].slice(0, 120)}`);
  }
  assert.deepEqual(hits, [], 'scope these to pdfjsWrapperRef.current (queryInViewer)');
  assert.match(source, /const queryInViewer = \(root, selector\) =>/);
});

test('a tab behind takes no keys, text-markup clicks or PageUp/PageDown', () => {
  const viewer = read('PDFViewer.jsx');
  assert.ok((viewer.match(/isInTabBehind\(pdfjsWrapperRef\.current\)/g) || []).length >= 2,
    'the shortcut handler and the text-markup pointer handler bail in a tab behind');
  assert.match(viewer, /tabActive=\{isActive !== false\}/);
  const container = read('components/PdfjsViewerContainer.jsx');
  assert.match(container, /isInTabBehind\(el\) \|\| el\.clientHeight <= 0/, 'PageUp/PageDown');
});

test('a viewer behind does not refit, re-window or measure the front tab\'s panels', () => {
  const container = read('components/PdfjsViewerContainer.jsx');
  assert.match(container, /tabActive = true,/);
  assert.match(container, /const hasViewport = el && !isInTabBehind\(el\)/, 'load-time fit waits for the front');
  assert.match(container, /if \(!el \|\| isInTabBehind\(el\) \|\| !el\.clientWidth/, 'page window keeps its last value');
  assert.match(container, /const update = \(\) => \{[\s\S]{0,120}if \(isInTabBehind\(el\)\) return;/, 'resize observer');
  assert.equal((container.match(/if \(isInTabBehind\(el\) \|\| !el\.clientWidth \|\| !el\.clientHeight\) return;/g) || []).length, 2,
    'top strip and side panel measures');
  assert.match(container, /if \(isFit && \(isInTabBehind\(el\) \|\|/, 'a fit asked for behind waits');
  assert.match(container, /if \(tabActive && pendingViewportFitRef\.current\) setViewportFitRevision/, 'and runs on reveal');
});

test('shared code that picks a shown page skips tabs behind', () => {
  const uses = {
    'components/SelectionQuickBar.jsx': /isInTabBehind\(/,
    'components/TextSelectionQuickMenu.jsx': /isInTabBehind\(/,
    'utils/annotationHitTest.js': /queryFrontTab\(|isInTabBehind\(/,
    'utils/crossPageMove.js': /if \(isInTabBehind\(svg\)\) continue;/,
    'sidebar/PagesPanel.jsx': /isInTabBehind\(/,
    'hooks/useAnnotationContextMenu.jsx': /queryFrontTab\(/,
    'components/SurveyMarkerPlacementDialog.jsx': /queryFrontTab\(/,
    'utils/pdfTextMarkup.js': /queryFrontTab\(/,
    'components/revisions/historyPageOverlay.js': /queryFrontTab\(/,
    'components/revisions/RevisionsPanel.jsx': /queryFrontTab\(/,
    'sidebar/SearchTextPanel.jsx': /queryFrontTab\(/,
    'RegionSelectionTool.jsx': /isInTabBehind\(/,
    'components/SVGAnnotationLayer.jsx': /isInTabBehind\(/,
  };
  for (const [path, re] of Object.entries(uses)) assert.match(read(path), re, path);
  assert.match(read('PageAnnotationLayer.jsx'), /canvasElement\?\.closest\?\.\('\[data-testid="pdf-container"\]'\)/,
    'the page layer pans its own tab\'s viewer');
});
