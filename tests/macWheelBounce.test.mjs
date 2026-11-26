// Nightly `native-bounce` (owner 2026-11-25: "the page spring-back is not 100%
// like Drawboard ... This should be some native thing"). Real trackpad
// recordings (tests/fixtures/mac-trackpad, macOS Safari / Chrome and Windows
// Chrome) are replayed against a page already at its edge, the way the viewer
// feeds createWheelOverscroll, and the drawn offset is sampled every frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ELASTIC_MAX_BOUNCE_FRACTION,
  MAC_RUBBERBAND_AMPLITUDE,
  MAC_RUBBERBAND_DECAY,
  WHEEL_OVERSCROLL_IDLE_MS,
  createWheelOverscroll,
  macRubberBandSpring,
} from '../src/utils/elasticEdges.js';

const D = 800;
const FRAME = 1000 / 60;

function load(name) {
  const url = new URL(`./fixtures/mac-trackpad/${name}.json`, import.meta.url);
  const { wheelEvents } = JSON.parse(fs.readFileSync(url, 'utf8'));
  const sum = (key) => wheelEvents.reduce((a, e) => a + Math.abs(e[key]), 0);
  const key = sum('deltaY') >= sum('deltaX') ? 'deltaY' : 'deltaX';
  const sign = Math.sign(wheelEvents.reduce((a, e) => a + e[key], 0));
  const t0 = wheelEvents[0].timeStamp;
  // Always pushing toward the far edge, so + offsets are past it.
  return wheelEvents.map((e) => ({ t: e.timeStamp - t0, d: e[key] * sign }));
}

/** Replay events into a controller with the viewer's idle timer; sample each frame. */
function replay(events, { mac = true, room = 0 } = {}) {
  const c = createWheelOverscroll({ mac });
  let left = room;
  let i = 0;
  let idleAt = Infinity;
  const frames = [];
  const end = events.at(-1).t + 1500;
  for (let t = 0; t <= end; t += 1) {
    while (i < events.length && events[i].t <= t) {
      const { d } = events[i];
      c.wheel('y', { delta: d, room: left, dimension: D, cancelable: true, now: t });
      left = Math.max(0, left - Math.abs(d));
      idleAt = t + WHEEL_OVERSCROLL_IDLE_MS;
      i += 1;
    }
    if (t >= idleAt) { c.idle(t); idleAt = Infinity; }
    if (t % 4 === 0) frames.push({ t, y: c.frame(t).y });
  }
  return frames;
}

// Where the fingers lifted: an event after a pause that carries more than the
// fingers' last ones (or Chrome on Windows' empty event). A second swipe
// starts after the first one's momentum has faded to a few px.
function liftTimes(events) {
  const lifts = [];
  let armed = true;
  for (let i = 2; i < events.length; i += 1) {
    const { d } = events[i];
    if (!armed) {
      if (events[i].t - events[i - 1].t > 30 && Math.abs(d) < Math.abs(events[i - 1].d)) armed = true;
      else continue;
    }
    const gap = events[i].t - events[i - 1].t;
    const before = events[i - 1].t - events[i - 2].t;
    if (d === 0 || (gap >= 18 && gap >= 1.4 * before && Math.abs(d) > Math.abs(events[i - 1].d))) {
      lifts.push({ t: events[i].t, i });
      armed = false;
    }
  }
  return lifts;
}

const peakOf = (frames) => frames.reduce((best, f) => (f.y > best.y ? f : best), { t: 0, y: -Infinity });

const SWIPES = ['swipe-down-trackpad', 'swipe-up-trackpad', 'swipe-left-fast-trackpad', 'swipe-right', 'double-swipe-right', 'win-chrome-right-ptp', 'win-chrome-fast-right-ptp'];

