/**
 * zoomGlide.js — the smooth zoom glide (owner 2026-10-07, Drawboard parity:
 * "you can see it grow into it and shrink out of it ... as if you're actually
 * moving closer and far away from it").
 *
 * Pure math, no DOM. The viewer (PdfjsViewerContainer) keeps one glide object
 * while a zoom button / Ctrl+plus/minus press or a mouse-wheel notch is
 * playing out, steps it once per animation frame, and shows the result with
 * the cheap live-zoom transform; the real re-render happens once, at the end.
 *
 * Two ways to move toward the target, both in log-scale space so 100% -> 200%
 * feels the same as 200% -> 400%, and both monotonic (never overshoot):
 *
 * - 'tween'  (buttons / keys): ease-out over ZOOM_GLIDE_MS. A second press
 *   during the glide starts a new ease FROM WHAT IS SHOWN and at the speed it
 *   is moving, toward the new target, so repeated presses run together as one
 *   continuous glide with no jump and no jolt.
 * - 'chase'  (mouse-wheel notches): each notch moves the target; what is shown
 *   closes a fixed share of the remaining gap every frame (exponential
 *   approach, time constant ZOOM_CHASE_TAU_MS), frame-rate independent.
 */

export const ZOOM_GLIDE_MS = 220;
export const ZOOM_CHASE_TAU_MS = 50;
// A chase this close to its target (0.15% of the scale, about 1 px on a page
// 700 px wide) is finished: it lands on the target exactly.
export const ZOOM_GLIDE_DONE_LOG = 1.5e-3;
// The first frame after a press always moves (an rAF time stamp can be a
// little earlier than the press that scheduled it).
const MIN_STEP_MS = 1000 / 120;
// A stalled frame does not make the chase leap the whole gap at once.
const MAX_CHASE_STEP_MS = 64;

export function easeOutCubic(u) {
  const t = Math.min(1, Math.max(0, Number(u) || 0));
  return 1 - (1 - t) ** 3;
}

const positive = (value, fallback = 1) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// The tween is a cubic Hermite curve in log scale: it leaves `from` with
// slope `slope` (log units per whole glide) and arrives at `target` at rest.
// slope = 3 * gap is exactly easeOutCubic; any slope between 0 and 3 * gap
// keeps it monotonic, so a retarget may start at the speed already shown.
function hermite(gap, slope, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return gap * (3 * u2 - 2 * u3) + slope * (u3 - 2 * u2 + u);
}

function hermiteSlope(gap, slope, u) {
  return gap * (6 * u - 6 * u * u) + slope * (3 * u * u - 4 * u + 1);
}

/** A new glide from the scale on screen (`from`) toward `to`. */
export function createZoomGlide({ from, to, now = 0, mode = 'tween' } = {}) {
  const start = positive(from);
  const target = positive(to, start);
  return {
    mode: mode === 'chase' ? 'chase' : 'tween',
    from: start,
    shown: start,
    target,
    // Fresh tween: a plain ease-out (fastest at the start).
    slope: 3 * Math.log(target / start),
    // How fast the shown scale is changing now, in log units per ms.
    velocity: 0,
    t0: Number(now) || 0,
    lastT: Number(now) || 0,
    done: false,
  };
}

/**
 * Point a running glide at a new target. It carries on from what is shown
 * right now (never from where it started), so nothing jumps; a tween also
 * keeps the speed it is moving at (capped so it never overshoots), so a quick
 * second press feels like the same glide going further.
 */
export function retargetZoomGlide(glide, { to, now = 0, mode } = {}) {
  if (!glide) return createZoomGlide({ from: to, to, now, mode });
  const nextMode = mode === 'chase' || mode === 'tween' ? mode : glide.mode;
  const t = Number(now) || 0;
  const from = positive(glide.shown);
  const target = positive(to, from);
  const gap = Math.log(target / from);
  let slope = 0;
  if (nextMode === 'tween' && gap !== 0) {
    const carried = (glide.done ? 0 : Number(glide.velocity) || 0) * ZOOM_GLIDE_MS;
    // Keep the speed already shown, but at least half a fresh press's push
    // (a glide that had nearly stopped still answers the press at once) and
    // at most a fresh ease-out's start (3 * gap), which keeps it monotonic.
    const low = Math.min(1.5 * gap, 3 * gap);
    const high = Math.max(1.5 * gap, 3 * gap);
    slope = Math.min(high, Math.max(low, carried));
  }
  return {
    ...glide,
    mode: nextMode,
    from,
    target,
    slope,
    t0: t,
    // A chase that keeps chasing keeps its frame clock; anything else starts now.
    lastT: nextMode === 'chase' && glide.mode === 'chase' && !glide.done ? glide.lastT : t,
    done: false,
  };
}

/** Advance the glide to time `now` (ms). Returns a new glide object. */
export function stepZoomGlide(glide, now) {
  if (!glide) return null;
  const t = Number(now) || 0;
  const target = positive(glide.target);
  if (glide.done) return { ...glide, shown: target, velocity: 0, lastT: t };
  let shown;
  let done;
  let velocity;
  if (glide.mode === 'chase') {
    const dt = Math.min(MAX_CHASE_STEP_MS, Math.max(MIN_STEP_MS, t - glide.lastT));
    const k = 1 - Math.exp(-dt / ZOOM_CHASE_TAU_MS);
    const gap = Math.log(target / positive(glide.shown));
    const left = gap * (1 - k);
    done = Math.abs(left) < ZOOM_GLIDE_DONE_LOG;
    shown = done ? target : target * Math.exp(-left);
    velocity = done ? 0 : left / ZOOM_CHASE_TAU_MS;
  } else {
    const elapsed = Math.max(MIN_STEP_MS, t - glide.t0);
    const u = Math.min(1, elapsed / ZOOM_GLIDE_MS);
    done = u >= 1;
    const from = positive(glide.from);
    const gap = Math.log(target / from);
    const slope = Number.isFinite(glide.slope) ? glide.slope : 3 * gap;
    shown = done ? target : from * Math.exp(hermite(gap, slope, u));
    velocity = done ? 0 : hermiteSlope(gap, slope, u) / ZOOM_GLIDE_MS;
  }
  return { ...glide, shown, velocity, lastT: t, done };
}
