// Edge "rubber band" + zoom-limit overshoot, shared by the phone (touch) and
// desktop (wheel / trackpad) viewers (owner 2026-10-02, Drawboard PDF iPhone
// parity; desktop added the same day: "I wish the desktop version had the same
// slingshot/spring back effect when scrolling to extents"). Pure math only —
// PdfjsViewerContainer owns the DOM. Renamed from mobileElasticEdges.js.
//
// UX intent: at a document edge, or past the min/max zoom, the page is allowed
// to go a little further under the fingers with growing resistance, and eases
// back after release. Nothing ever jumps. Numbers were measured frame-by-frame
// from the owner's 60fps screen recording of Drawboard PDF on an iPhone
// (scratchpad/edgeBounce, 2026-10-02):
//   - edge pull release: page edge returns like a critically damped spring
//     from rest, omega ~11-14 rad/s (312pt -> 37% at 200ms, 7% at 400ms,
//     1% at 600ms, no bounce-past). We use omega 11, which lands on
//     exactly that: (1 + 11t)e^(-11t) = 35.5% / 6.6% / 1.0% (owner 2026-10-02;
//     it was 13, which left only 27% / 3.4% / 0.4% - firmer than Drawboard).
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
// Desktop uses the same curve, spring and 30% cap through createWheelOverscroll
// below (wheel events have no finger, so the controller decides what is a push,
// a momentum tail or a mouse notch).

export const ELASTIC_RUBBER_COEFFICIENT = 0.55;
// Zoom overshoot ceilings, in log-scale units (asymptotes of the rubber curve).
export const ELASTIC_ZOOM_OVER_MAX = Math.log(1.8);
export const ELASTIC_ZOOM_UNDER_MIN = Math.log(1 / 0.43);
export const ELASTIC_SPRING_OMEGA = 11;
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

// ---- one transform on top of another --------------------------------------
// Owner 2026-10-04 ("it gets stuck sometimes ... it's weird"): a new gesture
// that lands while a zoom-limit ease is still running used to cut the ease off
// (the page snapped up to x1.8 in one frame). Now the ease keeps running ON TOP
// of the new gesture's live transform, like OpenSeadragon / react-spring: the
// new input takes over from what is shown, nothing ever jumps.
//
// Both transforms map the content node's own px: p -> o + t + s (p - o), with
// o the transform-origin. Returns the composite { tx, ty, s } for origin `inner.o`.
export function composeElasticTransform(inner, outer) {
  const s1 = finite(inner?.s, 1);
  const z = finite(outer?.s, 1);
  const ix = finite(inner?.ox); const iy = finite(inner?.oy);
  const ox = finite(outer?.ox); const oy = finite(outer?.oy);
  return {
    s: z * s1,
    tx: finite(outer?.tx) + z * finite(inner?.tx) + (1 - z) * (ox - ix),
    ty: finite(outer?.ty) + z * finite(inner?.ty) + (1 - z) * (oy - iy),
  };
}

/**
 * A pinch ends while the previous zoom-limit ease is still running on top of
 * it (review 9 / robust 10): the leftover to ease home must be EXACTLY the
 * picture the last frame showed, i.e. the same nesting the render draws with
 * composeElasticTransform - not foldElasticLeftover's multiply-and-add, which
 * is only that picture when both pivots are the same point (pivots 150 px
 * apart with 8% of a x1.8 bounce left: a ~12 px jump in the release frame).
 *
 * `pinch` is the pinch's own leftover in the committed layout ({ ax, ay, z,
 * tx, ty }, pivot in the new scroll space). `ease` is the running ease
 * ({ ax, ay, z, tx, ty }, pivot in the scroll space of the layout it was
 * drawn over). The ease is the OUTER transform: it acts on the picture as
 * drawn, so its pivot keeps its place on screen - in the new scroll space it
 * moves by the scroll change (`scrollShiftX/Y` = new scroll - old scroll),
 * never by the zoom ratio.
 */
export function composeReleaseLeftover(pinch, ease, { scrollShiftX = 0, scrollShiftY = 0 } = {}) {
  if (!ease) return pinch;
  const out = composeElasticTransform(
    { ox: pinch.ax, oy: pinch.ay, s: pinch.z, tx: pinch.tx, ty: pinch.ty },
    {
      ox: finite(ease.ax) + finite(scrollShiftX),
      oy: finite(ease.ay) + finite(scrollShiftY),
      s: ease.z,
      tx: ease.tx,
      ty: ease.ty,
    },
  );
  return { ...pinch, z: out.s, tx: out.tx, ty: out.ty };
}

