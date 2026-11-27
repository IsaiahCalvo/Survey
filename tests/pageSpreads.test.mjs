// Nightly 'page-spreads' (Drawboard PDF Pro push 2026-11-12, row C17):
// Single / Double / Cover page views.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { autoGridColumns, buildSpreadRows, gridColumns, isGridMode, normalizeSpreadMode, placeSpreadPages, rowMembers, steppedSpreadPage, stripSpreadMode } from '../src/utils/pageSpreads.js';
import { pickCurrentPageInColumns } from '../src/utils/pageNavigationMath.js';
import { buildVisiblePageStack, pagedRowIndex, pagedRows, pagedRowSpread } from '../src/utils/visiblePageLayout.js';

const page = (w = 600, h = 800) => ({ w, h });

test('page-spreads is a Nightly beta flag with an off-by-default row', () => {
  assert.equal(FEATURE_FLAGS['page-spreads']?.stage, 'rollout');
  const mig = readFileSync(new URL('../supabase/migrations/20261113003000_page_spreads_flag.sql', import.meta.url), 'utf8');
  assert.match(mig, /'page-spreads', 'off'/);
});

test('rows: Double pairs 1-2, 3-4; Cover puts page 1 alone, then 2-3; hidden pages are skipped', () => {
  const dims = [page(), page(), page(), page(), page()];
  assert.deepEqual(buildSpreadRows(dims, 'single'), [[0], [1], [2], [3], [4]]);
  assert.deepEqual(buildSpreadRows(dims, 'double'), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(buildSpreadRows(dims, 'cover'), [[0], [1, 2], [3, 4]]);
  const withHidden = [page(), { w: 0, h: 0, hidden: true }, page(), page()];
  assert.deepEqual(buildSpreadRows(withHidden, 'double'), [[0, 2], [3]]);
});

test('placement: Cover page 1 sits in the right slot; a row is as tall as its taller page', () => {
  const dims = [page(600, 800), page(600, 900), page(500, 800)];
  const cover = placeSpreadPages(dims, 'cover', 10);
  assert.equal(cover.offsetX[0], 610, 'page 1 on the right of an empty slot');
  assert.deepEqual(cover.stack[0], { w: 1210, h: 800 });
  assert.equal(cover.leader[2], 1);
  assert.equal(cover.offsetX[2], 610);
  assert.deepEqual(cover.stack[1], { w: 1110, h: 900 });
  assert.equal(cover.stack[2].hidden, true);
  assert.equal(placeSpreadPages(dims, 'single', 10), null);
  assert.deepEqual(rowMembers(cover, 2), [1, 2]);
});

test('the page stack: both pages of a row share its top; Single is unchanged', () => {
  const pageSizes = [page(), page(), page()];
  const single = buildVisiblePageStack({ pageSizes, scale: 1, gap: 10 });
  assert.equal(single.place, null);
  assert.equal(single.stack, single.dims);
  assert.deepEqual(single.tops, [10, 820, 1630]);
  const double = buildVisiblePageStack({ pageSizes, scale: 1, gap: 10, spread: 'double' });
  assert.deepEqual(double.tops, [10, 10, 820]);
  assert.equal(double.widestPt, 1210);
  assert.equal(double.height, 1630);
});

test('Next / Previous move a whole row in a spread view', () => {
  const dims = [page(), page(), page(), page(), page()];
  const double = placeSpreadPages(dims, 'double', 0);
  assert.equal(steppedSpreadPage(double, 1, 1), 3);
  assert.equal(steppedSpreadPage(double, 2, 1), 3);
  assert.equal(steppedSpreadPage(double, 4, -1), 1);
  assert.equal(steppedSpreadPage(null, 4, -1), 3);
  const cover = placeSpreadPages(dims, 'cover', 0);
  assert.equal(steppedSpreadPage(cover, 1, 1), 2);
  assert.equal(steppedSpreadPage(cover, 3, 1), 4);
});

test('the viewer and the Page fit card use the setting; the phone keeps one column', () => {
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /const spreadMode = phoneLayout \? 'single' : pageSpreadSetting;/);
  assert.match(viewer, /padTop: metrics\.padTop, gap: metrics\.gap, spread: stripView \? stripSpreadMode\(rowSpread\) : rowSpread,/);
  assert.match(viewer, /let rowSpread = spreadMode;/);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /const \[pageSpreadsOn\] = useState\(\(\) => isFeatureOn\('page-spreads'\)\);/);
  assert.match(shell, /\{pageSpreadsOn && !isNarrowShell && \(/);
});

// KAL-707: Grid with 2 to 6 columns (Drawboard View settings, Grid).
test('Grid: modes grid-2 to grid-6; plain grid starts at 3 columns; others fall back to Single', () => {
  assert.equal(normalizeSpreadMode('grid'), 'grid-3');
  assert.equal(normalizeSpreadMode('grid-5'), 'grid-5');
  assert.equal(normalizeSpreadMode('grid-7'), 'single');
  assert.equal(normalizeSpreadMode('grid-1'), 'single');
  assert.equal(gridColumns('grid-4'), 4);
  assert.equal(gridColumns('double'), 0);
});

test('Grid rows hold N pages; hidden pages are skipped', () => {
  const dims = [page(), page(), page(), page(), page(), page(), page()];
  assert.deepEqual(buildSpreadRows(dims, 'grid-3'), [[0, 1, 2], [3, 4, 5], [6]]);
  assert.deepEqual(buildSpreadRows(dims, 'grid-6'), [[0, 1, 2, 3, 4, 5], [6]]);
  const withHidden = [page(), { w: 0, h: 0, hidden: true }, page(), page(), page()];
  assert.deepEqual(buildSpreadRows(withHidden, 'grid-2'), [[0, 2], [3, 4]]);
});

test('Grid placement: pages left to right with the gap; a short last row keeps the full width, centred', () => {
  const dims = [page(600, 800), page(500, 900), page(600, 800), page(600, 800)];
  const grid = placeSpreadPages(dims, 'grid-3', 10);
  assert.deepEqual(grid.offsetX.slice(0, 3), [0, 610, 1120]);
  assert.deepEqual(grid.stack[0], { w: 1720, h: 900 });
  assert.equal(grid.leader[2], 0);
  assert.equal(grid.stack[1].hidden, true);
  // Page 4 alone: two empty slots as wide as it, and it sits in the middle (KAL-711, Drawboard).
  assert.equal(grid.offsetX[3], 610);
  assert.deepEqual(grid.stack[3], { w: 1820, h: 800 });
  assert.deepEqual(rowMembers(grid, 1), [0, 1, 2]);
  const stack = buildVisiblePageStack({ pageSizes: dims, scale: 1, gap: 10, spread: 'grid-3' });
  assert.deepEqual(stack.tops, [10, 10, 10, 920]);
});

test('Grid: Next / Previous move a whole row', () => {
  const dims = Array.from({ length: 10 }, () => page());
  const grid = placeSpreadPages(dims, 'grid-4', 0);
  assert.equal(steppedSpreadPage(grid, 1, 1), 5);
  assert.equal(steppedSpreadPage(grid, 7, 1), 9);
  assert.equal(steppedSpreadPage(grid, 10, -1), 5);
  assert.equal(steppedSpreadPage(grid, 9, 1), 9);
});

test('the Page fit card offers Grid and a Columns choice of 2 to 6', () => {
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /\{ id: 'grid', label: 'Grid' \}/);
  assert.match(shell, /data-grid-columns=\{n\}/);
  assert.match(shell, /\['auto', \.\.\.GRID_COLUMN_CHOICES\.map\(String\)\]/);
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /gridColumns\(spreadModeRef\.current, pdf\.numPages\)/);
  assert.match(viewer, /gridN \* firstSize\.w \+ \(gridN - 1\) \* metrics\.gap/);
});

