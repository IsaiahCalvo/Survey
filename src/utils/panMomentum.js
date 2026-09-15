// Shared pan momentum ("flick") physics for every pointer surface.
//
// UX intent: releasing a pan drag while the pointer is still moving keeps the
// page gliding and coasting to rest, exactly like the mobile PDF surface has
// always done. Reference behaviour matched: the iOS/Android touch pan in
// PdfjsViewerContainer (exponential decay, 325ms time constant, EMA + sample
// window + whole-gesture velocity fallback). Desktop mouse/space-drag panning
// now reuses THIS module rather than a second physics implementation, so the
// two surfaces can never drift apart.
//
// Nothing here touches zoom: the runner only writes scrollLeft/scrollTop
// through a caller-supplied `scrollBy`, so the pdf.js scale lifecycle and the
// zoomGeneration signal contract are untouched.

export const PAN_MOMENTUM_DEFAULTS = Object.freeze({
  // Exponential friction time constant. Feel is device-rate independent:
  // the same real-world glide at 60Hz and 120Hz.
  decayTauMs: 325,
  // Release speeds are finger/pointer speeds in px per millisecond.
  // Below minStartSpeed a release is a click/slow drop, not a flick.
  minStartSpeed: 0.08,
  // Coast ends once the residual speed can no longer move a pixel per frame.
  minRestSpeed: 0.015,
  // Frame delta clamp: a backgrounded tab must not teleport the page.
  minFrameMs: 1,
  maxFrameMs: 32,
  // Velocity is sampled from the trailing window of pointer moves only.
  sampleWindowMs: 140,
  // Exponential moving average weight kept from the previous sample.
  emaKeep: 0.7,
  // A scroll write that moves the surface less than this hit a bound.
  stallEpsilonPx: 0.1,
  // A pointer parked for longer than this before release is a hold, not a
  // flick, so it must not glide (this is what keeps a plain click still).
  releaseIdleMs: 140,
});

function withDefaults(config) {
  return config === PAN_MOMENTUM_DEFAULTS || !config
    ? PAN_MOMENTUM_DEFAULTS
    : { ...PAN_MOMENTUM_DEFAULTS, ...config };
}

/** Exponential friction factor applied to velocity over `dtMs`. */
export function decayFactor(dtMs, tauMs = PAN_MOMENTUM_DEFAULTS.decayTauMs) {
  const dt = Number.isFinite(dtMs) ? dtMs : 0;
  const tau = Number.isFinite(tauMs) && tauMs > 0 ? tauMs : PAN_MOMENTUM_DEFAULTS.decayTauMs;
  return Math.exp(-dt / tau);
}

/** Clamp a frame delta into the runner's safe integration window. */
export function clampFrameDelta(dtMs, config) {
  const cfg = withDefaults(config);
  const dt = Number(dtMs);
  if (!Number.isFinite(dt)) return cfg.minFrameMs;
  return Math.min(cfg.maxFrameMs, Math.max(cfg.minFrameMs, dt));
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

/**
 * Pick the largest-magnitude candidate, preserving its sign. Several velocity
 * estimators disagree when the platform coalesces the final move event; the
 * fastest honest estimate is the one that matches what the hand actually did.
 */
export function pickDominantVelocity(candidates) {
  if (!Array.isArray(candidates)) return 0;
  return candidates.reduce((best, candidate) => {
    const value = Number(candidate);
    if (!Number.isFinite(value)) return best;
    return Math.abs(value) > Math.abs(best) ? value : best;
  }, 0);
}

/** Clamp a scroll offset into [0, max]. */
export function clampScrollTarget(value, max) {
  const limit = Number.isFinite(max) ? Math.max(0, max) : 0;
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.min(limit, Math.max(0, next));
}

/**
 * Samples pointer motion and turns a release into a flick velocity.
 * Velocities are in the POINTER's direction (px/ms); scrolling travels the
 * opposite way, which the runner handles.
 */
export function createPanVelocityTracker(config) {
  const cfg = withDefaults(config);
  let state = null;

  const reset = () => { state = null; };

  return {
    get active() { return Boolean(state); },
    reset,
    start(x, y, at) {
      state = {
        startX: x,
        startY: y,
        startTime: at,
        lastX: x,
        lastY: y,
        lastTime: at,
        velocityX: 0,
        velocityY: 0,
        samples: [{ x, y, at }],
      };
    },
    move(x, y, at) {
      if (!state) return { dx: 0, dy: 0 };
      const dx = x - state.lastX;
      const dy = y - state.lastY;
      const dt = Math.max(cfg.minFrameMs, at - state.lastTime);
      const add = 1 - cfg.emaKeep;
      state.velocityX = state.velocityX * cfg.emaKeep + (dx / dt) * add;
      state.velocityY = state.velocityY * cfg.emaKeep + (dy / dt) * add;
      state.samples.push({ x, y, at });
      state.samples = state.samples.filter((sample) => at - sample.at <= cfg.sampleWindowMs);
      state.lastX = x;
      state.lastY = y;
      state.lastTime = at;
      return { dx, dy };
    },
    /** Consume the gesture and return its release velocity in px/ms. */
    release(at) {
      if (!state) return { vx: 0, vy: 0 };
      const gesture = state;
      reset();
      // A pointer that sat still before lifting is a hold or a plain click.
      if (at - gesture.lastTime > cfg.releaseIdleMs) return { vx: 0, vy: 0 };

      const samples = gesture.samples || [];
      const first = samples[0];
      const last = samples[samples.length - 1];
      const sampleDt = Math.max(cfg.minFrameMs, (last?.at || 0) - (first?.at || 0));
      const sampleVx = first && last ? (last.x - first.x) / sampleDt : 0;
      const sampleVy = first && last ? (last.y - first.y) / sampleDt : 0;

      // WebKit (and Chrome under load) may coalesce a fast final move into a
      // single sparse sample. Keep a whole-gesture fallback so a real flick
      // cannot lose momentum merely because the trailing window is sparse.
      const gestureDt = Math.max(cfg.minFrameMs, at - gesture.startTime);
      const gestureVx = (gesture.lastX - gesture.startX) / gestureDt;
      const gestureVy = (gesture.lastY - gesture.startY) / gestureDt;

      return {
        vx: pickDominantVelocity([gesture.velocityX, sampleVx, gestureVx]),
        vy: pickDominantVelocity([gesture.velocityY, sampleVy, gestureVy]),
      };
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

  const stop = (reason) => {
    if (handle) cancelFrame(handle);
    handle = 0;
    vx = 0;
    vy = 0;
    onSettle?.(reason);
  };

  const tick = (frameTime) => {
    handle = 0;
    const dt = clampFrameDelta((Number(frameTime) || now()) - last, cfg);
    last = Number(frameTime) || now();
    const before = getScroll();
    scrollBy(-vx * dt, -vy * dt);
    const after = getScroll();
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
    /** @returns {boolean} true when a coast actually started. */
    start(releaseVx, releaseVy) {
      if (handle) cancelFrame(handle);
      handle = 0;
      vx = Number(releaseVx) || 0;
      vy = Number(releaseVy) || 0;
      if (!shouldStartPanMomentum(vx, vy, cfg)) {
        vx = 0;
        vy = 0;
        return false;
      }
      last = now();
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
