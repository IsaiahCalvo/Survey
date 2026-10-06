// Guards the two mechanisms behind the owner's "PDF elements vanish and come
// back / sharp -> blurry -> sharp" report on the mobile PDF surface:
//
//   1. a page that leaves the mount window must repaint from a cached raster,
//      not re-rasterize from scratch as an undrawn white slab, and
//   2. the crisp detail tile must be HELD until its replacement has painted,
//      instead of being destroyed on the first frame of every gesture.
//
// The geometry half is a real unit test of the page-unit tile box. The rest are
// source assertions, in the same style as tests/mobileRuntimeCompatibility.mjs:
// these are structural contracts inside a 2.8k-line high-risk component that no
// headless DOM can exercise.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeDetailTileBox, resolveDetailTileStyle } from '../src/utils/pdfDetailTileGeometry.js';

const PDFJS_VIEWER_SOURCE = readFileSync('src/components/PdfjsViewerContainer.jsx', 'utf8');

// A 393x780 phone viewport looking at the middle of a page laid out at 4x with a
// 1.5x pinch still in progress: the slice is measured in on-screen CSS px
// relative to the page host, whose rect is already scale * liveZoom.
const SLICE = { vx: 240, vy: 600, vw: 393, vh: 780 };

test('the detail tile box is page-unit, so it is independent of the live zoom', () => {
  // Same on-screen slice, two different (scale, liveZoom) splits of the same
  // product. The page region described must be identical.
  const midGesture = computeDetailTileBox({ ...SLICE, scale: 4, liveZoom: 1.5 });
  const committed = computeDetailTileBox({ ...SLICE, scale: 6, liveZoom: 1 });

  assert.equal(midGesture.left, committed.left);
  assert.equal(midGesture.top, committed.top);
  assert.equal(midGesture.w, committed.w);
  assert.equal(midGesture.h, committed.h);
  assert.equal(midGesture.renderScale, 6);
});

test('a tile held across a commit lands on exactly the same pixels', () => {
  // This is the sharp -> blurry -> sharp pop, expressed as arithmetic. A pinch
  // to 1.5x over a 4x layout commits to scale 6 with liveZoom back at 1. The
  // tile rasterized mid-gesture must still describe the same screen rectangle
  // afterwards — the old CSS-space box did not, which is why the old code had to
  // hide it and expose the soft base canvas.
  const tile = computeDetailTileBox({ ...SLICE, scale: 4, liveZoom: 1.5 });

  const duringGesture = resolveDetailTileStyle(tile, 4);
  const afterCommit = resolveDetailTileStyle(tile, 6);

  // During the gesture the parent content node still carries scale(1.5), so the
  // box is written at the pre-commit scale and the transform supplies the rest.
  assert.equal(duringGesture.left * 1.5, afterCommit.left);
  assert.equal(duringGesture.top * 1.5, afterCommit.top);
  assert.equal(duringGesture.width * 1.5, afterCommit.width);
  assert.equal(duringGesture.height * 1.5, afterCommit.height);

  // And after the commit the box is the slice's own on-screen geometry again.
  assert.equal(afterCommit.left, SLICE.vx);
  assert.equal(afterCommit.top, SLICE.vy);
  assert.equal(afterCommit.width, SLICE.vw);
  assert.equal(afterCommit.height, SLICE.vh);
  assert.equal(afterCommit.display, 'block');
});

test('a held tile is shown, and only a rotation change hides it', () => {
  const tile = computeDetailTileBox({ ...SLICE, scale: 4, liveZoom: 1.5, rotation: 0 });

  // Large live-zoom drift no longer hides the tile: it is provably never
  // blurrier than the base canvas it covers.
  assert.equal(resolveDetailTileStyle(tile, 4, 0).display, 'block');
  assert.equal(resolveDetailTileStyle(tile, 32, 0).display, 'block');

  // A rotation re-maps the page frame, so that tile would land on the wrong
  // region — the one case where hiding beats holding.
  assert.equal(resolveDetailTileStyle(tile, 4, 90).display, 'none');
  assert.equal(resolveDetailTileStyle(null, 4, 0).display, 'none');
});

test('a degenerate scale never produces a non-finite tile box', () => {
  for (const bad of [0, -1, Number.NaN, undefined]) {
    const tile = computeDetailTileBox({ ...SLICE, scale: bad, liveZoom: bad });
    for (const value of [tile.left, tile.top, tile.w, tile.h, tile.renderScale]) {
      assert.ok(Number.isFinite(value), `non-finite tile value for scale=${String(bad)}`);
    }
    const style = resolveDetailTileStyle(tile, bad, 0);
    for (const value of [style.left, style.top, style.width, style.height]) {
      assert.ok(Number.isFinite(value), `non-finite tile style for scale=${String(bad)}`);
    }
  }
});