test('Grid: the zoom floor counts the row, and the rail Next / Previous step a whole row', () => {
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(viewer, /getMinimumScaleForLayout\(\n\s*(dims|dimsPtRef\.current),/);
  assert.match(viewer, /getSteppedPage: \(step\) => pagedStepRef\.current\(step\) \?\? \(spreadPlaceRef\.current/);
  const pdfViewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(pdfViewer, /getSteppedPage\?\.\(1\) \?\? pageNum \+ 1/);
  assert.match(pdfViewer, /getSteppedPage\?\.\(-1\) \?\? pageNum - 1/);
});

// KAL-711: Drawboard's Auto columns come from the page count (10 pages: 4, 30 pages: 6).
test('Grid Auto: columns are the square root of the page count, rounded up', () => {
  assert.equal(normalizeSpreadMode('grid-auto'), 'grid-auto');
  assert.equal(isGridMode('grid-auto'), true);
  assert.equal(isGridMode('double'), false);
  assert.equal(autoGridColumns(10), 4);
  assert.equal(autoGridColumns(30), 6);
  assert.equal(autoGridColumns(1), 1);
  assert.equal(autoGridColumns(0), 1);
  assert.equal(gridColumns('grid-auto', 9), 3);
  const dims = Array.from({ length: 10 }, () => page());
  assert.deepEqual(buildSpreadRows(dims, 'grid-auto').map((row) => row.length), [4, 4, 2]);
  const place = placeSpreadPages(dims, 'grid-auto', 10);
  // Pages 9 and 10 sit in the middle of the last row, as in Drawboard.
  assert.deepEqual([place.offsetX[8], place.offsetX[9]], [610, 1220]);
  assert.equal(place.stack[8].w, place.stack[0].w);
  // Hidden pages do not count.
  const someHidden = dims.map((dim, index) => (index < 6 ? { w: 0, h: 0, hidden: true } : dim));
  assert.deepEqual(buildSpreadRows(someHidden, 'grid-auto'), [[6, 7], [8, 9]]);
  // A lone page in Auto is one column, the page itself.
  const one = placeSpreadPages([page()], 'grid-auto', 10);
  assert.deepEqual(one.stack[0], { w: 600, h: 800 });
});

// KAL-712: Drawboard's Continuous mode off shows one page or pair at a time.
test('Continuous off: the rows it turns through, the row a page sits in, and how a row lays out', () => {
  const pageSizes = Array.from({ length: 5 }, () => page());
  assert.deepEqual(pagedRows({ pageSizes }), [[1], [2], [3], [4], [5]]);
  assert.deepEqual(pagedRows({ pageSizes, spread: 'double' }), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(pagedRows({ pageSizes, spread: 'cover' }), [[1], [2, 3], [4, 5]]);
  // A Space hides pages 2 and 3.
  const rows = pagedRows({ pageSizes, visiblePageNumbers: [1, 4, 5] });
  assert.deepEqual(rows, [[1], [4], [5]]);
  assert.equal(pagedRowIndex(rows, 4), 1);
  assert.equal(pagedRowIndex(rows, 2), 1, 'a hidden page shows the next row');
  assert.equal(pagedRowIndex(rows, 9), 2);
  assert.equal(pagedRowIndex([], 1), -1);
  assert.equal(pagedRowSpread([2, 3], 'cover'), 'double');
  assert.equal(pagedRowSpread([1], 'cover'), 'cover');
  assert.equal(pagedRowSpread([3], 'single'), 'single');
  // Cover's later pair laid out alone stays a pair.
  const pair = buildVisiblePageStack({ pageSizes, visiblePageNumbers: [2, 3], gap: 10, spread: pagedRowSpread([2, 3], 'cover') });
  assert.deepEqual(pair.place.rows, [[1, 2]]);
});

test('Continuous off: the setting, the card row, and the viewer turning rows', async () => {
  const setting = readFileSync(new URL('../src/utils/pageSpreadSetting.js', import.meta.url), 'utf8');
  assert.match(setting, /const CONTINUOUS_KEY = 'survey\.pageContinuous\.v1';/);
  assert.match(setting, /if \(!flagOn\) return true;/);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /role="menuitemcheckbox"[\s\S]{0,120}aria-checked=\{gridOn \|\| pageContinuous\}/);
  assert.match(shell, /aria-disabled=\{gridOn \|\| undefined\}/);
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /const pagedView = !phoneLayout && !pageContinuous && !isGridMode\(spreadMode\);/);
  assert.match(viewer, /el\.addEventListener\('wheel', onWheel, \{ capture: true, passive: false \}\);/);
  assert.match(viewer, /getSteppedPage: \(step\) => pagedStepRef\.current\(step\) \?\?/);
});

test('Horizontal: one row of every page, left to right, stepping one page', () => {
  const dims = [page(600, 800), { w: 0, h: 0, hidden: true }, page(500, 900), page(600, 800)];
  assert.equal(normalizeSpreadMode('strip'), 'strip');
  assert.equal(isGridMode('strip'), false);
  assert.deepEqual(buildSpreadRows(dims, 'strip'), [[0, 2, 3]]);
  const strip = placeSpreadPages(dims, 'strip', 10);
  assert.equal(strip.strip, true);
  assert.deepEqual([strip.offsetX[0], strip.offsetX[2], strip.offsetX[3]], [0, 610, 1120]);
  assert.deepEqual(strip.stack[0], { w: 1720, h: 900 }, 'the row is every page and gap wide, as tall as the tallest');
  assert.equal(strip.leader[3], 0);
  assert.equal(steppedSpreadPage(strip, 3, 1), 4, 'Next steps one page, not the whole row');
  assert.equal(steppedSpreadPage(strip, 3, -1), 2);
  assert.equal(placeSpreadPages(dims, 'double', 10).strip, false);
  const stack = buildVisiblePageStack({ pageSizes: [page(), page(), page()], gap: 10, spread: 'strip' });
  assert.deepEqual(stack.tops, [stack.tops[0], stack.tops[0], stack.tops[0]], 'every page shares one top');
});

test('Horizontal: the setting, the card choice, and the viewer reading across', () => {
  const setting = readFileSync(new URL('../src/utils/pageSpreadSetting.js', import.meta.url), 'utf8');
  assert.match(setting, /const DIRECTION_KEY = 'survey\.pageDirection\.v1';/);
  assert.match(setting, /if \(!flagOn\) return 'vertical';/);
  assert.match(setting, /return kept === 'strip' \? 'single' : kept\.startsWith\('strip-'\) \? kept\.slice\(6\) : kept;/, 'the layout is never a saved view');
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /const directionOff = pageSpread === 'single'\n\s+\? !pageContinuous\n\s+: !isFeatureOn\('page-direction-all'\) \|\| \(!pageContinuous && !isGridMode\(pageSpread\)\);/);
  assert.match(shell, /data-page-direction=\{id\}/);
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /const stripView = !phoneLayout && pageDirection === 'horizontal' && \(spreadMode === 'single'\n\s+\? pageContinuous\n\s+: directionAllOn && \(pageContinuous \|\| isGridMode\(spreadMode\)\)\);/);
  assert.match(viewer, /spread: stripView \? stripSpreadMode\(rowSpread\) : rowSpread/);
  // The mount window, the current page and a page jump all go across.
  assert.match(viewer, /const strip = Boolean\(layout\.place\?\.strip\);/);
  assert.match(viewer, /const across = stripViewRef\.current;/);
  assert.match(viewer, /\}\) : pickCurrentPage\(\{\n\s+pageTops: across \?/);
  assert.match(viewer, /el\.scrollLeft = stripViewRef\.current\n\s+\? pageScrollLeftRef\.current\(i\)/);
});

