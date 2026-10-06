/**
 * pageRasterLod.js — which page bitmap to show for a zoom, and when a page
 * must be drawn again (owner 2026-10-06: "if it's that zoomed out, things
 * maybe don't have to be so detailed ... things need to load quick and
 * snappy").
 *
 * A page bitmap is drawn at a RASTER SCALE (device pixels per PDF point).
 * Drawing a page costs about the same whatever its size (pdf.js walks every
 * drawing command of the page: measured on a 4x-slowed phone, one large
 * drawing took ~500 ms at 25 px wide and at 735 px wide alike), so the
 * expensive thing is drawing it AGAIN. The old rule drew every page on screen
 * again at every new zoom, even when the bitmap already on screen had more
 * than enough pixels: zooming out on a set of 36 drawings re-drew all 36.
 *
 * Rules:
 *   - A page is drawn at exactly the scale the screen needs (one bitmap pixel
 *     per screen pixel: the crispest result).
 *   - Zooming OUT never redraws: any bitmap with more pixels than needed is
 *     shrunk to the exact size with one smooth image copy (a few ms), so the
 *     page stays crisp at rest and memory follows the zoom down.
 *   - Zooming IN shows the softer bitmap (never a blank page) until the sharp
 *     one is drawn, and that draw waits until the gesture is over
 *     (pageRasterQueue 'sharpen').
 */

// A bitmap within this factor above the needed scale is shown as it is (it is
// the canvas floor() of the same size, or a hair over).
export const RASTER_EXACT_TOLERANCE = 1.02;

// Is a bitmap drawn at `have` right for a screen that needs `want`?
//   'sharp'    — the right size: keep it as is
//   'oversize' — more pixels than needed: shrink it with an image copy
//   'soft'     — too few pixels: show it until a sharper one is drawn
//   'none'     — nothing to show
export function classifyRaster(have, want, { tolerance = RASTER_EXACT_TOLERANCE } = {}) {
  const h = Number(have);
  const w = Number(want);
  if (!(h > 0)) return 'none';
  if (!(w > 0)) return 'sharp';
  if (h < w * 0.999) return 'soft';
  if (h > w * tolerance) return 'oversize';
  return 'sharp';
}

// From the bitmaps already drawn for one page ([{ scale, ... }]), pick what
// to show for `want`:
//   { use, action }  action: 'keep' (right size), 'shrink' (copy it down to
//   `want`), 'placeholder' (soft: show it, then draw a sharp one), or 'draw'
//   (nothing usable: draw now).
// Prefers the smallest bitmap with enough pixels; failing that the sharpest
// soft one.
export function pickRasterSource(candidates, want, options = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((c) => c && Number(c.scale) > 0);
  let best = null;
  for (const c of list) {
    if (Number(c.scale) < Number(want) * 0.999) continue;
    if (!best || c.scale < best.scale) best = c;
  }
  if (best) {
    const kind = classifyRaster(best.scale, want, options);
    return { use: best, action: kind === 'oversize' ? 'shrink' : 'keep' };
  }
  let soft = null;
  for (const c of list) if (!soft || c.scale > soft.scale) soft = c;
  return soft ? { use: soft, action: 'placeholder' } : { use: null, action: 'draw' };
}

// The raster scale a page needs on screen: CSS scale x device pixel ratio, cut
// down so the bitmap stays inside the canvas limits (`maxArea` device pixels,
// `maxDim` per side). Returns { want, capped }.
export function resolveWantedRasterScale({ cssScale, dpr = 1, pageW, pageH, maxArea, maxDim = 16384 }) {
  const want = Math.max(0, Number(cssScale) || 0) * Math.max(0.5, Number(dpr) || 1);
  const w = Math.max(1, Number(pageW) || 1);
  const h = Math.max(1, Number(pageH) || 1);
  let cap = Number.POSITIVE_INFINITY;
  if (Number(maxArea) > 0) cap = Math.min(cap, Math.sqrt(maxArea / (w * h)));
  if (Number(maxDim) > 0) cap = Math.min(cap, maxDim / Math.max(w, h));
  return want > cap ? { want: cap, capped: true } : { want, capped: false };
}
