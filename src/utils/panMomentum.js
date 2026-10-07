// Shared pan momentum ("flick") physics for every pointer surface.
//
// UX intent: releasing a pan drag while the pointer is still moving keeps the
// page gliding and coasting to rest. ONE set of numbers drives the phone
// finger flick and the desktop Pan-tool / Space mouse drag, so the two can
// never drift apart (owner 2026-10-07: "It all has the same flick").
//
// Reference: Drawboard PDF's own pan, measured frame by frame with identical
// scripted drags (owner 2026-10-07, "dial it in" against Drawboard):
//  - the glide decays exponentially at the iOS rate (0.998 per ms, a ~500 ms
//    time constant) and stops below ~0.09 px/ms;
//  - only the LAST moments of the drag count. A finger that slows to a stop
//    before lifting, a slow careful drag (under 0.3 px/ms) or a finger that
//    rests before lifting does not glide. The old tracker took the fastest of
//    three estimates, one of them the whole-drag average, so all of those
//    threw the page (the "too aggressive" flick);
//  - a fast flick is carried further than the finger moved (x1 up to
//    0.7 px/ms, rising to ~x2.8 at 4 px/ms).
//
// Nothing here touches zoom: the runner only writes scrollLeft/scrollTop
// through a caller-supplied `scrollBy`, so the pdf.js scale lifecycle and the
// zoomGeneration signal contract are untouched.

// iOS UIScrollView's normal deceleration keeps 0.998 of the speed per ms: an
// exponential time constant of -1 / ln(0.998) = 499.5 ms.
export const IOS_DECELERATION_RATE = 0.998;
export const IOS_DECELERATION_TAU_MS = -1 / Math.log(IOS_DECELERATION_RATE);

export const PAN_MOMENTUM_DEFAULTS = Object.freeze({
  // Exponential friction time constant. Device-rate independent: the same
  // glide at 60 Hz and 120 Hz.
  decayTauMs: IOS_DECELERATION_TAU_MS,
  // Release speeds are pointer speeds in px per millisecond. Below this a
  // release is a careful placement, not a flick (Drawboard: a 0.2 px/ms drag
  // never glides, 0.3 px/ms only sometimes).
  minStartSpeed: 0.3,
  // The glide ends once it is slower than this (Drawboard: ~0.09 px/ms).
  minRestSpeed: 0.09,
  // Frame delta clamp. Frames up to 500 ms advance the glide by their real
  // length: WebKit drops frames while it paints pages, and a short cap played
  // the glide in slow motion there. glideDistance() is the exact integral, so
  // even a long frame never moves further than the rest of the glide.
  minFrameMs: 1,
  maxFrameMs: 500,
  // The first glide frame moves at least one 60 Hz frame's worth. The release
  // event can land a moment before the next frame; timing the first step from
  // it made that frame move almost nothing - a one-frame stop right as the
  // finger let go (owner 2026-10-07, "this reset that happens").
  minFirstFrameMs: 1000 / 60,
  // Release velocity = travel over this trailing window of moves, ending at
  // the last move. Short on purpose: the speed at the moment of letting go,
  // not an average of the drag.
  velocityWindowMs: 50,
  // A lift this soon after the last move still flicks at full speed (a finger
  // or a mouse button always comes up a frame or two after the last move).
  releaseGraceMs: 60,
  // A pointer parked this long before release is a hold, not a flick: no
  // glide. Pauses between the grace and this taper continuously.
  releaseIdleMs: 140,
  // Fast flicks are carried further (Drawboard): above the knee the launch
  // speed is speed x (speed / knee) ^ power, never more than the max.
  flickBoostKnee: 0.7,
  flickBoostPower: 0.6,
  flickMaxSpeed: 12,
  // A scroll write that moves the surface less than this hit a bound.
  stallEpsilonPx: 0.1,
  // Between two coast frames the scroll offset may only have moved by the
  // amount the runner itself wrote. Anything larger is somebody ELSE writing
  // scroll (page nav, a scrollbar thumb drag, a search hit, a fit change), and
  // the coast must yield to it instead of dragging the page back off target.
  externalScrollEpsilonPx: 1.5,
});