test('Mac curve: home at once from rest, a lift still moving runs on a little first (Blink / WebKit)', () => {
  const k = MAC_RUBBERBAND_DECAY;
  assert.ok(Math.abs(macRubberBandSpring(100, 0, 0.1).x - 100 * Math.exp(-k * 0.1)) < 1e-9);
  const { v } = macRubberBandSpring(100, 0, 0);
  assert.ok(v < -1000, `starts home at full speed (${v} px/s), no slow start`);
  const moving = macRubberBandSpring(50, MAC_RUBBERBAND_AMPLITUDE * 3000, 0.04).x;
  assert.ok(moving > 50, 'runs on past where it was let go');
  assert.ok(macRubberBandSpring(200, 0, 0.6).x < 0.2, 'home in ~0.6 s');
});

for (const name of SWIPES) {
  test(`real swipe at an edge (${name}): springs home the moment the fingers lift`, () => {
    const events = load(name);
    const lifts = liftTimes(events);
    assert.ok(lifts.length >= 1, 'the recording shows a lift');
    const frames = replay(events);
    // Each swipe on its own: from its first event to the next swipe's.
    const starts = [0, ...lifts.slice(1).map((l) => {
      let j = l.i;
      while (j > 0 && !(events[j].t - events[j - 1].t > 30)) j -= 1;
      return events[j].t;
    })];
    lifts.forEach((lift, n) => {
      const until = starts[n + 1] ?? Infinity;
      const own = frames.filter((f) => f.t >= starts[n] && f.t < until);
      const peak = peakOf(own);
      assert.ok(peak.t <= lift.t + 70, `peak at ${peak.t} ms, fingers lifted at ${lift.t} ms`);
      // After the peak it only goes home: the momentum never stretches it again.
      const after = own.filter((f) => f.t > peak.t);
      for (let j = 1; j < after.length; j += 1) assert.ok(after[j].y <= after[j - 1].y + 1e-6, `re-stretch at ${after[j].t} ms`);
    });
    const last = lifts.at(-1).t;
    assert.ok(frames.find((f) => f.t >= last + 600).y < 3, 'nearly home 0.6 s after the lift');
    // The old controller held the page out well past the first lift.
    const old = replay(events, { mac: false });
    const oldOwn = old.filter((f) => f.t < (starts[1] ?? Infinity));
    const oldMax = peakOf(oldOwn).y;
    const oldHeldUntil = oldOwn.filter((f) => f.y >= oldMax - 1).at(-1).t;
    if (!name.startsWith('win-')) assert.ok(oldHeldUntil > lifts[0].t + 70, `the old one started home at ${oldHeldUntil} ms`);
  });
}

test('real swipes never sit flat against a wall (the old one held at the 30% cap)', () => {
  for (const name of SWIPES) {
    const frames = replay(load(name));
    const cap = D * ELASTIC_MAX_BOUNCE_FRACTION;
    const atCap = frames.filter((f) => f.y > cap - 1).length;
    assert.equal(atCap, 0, `${name}: ${atCap * 4} ms at the cap`);
    const oldAtCap = replay(load(name), { mac: false }).filter((f) => f.y > cap - 1).length;
    if (name === 'swipe-down-trackpad') assert.ok(oldAtCap * 4 > 100, 'the old one sat on the cap');
  }
});

test('a slow pull follows the fingers out and never springs back while they still pull', () => {
  const events = load('slow-drag-right');
  const frames = replay(events);
  const lastEvent = events.at(-1).t;
  const pulling = frames.filter((f) => f.t > 200 && f.t <= lastEvent);
  for (let j = 1; j < pulling.length; j += 1) assert.ok(pulling[j].y >= pulling[j - 1].y - 1e-6, `pulled back at ${pulling[j].t} ms`);
  // The old one let go part-way through the pull.
  const old = replay(events, { mac: false }).filter((f) => f.t > 200 && f.t <= lastEvent);
  assert.ok(old.some((f, j) => j && f.y < old[j - 1].y - 1), 'the old one let go mid-pull');
  // Once the fingers stop, home on the Mac curve.
  assert.ok(frames.find((f) => f.t >= lastEvent + WHEEL_OVERSCROLL_IDLE_MS + 600).y < 1);
});

