// Right-rail audit (owner 2026-09-23): page indicator, go-to-page, typed zoom,
// fit math, and the "1 · 36" stack. The pure rules live in
// src/utils/pageNavigationMath.js; the wiring is guarded by source assertions
// in the same style as tests/zoomRailControlOrder.test.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  computeFitScale,
  parseZoomPercentInput,
  pickCurrentPage,
  resolvePageInput,
  sanitizeZoomInput,
} from '../src/utils/pageNavigationMath.js';

// A laid-out strip: page heights h (already scaled), gap g between and above.
const strip = (heights, gap) => {
  const tops = [];
  let y = gap;
  for (const h of heights) { tops.push(y); y += h + gap; }
  return tops;
};

test('current page: the page you jumped to stays current even when it is shorter than half the view', () => {
  // 25% zoom on a 36-sheet set: pages 198px tall, 8px gaps (scaled), 831px view.
  const heights = Array(36).fill(198);
  const tops = strip(heights, 4);
  // Old rule (viewport midpoint) said page 3 at the very top of the document.
  assert.equal(pickCurrentPage({ pageTops: tops, pageHeights: heights, viewTop: 0, viewBottom: 831, currentPage: 1 }), 1);
  // Jump to page 20: land with its gap showing.
  const land = tops[19] - 4;
  assert.equal(pickCurrentPage({ pageTops: tops, pageHeights: heights, viewTop: land, viewBottom: land + 831, currentPage: 20 }), 20);
});

test('current page: most-visible share wins, ties keep the current page, else the upper page', () => {
  const heights = [800, 800, 800];
  const tops = strip(heights, 16);
  // Page 2 shows 70%, page 3 shows 30%.
  const viewTop = tops[1] + 240;
  assert.equal(pickCurrentPage({ pageTops: tops, pageHeights: heights, viewTop, viewBottom: viewTop + 800, currentPage: 3 }), 2);
  // Exact half-and-half: keeps whichever is current.
  const mid = tops[1] + 408;
  assert.equal(pickCurrentPage({ pageTops: tops, pageHeights: heights, viewTop: mid, viewBottom: mid + 800, currentPage: 3 }), 3);
  assert.equal(pickCurrentPage({ pageTops: tops, pageHeights: heights, viewTop: mid, viewBottom: mid + 800, currentPage: 1 }), 2);
});

test('current page: mixed sizes use each page\'s own share, and empty layouts are page 1', () => {
  // A short portrait cover then a tall sheet; the cover is fully visible.
  const heights = [300, 1600];
  const tops = strip(heights, 10);
  assert.equal(pickCurrentPage({ pageTops: tops, pageHeights: heights, viewTop: 0, viewBottom: 800, currentPage: null }), 1);
  assert.equal(pickCurrentPage({ pageTops: [], pageHeights: [], viewTop: 0, viewBottom: 800 }), 1);
});

test('go-to-page field clamps into the document and cancels on no digits', () => {
  assert.equal(resolvePageInput('17', 36), 17);
  assert.equal(resolvePageInput('99', 36), 36);
  assert.equal(resolvePageInput('0', 36), 1);
  assert.equal(resolvePageInput(' 3 ', 36), 3);
  assert.equal(resolvePageInput('', 36), null);
  assert.equal(resolvePageInput('abc', 36), null);
  assert.equal(resolvePageInput('5', 0), null);
});

test('typed zoom keeps one decimal point, strips "%", and clamps to 1-4000', () => {
  assert.equal(sanitizeZoomInput('150%'), '150');
  assert.equal(sanitizeZoomInput('12.5'), '12.5');
  assert.equal(sanitizeZoomInput('1.2.5'), '1.25');
  assert.equal(sanitizeZoomInput('99999'), '4000');
  assert.equal(parseZoomPercentInput('150%'), 150);
  assert.equal(parseZoomPercentInput('12.5'), 12.5);
  assert.equal(parseZoomPercentInput('0'), 1);
  assert.equal(parseZoomPercentInput('5000'), 4000);
  assert.equal(parseZoomPercentInput(''), null);
  assert.equal(parseZoomPercentInput('.'), null);
});

test('fit math: width, height and page for landscape, portrait and the viewer\'s real metrics', () => {
  const metrics = { padX: 20, gap: 16, padTop: 0, padBottom: 0 };
  const view = { viewportW: 1344, viewportH: 831 };
  // Landscape tabloid sheet (1224x792 pt), measured in the app at 107% / 101%.
  const land = { pageW: 1224, pageH: 792, ...view, ...metrics };
  const fw = computeFitScale({ mode: 'fitWidth', ...land });
  const fh = computeFitScale({ mode: 'fitHeight', ...land });
  assert.equal(Math.round(fw * 1224), 1304); // page = viewer width - 2*20
  assert.equal(Math.round(fh * (792 + 32)), 831); // page + its two gaps = viewer height
  assert.equal(computeFitScale({ mode: 'fitPage', ...land }), Math.min(fw, fh));
  // Portrait letter (612x792): Fit width is height-overflowing, Fit page is height-bound.
  const port = { pageW: 612, pageH: 792, ...view, ...metrics };
  assert.equal(Math.round(computeFitScale({ mode: 'fitWidth', ...port }) * 612), 1304);
  assert.equal(computeFitScale({ mode: 'fitPage', ...port }), computeFitScale({ mode: 'fitHeight', ...port }));
  // Phone surface caps the fitted width.
  assert.equal(computeFitScale({ mode: 'fitWidth', pageW: 600, pageH: 800, viewportW: 1000, viewportH: 800, padX: 10, maxPageWidth: 600 }), 1);
});

