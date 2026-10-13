// Owner 2026-10-06 ("the PDF gets a little laggy when it's that zoomed out ...
// the rendering needs to be strategic"): which page bitmap to show for a zoom,
// and when a page has to be drawn again (src/utils/pageRasterLod.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  RASTER_EXACT_TOLERANCE,
  THUMB_LONG_SIDE,
  classifyRaster,
  pickRasterSource,
  planThumbPrefetch,
  resolveWantedRasterScale,
  thumbBytes,
  thumbRasterScale,
} from '../src/utils/pageRasterLod.js';

const CONTAINER = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');

test('a bitmap is right, too sharp, too soft or missing', () => {
  assert.equal(classifyRaster(1, 1), 'sharp');
  assert.equal(classifyRaster(1.01, 1), 'sharp', 'canvas floor() noise is still the right size');
  assert.equal(classifyRaster(1 * RASTER_EXACT_TOLERANCE + 0.01, 1), 'oversize');
  assert.equal(classifyRaster(2, 0.5), 'oversize', 'zoomed out: shrink, never redraw');
  assert.equal(classifyRaster(0.5, 1), 'soft', 'zoomed in: show it, then sharpen');
  assert.equal(classifyRaster(0, 1), 'none');
  assert.equal(classifyRaster(undefined, 1), 'none');
});

test('zooming out reuses the smallest bitmap that is sharp enough, shrunk to size', () => {
  const candidates = [{ scale: 0.25, id: 'a' }, { scale: 1.06, id: 'b' }, { scale: 2.1, id: 'c' }];
  assert.deepEqual(pickRasterSource(candidates, 1.06), { use: candidates[1], action: 'keep' });
  assert.deepEqual(pickRasterSource(candidates, 0.5), { use: candidates[1], action: 'shrink' });
  assert.deepEqual(pickRasterSource(candidates, 0.25), { use: candidates[0], action: 'keep' });
  assert.deepEqual(pickRasterSource(candidates, 0.1), { use: candidates[0], action: 'shrink' });
});

test('zooming in shows the sharpest softer bitmap until the sharp one is drawn', () => {
  const candidates = [{ scale: 0.25 }, { scale: 1 }];
  assert.deepEqual(pickRasterSource(candidates, 3), { use: candidates[1], action: 'placeholder' });
  assert.deepEqual(pickRasterSource([], 3), { use: null, action: 'draw' });
  assert.deepEqual(pickRasterSource([{ scale: 0 }, null], 1), { use: null, action: 'draw' });
});

test('the wanted scale is the CSS scale times the pixel ratio, inside the canvas limits', () => {
  assert.deepEqual(resolveWantedRasterScale({ cssScale: 0.5, dpr: 2, pageW: 612, pageH: 792 }), { want: 1, capped: false });
  // A 36x24 in drawing at 100% on a phone: capped by the 3 MP phone budget.
  const phone = resolveWantedRasterScale({ cssScale: 1, dpr: 2, pageW: 2592, pageH: 1728, maxArea: 3 * 1024 * 1024 });
  assert.equal(phone.capped, true);
  assert.ok(Math.abs(2592 * phone.want * 1728 * phone.want - 3 * 1024 * 1024) < 1);
  const dim = resolveWantedRasterScale({ cssScale: 40, dpr: 1, pageW: 612, pageH: 792, maxDim: 16384 });
  assert.equal(dim.capped, true);
  assert.ok(792 * dim.want <= 16384 + 1e-6);
});

test('the page canvas uses the reuse rules and draws at the wanted scale (never below its thumbnail)', () => {
  assert.match(CONTAINER, /const pick = pickRasterSource\(candidates, want\);/);
  assert.match(CONTAINER, /if \(shown && classifyRaster\(shown\.scale, want\) === 'sharp'\) return done;/);
  // 2026-10-07: far out the draw is at the thumbnail scale and shrunk to fit;
  // the thumbnail itself is a reuse candidate.
  assert.match(CONTAINER, /const drawScale = Math\.max\(want, thumbScale\);/);
  assert.match(CONTAINER, /page\.getViewport\(\{ scale: drawScale, rotation: page\.rotate \+ rotation \}\)/);
  assert.match(CONTAINER, /const thumb = pageThumbGet\(pageId\);\s*if \(thumb\) candidates\.push/);
  // A page already showing something only sharpens, which waits for a gesture.
  assert.match(CONTAINER, /const kind = shownRef\.current\?\.id === pageId \? 'sharpen' : 'fill';/);
});

// Owner 2026-10-07 (far zoom: "maybe a more blurry version"): one small
// bitmap per page, drawn ahead nearest the reader first, inside a budget.
test('a thumbnail is THUMB_LONG_SIDE device pixels on the page\'s longest side', () => {
  assert.equal(thumbRasterScale(2592, 1728) * 2592, THUMB_LONG_SIDE);
  assert.equal(thumbRasterScale(612, 792) * 792, THUMB_LONG_SIDE);
  assert.equal(thumbRasterScale(0, 0), 0);
  assert.equal(thumbBytes(612, 792), Math.floor(612 * (THUMB_LONG_SIDE / 792)) * THUMB_LONG_SIDE * 4);
});

test('thumbnails are drawn nearest the reader first, inside the budget, skipping ones already kept', () => {
  const sizes = Array.from({ length: 6 }, () => ({ w: 612, h: 792 }));
  assert.deepEqual(planThumbPrefetch(sizes, { focus: 2 }), [2, 3, 1, 4, 0, 5]);
  assert.deepEqual(planThumbPrefetch(sizes, { focus: 0 }), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(planThumbPrefetch(sizes, { focus: 2, skip: (i) => i === 3 }), [2, 1, 4, 0, 5]);
  const one = thumbBytes(612, 792);
  assert.deepEqual(planThumbPrefetch(sizes, { focus: 2, maxBytes: one * 3 }), [2, 3, 1]);
  // A kept page still counts against the budget (it is held in memory too).
  assert.deepEqual(planThumbPrefetch(sizes, { focus: 2, maxBytes: one * 3, skip: (i) => i === 2 }), [3, 1]);
  assert.deepEqual(planThumbPrefetch([], { focus: 4 }), []);
});

test('the viewer keeps thumbnails apart from the raster cache and draws them at the lowest priority', () => {
  assert.match(CONTAINER, /const PAGE_THUMBS = new Map\(\);/);
  assert.match(CONTAINER, /queue\.request\(index, \{ kind: 'prefetch'/);
  assert.match(CONTAINER, /pageThumbOffer\(pageId, target, drawScale, thumbScale, pageThumbsMaxBytes\(isMobileSurface\)\);/);
  const mobile = /MOBILE_PAGE_THUMBS_MAX_BYTES = (\d+) \* 1024 \* 1024/.exec(CONTAINER);
  assert.ok(mobile && Number(mobile[1]) <= 32, 'phone thumbnails stay well inside the WKWebView budget');
});
