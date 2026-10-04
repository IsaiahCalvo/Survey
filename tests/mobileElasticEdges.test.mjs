// Phone edge rubber band + zoom-limit overshoot math (owner 2026-10-02,
// Drawboard PDF iPhone parity; numbers measured from the owner's recording).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ELASTIC_SPRING_OMEGA,
  ELASTIC_ZOOM_OVER_MAX,
  ELASTIC_ZOOM_UNDER_MIN,
  WHEEL_OVERSCROLL_IDLE_MS,
  capBounceVelocity,
  composeElasticTransform,
  createWheelOverscroll,
  criticallyDampedSpring,
  easeInOutSine,
  foldElasticLeftover,
  inverseRubberBand,
  rubberBand,
  rubberClamp,
  rubberScale,
} from '../src/utils/elasticEdges.js';

test('rubber band grows ever slower and never reaches the viewport size', () => {
  const d = 764;
  const steps = [0, 50, 100, 200, 400, 800, 1600].map((x) => rubberBand(x, d));
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] > steps[i - 1], 'monotonic');
    // sublinear: each doubling of finger travel adds less than it doubles
    if (i > 1) assert.ok(steps[i] < steps[i - 1] * 2);
  }
  assert.ok(steps.at(-1) < d);
  // iOS curve: (1 - 1 / (x * 0.55 / d + 1)) * d
  assert.ok(Math.abs(rubberBand(300, d) - (1 - 1 / (300 * 0.55 / d + 1)) * d) < 1e-9);
  assert.equal(rubberBand(-100, d), -rubberBand(100, d));
  for (const x of [1, 37, 250, 900]) assert.ok(Math.abs(inverseRubberBand(rubberBand(x, d), d) - x) < 1e-6);
});

test('rubberClamp passes values inside the range untouched', () => {
  assert.equal(rubberClamp(120, 0, 500, 800), 120);
  assert.ok(rubberClamp(600, 0, 500, 800) > 500 && rubberClamp(600, 0, 500, 800) < 600);
  assert.ok(rubberClamp(-100, 0, 500, 800) < 0 && rubberClamp(-100, 0, 500, 800) > -100);
});

test('zoom past the limits overshoots with resistance toward the Drawboard ceilings', () => {
  const min = 0.5;
  const max = 8;
  assert.equal(rubberScale(3, min, max), 3);
  let prev = max;
  for (const raw of [9, 12, 16, 32, 64, 1000]) {
    const shown = rubberScale(raw, min, max);
    assert.ok(shown > prev && shown < raw);
    prev = shown;
  }
  assert.ok(prev < max * Math.exp(ELASTIC_ZOOM_OVER_MAX)); // never past x1.8
  const under = rubberScale(0.001, min, max);
  assert.ok(under < min && under > min * Math.exp(-ELASTIC_ZOOM_UNDER_MIN)); // never under x0.43
});

test('edge spring is critically damped: no pass of the edge, home in ~0.6 s', () => {
  let minX = Infinity;
  for (let t = 0; t <= 1; t += 1 / 120) minX = Math.min(minX, criticallyDampedSpring(100, 0, t).x);
  assert.ok(minX >= 0, 'never crosses the edge');
  // measured on Drawboard: ~37% left at 200 ms, ~7% at 400 ms, ~1% at 600 ms
  // (owner 2026-10-02: the old omega 13 left 27% / 3.4% / 0.4%, too firm).
  assert.equal(ELASTIC_SPRING_OMEGA, 11);
  assert.ok(Math.abs(criticallyDampedSpring(100, 0, 0.2).x - 37) < 2);
  assert.ok(Math.abs(criticallyDampedSpring(100, 0, 0.4).x - 7) < 1);
  assert.ok(Math.abs(criticallyDampedSpring(100, 0, 0.6).x - 1) < 0.3);
  // a flick into the edge travels out and comes back, capped by the viewport
  const v = capBounceVelocity(1e6, 800);
  let peak = 0;
  for (let t = 0; t <= 1; t += 1 / 240) peak = Math.max(peak, criticallyDampedSpring(0, v, t).x);
  assert.ok(peak <= 800 * 0.3 + 1e-6);
});

test('zoom-limit return uses an ease-in-out curve', () => {
  assert.equal(easeInOutSine(0), 0);
  assert.equal(easeInOutSine(1), 1);
  assert.ok(Math.abs(easeInOutSine(0.5) - 0.5) < 1e-12);
  assert.ok(easeInOutSine(0.1) < 0.1 && easeInOutSine(0.9) > 0.9);
});

// Desktop (owner 2026-10-02): wheel / trackpad deltas past an edge go through
// the same curve, spring and 30% cap as the phone.
const D = 830;
const push = (c, deltas, { t0 = 0, dt = 16, room = 0, notch = false, axis = 'y' } = {}) => {
  let t = t0;
  for (const delta of deltas) { c.wheel(axis, { delta, room, dimension: D, notch, now: t }); t += dt; }
  return t;
};

