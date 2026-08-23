import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';
import { normalizeBookmarkPageIds } from '../src/utils/bookmarkPageIds.js';

// Source contracts: bookmark jump AFTER page CW (viewBox 0 0 792 612).
// Unrotated V-07 is e2e-bookmark-group / e2e-bookmark-rename-delete (portrait).
// goToBookmarkSource returns false — page-number jump only.
// Do not invent dest XYZ remapping.
// Live proof: debug/scenarios/e2e-page-rotate-bookmark-jump.spec.mjs
// Distinct from leftover-18 / X-01 / remapper / create-after-rotate /
// History-restore / eraser-on-remap / mtr / page-ops / after-CW
// Select-text / Search / thumbnails / form widgets / Fit.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('CW rewrite peeks swapped 792×612; page-number dest is unchanged', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const before = await peekDisplayedPageSize(sourceBytes, 2);
  assert.deepEqual(before, { width: 612, height: 792 });

  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 2, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 2);
  assert.deepEqual(displayed, { width: 792, height: 612 });
  const sibling = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(sibling, { width: 612, height: 792 });
});

test('missing dest does not invent a page; page-number dest wins over leftover XYZ', () => {
  assert.deepEqual(normalizeBookmarkPageIds({ dest: { xyz: [100, 200, 0] } }), []);
  assert.deepEqual(normalizeBookmarkPageIds({ dest: { XYZ: [10, 20, 0], left: 10, top: 20 } }), []);
  assert.deepEqual(normalizeBookmarkPageIds({ destination: { x: 12, y: 34 } }), []);
  assert.deepEqual(normalizeBookmarkPageIds({ pageIds: [2], dest: { xyz: [100, 200, 0] } }), [2]);
  assert.deepEqual(normalizeBookmarkPageIds({ dest: { pageNumber: 2, xyz: [1, 2, 0] } }), [2]);
  assert.deepEqual(normalizeBookmarkPageIds({ dest: { PageNumber: 3 } }), [3]);
  assert.deepEqual(normalizeBookmarkPageIds(null), []);
});

test('goToBookmarkSource stays stubbed; outline dest is pageNumber only; rotate does not remap dest', () => {
  const viewer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewer, /goToBookmarkSource: \(\) => false/);
  assert.match(viewer, /resolveBookmarkPageFromSource: \(\) => null/);
  assert.match(viewer, /Stage 4 — caller falls back to goToPage/);

  const outline = read('src/utils/bookmarkOutline.js');
  assert.match(outline, /dest: \{\s*pageNumber: hasValidPage \? pageNumber : null\s*\}/);
  assert.doesNotMatch(outline, /dest\.xyz|XYZ|left:|top:/);

  const mutation = read('src/utils/pdfPageMutation.js');
  assert.match(mutation, /page\.setRotation\(degrees/);
  assert.doesNotMatch(mutation, /bookmarkDest|dest\.xyz|rotateBookmarkDest/);

  const pdfViewer = read('src/PDFViewer.jsx');
  assert.match(pdfViewer, /viewer\?\.goToBookmarkSource/);
  assert.match(pdfViewer, /bookmarkFallbackPage/);
  assert.match(pdfViewer, /invokeNavigation\(\s*viewer,\s*viewer\?\.goToPage,\s*desiredPage\)/);
  assert.match(pdfViewer, /setZoomGeneration\(prev => prev \+ 1\)/);

  const panel = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(panel, /if \(!isFolder\) onNavigate\?\.\(item\)/);
  assert.match(panel, /if \(page\) \{\s*onNavigateToPage\(page, navigationOptions\);\s*return;/);
  assert.match(panel, /preferBookmarkSource: canUseSourceNavigation/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(svg, /zoomGeneration/);
  assert.doesNotMatch(svg, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
});

test('live spec covers bookmark jump after CW + missing dest + 390; skip leftover-18', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-bookmark-jump.spec.mjs');
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop bookmark jump after page CW intended \+ break \+ edge/);
  assert.match(spec, /390 bookmark jump after page CW edge/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /page-number dest only/);
  assert.match(spec, /create must not invent dest XYZ/);
  assert.match(spec, /rotate page 2 must not invent a jump off page 1/);
  assert.match(spec, /missing dest does not invent XYZ after CW/);
  assert.match(spec, /bookmark must jump to the bookmarked landscape page/);
  assert.match(spec, /jumped page 2 host must be landscape, not leftover portrait/);
  assert.match(spec, /bookmark jump after CW must keep swapped viewBox/);
  assert.match(spec, /missing dest does not invent XYZ on jump/);
  assert.match(spec, /empty CW invents 0 annotations/);
  assert.match(spec, /390 Pages rotate is not cheap \(sheet backdrop\)/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);
  assert.doesNotMatch(spec, /goToBookmarkSource\(.*xyz/i);

  const group = read('debug/scenarios/e2e-bookmark-group.spec.mjs');
  assert.match(group, /child bookmark must jump to page 3/);
  assert.doesNotMatch(group, /bookmark jump after CW must keep swapped viewBox/);

  const fit = read('debug/scenarios/e2e-page-rotate-fit.spec.mjs');
  assert.match(fit, /Fit page after CW must use the swapped 792×612 page/);
  assert.doesNotMatch(fit, /bookmark must jump to the bookmarked landscape page/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
