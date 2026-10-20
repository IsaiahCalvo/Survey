// Drawboard canvas audit chunk 6: the smooth page move (src/utils/pageScrollGlide.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_GLIDE_MS,
  LONG_JUMP_SCREENS,
  planPageGlide,
  createPageGlide,
  stepPageGlide,
  startPageGlide,
} from '../src/utils/pageScrollGlide.js';

function fakeScroller({ scrollTop = 0, clientHeight = 800, scrollHeight = 300 * 815 } = {}) {
  const listeners = new Map();
  return {
    scrollTop,
    clientHeight,
    scrollHeight,
    writes: 0,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    fire(type) { listeners.get(type)?.(); },
    listenerCount() { return listeners.size; },
  };
}

function fakeClock() {
  let t = 0;
  let queue = [];
  let id = 0;
  return {
    now: () => t,
    raf: (fn) => { id += 1; queue.push({ id, fn }); return id; },
    caf: (cancelId) => { queue = queue.filter((q) => q.id !== cancelId); },
    // Advance one frame of `ms` and run what was scheduled.
    frame(ms = 16) { t += ms; const run = queue; queue = []; run.forEach((q) => q.fn()); },
    pending: () => queue.length,
  };
}

test('plan: a short move glides the whole way', () => {
  assert.deepEqual(planPageGlide({ from: 0, to: 815, screen: 800 }), { start: 0, to: 815, jumped: false });
  assert.deepEqual(planPageGlide({ from: 815, to: 0, screen: 800 }), { start: 815, to: 0, jumped: false });
  // Up to LONG_JUMP_SCREENS screens still glides in full.
  assert.equal(planPageGlide({ from: 0, to: LONG_JUMP_SCREENS * 800, screen: 800 }).jumped, false);
});

test('plan: a long jump lands one screen short, then glides the last screen', () => {
  const down = planPageGlide({ from: 0, to: 227347, screen: 800 });
  assert.deepEqual(down, { start: 227347 - 800, to: 227347, jumped: true });
  const up = planPageGlide({ from: 227347, to: 1630, screen: 800 });
  assert.deepEqual(up, { start: 1630 + 800, to: 1630, jumped: true });
});

test('plan: nothing to move returns null', () => {
  assert.equal(planPageGlide({ from: 100, to: 100.2, screen: 800 }), null);
});

test('step: 250 ms ease-out, monotonic, lands exactly', () => {
  const g = createPageGlide({ start: 0, to: 815, now: 1000 });
  let last = -1;
  for (let t = 1000; t <= 1000 + PAGE_GLIDE_MS; t += 10) {
    const { top } = stepPageGlide(g, t);
    assert.ok(top >= last, `monotonic at ${t}`);
    last = top;
  }
  const half = stepPageGlide(g, 1000 + PAGE_GLIDE_MS / 2).top;
  assert.ok(half > 815 * 0.8, `ease-out: most of the way at half time (${half})`);
  assert.deepEqual(stepPageGlide(g, 1000 + PAGE_GLIDE_MS), { top: 815, done: true });
});

test('run: glides over ~250 ms and ends with done', () => {
  const el = fakeScroller();
  const clock = fakeClock();
  const ends = [];
  const c = startPageGlide({ el, to: 815, reducedMotion: false, onEnd: (r) => ends.push(r), ...clock });
  assert.ok(c && c.isRunning());
  let frames = 0;
  while (clock.pending() && frames < 100) { clock.frame(16); frames += 1; }
  assert.equal(el.scrollTop, 815);
  assert.deepEqual(ends, ['done']);
  assert.ok(frames >= 15 && frames <= 17, `frames ${frames}`);
  assert.equal(el.listenerCount(), 0, 'listeners removed');
});

test('run: reduced motion lands at once', () => {
  const el = fakeScroller();
  const clock = fakeClock();
  const ends = [];
  const c = startPageGlide({ el, to: 815, reducedMotion: true, onEnd: (r) => ends.push(r), ...clock });
  assert.equal(c, null);
  assert.equal(el.scrollTop, 815);
  assert.deepEqual(ends, ['instant']);
  assert.equal(clock.pending(), 0);
});

test('run: a long jump jumps first, then glides one screen', () => {
  const el = fakeScroller();
  const clock = fakeClock();
  const c = startPageGlide({ el, to: 227347, screen: 800, reducedMotion: false, ...clock });
  assert.equal(el.scrollTop, 227347 - 800, 'jumped near');
  const seen = [];
  while (clock.pending()) { clock.frame(16); seen.push(el.scrollTop); }
  assert.ok(seen.every((v) => v >= 227347 - 800 && v <= 227347), 'never passes through the pages in between');
  assert.equal(el.scrollTop, 227347);
  assert.equal(c.isRunning(), false);
});

test('run: a wheel, press or touch mid-glide stops it where it is', () => {
  for (const type of ['wheel', 'pointerdown', 'touchstart']) {
    const el = fakeScroller();
    const clock = fakeClock();
    const ends = [];
    startPageGlide({ el, to: 815, reducedMotion: false, onEnd: (r) => ends.push(r), ...clock });
    clock.frame(16); clock.frame(16); clock.frame(16);
    const at = el.scrollTop;
    assert.ok(at > 0 && at < 815);
    el.fire(type);
    clock.frame(16); clock.frame(16);
    assert.equal(el.scrollTop, at, `${type}: stays where it was`);
    assert.equal(ends.length, 1);
    assert.equal(clock.pending(), 0);
  }
});

test('run: someone else writing scrollTop stops the glide', () => {
  const el = fakeScroller();
  const clock = fakeClock();
  const ends = [];
  startPageGlide({ el, to: 815, reducedMotion: false, onEnd: (r) => ends.push(r), ...clock });
  clock.frame(16);
  el.scrollTop += 40; // a scrollbar drag / arrow key
  const at = el.scrollTop;
  clock.frame(16);
  assert.equal(el.scrollTop, at);
  assert.deepEqual(ends, ['external']);
});

test('run: a zoom (shouldStop) stops the glide', () => {
  const el = fakeScroller();
  const clock = fakeClock();
  const ends = [];
  let zooming = false;
  startPageGlide({ el, to: 815, reducedMotion: false, shouldStop: () => zooming, onEnd: (r) => ends.push(r), ...clock });
  clock.frame(16);
  zooming = true;
  const at = el.scrollTop;
  clock.frame(16);
  assert.equal(el.scrollTop, at);
  assert.deepEqual(ends, ['zoom']);
});

test('run: retarget carries on from where it is shown', () => {
  const el = fakeScroller();
  const clock = fakeClock();
  const c = startPageGlide({ el, to: 815, reducedMotion: false, ...clock });
  clock.frame(16); clock.frame(16); clock.frame(16);
  const at = el.scrollTop;
  assert.equal(c.retarget(1630), true);
  assert.equal(el.scrollTop, at, 'no jump on retarget');
  assert.equal(c.target, 1630);
  let last = at;
  while (clock.pending()) { clock.frame(16); assert.ok(el.scrollTop >= last); last = el.scrollTop; }
  assert.equal(el.scrollTop, 1630);
});

test('run: the target is clamped to the scroll range', () => {
  const el = fakeScroller({ scrollHeight: 2000, clientHeight: 800, scrollTop: 0 });
  const clock = fakeClock();
  startPageGlide({ el, to: 5000, reducedMotion: false, ...clock });
  while (clock.pending()) clock.frame(16);
  assert.equal(el.scrollTop, 1200);
});
