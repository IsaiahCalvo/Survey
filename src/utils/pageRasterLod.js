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

// ---- page thumbnails: a small bitmap of every page ---------------------------
// Owner 2026-10-07 ("if it's that zoomed out, things maybe don't have to be so
// detailed — maybe a more blurry version ... things need to load quick and
// snappy"). Far out, a page is a few dozen pixels wide, yet drawing it costs
// as much as drawing it full size (a large drawing: ~0.3-0.5 s on a slowed
// phone), so zooming out over 36 sheets left them white for many seconds.
// Each page keeps one small bitmap (THUMB_LONG_SIDE device pixels on its
// longest side): made for free from any sharper draw, or drawn ahead in idle
// time, nearest pages first. Far out it IS the sharp page (shrunk to size);
// nearer in, and during a fling, it is the soft stand-in shown until the
// sharp draw lands, so a page on screen is never blank.
export const THUMB_LONG_SIDE = 256;

// Raster scale (device px per point) of a page's thumbnail.
export function thumbRasterScale(pageW, pageH, longSide = THUMB_LONG_SIDE) {
  const side = Math.max(Number(pageW) || 0, Number(pageH) || 0);
  return side > 0 ? longSide / side : 0;
}

// Bytes of a page's thumbnail (RGBA).
export function thumbBytes(pageW, pageH, longSide = THUMB_LONG_SIDE) {
  const s = thumbRasterScale(pageW, pageH, longSide);
  return Math.max(1, Math.floor((Number(pageW) || 0) * s)) * Math.max(1, Math.floor((Number(pageH) || 0) * s)) * 4;
}

// The pages to draw thumbnails for, in order: nearest `focus` first (ties go
// to the page after it), skipping `skip(index)`, and only as many as fit in
// `maxBytes` (sizes: [{ w, h }] in points). A document too big for the budget
// gets thumbnails around where the reader is.
export function planThumbPrefetch(sizes, { focus = 0, maxBytes = Infinity, skip = () => false, longSide = THUMB_LONG_SIDE } = {}) {
  const list = Array.isArray(sizes) ? sizes : [];
  const n = list.length;
  const out = [];
  let bytes = 0;
  const f = Math.min(Math.max(0, Math.round(Number(focus) || 0)), Math.max(0, n - 1));
  for (let d = 0; d < n; d += 1) {
    for (const i of d === 0 ? [f] : [f + d, f - d]) {
      if (i < 0 || i >= n) continue;
      const b = thumbBytes(list[i]?.w, list[i]?.h, longSide);
      if (bytes + b > maxBytes) return out;
      bytes += b;
      if (!skip(i)) out.push(i);
    }
  }
  return out;
}
