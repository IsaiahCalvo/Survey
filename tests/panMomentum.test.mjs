import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  PAN_MOMENTUM_DEFAULTS,
  clampFrameDelta,
  clampScrollTarget,
  createPanMomentumRunner,
  createPanVelocityTracker,
  decayFactor,
  isPanMomentumAtRest,
  releaseIdleScale,
  shouldStartPanMomentum,
  GLIDE_SHARPEN_SPEED,
  IOS_DECELERATION_RATE,
  IOS_DECELERATION_TAU_MS,
  flickLaunchSpeed,
  glideDistance,
  isGlideSlowEnoughToSharpen,
  panEventTime,
} from '../src/utils/panMomentum.js';

const TAU = PAN_MOMENTUM_DEFAULTS.decayTauMs;
const REST = PAN_MOMENTUM_DEFAULTS.minRestSpeed;

// A deterministic rAF + clock so the coast can be integrated frame by frame
// without any wall-clock flakiness.
function createFakeSurface({ maxLeft = 10000, maxTop = 10000, left = 0, top = 0 } = {}) {
  const state = { left, top, frameMs: 16, time: 0, queue: [], writes: 0 };
  const api = {
    state,
    getScroll: () => ({ left: state.left, top: state.top }),
    scrollBy: (dx, dy) => {
      state.writes += 1;
      state.left = clampScrollTarget(state.left + dx, maxLeft);
      state.top = clampScrollTarget(state.top + dy, maxTop);
    },
    requestFrame: (fn) => {
      state.queue.push(fn);
      return state.queue.length;
    },
    cancelFrame: () => { state.queue.length = 0; },
    now: () => state.time,
    pump: (frames = 600) => {
      let ran = 0;
      while (state.queue.length && ran < frames) {
        const fn = state.queue.shift();
        state.time += state.frameMs;
        fn(state.time);
        ran += 1;
      }
      return ran;
    },
  };
  return api;
}

function makeRunner(surface, extra = {}) {
  return createPanMomentumRunner({
    getScroll: surface.getScroll,
    scrollBy: surface.scrollBy,
    requestFrame: surface.requestFrame,
    cancelFrame: surface.cancelFrame,
    now: surface.now,
    ...extra,
  });
}

test('decay is exponential with the iOS time constant', () => {
  assert.equal(PAN_MOMENTUM_DEFAULTS.decayTauMs, IOS_DECELERATION_TAU_MS);
  assert.equal(decayFactor(0), 1);
  assert.ok(Math.abs(decayFactor(TAU) - Math.exp(-1)) < 1e-12);
  // Two 8ms frames must decay exactly as much as one 16ms frame: the feel is
  // identical at 60Hz and 120Hz.
  const twoShort = decayFactor(8) * decayFactor(8);
  assert.ok(Math.abs(twoShort - decayFactor(16)) < 1e-12);
  assert.ok(decayFactor(16) < 1 && decayFactor(16) > 0.9);
});

test('frame deltas clamp into the safe integration window', () => {
  assert.equal(clampFrameDelta(16), 16);
  assert.equal(clampFrameDelta(0), PAN_MOMENTUM_DEFAULTS.minFrameMs);
  assert.equal(clampFrameDelta(-40), PAN_MOMENTUM_DEFAULTS.minFrameMs);
  // A backgrounded tab returning after 4 seconds must not teleport the page.
  assert.equal(clampFrameDelta(4000), PAN_MOMENTUM_DEFAULTS.maxFrameMs);
  assert.equal(clampFrameDelta(NaN), PAN_MOMENTUM_DEFAULTS.minFrameMs);
});

test('start and rest thresholds separate a flick from a drop', () => {
  assert.equal(shouldStartPanMomentum(0, 0), false);
  assert.equal(shouldStartPanMomentum(0.05, 0), false);
  // Drawboard: a careful 0.2 px/ms placement never glides.
  assert.equal(shouldStartPanMomentum(0.2, 0), false);
  assert.equal(shouldStartPanMomentum(1.2, 0), true);
  // Diagonals are measured as a magnitude, not per axis.
  assert.equal(shouldStartPanMomentum(0.25, 0.25), true);
  assert.equal(isPanMomentumAtRest(0.01, 0.005), true);
  assert.equal(isPanMomentumAtRest(0.2, 0), false);
});

test('clampScrollTarget respects both scroll bounds', () => {
  assert.equal(clampScrollTarget(-50, 400), 0);
  assert.equal(clampScrollTarget(900, 400), 400);
  assert.equal(clampScrollTarget(120, 400), 120);
  assert.equal(clampScrollTarget(120, -5), 0);
});