// ---- phone: one finger past an edge ---------------------------------------
/**
 * One step of a one-finger pan that may run past an edge, for one axis, in
 * scroll space. `scroll` is the scroller's offset, `max` its scroll range (0
 * for a page that fits the screen), `excess` the finger travel already past an
 * edge, `delta` the finger's move (screen px, up = negative). Returns the new
 * scroll offset, the new excess (positive = past the far end) and the offset
 * to draw (negative = the page moves up, with the finger).
 *
 * A page that fits (max 0) has no scroll to use, so ALL finger travel is
 * excess: pushing up past the bottom edge always moves the page up, pulling
 * down past the top edge always moves it down - never the other way.
 */
export function resolveElasticPanStep({ scroll = 0, max = 0, excess = 0, delta = 0, dimension = 1 } = {}) {
  const hi = Math.max(0, finite(max));
  // Start from the in-range scroll: only finger travel may build up excess,
  // never a whole-pixel scroll offset sitting a hair past a fractional max.
  const free = Math.min(Math.max(0, finite(scroll)), hi) + finite(excess) - finite(delta);
  const next = Math.min(Math.max(0, free), hi);
  let left = free - next;
  if (Math.abs(left) < 0.01) left = 0;
  return { scroll: next, excess: left, shown: left ? -rubberBand(left, dimension) : 0 };
}

// ---- phone: the viewer changes size under a gesture -----------------------
// Real iPhone (Appetize, iOS 26, 2026-10-06): pushing a page that fits the
// screen past its bottom edge left it sitting ~145 px LOWER, cut off by the
// dock, and it only came back seconds later. A page that fits is centred in
// the scroller, so anything that changes the scroller's height while the
// finger is down (Safari's toolbar collapsing or coming back, the visual
// viewport or safe area settling after the keyboard) moved the centring
// margin by half the change in ONE frame - straight down when the viewer grew,
// against a push up. Now that move is held off while the finger is down (the
// page stays exactly where the finger has it) and glides to the new centre on
// the edge spring after the lift; a change that lands while the page is
// already springing home joins that spring. Nothing jumps, nothing moves
// against the finger.

/**
 * How far a page's resting place moved on screen when the viewer was resized:
 * the change of the fit-centring margin, only when the zoom and the tool-strip
 * room did not change too (those keep the page still on their own).
 */
export function resolveFitCentreShift(prev, next) {
  if (!prev || !next) return 0;
  if (Math.abs(finite(prev.scale, 1) - finite(next.scale, 1)) > 1e-9) return 0;
  if (Math.abs(finite(prev.room) - finite(next.room)) > 0.01) return 0;
  if (Math.abs(finite(prev.height) - finite(next.height)) < 0.5) return 0;
  const shift = finite(next.centerPad) - finite(prev.centerPad);
  return Math.abs(shift) < 0.01 ? 0 : shift;
}

/**
 * The visual offset that hides such a move: absorb(shift) keeps the page where
 * it is on screen; it is held while a finger is down and springs to the new
 * resting place after release(now) (critically damped, ~0.6 s, the edge
 * spring). frame(now) -> { y, active }: what to add to the drawn translate.
 */
export function createLayoutShiftHold({ omega = ELASTIC_SPRING_OMEGA } = {}) {
  const IDLE = { mode: 'idle', y: 0, x0: 0, v0: 0, t0: 0 };
  let s = IDLE;
  const at = (now) => {
    if (s.mode === 'held') return { x: s.y, v: 0 };
    if (s.mode !== 'spring') return { x: 0, v: 0 };
    return criticallyDampedSpring(s.x0, s.v0, Math.max(0, finite(now) - s.t0) / 1000, omega);
  };
  return {
    absorb(shift, now, { held = false } = {}) {
      const d = finite(shift);
      if (!d) return;
      const cur = at(now);
      if (held || s.mode === 'held') s = { mode: 'held', y: cur.x - d, x0: 0, v0: 0, t0: 0 };
      else s = { mode: 'spring', y: 0, x0: cur.x - d, v0: cur.v, t0: finite(now) };
    },
    release(now) {
      if (s.mode === 'held') s = { mode: 'spring', y: 0, x0: s.y, v0: 0, t0: finite(now) };
    },
    frame(now) {
      if (s.mode === 'idle') return { y: 0, active: false };
      const { x, v } = at(now);
      if (s.mode === 'spring'
        && ((Math.abs(x) < 0.2 && Math.abs(v) < 6) || finite(now) - s.t0 > ELASTIC_SPRING_MAX_MS)) {
        s = IDLE;
        return { y: 0, active: false };
      }
      return { y: x, active: true };
    },
    active() { return s.mode !== 'idle'; },
    held() { return s.mode === 'held'; },
    reset() { s = IDLE; },
  };
}

