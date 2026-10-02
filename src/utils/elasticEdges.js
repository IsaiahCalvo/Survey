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
// Desktop uses the same curve, spring and 30% cap through createWheelOverscroll
// below (wheel events have no finger, so the controller decides what is a push,
// a momentum tail or a mouse notch).

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

// ---- desktop: wheel / trackpad overscroll ---------------------------------
// A wheel stream has no finger to follow, so the controller sorts each event:
//   - a slow trackpad push at an edge stretches with the same iOS rubber band
//     as a finger (capped at ELASTIC_MAX_BOUNCE_FRACTION of the view);
//   - a fast stream (a fling's momentum) running into an edge hands its speed
//     to the edge spring, capped like the phone flick, and the rest of the
//     decaying momentum tail is ignored;
//   - a stretch whose deltas have started decaying (the macOS momentum tail
//     after the fingers lift) is released at once instead of riding the tail;
//   - a mouse notch gives a small smooth bounce (a pulse that starts and ends
//     at rest, so no frame moves more than ~3 px), never a jump.
// The stream "stops" after WHEEL_OVERSCROLL_IDLE_MS without events; a stretch
// then springs home on the same critically damped curve as the phone.
export const WHEEL_OVERSCROLL_IDLE_MS = 100;
// Above this speed (px/s) a stream reaching an edge counts as momentum hitting
// it (~10 px per 60 Hz event); slower is a deliberate push.
export const WHEEL_FLING_SPEED = 600;
// A notch shows this share of the rubber band of its overflow (100 px -> ~13 px
// on an 830 px view), as a pulse a·(ωt)²·e^(-ωt) that peaks at t = 2/ω.
export const WHEEL_NOTCH_SHARE = 0.25;
const NOTCH_PULSE_PEAK = 4 * Math.exp(-2);
const NOTCH_PULSE_LIFE_S = 0.9;
const STREAM_GAP_MS = 120;

function notchPulse(a, t, omega) {
  if (t <= 0) return { x: 0, v: 0 };
  const u = omega * t;
  const e = Math.exp(-u);
  return { x: a * u * u * e, v: a * omega * (2 * u - u * u) * e };
}

/**
 * Two-axis overscroll state for wheel input. Offsets are in scroll space:
 * positive = past the far end (bottom / right), negative = before the start.
 * `wheel(axis, input)` returns { prevent, scrollBy }: prevent is true only when
 * the event was cancelable and the controller used it to pull a stretch back
 * in (scrollBy = what is left to scroll natively after the stretch is gone).
 */