test('velocity tracker averages the last samples of a flick', () => {
  const tracker = createPanVelocityTracker();
  tracker.start(500, 500, 0);
  for (let i = 1; i <= 10; i += 1) tracker.move(500, 500 - i * 20, i * 16);
  const { vx, vy } = tracker.release(10 * 16 + 4);
  assert.equal(Math.round(vx * 1000) / 1000, 0);
  // Finger moved up 20px per 16ms frame -> -1.25 px/ms in finger direction,
  // launched as a flick of that speed.
  assert.ok(Math.abs(vy + flickLaunchSpeed(1.25)) < 1e-9, `vy=${vy}`);
  assert.equal(shouldStartPanMomentum(vx, vy), true);
  assert.equal(tracker.active, false, 'release consumes the gesture');
});

test('velocity tracker keeps both axes of a diagonal flick', () => {
  const tracker = createPanVelocityTracker();
  tracker.start(0, 0, 0);
  for (let i = 1; i <= 8; i += 1) tracker.move(i * 10, i * 24, i * 16);
  const { vx, vy } = tracker.release(8 * 16);
  assert.ok(vx > 0.4 && vy > 1.0, `vx=${vx} vy=${vy}`);
  assert.ok(vy > vx, 'the faster axis stays the faster axis');
});

test('a sparse coalesced final move still flicks (whole-gesture fallback)', () => {
  const tracker = createPanVelocityTracker();
  tracker.start(0, 0, 0);
  // Exactly one move event for a 300px throw: the trailing sample window has
  // a single entry, so only the whole-gesture estimate can see the speed.
  tracker.move(0, -300, 120);
  const { vy } = tracker.release(130);
  assert.ok(vy < -1.5, `vy=${vy}`);
  assert.equal(shouldStartPanMomentum(0, vy), true);
});

test('a click and a park-then-release never flick', () => {
  const click = createPanVelocityTracker();
  click.start(300, 300, 0);
  click.move(300, 300, 8);
  click.move(301, 300, 16);
  const clickRelease = click.release(20);
  assert.equal(shouldStartPanMomentum(clickRelease.vx, clickRelease.vy), false);

  const hold = createPanVelocityTracker();
  hold.start(0, 0, 0);
  for (let i = 1; i <= 6; i += 1) hold.move(0, -i * 30, i * 16);
  // Finger stops dead and rests for half a second before lifting.
  const held = hold.release(6 * 16 + 500);
  assert.deepEqual(held, { vx: 0, vy: 0 });
});

test('release with no gesture is inert', () => {
  const tracker = createPanVelocityTracker();
  assert.deepEqual(tracker.release(100), { vx: 0, vy: 0 });
  assert.deepEqual(tracker.move(10, 10, 100), { dx: 0, dy: 0 });
});

test('a flick coasts for many frames and decays to rest', () => {
  const surface = createFakeSurface({ top: 4000, maxTop: 20000 });
  const settled = [];
  const runner = makeRunner(surface, { onSettle: (reason) => settled.push(reason) });

  // Finger flicked UP at 1.2px/ms -> page scrolls DOWN (scrollTop grows).
  assert.equal(runner.start(0, -1.2), true);
  assert.equal(runner.isRunning(), true);

  surface.pump(4);
  const afterFourFrames = surface.state.top;
  assert.ok(afterFourFrames > 4000, 'scroll keeps moving after release');
  assert.equal(runner.isRunning(), true, 'still coasting several frames later');

  const frames = surface.pump() + 4;
  assert.ok(frames > 60, `expected a long coast, got ${frames} frames`);
  assert.equal(runner.isRunning(), false);
  assert.deepEqual(settled, ['settled']);

  const distance = surface.state.top - 4000;
  // Analytic glide distance: (v0 - rest speed) * tau.
  assert.ok(Math.abs(distance - (1.2 - REST) * TAU) < 15, `distance=${distance}`);

  // Each successive frame must travel less than the one before it.
  assert.ok(afterFourFrames - 4000 > distance * 0.1);
});

test('faster flicks glide further, on the same curve', () => {
  const measure = (v) => {
    const surface = createFakeSurface({ top: 5000, maxTop: 40000 });
    const runner = makeRunner(surface);
    runner.start(0, -v);
    surface.pump();
    return surface.state.top - 5000;
  };
  const slow = measure(0.4);
  const fast = measure(1.6);
  assert.ok(fast > slow * 3, `slow=${slow} fast=${fast}`);
  // Exponential friction: distance is linear in launch speed above the rest speed.
  const expected = (1.6 - REST) / (0.4 - REST);
  assert.ok(Math.abs(fast / slow - expected) < 0.35, `ratio=${fast / slow} expected ${expected}`);
});

test('a slow release does not start a coast at all', () => {
  const surface = createFakeSurface({ top: 100 });
  const runner = makeRunner(surface);
  assert.equal(runner.start(0.01, -0.02), false);
  assert.equal(runner.isRunning(), false);
  assert.equal(surface.state.queue.length, 0);
  assert.equal(surface.state.top, 100, 'no scroll write for a non-flick');
});

