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
  resolveFitPageLanding,
  resolvePageInput,
  sanitizeZoomInput,
  TYPED_PAGE_JUMP_FITS_PAGE,
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
  // Owner 2026-10-07: the vertical stack is the rail's only footer now.
  const collapsed = appShell.slice(appShell.indexOf('// Owner 2026-10-07 (Drawboard rail): the Survey rail never'), appShell.indexOf('})()}', appShell.indexOf('// Owner 2026-10-07 (Drawboard rail): the Survey rail never')));
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
  // Owner 2026-10-07 (Drawboard rail): the one-row footer is gone; the vertical
  // stack is the rail's only footer and it is the chrome region.
  assert.doesNotMatch(appShell, /data-rail-footer-row/);
  assert.match(appShell, /the Survey rail never[\s\S]{0,800}return \(\s*<div data-chrome-rail="true"/);
});

// Drawboard parity (measured 2026-10-04, scratchpad pageJump): a typed page
// number zooms to Fit page for THAT page; the page's top lands at the top of
// the visible band, it is centred across, and page 1 / the last page rest
// against the document's ends.
test('typed page jump: Fit page, top at the top of the view, centred across, clamped at the document ends', () => {
  assert.equal(TYPED_PAGE_JUMP_FITS_PAGE, true);
  // Desktop, portrait letter in a 1344x831 viewer at its fitted 100.85%.
  const s = computeFitScale({ mode: 'fitPage', pageW: 612, pageH: 792, viewportW: 1344, viewportH: 831, padX: 20, gap: 16 });
  assert.equal(Math.round(s * 792 + 2 * 16 * s), 831, 'the page and its two gaps fill the view height');
  const pageW = 612 * s;
  const mid = resolveFitPageLanding({ pageTop: 5000, pageLeft: (1344 - pageW) / 2, pageWidth: pageW, gap: 16 * s, viewportWidth: 1344, maxScrollTop: 96969 });
  assert.equal(mid.scrollTop, 5000 - 16 * s, 'top edge (with its own gap) at the top of the view');
  assert.equal(mid.scrollLeft, 0, 'a page narrower than the view is already centred by the column');
  // A page wider than the view (2448px at 400% in the 1344px viewer) is centred
  // by scrolling: 20 + 2448/2 - 1344/2 = 572 px.
  assert.equal(resolveFitPageLanding({ pageLeft: 20, pageWidth: 2448, viewportWidth: 1344, maxScrollLeft: 1124 }).scrollLeft, 572);
  // Tool strips over the top of the viewer push the landing below them.
  assert.equal(resolveFitPageLanding({ pageTop: 5000, gap: 16, topInset: 44 }).scrollTop, 5000 - 16 - 44);
  // Page 1 rests at the start of the document; the last page cannot rise past the end.
  assert.equal(resolveFitPageLanding({ pageTop: 10, gap: 16 }).scrollTop, 0);
  assert.equal(resolveFitPageLanding({ pageTop: 1200, gap: 8, maxScrollTop: 851 }).scrollTop, 851);
  // Wide sheet on a wide view (fits the width, not the height): hangs from the
  // top, NOT centred up-and-down — Drawboard's 2400x600 strip measured the same.
  const strip = computeFitScale({ mode: 'fitPage', pageW: 2400, pageH: 600, viewportW: 1344, viewportH: 831, padX: 20, gap: 16 });
  assert.ok(strip * 600 < 831 / 2);
  assert.equal(resolveFitPageLanding({ pageTop: 700, gap: 16 * strip }).scrollTop, 700 - 16 * strip);
  // Side panels open: centred in the band between them.
  const band = resolveFitPageLanding({ pageLeft: 800, pageWidth: 600, viewportWidth: 1344, insets: { left: 300, right: 0 } });
  assert.equal(band.scrollLeft, 800 + 300 - (300 + 1344) / 2); // 278
});

test('typed page jump wiring: the page field asks for Fit page after navigating; Fit page lands through the shared rule', () => {
  const commit = viewer.slice(viewer.indexOf('const commitPageInput = useCallback('), viewer.indexOf('const handlePageInputKeyDown'));
  assert.match(commit, /goToPage\(value\);[\s\S]{0,400}if \(TYPED_PAGE_JUMP_FITS_PAGE\) handleZoomModeSelect\(ZOOM_MODES\.FIT_PAGE\);/);
  const zoomTo = container.slice(container.indexOf('const zoomToScale = useCallback('), container.indexOf('const goToPage = useCallback('));
  assert.match(zoomTo, /resolveFitPageLanding\(\{/);
  assert.match(container, /fitToPage: \(\) => zoomToScale\('fit'\)/);
});
