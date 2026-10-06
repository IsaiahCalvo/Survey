// Owner 2026-10-06 ("the PDF gets a little laggy when it's that zoomed out ...
// the rendering needs to be strategic"): which page bitmap to show for a zoom,
// and when a page has to be drawn again (src/utils/pageRasterLod.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  RASTER_EXACT_TOLERANCE,
  classifyRaster,
  pickRasterSource,
  resolveWantedRasterScale,
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

test('the page canvas uses the reuse rules and draws at exactly the wanted scale', () => {
  assert.match(CONTAINER, /const pick = pickRasterSource\(candidates, want\);/);
  assert.match(CONTAINER, /if \(shown && classifyRaster\(shown\.scale, want\) === 'sharp'\) return done;/);
  assert.match(CONTAINER, /page\.getViewport\(\{ scale: want, rotation: page\.rotate \+ rotation \}\)/);
  // A page already showing something only sharpens, which waits for a gesture.
  assert.match(CONTAINER, /const kind = shownRef\.current\?\.id === pageId \? 'sharpen' : 'fill';/);
});