test('a coast into a scroll bound stops instead of banking velocity', () => {
  const surface = createFakeSurface({ top: 960, maxTop: 1000 });
  const runner = makeRunner(surface);
  runner.start(0, -2.5);
  surface.pump();
  assert.equal(surface.state.top, 1000, 'clamped to the bottom bound');
  assert.equal(runner.isRunning(), false, 'stalled axis ends the coast');
});

test('a bounded axis stops while the free axis keeps gliding', () => {
  const surface = createFakeSurface({ left: 0, top: 500, maxLeft: 0, maxTop: 9000 });
  const runner = makeRunner(surface);
  runner.start(1.0, -1.0);
  surface.pump();
  assert.equal(surface.state.left, 0, 'horizontal had nowhere to go');
  assert.ok(surface.state.top > 700, `vertical still coasted: ${surface.state.top}`);
});

test('a new input cancels a coast mid-flight', () => {
  const surface = createFakeSurface({ top: 3000, maxTop: 20000 });
  const settled = [];
  const runner = makeRunner(surface, { onSettle: (reason) => settled.push(reason) });
  runner.start(0, -1.5);
  surface.pump(3);
  const interrupted = surface.state.top;
  assert.ok(interrupted > 3000);

  assert.equal(runner.cancel('pointerdown'), true);
  assert.equal(runner.isRunning(), false);
  assert.deepEqual(settled, ['pointerdown']);

  assert.equal(surface.pump(), 0, 'no frames remain queued');
  assert.equal(surface.state.top, interrupted, 'scroll froze where it was');
  assert.equal(runner.cancel(), false, 'cancelling twice is a no-op');
});

test('starting a new flick replaces the one in flight', () => {
  const surface = createFakeSurface({ top: 2000, maxTop: 30000 });
  const runner = makeRunner(surface);
  runner.start(0, -0.5);
  surface.pump(2);
  runner.start(0, -2.0);
  assert.equal(surface.state.queue.length, 1, 'exactly one frame scheduled');
  surface.pump();
  assert.ok(surface.state.top - 2000 > 500, 'the second, faster flick won');
});

test('onFrame reports live scroll position and remaining velocity', () => {
  const surface = createFakeSurface({ top: 0, maxTop: 9000 });
  const frames = [];
  const runner = makeRunner(surface, { onFrame: (frame) => frames.push(frame) });
  runner.start(0, -1.0);
  surface.pump();
  assert.ok(frames.length > 40);
  assert.ok(frames[0].top > 0, 'the very first coast frame already moved the page');
  assert.ok(frames[0].vy < 0 && frames[0].vy > -1.0, 'velocity already decaying on frame one');
  assert.ok(Math.abs(frames[frames.length - 1].vy) < PAN_MOMENTUM_DEFAULTS.minRestSpeed);
  for (let i = 1; i < frames.length; i += 1) {
    assert.ok(Math.abs(frames[i].vy) <= Math.abs(frames[i - 1].vy), 'velocity only ever decays');
    assert.ok(frames[i].top >= frames[i - 1].top, 'scroll only travels one way');
  }
});

test('the coast survives a missing scroll surface without throwing', () => {
  const surface = createFakeSurface();
  const runner = createPanMomentumRunner({
    getScroll: () => ({ left: 0, top: 0 }),
    scrollBy: () => {},
    requestFrame: surface.requestFrame,
    cancelFrame: surface.cancelFrame,
    now: surface.now,
  });
  runner.start(0, -1.5);
  surface.pump();
  assert.equal(runner.isRunning(), false, 'a surface that never moves settles immediately');
});

// Integration guard (pan glide x zoom). Neither feature branch could see this
// seam on its own: the desktop coast and the imperative zoom path only became
// concurrent when they landed together. applyAnchoredScale re-anchors
// scrollLeft/scrollTop under the cursor after a scale change, so a coast still
// writing scroll offsets every frame would drag the page off that anchor.
test('the imperative zoom path ends an in-flight coast before it re-anchors scroll', async () => {
  const source = await readFile(
    new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url),
    'utf8',
  );
  const body = source.slice(source.indexOf('const applyAnchoredScale = useCallback('));
  const cancelAt = body.indexOf("panMomentumRef.current?.cancel(");
  assert.ok(cancelAt > 0, 'applyAnchoredScale cancels the pan momentum runner');
  const anchorAt = body.indexOf('const cX = el.scrollLeft + cursorX;');
  assert.ok(anchorAt > 0, 'applyAnchoredScale still anchors on the cursor');
  assert.ok(cancelAt < anchorAt, 'the coast is cancelled before the scroll anchor is read');
  // A wheel/trackpad scroll takes the page back too, so the browser's own
  // scrolling never fights a coast.
  assert.match(source, /addEventListener\('wheel', onWheelStopGlide/);
});