// Pages on screen that show a softer bitmap sharpen DURING a glide once it
// has slowed under this speed (px/ms; 0.25 = 4 px a frame at 60 Hz), the way
// iOS does, instead of only after it has fully stopped. Faster than this a
// page redraw would cost visible frames of the glide.
export const GLIDE_SHARPEN_SPEED = 0.25;

/** True when a glide moving at (vx, vy) px/ms is slow enough to sharpen pages. */
export function isGlideSlowEnoughToSharpen(vx, vy, threshold = GLIDE_SHARPEN_SPEED) {
  const speed = Math.hypot(Number(vx) || 0, Number(vy) || 0);
  return speed < threshold;
}

function withDefaults(config) {
  return config === PAN_MOMENTUM_DEFAULTS || !config
    ? PAN_MOMENTUM_DEFAULTS
    : { ...PAN_MOMENTUM_DEFAULTS, ...config };
}

/**
 * When an input event happened, on the performance.now() clock. Velocity is
 * measured on the times the hand moved, not on when a busy main thread got
 * round to the handler: two queued moves handled 1 ms apart would otherwise
 * read as a far faster finger. Falls back to `now` for a missing, epoch-based
 * or future stamp.
 */
export function panEventTime(event, now = performance.now()) {
  const t = Number(event?.timeStamp);
  if (!Number.isFinite(t) || t <= 0 || t > now + 1 || now - t > 1000) return now;
  return t;
}

/** Exponential friction factor applied to velocity over `dtMs`. */
export function decayFactor(dtMs, tauMs = PAN_MOMENTUM_DEFAULTS.decayTauMs) {
  const dt = Number.isFinite(dtMs) ? dtMs : 0;
  const tau = Number.isFinite(tauMs) && tauMs > 0 ? tauMs : PAN_MOMENTUM_DEFAULTS.decayTauMs;
  return Math.exp(-dt / tau);
}

/**
 * Distance a glide at `speed` px/ms travels in `dtMs` under exponential
 * friction (the exact integral, so the path does not depend on frame rate).
 */
export function glideDistance(speed, dtMs, tauMs = PAN_MOMENTUM_DEFAULTS.decayTauMs) {
  const v = Number(speed) || 0;
  const dt = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;
  const tau = Number.isFinite(tauMs) && tauMs > 0 ? tauMs : PAN_MOMENTUM_DEFAULTS.decayTauMs;
  return v * tau * (1 - Math.exp(-dt / tau));
}

/** Clamp a frame delta into the runner's safe integration window. */
export function clampFrameDelta(dtMs, config) {
  const cfg = withDefaults(config);
  const dt = Number(dtMs);
  if (!Number.isFinite(dt)) return cfg.minFrameMs;
  return Math.min(cfg.maxFrameMs, Math.max(cfg.minFrameMs, dt));
}

/**
 * How much of the tracked velocity survives a pointer that sat still for
 * `idleMs` after its last move before lifting. Full speed through the grace
 * period, then continuous - never binary - down to zero at `releaseIdleMs`:
 *  - exponential friction on the SAME time constant as the coast: the page
 *    would already have been slowing down during those milliseconds;
 *  - a linear intent ramp: the longer a finger sits still, the more the
 *    gesture is a hold and the less it is a flick.
 */
export function releaseIdleScale(idleMs, config) {
  const cfg = withDefaults(config);
  const idle = Number(idleMs);
  if (!Number.isFinite(idle) || idle <= cfg.releaseGraceMs) return 1;
  if (idle >= cfg.releaseIdleMs) return 0;
  const over = idle - cfg.releaseGraceMs;
  return decayFactor(over, cfg.decayTauMs) * (1 - (over / (cfg.releaseIdleMs - cfg.releaseGraceMs)));
}