// ---- desktop: wheel / trackpad overscroll ---------------------------------
// A wheel stream has no finger to follow and the browser does not say when the
// fingers lift, so the controller sorts each event (same ideas as
// @use-gesture's wheel engine and iOS UIScrollView, ported, no dependency):
//   - a trackpad push at an edge stretches with the same iOS rubber band as a
//     finger (capped at ELASTIC_MAX_BOUNCE_FRACTION of the view);
//   - the stream "ends" WHEEL_OVERSCROLL_IDLE_MS after its last event (the
//     idle timer, like @use-gesture's 140 ms wheelEnd debounce): a stretch then
//     springs home from rest on the phone's critically damped curve;
//   - the macOS momentum tail after the fingers lift is RELEASE-AND-IGNORE:
//     once the recent deltas (mean of the last 3, so jitter cannot hide the
//     decay) fall under WHEEL_TAIL_DROP of the stream's strongest, the page
//     springs home and the rest of the tail is ignored. It used to need five
//     strictly shrinking deltas in a row; real tails jitter, so the page rode
//     the whole tail (up to ~3 s held past the edge - the "stuck" feel);
//   - a tail that only starts after the idle timer fired (a short gap after
//     the lift) is watched for a few events before it may stretch again:
//     decaying deltas are ignored, steady or growing ones are fingers pushing
//     again and catch the page where it is (never a restart from 0);
//   - a fast stream (a fling's momentum) running into an edge hands its speed
//     to the edge spring, capped like the phone flick;
//   - a mouse notch gives a small smooth bounce (a pulse that starts and ends
//     at rest, so no frame moves more than ~3 px), never a jump.
// Every state has a way home even if a timer or event is lost: frame() springs
// a stretch that has had no input for WHEEL_STRETCH_WATCHDOG_MS, and ends any
// spring after ELASTIC_SPRING_MAX_MS.
export const WHEEL_OVERSCROLL_IDLE_MS = 100;
// Above this speed (px/s) a stream reaching an edge counts as momentum hitting
// it (~10 px per 60 Hz event); slower is a deliberate push.
export const WHEEL_FLING_SPEED = 600;
// A notch shows this share of the rubber band of its overflow (100 px -> ~13 px
// on an 830 px view), as a pulse a·(ωt)²·e^(-ωt) that peaks at t = 2/ω.
export const WHEEL_NOTCH_SHARE = 0.25;
// Recent deltas under this share of the stream's strongest = the fingers have
// lifted and this is the momentum tail.
export const WHEEL_TAIL_DROP = 0.65;
export const WHEEL_STRETCH_WATCHDOG_MS = 400;
export const ELASTIC_SPRING_MAX_MS = 1500;
const NOTCH_PULSE_PEAK = 4 * Math.exp(-2);
const NOTCH_PULSE_LIFE_S = 0.9;
const STREAM_GAP_MS = 120;
const RECENT_EVENTS = 3;
const PROBE_MAX_EVENTS = 6;
const TAIL_MEMORY_MS = 400;
const NONE = Object.freeze({ prevent: false, scrollBy: 0 });

function notchPulse(a, t, omega) {
  if (t <= 0) return { x: 0, v: 0 };
  const u = omega * t;
  const e = Math.exp(-u);
  return { x: a * u * u * e, v: a * omega * (2 * u - u * u) * e };
}

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

/**
 * Two-axis overscroll state for wheel input. Offsets are in scroll space:
 * positive = past the far end (bottom / right), negative = before the start.
 * `wheel(axis, input)` returns { prevent, scrollBy }: prevent is true only when
 * the event was cancelable and the controller used it to pull a stretch back
 * in (scrollBy = what is left to scroll natively after the stretch is gone).
 * The controller is the ONE owner of the wheel overscroll offset; the viewer
 * only draws frame(now).
 */