// ---------------------------------------------------------------------------
// Round 2 - a pause before release tapers the glide instead of switching it off
// ---------------------------------------------------------------------------

test('releaseIdleScale tapers continuously instead of flipping at the cutoff', () => {
  assert.equal(releaseIdleScale(0), 1);
  assert.equal(releaseIdleScale(-5), 1);
  assert.equal(releaseIdleScale(NaN), 1);
  // Zero from the hold threshold onward: a parked finger is never a flick.
  assert.equal(releaseIdleScale(PAN_MOMENTUM_DEFAULTS.releaseIdleMs), 0);
  assert.equal(releaseIdleScale(500), 0);

  // A lift always trails the last move by a frame or two: full speed through
  // the grace period, for finger and mouse alike (flickPan 2026-10-07: one
  // rule for both; Drawboard still throws the page after a 50 ms pause).
  const grace = PAN_MOMENTUM_DEFAULTS.releaseGraceMs;
  assert.equal(releaseIdleScale(16), 1);
  assert.equal(releaseIdleScale(grace), 1);
  const holds = [0, grace, 70, 90, 110, 130, 139, 140, 200];
  const scales = holds.map((hold) => releaseIdleScale(hold));
  for (let i = 1; i < scales.length; i += 1) {
    assert.ok(scales[i] <= scales[i - 1], `scale must never rise: ${holds[i]}ms -> ${scales[i]}`);
  }
  // Strictly shrinking once the taper is live - no second plateau.
  for (let i = 2; i < scales.length - 1; i += 1) {
    assert.ok(scales[i] < scales[i - 1], `${holds[i]}ms must be slower than ${holds[i - 1]}ms`);
  }
  // No cliff: the last live value is already tiny by the time it reaches zero.
  assert.ok(releaseIdleScale(139) < 0.02, `139ms -> ${releaseIdleScale(139)}`);
  // A real hesitation must cost real speed, not be waved through.
  assert.ok(releaseIdleScale(100) > 0.3 && releaseIdleScale(100) < 0.6, `100ms -> ${releaseIdleScale(100)}`);
});

test('a pause before release shortens the glide in proportion to the pause', () => {
  // Same flick every time - only the pause before lifting changes.
  const releaseAfterHold = (holdMs) => {
    const tracker = createPanVelocityTracker();
    tracker.start(500, 500, 0);
    for (let i = 1; i <= 10; i += 1) tracker.move(500, 500 - i * 20, i * 16);
    return tracker.release(10 * 16 + holdMs);
  };
  const glideDistance = (holdMs) => {
    const { vx, vy } = releaseAfterHold(holdMs);
    const surface = createFakeSurface({ top: 5000, maxTop: 40000 });
    const runner = makeRunner(surface);
    runner.start(vx, vy);
    surface.pump();
    return surface.state.top - 5000;
  };

  const holds = [0, 80, 110, 140, 200];
  const distances = holds.map(glideDistance);
  for (let i = 1; i < distances.length; i += 1) {
    assert.ok(
      distances[i] <= distances[i - 1],
      `a longer pause can never glide further: ${holds.join('/')} -> ${distances.join('/')}`,
    );
  }
  // The live band is continuous, not binary: each of these is a real, shorter glide.
  assert.ok(distances[0] > 300, `0ms hold still throws the page: ${distances[0]}`);
  assert.ok(distances[1] > 20 && distances[1] < distances[0] * 0.7, `80ms hold: ${distances[1]}`);
  assert.ok(distances[2] > 10 && distances[2] < distances[1], `110ms hold: ${distances[2]}`);
  // A real hold still stops dead, so a press-hold-release never throws the page.
  assert.equal(distances[3], 0, '140ms hold glides nothing');
  assert.equal(distances[4], 0, '200ms hold glides nothing');
});

test('an idle taper cannot flip a flick direction or wake a dead gesture', () => {
  const tracker = createPanVelocityTracker();
  tracker.start(0, 0, 0);
  for (let i = 1; i <= 6; i += 1) tracker.move(i * 18, -i * 18, i * 16);
  const { vx, vy } = tracker.release(6 * 16 + 80);
  assert.ok(vx > 0 && vy < 0, `signs survive the taper: vx=${vx} vy=${vy}`);
  assert.equal(shouldStartPanMomentum(vx, vy), true);
});

// ---------------------------------------------------------------------------
// Round 2 - a programmatic scroll owns the surface, the coast yields to it
// ---------------------------------------------------------------------------