const appShell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const container = await readFile(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const states = await readFile(new URL('../src/styles/states.css', import.meta.url), 'utf8');

test('rail "1 · 36": drawn dot between two equal-height number boxes', () => {
  const collapsed = appShell.slice(appShell.indexOf('if (!railPanelEl)'), appShell.indexOf('// Expanded 320px survey panel'));
  const dotAt = collapsed.indexOf('data-rail-page-dot');
  // Spaces chunk A (2026-10-01): the total reads 0 while the active space has
  // no pages, so it is `{api.activeSpaceHasNoPages ? 0 : api.numPages}`.
  assert.ok(collapsed.indexOf('{pageValue}') < dotAt && dotAt < collapsed.indexOf('api.numPages}'));
  assert.doesNotMatch(collapsed, />·</, 'no font middle-dot glyph in the vertical stack');
  // The total sits in the page field's 20px box.
  assert.match(collapsed, /data-rail-page-dot[\s\S]{0,200}height: 'var\(--chrome-field-h\)'[\s\S]{0,200}\{api\.activeSpaceHasNoPages \? 0 : api\.numPages\}/);
});

test('rail fields select their value on focus, commit the typed DOM value, and dismiss on an outside click', () => {
  assert.equal((appShell.match(/onFocus=\{\(e\) => e\.target\.select\(\)\}/g) || []).length, 2);
  assert.match(appShell, /defaultValue=\{api\.pageInputValue\}/);
  assert.match(appShell, /defaultValue=\{api\.zoomInputValue\}/);
  assert.equal((appShell.match(/<DismissBarrier active insideRefs=\{railFieldRefs\}[^>]*dismissOnEscape=\{false\}/g) || []).length, 2);
  assert.match(appShell, /<DismissBarrier active insideRefs=\{railFitMenuRefs\}/);
  assert.match(viewer, /commitPageInput\(e\.target\.value\)/);
  assert.match(viewer, /commitZoomInput\(e\.currentTarget\.value\)/);
});

test('Escape in the page / zoom field cancels instead of committing on the blur that follows', () => {
  const pageKeys = viewer.slice(viewer.indexOf('const handlePageInputKeyDown'), viewer.indexOf('const handlePageInputBlur'));
  assert.match(pageKeys, /'Escape'[\s\S]*skipPageInputCommitRef\.current = true;[\s\S]*blur\(\)/);
  assert.match(viewer, /const handlePageInputBlur = useCallback\(\(e\) => \{\n\s*if \(skipPageInputCommitRef\.current\) return;/);
  assert.match(viewer, /const handleZoomInputBlur = useCallback\(\(e\) => \{\n\s*if \(skipZoomInputCommitRef\.current\) return;/);
});

test('viewer: fits measure the current page, Fit height is the viewer\'s own, and a jump lands with the page gap', () => {
  const zoomTo = container.slice(container.indexOf('const zoomToScale = useCallback('), container.indexOf('const goToPage = useCallback('));
  assert.doesNotMatch(zoomTo, /pageSizes\[Math\.max\(0, range\[0\]\)\]/, 'fit no longer sizes to the first mounted overscan page');
  assert.match(zoomTo, /currentPageRef\.current/);
  assert.match(zoomTo, /'fith'/);
  assert.match(container, /fitToHeight: \(\) => zoomToScale\('fith'\)/);
  assert.match(viewer, /mode === ZOOM_MODES\.FIT_HEIGHT && typeof magnification\.fitToHeight === 'function'/);
  const goTo = container.slice(container.indexOf('const goToPage = useCallback('));
  assert.match(goTo.slice(0, 1600), /- layoutMetricsRef\.current\.gap \* scaleRef\.current\)/);
  assert.match(container, /const page = pickCurrentPage\(\{/);
});

test('rail glyph buttons: no hover plate, the glyph grows and brightens instead', () => {
  // The two number fields keep their hover plate (they are fields).
  assert.match(states, /#chrome-right-host button:not\(:disabled\):not\(\[aria-disabled='true'\]\):not\(\[data-glyph-only\]\):not\(\.chrome-icon-btn\):hover:not\(:active\) \{\n\s*background-color: var\(--hover\) !important;/);
  // DELIBERATE ASSERTION CHANGE (owner 2026-10-02, test plan U2: "the left
  // rail and right rail: those are different. There's no consistency"): the
  // rail's glyphs grew to 112% by a rule of their own, the tool bar not at
  // all and the left rail painted a plate. Every chrome icon now takes ONE
  // rule set, states.css section 5 - grow to 108%, brighten, no plate - and
  // both rail regions (the collapsed stack and the footer row) are marked
  // data-chrome-rail so it reaches them. Still no plate; still grows and
  // brightens; only the number and the owner of the rule changed.
  assert.doesNotMatch(states, /#chrome-right-host button\[data-glyph-only\]/);
  assert.match(states, /:is\([^)]*\[data-chrome-rail\][^)]*\) :is\(\[data-glyph-only\], \.chrome-icon-btn\)[^{]*:hover > :not\(\[data-anchored-tooltip\]\) \{\s*scale: 1\.08;/);
  assert.match(states, /:not\(\.btn-active, \.is-active, \[aria-pressed='true'\], \[aria-selected='true'\], \[data-active='true'\]\):hover \{\s*color: var\(--text-1\) !important;/);
  assert.match(appShell, /data-rail-footer-row="true"[\s\S]{0,200}data-chrome-rail="true"/);
});