/**
 * The speed a glide launches with after a release at `speed` px/ms: the same
 * up to the knee, carried further above it (Drawboard), capped.
 */
export function flickLaunchSpeed(speed, config) {
  const cfg = withDefaults(config);
  const v = Math.abs(Number(speed) || 0);
  if (v <= cfg.flickBoostKnee) return v;
  return Math.min(cfg.flickMaxSpeed, v * (v / cfg.flickBoostKnee) ** cfg.flickBoostPower);
}

/** True when a release is fast enough to be treated as a flick. */
export function shouldStartPanMomentum(vx, vy, config) {
  const cfg = withDefaults(config);
  const x = Number(vx) || 0;
  const y = Number(vy) || 0;
  return Math.hypot(x, y) >= cfg.minStartSpeed;
}

/** True once the coast has decayed below the perceptible floor. */
export function isPanMomentumAtRest(vx, vy, config) {
  const cfg = withDefaults(config);
  const x = Number(vx) || 0;
  const y = Number(vy) || 0;
  return Math.hypot(x, y) < cfg.minRestSpeed;
}

/** Clamp a scroll offset into [0, max]. */
export function clampScrollTarget(value, max) {
  const limit = Number.isFinite(max) ? Math.max(0, max) : 0;
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.min(limit, Math.max(0, next));
}

/**
 * Samples pointer motion and turns a release into a launch velocity.
 * Velocities are in the POINTER's direction (px/ms); scrolling travels the
 * opposite way, which the runner handles. Times are event times
 * (panEventTime), so a busy main thread does not distort the speed.
 */
export function createPanVelocityTracker(config) {
  const cfg = withDefaults(config);
  let state = null;

  const reset = () => { state = null; };

  return {
    get active() { return Boolean(state); },
    reset,
    start(x, y, at) {
      state = { lastX: x, lastY: y, lastTime: at, samples: [{ x, y, at }] };
    },
    move(x, y, at) {
      if (!state) return { dx: 0, dy: 0 };
      const dx = x - state.lastX;
      const dy = y - state.lastY;
      const { samples } = state;
      samples.push({ x, y, at });
      // Keep the window plus the one sample just before it (its anchor).
      let drop = 0;
      while (drop < samples.length - 2 && samples[drop + 1].at <= at - cfg.velocityWindowMs) drop += 1;
      if (drop) samples.splice(0, drop);
      state.lastX = x;
      state.lastY = y;
      state.lastTime = at;
      return { dx, dy };
    },
    /**
     * Consume the gesture and return the glide's launch velocity in px/ms:
     * the pointer's speed over its last `velocityWindowMs` of movement,
     * faded by a rest before lifting (releaseIdleScale) and carried further
     * for a fast flick (flickLaunchSpeed). Zero when it is not a flick.
     */
    release(at) {
      if (!state) return { vx: 0, vy: 0 };
      const gesture = state;
      reset();
      const idleScale = releaseIdleScale(at - gesture.lastTime, cfg);
      if (idleScale <= 0) return { vx: 0, vy: 0 };
      const { samples } = gesture;
      const last = samples[samples.length - 1];
      // Where the pointer was `velocityWindowMs` before its last move,
      // interpolated between the samples around that moment. A sparse
      // (coalesced) final move spans its whole segment instead.
      const from = last.at - cfg.velocityWindowMs;
      let anchor = samples[0];
      for (let i = samples.length - 2; i >= 0; i -= 1) {
        const a = samples[i];
        if (a.at > from) continue;
        const b = samples[i + 1];
        const span = b.at - a.at;
        const k = span > 0 ? Math.min(1, (from - a.at) / span) : 1;
        anchor = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, at: a.at + span * k };
        break;
      }
      const dt = last.at - anchor.at;
      if (!(dt > 0)) return { vx: 0, vy: 0 };
      const vx = ((last.x - anchor.x) / dt) * idleScale;
      const vy = ((last.y - anchor.y) / dt) * idleScale;
      if (!shouldStartPanMomentum(vx, vy, cfg)) return { vx: 0, vy: 0 };
      const speed = Math.hypot(vx, vy);
      const boost = flickLaunchSpeed(speed, cfg) / speed;
      return { vx: vx * boost, vy: vy * boost };
    },
  };
}