test('desktop: a trackpad push at an edge stretches on the iOS curve and springs home', () => {
  const c = createWheelOverscroll();
  let t = push(c, Array(30).fill(5));
  const stretched = c.frame(t).y;
  assert.ok(Math.abs(stretched - rubberBand(150, D)) < 1e-6, 'iOS rubber band of the pushed px');
  assert.ok(stretched < 150 * 0.55 && stretched > 0, 'sublinear');
  t += WHEEL_OVERSCROLL_IDLE_MS;
  c.idle(t);
  assert.ok(Math.abs(c.frame(t + 200).y - criticallyDampedSpring(stretched, 0, 0.2).x) < 1e-6, 'phone release curve');
  assert.equal(c.frame(t + 1200).active, false);
});

test('desktop: scrolling inside the document is never touched', () => {
  const c = createWheelOverscroll();
  push(c, Array(30).fill(5), { room: 10000 });
  assert.equal(c.active(), false);
  assert.equal(c.frame(500).y, 0);
});

test('desktop: a crossing delta stretches only by what is past the edge', () => {
  const c = createWheelOverscroll();
  c.wheel('y', { delta: 8, room: 3, dimension: D, now: 0 });
  assert.ok(Math.abs(c.frame(1).y - rubberBand(5, D)) < 1e-9);
  const top = createWheelOverscroll();
  top.wheel('y', { delta: -8, room: 3, dimension: D, now: 0 });
  assert.ok(top.frame(1).y < 0, 'top edge pulls the other way');
});

test('desktop: momentum into an edge bounces with its speed, capped at 30% of the view, and ignores the tail', () => {
  const c = createWheelOverscroll();
  // 60 px per event at 60 Hz = 3600 px/s, then a decaying tail at the edge.
  let t = push(c, Array(6).fill(60), { room: 10000 });
  const tail = [];
  for (let v = 60; v > 0.5; v *= 0.9) tail.push(v);
  push(c, tail, { t0: t });
  let peak = 0;
  for (let k = 0; k < 120; k += 1) peak = Math.max(peak, c.frame(t + k * 8).y);
  assert.ok(peak > 20 && peak <= D * 0.3 + 1e-6, `peak ${peak}`);
  assert.equal(c.frame(t + 3000).active, false, 'home after the bounce');
});

test('desktop: a mouse notch is a small bounce that never steps more than 3 px a frame', () => {
  const c = createWheelOverscroll();
  c.wheel('y', { delta: 100, room: 0, dimension: D, notch: true, now: 0 });
  let prev = 0;
  let peak = 0;
  let maxStep = 0;
  for (let t = 0; t < 1200; t += 1000 / 60) {
    const y = c.frame(t).y;
    maxStep = Math.max(maxStep, Math.abs(y - prev));
    peak = Math.max(peak, y);
    prev = y;
  }
  assert.ok(peak > 8 && peak < 20, `peak ${peak}`);
  assert.ok(maxStep <= 3, `step ${maxStep}`);
  assert.equal(c.frame(2000).active, false);
});

// ---- owner 2026-10-04: "it gets stuck sometimes" ---------------------------
// Each test below is a case that stuck, fought or jumped before the fix
// (frame logs: scratchpad/springFix). Times are a 60 Hz event stream.
const tailOf = (start, k, n, jitter = 0.1) => Array.from({ length: n }, (_, i) => {
  const v = start * k ** i;
  return Math.max(0.2, v * (1 + jitter * ((((i * 37) % 7) - 3) / 3)));
});
const offsets = (c, from, to, step = 1000 / 60) => {
  const out = [];
  for (let t = from; t <= to; t += step) out.push(c.frame(t).y);
  return out;
};

test('desktop: a jittery macOS momentum tail at an edge releases early and is ignored (was held out for the whole tail)', () => {
  const c = createWheelOverscroll();
  let t = push(c, Array.from({ length: 25 }, (_, i) => 6 + (i % 3)));
  const tailStart = t;
  t = push(c, tailOf(9, 0.95, 70), { t0: t });
  // Home well before the tail (~1.2 s) ends: the old detector needed five
  // strictly shrinking deltas in a row and rode the jittery tail to its end.
  const during = offsets(c, tailStart, t);
  const peakAt = during.indexOf(Math.max(...during));
  assert.ok(peakAt * (1000 / 60) < 300, `released ${Math.round(peakAt * 16.7)} ms into the tail`);
  for (let i = peakAt + 1; i < during.length; i += 1) assert.ok(during[i] <= during[i - 1] + 1e-6, 'never stretches again during the tail');
  assert.ok(c.frame(tailStart + 900).y < 1, 'home while the tail is still arriving');
});

