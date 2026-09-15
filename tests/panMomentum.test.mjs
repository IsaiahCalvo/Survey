import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAN_MOMENTUM_DEFAULTS,
  clampFrameDelta,
  clampScrollTarget,
  createPanMomentumRunner,
  createPanVelocityTracker,
  decayFactor,
  isPanMomentumAtRest,
  pickDominantVelocity,
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
