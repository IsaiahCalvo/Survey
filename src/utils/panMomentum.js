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
  // The first glide frame moves at least one 60 Hz frame's worth. The release
  // event can land a moment before the next frame; timing the first step from
  // it made that frame move almost nothing - a one-frame stop right as the
  // finger let go (owner 2026-10-07, "this reset that happens").
  minFirstFrameMs: 1000 / 60,
  // Velocity is sampled from the trailing window of pointer moves only.
  sampleWindowMs: 140,
  // Exponential moving average weight kept from the previous sample.
  emaKeep: 0.7,
  // A scroll write that moves the surface less than this hit a bound.
  stallEpsilonPx: 0.1,
  // A pointer parked for this long before release is a pure hold, not a flick,
  // so it must not glide at all (this is what keeps a plain click still).
  // Shorter pauses taper continuously toward it - see releaseIdleScale().
  releaseIdleMs: 140,
  // Between two coast frames the scroll offset may only have moved by the
  // amount the runner itself wrote. Anything larger is somebody ELSE writing
  // scroll (page nav, a scrollbar thumb drag, a search hit, a fit change), and
  // the coast must yield to it instead of dragging the page back off target.
  externalScrollEpsilonPx: 1.5,
});

// Phone finger flicks (owner 2026-10-07: "glide like native iOS"). iOS
// UIScrollView's normal deceleration keeps 0.998 of the speed per ms, an
// exponential time constant of -1 / ln(0.998) = 499.5 ms. The glide is called
// over once it moves less than ~1 px a frame (0.06 px/ms), so a gentle flick
// glides ~0.5 s and a hard one ~2 s. Frames up to 500 ms advance the glide by
// their real length: WebKit drops frames while it paints pages, and the old
// 32 ms cap played the glide in slow motion there (a 1.6 s glide took 11 s in
// headless WebKit). The desktop pointer glide keeps PAN_MOMENTUM_DEFAULTS.
export const IOS_DECELERATION_RATE = 0.998;
export const IOS_DECELERATION_TAU_MS = -1 / Math.log(IOS_DECELERATION_RATE);
export const TOUCH_PAN_MOMENTUM = Object.freeze({
  ...PAN_MOMENTUM_DEFAULTS,
  decayTauMs: IOS_DECELERATION_TAU_MS,
  minRestSpeed: 0.06,
  maxFrameMs: 500,
});

// Pages on screen that show a softer bitmap sharpen DURING a finger glide once
// it has slowed under this speed (px/ms; 0.25 = 4 px a frame at 60 Hz), the
// way iOS does, instead of only after it has fully stopped. Faster than this
// a page redraw would cost visible frames of the glide.
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
 * How much of the tracked velocity survives a pointer that paused for `idleMs`
 * before lifting. Continuous, never binary: a 60ms hesitation must shorten the
 * glide, not preserve it whole, and a 140ms park must kill it outright.
 *
 * Two factors, each modelling one real thing:
 *  - exponential friction on the SAME time constant as the coast: the page
 *    would already have been slowing down during those milliseconds;
 *  - a linear intent ramp to zero at `releaseIdleMs`: the longer a finger sits
 *    still, the more the gesture is a hold and the less it is a flick.
 * Their product is 1 at 0ms, falls monotonically, and is exactly 0 from
 * `releaseIdleMs` onward - no cliff anywhere in between.
 */
export function releaseIdleScale(idleMs, config) {
  const cfg = withDefaults(config);
  const idle = Number(idleMs);
  if (!Number.isFinite(idle) || idle <= 0) return 1;
  if (idle >= cfg.releaseIdleMs) return 0;
  return decayFactor(idle, cfg.decayTauMs) * (1 - (idle / cfg.releaseIdleMs));
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
    release(at, { idleTaper = true } = {}) {
      if (!state) return { vx: 0, vy: 0 };
      const gesture = state;
      reset();
      // A pointer that sat still before lifting is a hold or a plain click.
      // The taper is continuous: a brief hesitation shortens the glide in
      // proportion to how long the finger was parked. Touch callers pass
      // idleTaper:false — a finger always lifts a few ms after its last
      // move, and the phone flick must stay exactly as it always was.
      const idleScale = idleTaper ? releaseIdleScale(at - gesture.lastTime, cfg) : 1;
      if (idleScale <= 0) return { vx: 0, vy: 0 };

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
        vx: pickDominantVelocity([gesture.velocityX, sampleVx, gestureVx]) * idleScale,
        vy: pickDominantVelocity([gesture.velocityY, sampleVy, gestureVy]) * idleScale,
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
  const baseCfg = withDefaults(config);
  // The settings of the glide in flight (start() may pass its own, e.g.
  // TOUCH_PAN_MOMENTUM for a finger flick).
  let cfg = baseCfg;
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
     * @param {object} [glideConfig] settings for this glide only (merged over
     *   the runner's own), e.g. TOUCH_PAN_MOMENTUM for a finger flick.
     * @returns {boolean} true when a coast actually started.
     */
    start(releaseVx, releaseVy, glideConfig) {
      if (handle) cancelFrame(handle);
      handle = 0;
      cfg = glideConfig ? { ...baseCfg, ...glideConfig } : baseCfg;
      vx = Number(releaseVx) || 0;
      vy = Number(releaseVy) || 0;
      written = null;
      if (!shouldStartPanMomentum(vx, vy, cfg)) {
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