test('a coast yields to a programmatic scroll instead of dragging the page back', () => {
  const surface = createFakeSurface({ top: 3000, maxTop: 90000 });
  const settled = [];
  const runner = makeRunner(surface, { onSettle: (reason) => settled.push(reason) });
  runner.start(0, -1.6);
  surface.pump(3);
  assert.equal(runner.isRunning(), true);

  // Page nav / thumbnail / bookmark / search hit: somebody else writes scrollTop.
  const target = 41234;
  surface.state.top = target;

  surface.pump();
  assert.equal(runner.isRunning(), false, 'the glide stopped itself');
  assert.deepEqual(settled, ['external-scroll']);
  assert.equal(surface.state.top, target, 'the navigation target was not moved by a single pixel');
});

test('sub-pixel scroll jitter does not abort a healthy coast', () => {
  const surface = createFakeSurface({ top: 0, maxTop: 90000 });
  const settled = [];
  const runner = makeRunner(surface, { onSettle: (reason) => settled.push(reason) });
  runner.start(0, -1.2);
  surface.pump(2);
  // Browsers snap scrollTop to device pixels; that is not somebody stealing it.
  surface.state.top += 0.4;
  surface.pump(2);
  assert.equal(runner.isRunning(), true, 'rounding noise is tolerated');
  surface.pump();
  assert.deepEqual(settled, ['settled']);
});

test('a restarted flick forgets the previous write position', () => {
  const surface = createFakeSurface({ top: 1000, maxTop: 90000 });
  const runner = makeRunner(surface);
  runner.start(0, -1.0);
  surface.pump(3);
  runner.cancel('pointerdown');
  // The finger dragged the page a long way before flicking again.
  surface.state.top = 24000;
  runner.start(0, -1.0);
  surface.pump(2);
  assert.equal(runner.isRunning(), true, 'the new flick is not killed by the drag that preceded it');
  assert.ok(surface.state.top > 24000, 'and it actually coasts');
});

// ---------------------------------------------------------------------------
// Round 2 - container wiring (source assertions, same pattern as the zoom guard)
// ---------------------------------------------------------------------------

