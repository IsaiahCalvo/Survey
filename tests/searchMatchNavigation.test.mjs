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
  SEARCH_MAX_FIT_MULTIPLE,
  SEARCH_READABLE_TEXT_PX,
  buildSearchSnippet,
  measureCenterOffset,
  needsTextItemSeparator,
  resolveReadableSearchScale,
  resolveViewerOcclusionInsets,
} from '../src/utils/searchMatchNavigation.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------- zoom choice

test('a jump zooms in only until the matched line reads at ~14px (owner 2026-11-09: zoom less)', () => {
  const scale = resolveReadableSearchScale({
    currentScale: 0.89, lineHeight: 8, matchWidth: 17, visibleWidth: 960,
  });
  assert.equal(Math.round(scale * 100) / 100, 1.75);
  assert.equal(SEARCH_READABLE_TEXT_PX, 14);
  assert.ok(SEARCH_MAX_AUTO_SCALE <= 3);
  assert.ok(SEARCH_MAX_FIT_MULTIPLE <= 2.5);
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

test('stepping to a hit in bigger text zooms back out, but never past the zoom you started at', () => {
  // On 2.4x for tiny drawing text; the next hit is 20pt text.
  const scale = resolveReadableSearchScale({
    currentScale: 2.4, lineHeight: 20, matchWidth: 80, visibleWidth: 960, floorScale: 0.96,
  });
  assert.equal(scale, 0.96);
  const mid = resolveReadableSearchScale({
    currentScale: 2.4, lineHeight: 10, matchWidth: 40, visibleWidth: 960, floorScale: 0.96,
  });
  assert.ok(Math.abs(mid - 1.4) < 1e-9, `${mid}`);
  // A floor above the zoom you are at is ignored (it never zooms out by itself).
  assert.equal(resolveReadableSearchScale({
    currentScale: 1, lineHeight: 40, matchWidth: 120, visibleWidth: 960, floorScale: 2,
  }), 1);
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

test('the phone Survey sheet at its standard height still covers the bottom', () => {
  // iPhone 14: the viewer runs 70-600 beside the 36px tool rail; the sheet
  // rises to 170, more than 60% of the viewer's height.
  const phone = { left: 36, top: 70, right: 390, bottom: 600 };
  const insets = resolveViewerOcclusionInsets(phone, [
    { left: 0, top: 170, right: 390, bottom: 600 },
  ]);
  assert.deepEqual(insets, { left: 0, right: 0, top: 0, bottom: 430 });
});

test('a sheet that would leave less than 80px is ignored', () => {
  const phone = { left: 36, top: 70, right: 390, bottom: 600 };
  const insets = resolveViewerOcclusionInsets(phone, [
    { left: 0, top: 100, right: 390, bottom: 600 },
  ]);
  assert.equal(insets.bottom, 0);
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
  // Chunk D (2026-10-13): on desktop the panel covers the page until its
  // closing slide ends, so it stays an occluder while it is laid out.
  assert.match(sidebar, /data-viewer-occluder=\{mobileMode \? \(isCollapsed \? undefined : 'sheet'\) : \(layoutOpen \? 'side' : undefined\)\}/);
  assert.match(panel, /navigateToMatch\(index, dismissSheet \? \{ dismissingSheet: true \} : undefined\)/);
  assert.match(panel, /const lastQueryByDocument = new Map\(\);/);
});

test('the viewer jump animates through focusPageRect and centres in the visible area', () => {
  const start = viewer.indexOf('const navigateToMatch = useCallback(');
  const jump = viewer.slice(start, viewer.indexOf('// Prevent recursive navigation', start));
  // Owner 2026-11-09: scroll / pan + zoom there instead of snapping.
  assert.match(jump, /viewer\.focusPageRect\(pageNumber, bounds, \{\s*animate: true,/);
  assert.match(jump, /scale: targetScale, maxFitMultiple: SEARCH_MAX_FIT_MULTIPLE/);
  assert.match(jump, /keepZoom: true/);
  assert.match(jump, /resolveReadableSearchScale\(/);
  assert.match(jump, /resolveViewerOcclusionInsets\(/);
  assert.match(jump, /data-viewer-occluder/);
  assert.match(jump, /topInset: insets\.top/);
  assert.match(jump, /bottomInset: insets\.bottom/);
  // No more instant zoom-then-measure-then-centre.
  assert.doesNotMatch(jump, /setScaleWithViewportPreservation\(targetScale/);
  // Newest jump wins — no "busy, ignore the click" guard on the pdf.js path.
  assert.match(jump, /textMatchNavTokenRef\.current = navToken/);
  assert.doesNotMatch(jump, /isNavigatingToMatchRef\.current/);
});

test('the hit you are on is a different colour from the other hits and does not pulse', () => {
  const layer = read('../src/components/SearchHighlightLayer.jsx');
  const other = layer.match(/const OTHER_LOOK = Object\.freeze\(\{[\s\S]*?\}\);/)?.[0] || '';
  const active = layer.match(/const ACTIVE_LOOK = Object\.freeze\(\{[\s\S]*?\}\);/)?.[0] || '';
  const fillOf = (block) => block.match(/fill: 'rgba\((\d+), (\d+), (\d+)/)?.slice(1).map(Number);
  const [or, og, ob] = fillOf(other);
  const [ar, ag, ab] = fillOf(active);
  // Yellow (red ≈ green) for the others, orange (green well under red) for the current one.
  assert.ok(Math.abs(or - og) < 30 && ob < 100, 'other hits are yellow');
  assert.ok(ar - ag > 90 && ab < 60, 'current hit is orange');
  assert.match(active, /stroke: 'rgba\(/);
  assert.match(other, /stroke: 'none'/);
  assert.doesNotMatch(layer, /@keyframes|active-pulse|activeGlowOnly/);
});

test('clearing the search gives back the zoom the first jump replaced', () => {
  const clear = viewer.slice(viewer.indexOf('const handleClearTextSearch = useCallback('));
  assert.match(clear.slice(0, 900), /setScaleWithViewportPreservation\(searchZoomLevelRef\.current, \{ mode: ZOOM_MODES\.MANUAL \}\)/);
  const change = viewer.slice(viewer.indexOf('const handleSearchResultsChange = useCallback('));
  assert.doesNotMatch(change.slice(0, 1200), /setScaleWithViewportPreservation/);
});