/**
 * Drives the coast. The caller owns all DOM access:
 *  - getScroll()      -> { left, top } current offsets
 *  - scrollBy(dx, dy) -> apply a delta (and any app-specific clamping)
 * Bounds are respected implicitly: when a write cannot move the surface the
 * runner zeroes that axis, so a coast into an edge stops instead of banking
 * velocity it can never spend.
 */
export function createPanMomentumRunner({
  getScroll,
  scrollBy,
  onFrame,
  onSettle,
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (handle) => cancelAnimationFrame(handle),
  now = () => performance.now(),
  config,
} = {}) {
  const cfg = withDefaults(config);
  let handle = 0;
  let vx = 0;
  let vy = 0;
  let last = 0;
  let firstTick = false;
  // Where the surface stood after the runner's own last write. Used to notice
  // that somebody else moved the scroller between frames.
  let written = null;

  const stop = (reason) => {
    if (handle) cancelFrame(handle);
    handle = 0;
    vx = 0;
    vy = 0;
    written = null;
    onSettle?.(reason);
  };

  const tick = (frameTime) => {
    handle = 0;
    const raw = (Number(frameTime) || now()) - last;
    const dt = clampFrameDelta(firstTick ? Math.max(raw, cfg.minFirstFrameMs) : raw, cfg);
    firstTick = false;
    last = Number(frameTime) || now();
    const before = getScroll();
    // A programmatic jump (page nav, thumbnail, bookmark, search hit, a
    // scrollbar thumb drag, a fit change) owns the surface: the coast yields on
    // the very next frame so it can never drag the page back off that target.
    if (written
      && (Math.abs(before.left - written.left) > cfg.externalScrollEpsilonPx
        || Math.abs(before.top - written.top) > cfg.externalScrollEpsilonPx)) {
      stop('external-scroll');
      return;
    }
    scrollBy(-glideDistance(vx, dt, cfg.decayTauMs), -glideDistance(vy, dt, cfg.decayTauMs));
    const after = getScroll();
    written = { left: after.left, top: after.top };
    if (Math.abs(after.left - before.left) < cfg.stallEpsilonPx) vx = 0;
    if (Math.abs(after.top - before.top) < cfg.stallEpsilonPx) vy = 0;
    const decay = decayFactor(dt, cfg.decayTauMs);
    vx *= decay;
    vy *= decay;
    onFrame?.({ left: after.left, top: after.top, vx, vy });
    if (isPanMomentumAtRest(vx, vy, cfg)) {
      stop('settled');
      return;
    }
    handle = requestFrame(tick);
  };

  return {
    isRunning: () => Boolean(handle),
    /**
     * Start a glide at the launch velocity (px/ms, pointer direction).
     * @returns {boolean} true when a coast actually started.
     */
    start(releaseVx, releaseVy) {
      if (handle) cancelFrame(handle);
      handle = 0;
      vx = Number(releaseVx) || 0;
      vy = Number(releaseVy) || 0;
      written = null;
      // A launch that is already at rest is no glide (an elastic release may
      // hand over any speed, so this is the runner's own floor).
      if (isPanMomentumAtRest(vx, vy, cfg)) {
        vx = 0;
        vy = 0;
        return false;
      }
      last = now();
      firstTick = true;
      handle = requestFrame(tick);
      return true;
    },
    /** @returns {boolean} true when a running coast was interrupted. */
    cancel(reason = 'cancelled') {
      if (!handle) return false;
      stop(reason);
      return true;
    },
  };
}