async function readContainerSource() {
  return readFile(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
}

test('page navigation cancels the glide before it writes scrollTop', async () => {
  const source = await readContainerSource();
  const body = source.slice(source.indexOf('const goToPage = useCallback('));
  const cancelAt = body.indexOf('cancelPanInertia(');
  assert.ok(cancelAt > 0, 'goToPage cancels the pan glide');
  const writeAt = body.indexOf('el.scrollTop =');
  assert.ok(writeAt > 0, 'goToPage still writes the page top');
  assert.ok(cancelAt < writeAt, 'the glide is cancelled before the page top is written');
  // Previous/Next, the page-number field, thumbnails, bookmarks and search hits
  // are all routed through this one entry point.
  assert.match(source, /navigationModule: \{ goToPage \}/);
});

test('the viewport scrollbars take the surface from an in-flight glide', async () => {
  const source = await readContainerSource();
  assert.match(source, /onScrollbarGrab=\{stopGlideForScrollbar\}/);
  assert.match(source, /const stopGlideForScrollbar = useCallback\(\(\) => \{ cancelPanInertia\(false\); \}/);
  const scrollbars = source.slice(
    source.indexOf('function ViewportScrollbars('),
    source.indexOf('let pdfjsContainerSeq = 0;'),
  );
  // The thumb drag writes scroller.scrollTop directly from a window-level
  // pointermove, far outside the scroller's own pan listeners.
  const startDrag = scrollbars.slice(scrollbars.indexOf('const startDrag = '));
  const grabAt = startDrag.indexOf('takeScrollerFromGlide()');
  const dragStateAt = startDrag.indexOf('dragRef.current = {');
  assert.ok(grabAt > 0 && dragStateAt > 0 && grabAt < dragStateAt,
    'the thumb stops the glide before it starts driving scrollTop');
  // The rails sit outside the scroller, so their wheel never reaches onWheelStopGlide.
  const railWheel = scrollbars.slice(scrollbars.indexOf('const forwardRailWheel = useCallback('));
  assert.ok(railWheel.indexOf('takeScrollerFromGlide()') < railWheel.indexOf('scrollerNode.scrollLeft +='),
    'a rail wheel stops the glide before it scrolls');
  assert.equal((scrollbars.match(/onPointerDown=\{takeScrollerFromGlide\}/g) || []).length, 2,
    'both rails hand the surface over on pointerdown');
});

test('stopping a glide that was not running never fires a pan end', async () => {
  const source = await readContainerSource();
  const body = source.slice(source.indexOf('const cancelPanInertia = useCallback('));
  const tail = body.slice(0, body.indexOf('}, [restorePanInteraction]);'));
  assert.ok(tail.includes('restorePanInteraction()'),
    'the no-glide path re-derives pan state from the live space/pointer refs');
  assert.ok(!tail.includes('setPanInteraction(false)'),
    'a wheel tick with nothing coasting must not force PAN_END while Space is held');
  assert.ok(tail.includes('return wasRunning'), 'callers can tell whether a glide was actually stopped');
});

test('finger and mouse share one release rule: a quick lift keeps full speed, a rest fades it', () => {
  const release = (gapMs) => {
    const tracker = createPanVelocityTracker();
    tracker.start(0, 0, 0);
    for (let i = 1; i <= 6; i += 1) tracker.move(i * 16, 0, i * 16);
    return tracker.release(96 + gapMs).vx;
  };
  // A finger lifts ~8-20 ms after its last move: no speed lost.
  assert.equal(release(12), release(0));
  assert.ok(release(100) < release(0) * 0.5, `a 100 ms rest fades the glide (${release(100)} vs ${release(0)})`);
  assert.equal(release(160), 0);
});

// ---------------------------------------------------------------------------
// 2026-10-07 - finger flicks glide like iOS, in real time, and sharpen as they
// slow down
// ---------------------------------------------------------------------------

test('every glide uses the iOS deceleration rate (0.998 per ms)', () => {
  assert.equal(IOS_DECELERATION_RATE, 0.998);
  // Speed kept after 1 ms is exactly the iOS rate.
  assert.ok(Math.abs(decayFactor(1) - 0.998) < 1e-12);
  assert.ok(Math.abs(IOS_DECELERATION_TAU_MS - 499.5) < 0.1);
  assert.equal(PAN_MOMENTUM_DEFAULTS.maxFrameMs, 500);
});

test('glideDistance is the exact integral, so the path does not depend on frame rate', () => {
  const tau = TAU;
  assert.equal(glideDistance(0, 16, tau), 0);
  // One 32 ms step travels exactly as far as two 16 ms steps.
  const one = glideDistance(2, 32, tau);
  const two = glideDistance(2, 16, tau) + glideDistance(2 * decayFactor(16, tau), 16, tau);
  assert.ok(Math.abs(one - two) < 1e-9);
  // A very long step never travels further than the whole glide (v * tau).
  assert.ok(glideDistance(2, 1e9, tau) <= 2 * tau + 1e-9);
});

function glideRun(speed, frameMs) {
  const surface = createFakeSurface({ top: 100000, maxTop: 400000 });
  surface.state.frameMs = frameMs;
  const runner = makeRunner(surface);
  runner.start(0, -speed);
  const frames = surface.pump(100000);
  return { distance: surface.state.top - 100000, ms: frames * frameMs };
}

test('a finger glide lasts ~0.5-2 s depending on speed, like iOS', () => {
  const gentle = glideRun(0.3, 16);
  const medium = glideRun(1.5, 16);
  const hard = glideRun(4, 16);
  assert.ok(gentle.ms >= 450 && gentle.ms <= 750, `gentle ${gentle.ms} ms`);
  assert.ok(medium.ms >= 1300 && medium.ms <= 1800, `medium ${medium.ms} ms`);
  assert.ok(hard.ms >= 1800 && hard.ms <= 2300, `hard ${hard.ms} ms`);
  // Distance is v * tau less the tail cut at the rest speed.
  assert.ok(Math.abs(medium.distance - (1.5 - REST) * TAU) < 15, `medium ${medium.distance}`);
});

test('dropped frames do not slow the glide down (WebKit paints pages mid-glide)', () => {
  // 60 Hz vs a browser managing one frame every 200 ms: same length, same distance.
  const smooth = glideRun(1.5, 16);
  const choppy = glideRun(1.5, 200);
  assert.ok(Math.abs(choppy.ms - smooth.ms) <= 200, `smooth ${smooth.ms} ms, choppy ${choppy.ms} ms`);
  assert.ok(Math.abs(choppy.distance - smooth.distance) < 40, `smooth ${smooth.distance}, choppy ${choppy.distance}`);
  assert.equal(clampFrameDelta(200), 200);
  assert.equal(clampFrameDelta(4000), 500);
});

test('pages may sharpen once a glide is under GLIDE_SHARPEN_SPEED', () => {
  assert.equal(GLIDE_SHARPEN_SPEED, 0.25);
  assert.equal(isGlideSlowEnoughToSharpen(0, -1.5), false);
  assert.equal(isGlideSlowEnoughToSharpen(0.2, 0.2), false); // 0.28 px/ms diagonal
  assert.equal(isGlideSlowEnoughToSharpen(0, -0.2), true);
  assert.equal(isGlideSlowEnoughToSharpen(0, 0), true);
  // A hard flick spends its last ~0.5 s under the threshold.
  const slowFor = TAU * Math.log(GLIDE_SHARPEN_SPEED / REST);
  assert.ok(slowFor > 450 && slowFor < 650, `slow tail ${slowFor} ms`);
});

test('the viewer gives finger and mouse the same glide and lets a slowing finger glide sharpen', async () => {
  const source = await readFile(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(source, /getPanMomentumRunner\(\)\.start\(fingerVelocityX, fingerVelocityY\)/);
  assert.match(source, /\{ elastic: release\.elastic, touch: true \}/);
  assert.match(source, /return !\(kind === 'sharpen' && glideSettlingRef\.current\);/);
  // The quiet pump (which clears data-pdfjs-moving) still waits for the page to be still.
  assert.match(source, /if \(gestureHoldsRasterRef\.current\('prefetch'\)\) \{ scheduleRasterQuietPump\(\); return; \}/);
});

// Owner 2026-10-07 ("this reset that happens"): a release that lands a moment
// before the next frame used to time the first glide step from the release,
// so that frame moved almost nothing - the page stood still for a frame right
// as the finger let go.
test('the first glide frame moves a whole frame even when the release lands just before it', () => {
  const surface = createFakeSurface({ left: 5000 });
  const runner = makeRunner(surface);
  surface.state.time = 100;
  runner.start(1, 0);
  // The next frame comes only 2 ms after the release.
  const fn = surface.state.queue.shift();
  surface.state.time += 2;
  fn(surface.state.time);
  const firstStep = 5000 - surface.state.left;
  assert.ok(Math.abs(firstStep - glideDistance(1, 1000 / 60)) < 1e-9, `first step ${firstStep}`);
  // Later frames use their real length again.
  const before = surface.state.left;
  surface.pump(1);
  assert.ok(before - surface.state.left < glideDistance(1, 16) + 1e-9);
});

// ---------------------------------------------------------------------------
// 2026-10-07 (flickPan) - the flick matches Drawboard PDF, measured frame by
// frame with identical scripted drags (owner: "the flick just seems too
// aggressive ... compare the Drawboard and get it right, dial it in").
// ---------------------------------------------------------------------------

// A whole drag at a steady `speed` px/ms on a 120 Hz (8 ms) clock, then a lift
// `liftMs` after the last move; returns the glide the runner then plays.
function flick({ speed, ms = 150, liftMs = 8, ease = false, frameMs = 16 }) {
  const tracker = createPanVelocityTracker();
  tracker.start(0, 0, 0);
  let t = 0;
  for (; t < ms; t += 8) {
    const u = Math.min(1, (t + 8) / ms);
    const k = ease ? 1 - (1 - u) ** 3 : u;
    tracker.move(0, -speed * ms * k, t + 8);
  }
  const { vx, vy } = tracker.release(t + liftMs);
  const surface = createFakeSurface({ top: 200000, maxTop: 900000 });
  surface.state.frameMs = frameMs;
  const runner = makeRunner(surface);
  const started = runner.start(vx, vy);
  const frames = started ? surface.pump(100000) : 0;
  return { distance: surface.state.top - 200000, ms: frames * frameMs, vy };
}

test('flick glide distance and duration land within 15% of Drawboard for every flick size', () => {
  // Drawboard PDF web, Chromium, 60 fps: [finger px/ms, glide px, glide ms]
  // (medians of the scratchpad flickPan runs, phone + desktop).
  const drawboard = [
    [0.95, 550, 1225],
    [1.5, 1060, 1475],
    [2.08, 1790, 1735],
    [2.5, 2520, 1880],
    [3.7, 4900, 2200],
  ];
  for (const [speed, px, ms] of drawboard) {
    const g = flick({ speed });
    assert.ok(Math.abs(g.distance / px - 1) <= 0.15, `${speed} px/ms: ${Math.round(g.distance)} px vs Drawboard ${px}`);
    assert.ok(Math.abs(g.ms / ms - 1) <= 0.15, `${speed} px/ms: ${g.ms} ms vs Drawboard ${ms}`);
  }
});

test('a drag that slows to a stop, a slow placement or a rest before lifting does not glide', () => {
  // The old tracker took the fastest of three estimates (incl. the whole-drag
  // average), so all three of these threw the page (420 / 100 / 600 px).
  assert.equal(flick({ speed: 1, ms: 300, ease: true }).distance, 0, 'finger slowed to a stop');
  assert.equal(flick({ speed: 0.2, ms: 1000 }).distance, 0, 'slow 0.2 px/ms placement');
  assert.equal(flick({ speed: 1.6, ms: 120, liftMs: 150 }).distance, 0, 'rested 150 ms before lifting');
  // ...while the same drag lifted at once is a real flick.
  assert.ok(flick({ speed: 1.6, ms: 120 }).distance > 600);
});

test('the release reads only the last moments of the drag, never a faster earlier stretch', () => {
  const tracker = createPanVelocityTracker();
  tracker.start(0, 0, 0);
  // 200 ms fast (2 px/ms), then 100 ms at 0.5 px/ms, lifted at once.
  let y = 0;
  for (let t = 8; t <= 200; t += 8) { y -= 16; tracker.move(0, y, t); }
  for (let t = 208; t <= 300; t += 8) { y -= 4; tracker.move(0, y, t); }
  const { vy } = tracker.release(304);
  assert.ok(Math.abs(vy + 0.5) < 0.02, `release speed is the last 50 ms (${vy})`);
});

test('fast flicks are carried further, slow ones are not, and the boost is capped', () => {
  const knee = PAN_MOMENTUM_DEFAULTS.flickBoostKnee;
  assert.equal(flickLaunchSpeed(0.5), 0.5);
  assert.equal(flickLaunchSpeed(knee), knee);
  assert.equal(flickLaunchSpeed(-0.5), 0.5, 'a speed, never a direction');
  let previous = 0;
  for (const v of [0.9, 1.2, 2, 3, 4, 6]) {
    const launch = flickLaunchSpeed(v);
    assert.ok(launch > v && launch > previous, `${v} -> ${launch}`);
    previous = launch;
  }
  assert.ok(Math.abs(flickLaunchSpeed(2.08) / 2.08 - 1.92) < 0.05);
  assert.equal(flickLaunchSpeed(50), PAN_MOMENTUM_DEFAULTS.flickMaxSpeed);
});

test('a frame-rate change does not change the flick (8 ms vs 16 ms vs 33 ms frames)', () => {
  const a = flick({ speed: 2, frameMs: 8 });
  const b = flick({ speed: 2, frameMs: 16 });
  const c = flick({ speed: 2, frameMs: 33 });
  assert.ok(Math.abs(a.distance - b.distance) < 20 && Math.abs(c.distance - b.distance) < 30, `${a.distance} ${b.distance} ${c.distance}`);
});

test('velocity uses the time the input happened, not when the handler ran', () => {
  assert.equal(panEventTime({ timeStamp: 1234.5 }, 1240), 1234.5);
  // Missing, epoch-based (old Safari), future or stale stamps fall back to now.
  assert.equal(panEventTime({}, 500), 500);
  assert.equal(panEventTime({ timeStamp: 1791403381464 }, 500), 500);
  assert.equal(panEventTime({ timeStamp: 900 }, 500), 500);
  assert.equal(panEventTime({ timeStamp: 10 }, 5000), 5000);
  assert.equal(panEventTime(null, 42), 42);
  // Two queued moves handled 1 ms apart keep their real 16 ms spacing.
  const tracker = createPanVelocityTracker();
  tracker.start(0, 0, panEventTime({ timeStamp: 100 }, 140));
  tracker.move(0, -16, panEventTime({ timeStamp: 116 }, 140));
  tracker.move(0, -32, panEventTime({ timeStamp: 132 }, 141));
  const { vy } = tracker.release(panEventTime({ timeStamp: 140 }, 142));
  assert.ok(Math.abs(vy + flickLaunchSpeed(1)) < 1e-9, `vy=${vy}`);
});

test('Pan tool: a press the selection grab claimed drags only the mark, and any press stops a glide', async () => {
  const source = await readContainerSource();
  assert.match(source, /import \{ isSelectionGrabPress \} from '\.\.\/hooks\/useSelectionGrabHandoff\.js';/);
  // Desktop: the scroller's pointerdown leaves a claimed press alone, but
  // still catches a glide in flight (the page must not coast under the mark).
  const down = source.slice(source.indexOf('const onPointerDown = (event) => {'));
  const bail = down.indexOf('if (isSelectionGrabPress(event)');
  const stopGlide = down.indexOf('if (panMomentumRef.current?.isRunning()) cancelPanInertia();');
  const panStart = down.indexOf('panPointerRef.current = {');
  assert.ok(bail > 0 && stopGlide > bail && stopGlide < panStart, 'claimed press bails before a pan starts, after stopping the glide');
  // Phone: one finger on the selection never starts a pan; a pan that the
  // grab claims later (any engine's event order) ends on the spot, no glide.
  const touchStart = source.slice(source.indexOf('const onTouchStart = (event) => {'));
  assert.ok(touchStart.indexOf('event.touches.length === 1 && isSelectionGrabPress(event)') > 0);
  assert.ok(touchStart.indexOf('event.touches.length === 1 && isSelectionGrabPress(event)') < touchStart.indexOf("mobileTouchRef.current = { mode: 'pan' };"));
  assert.match(source, /if \(touchState\?\.mode === 'pan' && isSelectionGrabPress\(event\)\) \{\s*panVelocityRef\.current\.reset\(\);\s*endTouchPan\(0, 0\);/);
  // Pinch is untouched: two fingers still reach startPinch.
  assert.match(touchStart, /if \(event\.touches\.length >= 2\) \{\s*event\.stopPropagation\(\);\s*startPinch\(event\.touches\);/);
});