export function createWheelOverscroll({ omega = ELASTIC_SPRING_OMEGA } = {}) {
  const makeAxis = () => ({
    mode: 'idle', excess: 0, x0: 0, v0: 0, t0: 0, pulses: [], dim: 1,
    lastT: -Infinity, vel: 0, notch: false,
    recent: [], peakMean: 0, ignore: false, floor: 0, growth: 0, probe: null,
    tailUntil: -Infinity, tailFloor: 0,
  });
  let axes = { x: makeAxis(), y: makeAxis() };
  const capOf = (s) => s.dim * ELASTIC_MAX_BOUNCE_FRACTION;
  const springAt = (s, now) => criticallyDampedSpring(s.x0, s.v0, Math.max(0, now - s.t0) / 1000, omega);
  const stateAt = (s, now) => {
    if (s.mode === 'stretch') {
      const shown = Math.min(Math.abs(rubberBand(s.excess, s.dim)), capOf(s));
      return { x: s.excess < 0 ? -shown : shown, v: 0 };
    }
    if (s.mode !== 'spring') return { x: 0, v: 0 };
    const out = springAt(s, now);
    let { x, v } = out;
    for (const p of s.pulses) {
      if (p.t0 === null) continue;
      const q = notchPulse(p.a, (now - p.t0) / 1000, omega);
      x += q.x;
      v += q.v;
    }
    return { x, v };
  };
  // Fold whatever is showing (stretch, spring, pulses) into one spring state.
  const toSpring = (s, now) => {
    const { x, v } = stateAt(s, now);
    s.mode = 'spring'; s.x0 = x; s.v0 = v; s.t0 = now; s.pulses = []; s.excess = 0;
  };
  // Catch the page where it is and keep stretching from there.
  const toStretch = (s, now) => {
    const { x } = stateAt(s, now);
    const shown = Math.sign(x) * Math.min(Math.abs(x), capOf(s) * 0.999);
    s.mode = 'stretch'; s.excess = inverseRubberBand(shown, s.dim); s.pulses = [];
  };
  // Spring home now and ignore the rest of this stream unless it clearly grows.
  const releaseAndIgnore = (s, now, level) => {
    toSpring(s, now);
    s.ignore = true; s.floor = level; s.growth = 0; s.probe = null;
  };

  function wheelAxis(name, { delta = 0, room = 0, dimension = 1, notch = false, cancelable = false, now = 0 } = {}) {
    const s = axes[name];
    const d = finite(delta);
    s.dim = Math.max(1, finite(dimension, 1));
    const dt = now - s.lastT;
    if (!(dt < STREAM_GAP_MS)) {
      // A new stream: whether it is a mouse wheel is decided by its first
      // event. One that starts while the page is still springing home may be
      // the momentum tail of the push that just ended, so it is watched first.
      // A tail that was being ignored stays ignored across a short hiccup in
      // the event stream (a busy main thread can delay events > 120 ms).
      const springing = s.mode === 'spring' && Math.abs(stateAt(s, now).x) > 0.5;
      const tailGoesOn = now < s.tailUntil && !notch;
      s.notch = Boolean(notch);
      s.vel = d * 60;
      s.recent = []; s.peakMean = 0; s.growth = 0;
      s.ignore = tailGoesOn; s.floor = tailGoesOn ? s.tailFloor : 0;
      s.tailUntil = -Infinity;
      s.probe = !tailGoesOn && springing && !s.notch ? [] : null;
    } else {
      s.vel = 0.5 * s.vel + 0.5 * (d / Math.max(4, dt)) * 1000;
    }
    s.lastT = now;
    const dir = Math.sign(d);
    if (!dir) return NONE;
    const abs = Math.abs(d);
    s.recent.push(abs);
    if (s.recent.length > RECENT_EVENTS) s.recent.shift();
    const level = mean(s.recent);
    s.peakMean = Math.max(s.peakMean, level);
    const cur = stateAt(s, now).x;
    const over = Math.abs(cur) > 0.01;
    if (over && Math.sign(cur) !== dir) {
      // Scrolling back in while past the edge: undo the stretch first, like a
      // finger dragging back. If the browser will scroll anyway (event not
      // cancelable), let the edge spring home instead of moving twice.
      s.ignore = false; s.probe = null;
      if (s.mode === 'stretch' && cancelable) {
        const next = s.excess + d;
        if (Math.sign(next) === Math.sign(s.excess)) { s.excess = next; return { prevent: true, scrollBy: 0 }; }
        s.excess = 0; s.mode = 'idle';
        return { prevent: true, scrollBy: next };
      }
      if (s.mode === 'stretch') toSpring(s, now);
      return NONE;
    }
    const overflow = over ? d : (abs > room ? d - dir * Math.max(0, room) : 0);
    if (!overflow) return NONE;
    if (s.notch) {
      if (s.mode !== 'spring') toSpring(s, now);
      const headroom = Math.max(0, 1 - Math.abs(cur) / capOf(s));
      const peak = WHEEL_NOTCH_SHARE * Math.abs(rubberBand(overflow, s.dim)) * headroom;
      s.pulses = s.pulses.filter((p) => p.t0 === null || (now - p.t0) / 1000 < NOTCH_PULSE_LIFE_S);
      // t0 is set by the first frame that draws it: an event that waited in
      // the queue must not start its bounce part-way up (that showed as a step).
      s.pulses.push({ t0: null, a: Math.sign(overflow) * (peak / NOTCH_PULSE_PEAK) });
      return NONE;
    }
    if (s.ignore) {
      // The momentum tail after a bounce or a release: ignored while it
      // decays. Three clearly bigger deltas in a row are fingers pushing again.
      s.floor = Math.min(s.floor, level);
      s.growth = abs > s.floor * 1.5 + 2 ? s.growth + 1 : 0;
      if (s.growth < 3) return NONE;
      s.ignore = false; s.growth = 0; s.peakMean = level;
      toStretch(s, now);
      s.excess += overflow;
      return NONE;
    }
    if (s.probe) {
      s.probe.push(abs);
      const n = s.probe.length;
      if (n < 4) return NONE;
      const first = (s.probe[0] + s.probe[1]) / 2;
      const last = (s.probe[n - 2] + s.probe[n - 1]) / 2;
      if (last < first * 0.9) { releaseAndIgnore(s, now, level); return NONE; }
      if (last <= first * 1.1 && n < PROBE_MAX_EVENTS) return NONE;
      // Steady or growing: fingers pushing again. Catch the page where it is.
      s.probe = null;
    }
    if (s.mode !== 'stretch' && Math.abs(s.vel) > WHEEL_FLING_SPEED && Math.sign(s.vel) === dir) {
      // Momentum hitting the edge: bounce with the stream's speed, capped like
      // the phone flick so the page never travels past 30% of the view.
      toSpring(s, now);
      s.v0 = capBounceVelocity(s.v0 + s.vel, s.dim, omega);
      s.ignore = true; s.floor = level; s.growth = 0;
      return NONE;
    }
    if (s.mode !== 'stretch') toStretch(s, now);
    s.excess += overflow;
    if (s.recent.length >= RECENT_EVENTS && s.peakMean >= 2 && level < s.peakMean * WHEEL_TAIL_DROP) {
      // The deltas have dropped well below the stream's strongest: the fingers
      // lifted and this is the momentum tail. Go home now instead of riding it.
      releaseAndIgnore(s, now, level);
    }
    return NONE;
  }

  // The stream stopped (or the window lost focus, the tab was hidden, a zoom
  // took over): a stretch springs home from rest; a spring keeps going.
  function release(now) {
    for (const s of Object.values(axes)) {
      if (s.mode === 'stretch') { toSpring(s, now); s.v0 = 0; }
      if (s.ignore) { s.tailUntil = s.lastT + TAIL_MEMORY_MS; s.tailFloor = s.floor; }
      s.ignore = false; s.probe = null; s.growth = 0;
      s.lastT = -Infinity;
    }
  }

  return {
    wheel: wheelAxis,
    idle: release,
    release,
    // Offsets to draw at `now`; active is false once both axes are home.
    frame(now) {
      const out = { x: 0, y: 0, active: false };
      for (const name of ['x', 'y']) {
        const s = axes[name];
        if (s.mode === 'idle') continue;
        // Watchdog: a stretch nobody is feeding goes home even if the idle
        // timer was lost.
        if (s.mode === 'stretch' && now - s.lastT > WHEEL_STRETCH_WATCHDOG_MS) { toSpring(s, now); s.v0 = 0; }
        for (const p of s.pulses) if (p.t0 === null) p.t0 = now;
        const { x, v } = stateAt(s, now);
        if (s.mode === 'spring') {
          const pulsesLive = s.pulses.some((p) => (now - p.t0) / 1000 < NOTCH_PULSE_LIFE_S);
          const settled = Math.abs(x) < 0.2 && Math.abs(v) < 6;
          if (!pulsesLive && (settled || now - s.t0 > ELASTIC_SPRING_MAX_MS)) {
            s.mode = 'idle';
            s.pulses = [];
            continue;
          }
        }
        out[name] = x;
        out.active = true;
      }
      return out;
    },
    active() { return axes.x.mode !== 'idle' || axes.y.mode !== 'idle'; },
    reset() { axes = { x: makeAxis(), y: makeAxis() }; },
  };
}
