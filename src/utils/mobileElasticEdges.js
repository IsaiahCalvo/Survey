// Phone edge "rubber band" + zoom-limit overshoot (owner 2026-10-02, Drawboard
// PDF iPhone parity). Pure math only — PdfjsViewerContainer owns the DOM.
//
// UX intent: at a document edge, or past the min/max zoom, the page is allowed
// to go a little further under the fingers with growing resistance, and eases
// back after release. Nothing ever jumps. Numbers were measured frame-by-frame
// from the owner's 60fps screen recording of Drawboard PDF on an iPhone
// (scratchpad/edgeBounce, 2026-10-02):
//   - edge pull release: page edge returns like a critically damped spring
//     from rest, omega ~11-14 rad/s (312pt -> 37% at 200ms, 7% at 400ms,
//     1% at 600ms, no bounce-past). We use omega 13.
//   - zoom past max: readout 3005% climbed to 5325% (x1.77) ever slower and
//     flattened there — two separate pinches both levelled off at ~5300%, so
//     the ceiling is real and is approached quickly (x1.49 within 100 ms,
//     x1.70 by 300 ms); past min: 28% fell to 12% (x0.43). A tanh curve in
//     log-zoom fits that fast levelling; the iOS edge curve below never gets
//     near its ceiling. On release the view eased back in ~250 ms with an
//     ease-in-out curve (sine shape).
//   - resistance while dragging: the iOS UIScrollView rubber band
//     offset = (1 - 1 / (x * 0.55 / d + 1)) * d (the finger itself is not
//     visible in the recording, so this curve is iOS's, not a guess).
// Desktop never calls into this module.

export const ELASTIC_RUBBER_COEFFICIENT = 0.55;
// Zoom overshoot ceilings, in log-scale units (asymptotes of the rubber curve).
export const ELASTIC_ZOOM_OVER_MAX = Math.log(1.8);
export const ELASTIC_ZOOM_UNDER_MIN = Math.log(1 / 0.43);
export const ELASTIC_SPRING_OMEGA = 13;
export const ELASTIC_ZOOM_EASE_MS = 250;
// Momentum into an edge: cap the bounce so a hard flick never throws the page
// more than this share of the viewport past the edge.
export const ELASTIC_MAX_BOUNCE_FRACTION = 0.3;

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** iOS rubber band: how far the page moves for `excess` px of finger travel past an edge. */
export function rubberBand(excess, dimension, coefficient = ELASTIC_RUBBER_COEFFICIENT) {
  const x = finite(excess);
  const d = Math.max(1e-6, finite(dimension, 1));
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  return sign * (1 - 1 / ((ax * coefficient) / d + 1)) * d;
}

/** Inverse of rubberBand: the finger excess that produces a shown offset. */
export function inverseRubberBand(offset, dimension, coefficient = ELASTIC_RUBBER_COEFFICIENT) {
  const y = finite(offset);
  const d = Math.max(1e-6, finite(dimension, 1));
  if (y === 0) return 0;
  const sign = y < 0 ? -1 : 1;
  const ay = Math.min(Math.abs(y), d * 0.999);
  return sign * ((d / coefficient) * (1 / (1 - ay / d) - 1));
}

/** Clamp `value` into [min, max], letting what is past either end through with resistance. */
export function rubberClamp(value, min, max, dimension, coefficient = ELASTIC_RUBBER_COEFFICIENT) {
  const v = finite(value);
  const lo = finite(min);
  const hi = Math.max(lo, finite(max, lo));
  if (v < lo) return lo + rubberBand(v - lo, dimension, coefficient);
  if (v > hi) return hi + rubberBand(v - hi, dimension, coefficient);
  return v;
}

/** Saturating resistance: slope `coefficient` at the limit, levelling off at `ceiling`. */
function saturate(excess, ceiling, coefficient) {
  return ceiling * Math.tanh((excess * coefficient) / ceiling);
}

/**
 * Zoom with resistance past [minScale, maxScale] (log space, Drawboard-measured
 * ceilings x1.8 / x0.43). A 2x finger spread past the max shows x1.40, 3x
 * shows x1.57, 5x shows x1.70.
 */
export function rubberScale(requestedScale, minScale, maxScale, {
  coefficient = ELASTIC_RUBBER_COEFFICIENT,
  overMax = ELASTIC_ZOOM_OVER_MAX,
  underMin = ELASTIC_ZOOM_UNDER_MIN,
} = {}) {
  const s = finite(requestedScale, 1);
  const lo = Math.max(1e-6, finite(minScale, 1e-6));
  const hi = Math.max(lo, finite(maxScale, lo));
  if (s > hi) return hi * Math.exp(saturate(Math.log(s / hi), overMax, coefficient));
  if (s < lo && s > 0) return lo * Math.exp(saturate(Math.log(s / lo), underMin, coefficient));
  if (s <= 0) return lo * Math.exp(-underMin);
  return s;
}

/**
 * Critically damped spring toward 0 (no bounce-past): position and velocity
 * after `t` seconds from offset x0 moving at v0 (units / s).
 */
export function criticallyDampedSpring(x0, v0, t, omega = ELASTIC_SPRING_OMEGA) {
  const x = finite(x0);
  const v = finite(v0);
  const time = Math.max(0, finite(t));
  const e = Math.exp(-omega * time);
  const b = v + omega * x;
  return {
    x: (x + b * time) * e,
    v: (b - omega * (x + b * time)) * e,
  };
}

/** Sine ease-in-out on [0, 1] — the curve Drawboard's zoom-limit return follows. */
export function easeInOutSine(u) {
  const p = Math.min(1, Math.max(0, finite(u)));
  return 0.5 - 0.5 * Math.cos(Math.PI * p);
}

/** Bounce from momentum hitting an edge: initial velocity capped to a fraction of the viewport. */
export function capBounceVelocity(velocity, dimension, omega = ELASTIC_SPRING_OMEGA) {
  const v = finite(velocity);
  // Peak of x(t) = v t e^(-wt) is v / (w e).
  const maxV = Math.max(0, finite(dimension)) * ELASTIC_MAX_BOUNCE_FRACTION * omega * Math.E;
  return Math.max(-maxV, Math.min(maxV, v));
}

export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