test('desktop: a momentum tail that starts after the idle release does not stretch the page again', () => {
  const c = createWheelOverscroll();
  let t = push(c, Array(25).fill(6));
  t += WHEEL_OVERSCROLL_IDLE_MS;
  c.idle(t);
  const released = c.frame(t).y;
  t += 50;
  const tailStart = t;
  t = push(c, tailOf(8, 0.94, 60, 0.05), { t0: t });
  const during = offsets(c, tailStart, t);
  assert.ok(Math.max(...during) <= released + 1e-6);
  for (let i = 1; i < during.length; i += 1) assert.ok(during[i] <= during[i - 1] + 1e-6, 'spring never fights the tail');
});

test('desktop: pushing again while it springs home catches the page where it is (no jump, no restart from 0)', () => {
  const c = createWheelOverscroll();
  let t = push(c, Array(30).fill(5));
  t += WHEEL_OVERSCROLL_IDLE_MS;
  c.idle(t);
  t += 120;
  const live = c.frame(t).y;
  assert.ok(live > 5);
  let prev = live;
  let maxStep = 0;
  for (let i = 0; i < 20; i += 1) {
    c.wheel('y', { delta: 4 + (i % 3), room: 0, dimension: D, now: t });
    const y = c.frame(t).y;
    maxStep = Math.max(maxStep, Math.abs(y - prev));
    prev = y;
    t += 16;
  }
  assert.ok(maxStep < 8, `max step ${maxStep}`);
  assert.ok(prev > live * 0.5, 'stretching again from the live offset');
});

test('desktop: a stretch always finds its way home even if the idle timer is lost', () => {
  const c = createWheelOverscroll();
  const t = push(c, Array(30).fill(5));
  // no idle() call: the frame loop's watchdog releases it
  assert.ok(c.frame(t + 100).y > 10);
  offsets(c, t + 100, t + 2500);
  assert.equal(c.frame(t + 2500).active, false);
  // blur / tab hidden / a press / a zoom start release it at once into the spring
  const d = createWheelOverscroll();
  const u = push(d, Array(30).fill(5));
  const held = d.frame(u).y;
  d.release(u);
  assert.ok(Math.abs(d.frame(u + 200).y - criticallyDampedSpring(held, 0, 0.2).x) < 1e-6);
  assert.equal(d.frame(u + 1600).active, false);
});

test('a zoom-limit ease composed under a new gesture shows exactly both transforms in turn', () => {
  const apply = (m, p) => ({ x: m.ox + m.tx + m.s * (p.x - m.ox), y: m.oy + m.ty + m.s * (p.y - m.oy) });
  const inner = { ox: 300, oy: 900, s: 1.3, tx: -12, ty: 40 };
  const outer = { ox: 120, oy: 2000, s: 1.6, tx: 7, ty: -3 };
  const c = composeElasticTransform(inner, outer);
  for (const p of [{ x: 0, y: 0 }, { x: 512, y: 1400 }, { x: -80, y: 3000 }]) {
    const want = apply(outer, apply(inner, p));
    const got = apply({ ox: inner.ox, oy: inner.oy, ...c }, p);
    assert.ok(Math.abs(want.x - got.x) < 1e-9 && Math.abs(want.y - got.y) < 1e-9);
  }
  // an identity ease changes nothing
  const same = composeElasticTransform(inner, { ox: 5, oy: 6, s: 1, tx: 0, ty: 0 });
  assert.deepEqual(same, { s: 1.3, tx: -12, ty: 40 });
  // the next leftover starts from what is shown: zoom multiplies, offsets add
  const folded = foldElasticLeftover({ ax: 1, ay: 2, z: 1.2, tx: 3, ty: 4, anim: null }, { z: 1.5, tx: -1, ty: 10 });
  assert.ok(Math.abs(folded.z - 1.8) < 1e-12);
  assert.deepEqual({ ...folded, z: 1.8 }, { ax: 1, ay: 2, z: 1.8, tx: 2, ty: 14, anim: null });
  assert.equal(foldElasticLeftover(folded, null), folded);
});

test('desktop: a hiccup in the event stream mid-tail does not restart the stretch', () => {
  const c = createWheelOverscroll();
  let t = push(c, Array(25).fill(7));
  t = push(c, tailOf(7, 0.93, 25, 0.05), { t0: t });
  t += WHEEL_OVERSCROLL_IDLE_MS;
  c.idle(t);
  t += 60; // events held up by a busy main thread, then the tail goes on
  const resumed = t;
  t = push(c, tailOf(1.6, 0.97, 30, 0.3), { t0: t });
  const during = offsets(c, resumed, t);
  for (let i = 1; i < during.length; i += 1) assert.ok(during[i] <= during[i - 1] + 1e-6, 'no re-stretch');
  // a clear new push after it still stretches
  t += 200;
  push(c, Array(12).fill(9), { t0: t });
  assert.ok(c.frame(t + 12 * 16).y > 5);
});
