/**
 * Text search: live results, jump + zoom + centre, compact rows.
 * Owner 2026-09-23: "When I type something in, I should see related things
 * showing up as I'm typing, and then when I click, I should be directly
 * brought to it, zoomed in and centered on whatever it is that it found."
 *
 * Part 1 unit-tests the pure rules in src/utils/searchMatchNavigation.js.
 * Part 2 guards the wiring (source-assertion style, like the other viewer
 * contract tests). The live behaviour was checked end to end in a headless
 * browser against the owner's 36-page drawing set (w12 report, 2026-09-23).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SEARCH_MAX_AUTO_SCALE,
  buildSearchSnippet,
  measureCenterOffset,
  needsTextItemSeparator,
  resolveReadableSearchScale,
  resolveViewerOcclusionInsets,
} from '../src/utils/searchMatchNavigation.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------- zoom choice

test('a jump zooms in until the matched line reads at ~18px', () => {
  const scale = resolveReadableSearchScale({
    currentScale: 0.89, lineHeight: 8, matchWidth: 17, visibleWidth: 960,
  });
  assert.equal(Math.round(scale * 100) / 100, 2.25);
});

test('a jump never zooms out', () => {
  assert.equal(resolveReadableSearchScale({
    currentScale: 3, lineHeight: 8, matchWidth: 17, visibleWidth: 960,
  }), 3);
  // Big heading text is already readable: stay put.
  assert.equal(resolveReadableSearchScale({
    currentScale: 1, lineHeight: 40, matchWidth: 120, visibleWidth: 960,
  }), 1);
});

test('a jump keeps a long match inside the visible width', () => {
  const scale = resolveReadableSearchScale({
    currentScale: 0.5, lineHeight: 6, matchWidth: 400, visibleWidth: 960,
  });
  assert.ok(400 * scale <= 960 * 0.7 + 0.001, `match ${400 * scale}px wide`);
  assert.ok(scale > 0.5);
});

test('a jump is capped for tiny text', () => {
  assert.equal(resolveReadableSearchScale({
    currentScale: 0.3, lineHeight: 1, matchWidth: 3, visibleWidth: 960,
  }), SEARCH_MAX_AUTO_SCALE);
});

test('no line height → no zoom change', () => {
  assert.equal(resolveReadableSearchScale({ currentScale: 0.8, lineHeight: 0 }), 0.8);
});

// ------------------------------------------------------------ visible area

const container = { left: 48, top: 69, right: 1232, bottom: 800 };

test('an open desktop side panel narrows the area a match is centred in', () => {
  const insets = resolveViewerOcclusionInsets(container, [
    { left: 0, top: 69, right: 272, bottom: 800 },
  ]);
  assert.deepEqual(insets, { left: 224, right: 0, top: 0, bottom: 0 });
});

test('a collapsed rail beside the viewer covers nothing', () => {
  const insets = resolveViewerOcclusionInsets(container, [
    { left: 0, top: 69, right: 48, bottom: 800 },
  ]);
  assert.deepEqual(insets, { left: 0, right: 0, top: 0, bottom: 0 });
});

test('the phone search sheet covers the bottom of the viewer', () => {
  const phone = { left: 36, top: 34, right: 390, bottom: 798 };
  const insets = resolveViewerOcclusionInsets(phone, [
    { left: 0, top: 386, right: 390, bottom: 844 },
  ]);
  assert.deepEqual(insets, { left: 0, right: 0, top: 0, bottom: 412 });
});

test('a panel that would leave no room is ignored', () => {
  const insets = resolveViewerOcclusionInsets(container, [
    { left: 0, top: 69, right: 1220, bottom: 800 },
  ]);
  assert.equal(insets.left, 0);
});

test('centre offset is measured against the visible area', () => {
  const offset = measureCenterOffset(
    { left: 742, top: 424.5, width: 20, height: 10 },
    container,
    { left: 224 },
  );
  assert.deepEqual(offset, { dx: 0, dy: -5 });
});

// ------------------------------------------------------------------ snippet

test('the snippet is short, single-line and centred on the match', () => {
  const text = `${'alpha beta gamma delta '.repeat(6)}Card Reader Door Contact (Door Position Switch)${' epsilon zeta eta'.repeat(6)}`;
  const start = text.indexOf('Door');
  const { snippet, matchIndex, matchLength } = buildSearchSnippet(text, start, start + 4);
  assert.equal(snippet.slice(matchIndex, matchIndex + matchLength), 'Door');
  assert.ok(snippet.length <= 4 + 2 * 34 + 2, `snippet ${snippet.length} chars`);
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'));
  assert.ok(!/\s{2,}|\n/.test(snippet));
  // Cut on word boundaries: no half word right after the leading ellipsis.
  const firstWord = snippet.slice(1).split(' ')[0];
  assert.ok(['alpha', 'beta', 'gamma', 'delta', 'Card'].includes(firstWord), firstWord);
});

test('the snippet has no ellipsis where the page text starts or ends', () => {
  const { snippet, matchIndex } = buildSearchSnippet('Door schedule', 0, 4);
  assert.equal(snippet, 'Door schedule');
  assert.equal(matchIndex, 0);
});

// ----------------------------------------------------- page text separators

const item = (str, x, y, width, extra = {}) => ({
  str, width, height: 8, transform: [8, 0, 0, 8, x, y], ...extra,
});

test('labels placed apart on a drawing are separated by a space', () => {
  assert.equal(needsTextItemSeparator(item('Card Reader', 100, 500, 40), item('Door Contact', 180, 500, 45)), true);
  assert.equal(needsTextItemSeparator(item('Reader', 100, 500, 24), item('Door', 100, 480, 16)), true);
  assert.equal(needsTextItemSeparator(item('Reader', 100, 500, 24, { hasEOL: true }), item('Door', 124, 500, 16)), true);
});

test('pieces of one word stay joined', () => {
  assert.equal(needsTextItemSeparator(item('Do', 100, 500, 8), item('or', 108, 500, 8)), false);
  assert.equal(needsTextItemSeparator(item('Door ', 100, 500, 20), item('Contact', 130, 500, 30)), false);
});

// -------------------------------------------------------------- the wiring

const panel = read('../src/sidebar/SearchTextPanel.jsx');
const panelCss = read('../src/sidebar/searchTextPanel.css');
const viewer = read('../src/PDFViewer.jsx');
const sidebar = read('../src/PDFSidebar.jsx');

test('results stream in while typing, from two letters, after a short pause', () => {
  assert.match(panel, /export const SEARCH_MIN_QUERY_LENGTH = 2;/);
  const debounce = Number(panel.match(/export const SEARCH_DEBOUNCE_MS = (\d+);/)?.[1]);
  assert.ok(debounce >= 80 && debounce <= 250, `debounce ${debounce}ms`);
  assert.match(panel, /setSearchResults\(\[\.\.\.results\], 'progressive'\)/);
  // The list is no longer hidden behind "Searching…" while a search runs.
  assert.doesNotMatch(panel, /!isSearching && searchResults\.length > 0/);
});

test('match boxes are measured with pdf.js text-layer CSS (KAL-239 contract)', () => {
  assert.match(panel, /ensureTextLayerStyles\(\);/);
  assert.match(panel, /className = 'textLayer pdfjsTextLayer search-text-measurement-layer'/);
});

test('result rows are plain list rows: no gold chip, no gold border, no card', () => {
  const row = panel.slice(panel.indexOf('const SearchResultRow'), panel.indexOf('const SearchTextPanel = ('));
  assert.doesNotMatch(row, /var\(--accent\)/);
  assert.doesNotMatch(row, /Page \{result\.pageNumber\}/);
  assert.doesNotMatch(panelCss, /--accent/);
  assert.match(panelCss, /\.search-text-result \{[\s\S]*?border-top: 1px solid var\(--border\);/);
  assert.match(panelCss, /\.search-text-result\.is-active \{[\s\S]*?background: var\(--surface-3\);/);
});

test('icon buttons have invisible hit areas (no hover or press plate)', () => {
  const button = panelCss.match(/\.search-text-panel__icon-button \{[\s\S]*?\}/)?.[0] || '';
  assert.match(button, /background: transparent;/);
  const hover = panelCss.match(/\.search-text-panel__icon-button:hover:not\(:disabled\) \{[\s\S]*?\}/)?.[0] || '';
  assert.doesNotMatch(hover, /background/);
  assert.doesNotMatch(panel, /onMouseEnter=\{\(e\) => e\.currentTarget\.style\.background = 'var\(--hover\)'\}/);
});

test('picking a result on the phone closes the sheet; the query survives it', () => {
  assert.match(sidebar, /onRequestSheetClose=\{mobileMode \? requestSheetClose : undefined\}/);
  assert.match(sidebar, /data-viewer-occluder=\{isCollapsed \? undefined : \(mobileMode \? 'sheet' : 'side'\)\}/);
  assert.match(panel, /navigateToMatch\(index, dismissSheet \? \{ dismissingSheet: true \} : undefined\)/);
  assert.match(panel, /const lastQueryByDocument = new Map\(\);/);
});

test('the viewer jump zooms through the normal zoom path and centres in the visible area', () => {
  const start = viewer.indexOf('const navigateToMatch = useCallback(');
  const jump = viewer.slice(start, viewer.indexOf('// First, navigate to the page', start));
  assert.match(jump, /setScaleWithViewportPreservation\(targetScale, \{ preserveCenter: false, mode: ZOOM_MODES\.MANUAL \}\)/);
  assert.match(jump, /resolveReadableSearchScale\(/);
  assert.match(jump, /resolveViewerOcclusionInsets\(/);
  assert.match(jump, /data-viewer-occluder/);
  assert.match(jump, /topInset: insets\.top/);
  assert.match(jump, /bottomInset: insets\.bottom/);
  // Newest jump wins — no "busy, ignore the click" guard on the pdf.js path.
  assert.match(jump, /textMatchNavTokenRef\.current = navToken/);
  assert.ok(jump.indexOf('if (usePdfjsRenderer)') < jump.indexOf('isNavigatingToMatchRef.current'));
});

test('clearing the search gives back the zoom the first jump replaced', () => {
  const clear = viewer.slice(viewer.indexOf('const handleClearTextSearch = useCallback('));
  assert.match(clear.slice(0, 900), /setScaleWithViewportPreservation\(searchZoomLevelRef\.current, \{ mode: ZOOM_MODES\.MANUAL \}\)/);
  const change = viewer.slice(viewer.indexOf('const handleSearchResultsChange = useCallback('));
  assert.doesNotMatch(change.slice(0, 1200), /setScaleWithViewportPreservation/);
});