export function createWheelOverscroll({ omega = ELASTIC_SPRING_OMEGA } = {}) {
  const makeAxis = () => ({
    mode: 'idle', excess: 0, x0: 0, v0: 0, t0: 0, pulses: [],
    tail: false, lastAbs: 0, decayRun: 0, peakAbs: 0, vel: 0, lastT: -Infinity, notch: false, dim: 1,
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

  function wheelAxis(name, { delta = 0, room = 0, dimension = 1, notch = false, cancelable = false, now = 0 } = {}) {
    const s = axes[name];
    const d = finite(delta);
    s.dim = Math.max(1, finite(dimension, 1));
    const dt = now - s.lastT;
    if (!(dt < STREAM_GAP_MS)) {
      // A new stream: whether it is a mouse wheel is decided by its first event.
      s.tail = false; s.decayRun = 0; s.peakAbs = 0; s.lastAbs = 0; s.notch = Boolean(notch);
      s.vel = d * 60;
    } else {
      s.vel = 0.5 * s.vel + 0.5 * (d / Math.max(4, dt)) * 1000;
    }
    s.lastT = now;
    const dir = Math.sign(d);
    if (!dir) return { prevent: false, scrollBy: 0 };
    const cur = stateAt(s, now).x;
    const over = Math.abs(cur) > 0.01;
    if (over && Math.sign(cur) !== dir) {
      // Scrolling back in while past the edge: undo the stretch first, like a
      // finger dragging back. If the browser will scroll anyway (event not
      // cancelable), let the edge spring home instead of moving twice.
      if (s.mode === 'stretch' && cancelable) {
        const next = s.excess + d;
        if (Math.sign(next) === Math.sign(s.excess)) { s.excess = next; return { prevent: true, scrollBy: 0 }; }
        s.excess = 0; s.mode = 'idle';
        return { prevent: true, scrollBy: next };
      }
      if (s.mode === 'stretch') toSpring(s, now);
      s.tail = false;
      return { prevent: false, scrollBy: 0 };
    }
    const overflow = over ? d : (Math.abs(d) > room ? d - dir * Math.max(0, room) : 0);
    if (!overflow) return { prevent: false, scrollBy: 0 };
    const abs = Math.abs(d);
    if (s.notch) {
      if (s.mode !== 'spring') toSpring(s, now);
      const headroom = Math.max(0, 1 - Math.abs(cur) / capOf(s));
      const peak = WHEEL_NOTCH_SHARE * Math.abs(rubberBand(overflow, s.dim)) * headroom;
      s.pulses = s.pulses.filter((p) => p.t0 === null || (now - p.t0) / 1000 < NOTCH_PULSE_LIFE_S);
      // t0 is set by the first frame that draws it: an event that waited in
      // the queue must not start its bounce part-way up (that showed as a step).
      s.pulses.push({ t0: null, a: Math.sign(overflow) * (peak / NOTCH_PULSE_PEAK) });
      return { prevent: false, scrollBy: 0 };
    }
    if (s.tail) {
      // The momentum tail after a bounce or a release: ignore it while it
      // decays; a growing delta means fingers are pushing again.
      if (abs <= s.lastAbs + 0.5) { s.lastAbs = abs; return { prevent: false, scrollBy: 0 }; }
      s.tail = false; s.decayRun = 0; s.peakAbs = 0;
      toStretch(s, now);
    } else if (s.mode !== 'stretch' && Math.abs(s.vel) > WHEEL_FLING_SPEED && Math.sign(s.vel) === dir) {
      // Momentum hitting the edge: bounce with the stream's speed, capped like
      // the phone flick so the page never travels past 30% of the view.
      toSpring(s, now);
      s.v0 = capBounceVelocity(s.v0 + s.vel, s.dim, omega);
      s.tail = true; s.lastAbs = abs;
      return { prevent: false, scrollBy: 0 };
    } else if (s.mode !== 'stretch') {
      toStretch(s, now);
    }
    s.excess += overflow;
    s.decayRun = abs < s.lastAbs - 0.01 ? s.decayRun + 1 : 0;
    s.peakAbs = Math.max(s.peakAbs, abs);
    s.lastAbs = abs;
    if (s.decayRun >= 5 && abs < s.peakAbs * 0.6) {
      // Deltas have shrunk five times running: the fingers lifted and this is
      // the momentum tail. Go home now instead of riding it.
      toSpring(s, now);
      s.tail = true;
    }
    return { prevent: false, scrollBy: 0 };
  }

  return {
    wheel: wheelAxis,
    // The wheel stream stopped: a stretch springs home from rest.
    idle(now) {
      for (const s of Object.values(axes)) {
        if (s.mode === 'stretch') { toSpring(s, now); s.v0 = 0; }
        s.tail = false;
        s.lastT = -Infinity;
      }
    },
    // Offsets to draw at `now`; active is false once both axes are home.
    frame(now) {
      const out = { x: 0, y: 0, active: false };
      for (const name of ['x', 'y']) {
        const s = axes[name];
        if (s.mode === 'idle') continue;
        for (const p of s.pulses) if (p.t0 === null) p.t0 = now;
        const { x, v } = stateAt(s, now);
        if (s.mode === 'spring') {
          const pulsesLive = s.pulses.some((p) => (now - p.t0) / 1000 < NOTCH_PULSE_LIFE_S);
          if (!pulsesLive && Math.abs(x) < 0.2 && Math.abs(v) < 6) {
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
