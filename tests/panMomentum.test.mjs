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
  pickDominantVelocity,
  releaseIdleScale,
  shouldStartPanMomentum,
} from '../src/utils/panMomentum.js';

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

test('decay is exponential with the mobile 325ms time constant', () => {
  assert.equal(PAN_MOMENTUM_DEFAULTS.decayTauMs, 325);
  assert.equal(decayFactor(0), 1);
  assert.ok(Math.abs(decayFactor(325) - Math.exp(-1)) < 1e-12);
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
  assert.equal(shouldStartPanMomentum(1.2, 0), true);
  // Diagonals are measured as a magnitude, not per axis.
  assert.equal(shouldStartPanMomentum(0.06, 0.06), true);
  assert.equal(isPanMomentumAtRest(0.01, 0.005), true);
  assert.equal(isPanMomentumAtRest(0.2, 0), false);
});

test('pickDominantVelocity keeps the fastest honest estimate and its sign', () => {
  assert.equal(pickDominantVelocity([0.2, -0.9, 0.4]), -0.9);
  assert.equal(pickDominantVelocity([]), 0);
  assert.equal(pickDominantVelocity([NaN, Infinity, 0.3]), 0.3);
  assert.equal(pickDominantVelocity(null), 0);
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
  // Finger moved up 20px per 16ms frame -> -1.25 px/ms in finger direction.
  assert.ok(vy < -1.0 && vy > -1.5, `vy=${vy}`);
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
  // Analytic glide distance for v0=1.2px/ms, tau=325ms is v0*tau = 390px;
  // discrete integration lands just under that.
  assert.ok(distance > 330 && distance < 400, `distance=${distance}`);

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
  // Distance is linear in release speed for exponential friction.
  assert.ok(Math.abs(fast / slow - 4) < 0.35, `ratio=${fast / slow}`);
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

  const holds = [0, 20, 60, 100, 120, 139, 140, 200];
  const scales = holds.map((hold) => releaseIdleScale(hold));
  for (let i = 1; i < scales.length; i += 1) {
    assert.ok(scales[i] <= scales[i - 1], `scale must never rise: ${holds[i]}ms -> ${scales[i]}`);
  }
  // Strictly shrinking while the taper is live - no flat "full speed" plateau.
  for (let i = 1; i < scales.length - 1; i += 1) {
    assert.ok(scales[i] < scales[i - 1], `${holds[i]}ms must be slower than ${holds[i - 1]}ms`);
  }
  // No cliff: the last live value is already tiny by the time it reaches zero.
  assert.ok(releaseIdleScale(139) < 0.02, `139ms -> ${releaseIdleScale(139)}`);
  // A brief hesitation must cost real speed, not be waved through.
  assert.ok(releaseIdleScale(60) > 0.3 && releaseIdleScale(60) < 0.6, `60ms -> ${releaseIdleScale(60)}`);
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

  const holds = [0, 60, 100, 140, 200];
  const distances = holds.map(glideDistance);
  for (let i = 1; i < distances.length; i += 1) {
    assert.ok(
      distances[i] <= distances[i - 1],
      `a longer pause can never glide further: ${holds.join('/')} -> ${distances.join('/')}`,
    );
  }
  // The live band is continuous, not binary: each of these is a real, shorter glide.
  assert.ok(distances[0] > 300, `0ms hold still throws the page: ${distances[0]}`);
  assert.ok(distances[1] > 20 && distances[1] < distances[0] * 0.7, `60ms hold: ${distances[1]}`);
  assert.ok(distances[2] > 10 && distances[2] < distances[1], `100ms hold: ${distances[2]}`);
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