test('every surface reads AND writes the page raster cache', () => {
  // The mobile-only cache bypass is what made a revisited page a blank white
  // slab for up to seconds on a large drawing. Both guards must stay gone.
  assert.doesNotMatch(PDFJS_VIEWER_SOURCE, /isMobileSurface \? null : pageRasterCacheGet/);
  // 2026-10-06 (smooth zoom at every level): the cache keeps every bitmap of a
  // page at any scale (pageRasterCacheCandidates) so a zoom change can reuse
  // or shrink one; still read and written on every surface.
  assert.match(PDFJS_VIEWER_SOURCE, /const candidates = pageRasterCacheCandidates\(pageId\);/);
  assert.doesNotMatch(PDFJS_VIEWER_SOURCE, /if \(!isMobileSurface\) \{\s*\/\/[^\n]*\n\s*pageRasterCacheSet/);
  assert.match(PDFJS_VIEWER_SOURCE, /const maxBytes = pageRasterCacheMaxBytes\(isMobileSurface\);/);
  assert.match(
    PDFJS_VIEWER_SOURCE,
    /pageRasterCacheSet\(rasterCacheKey\(pageId, want\), target, maxBytes, want\)/
  );
  // The bypass is replaced by a surface-aware byte ceiling, not by an unbounded
  // cache: mobile must stay well under the WKWebView budget.
  const desktopCeiling = /PAGE_RASTER_CACHE_MAX_BYTES = (\d+) \* 1024 \* 1024/.exec(PDFJS_VIEWER_SOURCE);
  const mobileCeiling = /MOBILE_PAGE_RASTER_CACHE_MAX_BYTES = (\d+) \* 1024 \* 1024/.exec(PDFJS_VIEWER_SOURCE);
  assert.ok(desktopCeiling && mobileCeiling, 'both raster cache ceilings must be declared');
  assert.ok(Number(mobileCeiling[1]) > 0);
  assert.ok(Number(mobileCeiling[1]) < Number(desktopCeiling[1]));
  // LRU eviction must honor the ceiling it was handed, not the desktop constant.
  assert.match(PDFJS_VIEWER_SOURCE, /while \(pageRasterCacheBytes > maxBytes && PAGE_RASTER_CACHE\.size > 0\)/);
});

test('the crisp detail tile is held across a gesture boundary', () => {
  // The old code cancelled the render AND destroyed the visible tile on the
  // first frame of a pinch. Cancelling is still right; destroying is the pop.
  const enteringBranch = /if \(enteringLiveZoom\) \{([\s\S]*?)\n    \}/.exec(PDFJS_VIEWER_SOURCE);
  assert.ok(enteringBranch, 'the enteringLiveZoom branch must still exist');
  assert.match(enteringBranch[1], /taskRef\.current\.cancel\(\)/);
  assert.doesNotMatch(enteringBranch[1], /releaseRasterCanvas/);
  assert.doesNotMatch(enteringBranch[1], /setTile\(null\)/);

  // No live-zoom staleness cutoff: a commit snapping liveZoom back to 1 always
  // tripped it, so the tile vanished at the end of every gesture.
  assert.doesNotMatch(PDFJS_VIEWER_SOURCE, /tileIsCurrent/);
  assert.match(PDFJS_VIEWER_SOURCE, /const tileStyle = resolveDetailTileStyle\(tile, scale, rotation\)/);

  // Bitmap and box must be written in the same synchronous block, or a paint
  // landing between them stretches the new bitmap across the previous box.
  assert.match(
    PDFJS_VIEWER_SOURCE,
    /drawImage\(off, 0, 0\);\s*\n\s*applyDetailTileStyle\(c, nextTile, scale, rotation\);/
  );
});

test('the flicker fix leaves the enforced zoom contracts alone', () => {
  // Mobile deep zoom-out still refuses to RENDER another large canvas on the
  // path that is tightest on iPhone memory — it just no longer destroys the one
  // already on screen, which costs nothing and keeps the pinch-out sharp.
  assert.match(PDFJS_VIEWER_SOURCE, /if \(isMobileSurface && liveZoom < 1\) return;/);
  // 2026-09-30 (owner: phone pinch as smooth as desktop): the scheduling
  // branch now covers the whole live touch pinch (liveZoom !== 1), not only
  // pinch-out — no tile raster competes with touchmove while fingers are down.
  const zoomOutBranch = /if \(isMobileSurface && liveZoom (?:< 1|!== 1)\) \{([\s\S]*?)\n      return;/.exec(PDFJS_VIEWER_SOURCE);
  assert.ok(zoomOutBranch, 'the mobile zoom-out branch must still exist');
  assert.match(zoomOutBranch[1], /taskRef\.current\.cancel\(\)/);
  assert.doesNotMatch(zoomOutBranch[1], /setTile\(null\)/);
  // A second overscan page is part of the fix, not an accident: see the ruled
  // decision in tests/mobileRuntimeCompatibility.test.mjs.
  assert.match(PDFJS_VIEWER_SOURCE, /MOBILE_MAX_OVERSCAN_PAGES = 2/);
  // The zoomGeneration signal still fires through onZoomPhase at gesture start
  // and settle; SVGAnnotationLayer / FabricEraserCanvas depend on it.
  assert.match(PDFJS_VIEWER_SOURCE, /onZoomPhase\?\.\('gesture-start'/);
  assert.match(PDFJS_VIEWER_SOURCE, /onZoomPhase\?\.\('settle'/);
  // Container-aware sizing: the base canvas still fills its host at 100%, so
  // overlays keep measuring the page host rather than pageSize * scale.
  assert.match(PDFJS_VIEWER_SOURCE, /width: '100%', height: '100%', background: '#fff'/);
  // The detail tile stays non-interactive: it must never steal pointer events
  // from the annotation overlays above it.
  assert.match(PDFJS_VIEWER_SOURCE, /position: 'absolute', inset: 0, pointerEvents: 'none'/);
});