test('momentum running into the edge gives a small bounce, then ignores the rest', () => {
  for (const [name, room] of [['swipe-down-fast-trackpad', 1500], ['swipe-right-fast', 2500], ['swipe-down-trackpad', 300]]) {
    const frames = replay(load(name), { room });
    const peak = peakOf(frames);
    assert.ok(peak.y > 20 && peak.y <= D * 0.12 + 1, `${name}: bounce ${peak.y.toFixed(1)} px`);
    const after = frames.filter((f) => f.t > peak.t);
    for (let j = 1; j < after.length; j += 1) assert.ok(after[j].y <= after[j - 1].y + 1e-6, `${name}: re-stretch`);
  }
});

test('scrolling inside the document is never touched', () => {
  const frames = replay(load('swipe-down-trackpad'), { room: 100000 });
  assert.ok(frames.every((f) => f.y === 0));
});

test('no jumps of its own: going home moves a little each frame, and a stretch never outruns the fingers', () => {
  for (const name of SWIPES) {
    const events = load(name);
    const frames = replay(events).filter((f) => f.t % 16 === 0);
    const lift = liftTimes(events)[0].t;
    let maxStep = 0;
    for (let j = 1; j < frames.length; j += 1) {
      if (frames[j].t > lift) maxStep = Math.max(maxStep, Math.abs(frames[j].y - frames[j - 1].y));
    }
    assert.ok(maxStep < 45, `${name}: ${maxStep.toFixed(1)} px in one frame going home`);
    const old = replay(events, { mac: false }).filter((f) => f.t % 16 === 0);
    frames.forEach((f, j) => { if (f.t < lift) assert.ok(f.y <= old[j].y + 1e-6, `${name}: further out than before at ${f.t} ms`); });
  }
});

test('pushing again while it springs home catches the page where it is', () => {
  const c = createWheelOverscroll({ mac: true });
  let t = 0;
  for (let i = 0; i < 30; i += 1) { c.wheel('y', { delta: 6, room: 0, dimension: D, now: t }); t += 8; }
  t += WHEEL_OVERSCROLL_IDLE_MS;
  c.idle(t);
  t += 40;
  const live = c.frame(t).y;
  assert.ok(live > 3);
  let prev = live;
  for (let i = 0; i < 20; i += 1) {
    c.wheel('y', { delta: 6, room: 0, dimension: D, now: t });
    const y = c.frame(t).y;
    assert.ok(Math.abs(y - prev) < 8, 'no jump');
    prev = y;
    t += 8;
  }
  assert.ok(prev > live, 'stretching again from where it was');
});

test('a stretch always finds its way home, even with no idle timer', () => {
  const c = createWheelOverscroll({ mac: true });
  let t = 0;
  for (let i = 0; i < 30; i += 1) { c.wheel('y', { delta: 6, room: 0, dimension: D, now: t }); t += 8; }
  assert.ok(c.frame(t).y > 10);
  for (let u = t; u < t + 2500; u += FRAME) c.frame(u);
  assert.equal(c.frame(t + 2500).active, false);
});

test('a mouse notch is still a small, quick bounce', () => {
  const c = createWheelOverscroll({ mac: true });
  c.wheel('y', { delta: 100, room: 0, dimension: D, notch: true, now: 0 });
  let peak = 0;
  for (let t = 0; t < 600; t += FRAME) peak = Math.max(peak, c.frame(t).y);
  assert.ok(peak > 2 && peak < D * 0.03 + 1, `peak ${peak}`);
  assert.equal(c.frame(700).active, false);
});

test('without the flag the old controller is unchanged', () => {
  const a = replay(load('swipe-down-trackpad'), { mac: false });
  assert.ok(peakOf(a).y > D * ELASTIC_MAX_BOUNCE_FRACTION - 1);
});
