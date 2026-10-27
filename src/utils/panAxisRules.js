// Which way the page may move when you pan (owner 2026-10-27: "when a page's
// horizontal extents fit within the viewport, panning is restricted to just
// the vertical axis"). Pure math only; PdfjsViewerContainer owns the DOM. The
// full rule set lives in docs/VIEWER-PAN-ZOOM-RULES.md.
//
// Two rules, both read from Drawboard PDF's web bundle and checked live
// (pdf.drawboard.com, 2026-10-27):
//  1. A page that fits sideways does not move sideways: no pan, no stretch, no
//     bounce. Drawboard keeps 100 px of play at fit width (its bounds allow the
//     page edge 100 px past the view); Survey locks as soon as the page fits.
//  2. A drag or touchpad scroll that is almost straight up/down (or across)
//     runs exactly straight ("rails"), with Drawboard's hysteresis: the
//     sideways share must pass a "free" ratio to break off the rail and fall
//     under a "snap" ratio to join one. Travel is a decaying sum (x0.82 per
//     step) so the latest motion counts most.

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

// Drawboard: wheel {snap .4, free .6, minTravel 4}, drag {snap .2, free .3,
// minTravel 2}, decay .82, back to the vertical rail after 80 ms without input.
export const WHEEL_AXIS_SNAP = Object.freeze({ snapRatio: 0.4, freeRatio: 0.6, minTravel: 4 });
export const DRAG_AXIS_SNAP = Object.freeze({ snapRatio: 0.2, freeRatio: 0.3, minTravel: 2 });
export const AXIS_SNAP_DECAY = 0.82;
export const AXIS_SNAP_RESET_MS = 80;

/**
 * Rails for one gesture. step(dx, dy, now) returns the deltas to apply: the
 * off-rail axis is zeroed while the gesture runs along a rail. A gesture
 * starts on the vertical rail (the document's own direction), so a few px of
 * sideways wobble at the start of a scroll never move the page sideways.
 */
export function createAxisSnap(config = DRAG_AXIS_SNAP) {
  const { snapRatio, freeRatio, minTravel } = config;
  let axis = 'vertical';
  let travelX = 0;
  let travelY = 0;
  let lastAt = -Infinity;
  const reset = () => { axis = 'vertical'; travelX = 0; travelY = 0; lastAt = -Infinity; };
  return {
    step(dx, dy, now = 0) {
      const x = finite(dx);
      const y = finite(dy);
      const t = finite(now);
      if (t - lastAt > AXIS_SNAP_RESET_MS) { axis = 'vertical'; travelX = 0; travelY = 0; }
      lastAt = t;
      travelX = travelX * AXIS_SNAP_DECAY + Math.abs(x);
      travelY = travelY * AXIS_SNAP_DECAY + Math.abs(y);
      if (Math.max(travelX, travelY) >= minTravel) {
        if (axis === 'vertical' && travelX > travelY * freeRatio) axis = 'free';
        else if (axis === 'horizontal' && travelY > travelX * freeRatio) axis = 'free';
        if (axis === 'free') {
          if (travelX < travelY * snapRatio) axis = 'vertical';
          else if (travelY < travelX * snapRatio) axis = 'horizontal';
        }
      }
      return {
        dx: axis === 'vertical' ? 0 : x,
        dy: axis === 'horizontal' ? 0 : y,
      };
    },
    /** A release speed along the rail the gesture ended on. */
    release(vx, vy) {
      return {
        vx: axis === 'vertical' ? 0 : finite(vx),
        vy: axis === 'horizontal' ? 0 : finite(vy),
      };
    },
    axis: () => axis,
    reset,
  };
}

/**
 * Where scrollLeft may go from here. `pageLeft` / `pageWidth` are the widest
 * page's left edge and width in the scroller's own screen px (0 = scroller's
 * left edge) at the current scrollLeft; `insetLeft` / `insetRight` the side
 * panels covering the view, `margin` the gap a page keeps from a panel (the
 * page margin, less if the band is too narrow for it). Returns { lo, hi, fits }.
 *
 *  - Wider than the band you can see between the panels: the whole scroll
 *    range, as before (edges spring).
 *  - Fits the band: the page only moves to come fully into view, never away
 *    from it. Fully in view already = locked (lo === hi === scrollLeft). Part
 *    of it under a panel that opened over it (opening a panel never moves the
 *    page) = it can slide out until it clears the panel by the margin, then
 *    stops.
 */
export function resolveHorizontalPanRange({
  scrollLeft = 0, maxLeft = 0, pageLeft = 0, pageWidth = 0, viewportWidth = 0, insetLeft = 0, insetRight = 0, margin = 0,
} = {}) {
  const s = finite(scrollLeft);
  const max = Math.max(0, finite(maxLeft));
  const bandLeft = Math.max(0, finite(insetLeft));
  const bandRight = finite(viewportWidth) - Math.max(0, finite(insetRight));
  const width = Math.max(0, finite(pageWidth));
  if (width > bandRight - bandLeft + 0.5) return { lo: 0, hi: max, fits: false };
  const gap = Math.min(Math.max(0, finite(margin)), Math.max(0, (bandRight - bandLeft - width) / 2));
  const left = finite(pageLeft);
  // Scrolling by d moves the page by -d; fully in view for d in [need, room].
  const need = left + width - (bandRight - gap);
  const room = left - (bandLeft + gap);
  const d = Math.min(Math.max(0, need), Math.max(need, room));
  const lo = Math.min(Math.max(0, s + Math.min(0, d)), max);
  const hi = Math.min(Math.max(0, s + Math.max(0, d)), max);
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), fits: true };
}

/** A sideways scroll of `delta` px from `scrollLeft`, kept inside the range. */
export function limitHorizontalDelta(delta, scrollLeft, range) {
  const d = finite(delta);
  if (!range?.fits) return d;
  const s = finite(scrollLeft);
  return Math.min(Math.max(s + d, Math.min(range.lo, s)), Math.max(range.hi, s)) - s;
}
