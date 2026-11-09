/**
 * viewerFlyTo.js — the smooth move to a search hit or a Survey Marker
 * (owner 2026-11-09).
 *
 * Owner: "when I click on different line items, it's just snapping to that
 * line item, but I want it to be an animation. If it's on different pages, it
 * should scroll to it ... When you find a survey, it zooms into it, but it
 * should animate to that. It should pan and zoom to it."
 *
 * Pure maths, no DOM. The viewer (PdfjsViewerContainer.focusPageRect with
 * `animate`) moves in up to two steps:
 *
 *   1. Scroll (only when the target is not on screen): the page scrolls at the
 *      zoom you are at until the target sits in the middle of the view, on the
 *      same jump-then-glide move a page jump uses (pageScrollGlide.js), so a
 *      hit 30 pages away still reads as "scrolled down to it".
 *   2. Fly (pan + zoom at once): the target slides to the middle of the part of
 *      the viewer you can see while the page grows (or shrinks) around it. It
 *      is drawn with the cheap live-zoom transform a pinch uses and re-renders
 *      once, when it lands. No zoom change → a plain scroll glide instead.
 *
 * Reduced motion (the system setting) skips both: it lands at once.
 */

import { easeOutCubic } from './zoomGlide.js';

// The scroll step: a little longer than a Next page press (250 ms) so a long
// way reads as scrolling rather than a cut.
export const FLY_SCROLL_MS = 320;
// The fly step grows with how far it zooms and pans, inside these limits.
export const FLY_MIN_MS = 320;
export const FLY_MAX_MS = 520;
// Extra length per doubling (or halving) of the zoom, and per screen panned.
const FLY_MS_PER_ZOOM_DOUBLING = 70;
const FLY_MS_PER_SCREEN = 120;

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Is a point (scroller-local CSS px) inside the part of the viewer you can
 * see? `band` = { left, top, width, height }. A target that is on screen flies
 * straight there; one that is not scrolls first.
 */
export function isPointInBand(x, y, band) {
  if (!band) return false;
  const left = finite(band.left);
  const top = finite(band.top);
  return finite(x, NaN) >= left
    && finite(x, NaN) <= left + finite(band.width)
    && finite(y, NaN) >= top
    && finite(y, NaN) <= top + finite(band.height);
}

/** How long the fly step takes, in ms. */
export function flyDurationMs({ fromScale, toScale, panPx = 0, screenPx = 800 } = {}) {
  const from = Math.max(1e-4, finite(fromScale, 1));
  const to = Math.max(1e-4, finite(toScale, from));
  const doublings = Math.abs(Math.log2(to / from));
  const screens = Math.abs(finite(panPx)) / Math.max(1, finite(screenPx, 800));
  const ms = FLY_MIN_MS + doublings * FLY_MS_PER_ZOOM_DOUBLING + screens * FLY_MS_PER_SCREEN;
  return Math.round(Math.min(FLY_MAX_MS, Math.max(FLY_MIN_MS, ms)));
}

/**
 * Where the target is drawn at time `now` during the fly step (scroller-local
 * CSS px). `pan` = { fromX, fromY, toX, toY, t0, durationMs }. It eases out on
 * the same curve the zoom does, so the slide and the growth start together,
 * slow together and land together.
 */
export function flyPanAt(pan, now) {
  if (!pan) return null;
  const duration = Math.max(1, finite(pan.durationMs, FLY_MIN_MS));
  const u = Math.min(1, Math.max(0, (finite(now) - finite(pan.t0)) / duration));
  const e = easeOutCubic(u);
  return {
    x: finite(pan.fromX) + (finite(pan.toX) - finite(pan.fromX)) * e,
    y: finite(pan.fromY) + (finite(pan.toY) - finite(pan.fromY)) * e,
    done: u >= 1,
  };
}