test('Horizontal Double, Cover and Grid (KAL-716): pages stack in columns that run left to right', () => {
  assert.equal(FEATURE_FLAGS['page-direction-all']?.stage, 'beta');
  const mig = readFileSync(new URL('../supabase/migrations/20261117160100_page_direction_all_flag.sql', import.meta.url), 'utf8');
  assert.match(mig, /'page-direction-all', 'off'/);
  assert.equal(stripSpreadMode('single'), 'strip');
  assert.equal(stripSpreadMode('double'), 'strip-double');
  assert.equal(stripSpreadMode('grid-auto'), 'strip-grid-auto');
  assert.equal(normalizeSpreadMode('strip-single'), 'strip');
  assert.equal(normalizeSpreadMode('strip-nope'), 'strip');
  assert.equal(isGridMode('strip-grid-3'), false, 'a turned Grid is a strip, not a Grid row');
  const dims = [page(100, 150), page(100, 150), page(100, 150), page(100, 150), page(100, 150)];
  // Double: 1 over 2, 3 over 4, then 5 at the top of its own column (picture 43).
  const double = placeSpreadPages(dims, 'strip-double', 10);
  assert.equal(double.strip, true);
  assert.deepEqual(double.offsetX, [0, 0, 110, 110, 220]);
  assert.deepEqual(double.offsetY, [0, 160, 0, 160, 0]);
  assert.deepEqual(double.stack[0], { w: 320, h: 310 });
  assert.deepEqual(double.rows, [[0, 1, 2, 3, 4]]);
  assert.deepEqual(double.columns, [[0, 1], [2, 3], [4]]);
  assert.equal(steppedSpreadPage(double, 2, 1), 3, 'Next steps one page');
  // Cover: page 1 alone in the low slot, then 2 over 3, 4 over 5.
  const cover = placeSpreadPages(dims, 'strip-cover', 10);
  assert.deepEqual(cover.offsetY, [160, 0, 160, 0, 160]);
  assert.deepEqual(cover.offsetX, [0, 110, 110, 220, 220]);
  // Grid 3: columns of three, top to bottom (picture 44 is Auto's columns of six).
  const grid = placeSpreadPages(dims, 'strip-grid-3', 10);
  assert.deepEqual(grid.offsetY, [0, 160, 320, 0, 160]);
  assert.deepEqual(grid.stack[0], { w: 210, h: 470 });
  const thirty = Array.from({ length: 30 }, () => page(100, 100));
  assert.equal(placeSpreadPages(thirty, 'strip-grid-auto', 0).columns.length, 5, '30 pages: five columns of six');
  // Every other view has no y place, so nothing below the row moves.
  assert.deepEqual(placeSpreadPages(dims, 'double', 10).offsetY, [0, 0, 0, 0, 0]);
  // The page stack puts a page lower in its row by its y place.
  const stack = buildVisiblePageStack({ pageSizes: dims, gap: 10, scale: 2, spread: 'strip-double' });
  assert.equal(stack.tops[1] - stack.tops[0], 320);
  assert.equal(stack.tops[2], stack.tops[0]);
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /return y \+ \(spreadPlaceRef\.current\?\.offsetY\?\.\[i\] \|\| 0\) \* sc;/);
  assert.match(viewer, /if \(cY != null && place\.columns\) \{/);
  assert.match(viewer, /const page = columns \? pickCurrentPageInColumns\(\{/);
});

test('Horizontal columns: the current page is across to the column, then down it', () => {
  // Two columns of two 100 x 100 pages, 10 apart.
  const columns = [[0, 1], [2, 3]];
  const args = {
    columns,
    lefts: [0, 0, 110, 110],
    widths: [100, 100, 100, 100],
    tops: [0, 110, 0, 110],
    heights: [100, 100, 100, 100],
  };
  // The view shows the lower half of column one.
  assert.equal(pickCurrentPageInColumns({ ...args, viewLeft: 0, viewRight: 100, viewTop: 110, viewBottom: 210, currentPage: 1 }), 2);
  // Scrolled across to column two, top row.
  assert.equal(pickCurrentPageInColumns({ ...args, viewLeft: 110, viewRight: 210, viewTop: 0, viewBottom: 100, currentPage: 2 }), 3);
  // A page still fully in view stays current.
  assert.equal(pickCurrentPageInColumns({ ...args, viewLeft: 0, viewRight: 220, viewTop: 0, viewBottom: 220, currentPage: 4 }), 4);
});
