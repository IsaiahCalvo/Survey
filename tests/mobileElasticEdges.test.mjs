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
  composeReleaseLeftover,
  createLayoutShiftHold,
  createOffsetSpring,
  createWheelOverscroll,
  criticallyDampedSpring,
  easeInOutSine,
  inverseRubberBand,
  resolveEdgeRelease,
  resolveElasticPanStep,
  resolveFitCentreShift,
  rubberBand,
  rubberBandSlope,
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
  // no ease under the pinch: its own leftover, untouched
  const own = { ax: 1, ay: 2, z: 1.2, tx: 3, ty: 4, anim: null };
  assert.equal(composeReleaseLeftover(own, null), own);
});

// Review 9 / robust 10 (item 1): a pinch ending while the previous zoom-limit
// ease is still running. The release leftover must be the picture the last
// frame drew (the ease nested OUTSIDE the pinch), for any pivots and a zoom
// change. The old fold (zoom multiplies, offsets add) was only that picture
// when both pivots were the same point.
test('pinch release over a running zoom ease keeps every page point where the last frame drew it', () => {
  const apply = (m, p) => ({ x: m.ox + m.tx + m.s * (p.x - m.ox), y: m.oy + m.ty + m.s * (p.y - m.oy) });
  // Model: old layout point p (scroll space); the commit lays out at k x the
  // old scale (L(p) = k p) and moves the scroll from S0 to S1.
  const cases = [
    { name: 'same pivot', k: 1, a: { x: 400, y: 900 }, e: { x: 400, y: 900 }, S0: { x: 200, y: 600 }, S1: { x: 200, y: 600 } },
    { name: 'pivots 150 px apart', k: 1, a: { x: 400, y: 900 }, e: { x: 550, y: 900 }, S0: { x: 200, y: 600 }, S1: { x: 200, y: 600 } },
    { name: 'zoom change + scroll move', k: 0.8, a: { x: 400, y: 900 }, e: { x: 250, y: 1010 }, S0: { x: 200, y: 600 }, S1: { x: 130, y: 470 } },
  ];
  let oldWorst = 0;
  for (const c of cases) {
    // live pinch preview G (pivot a, old layout) and the ease E (8% of a x1.8 bounce left)
    const G = { ox: c.a.x, oy: c.a.y, s: 1.35, tx: -14, ty: 22 };
    const E = { ax: c.e.x, ay: c.e.y, z: 1.8 ** 0.08, tx: 3, ty: -5 };
    const shown = (p) => {
      const q = apply({ ox: E.ax, oy: E.ay, s: E.z, tx: E.tx, ty: E.ty }, apply(G, p));
      return { x: q.x - c.S0.x, y: q.y - c.S0.y };
    };
    // the pinch's own leftover, as commitGesture builds it
    const A = { x: c.k * c.a.x, y: c.k * c.a.y };
    const anchorShown = { x: c.a.x + G.tx - c.S0.x, y: c.a.y + G.ty - c.S0.y };
    const pinch = {
      ax: A.x, ay: A.y, z: G.s / c.k, tx: anchorShown.x - (A.x - c.S1.x), ty: anchorShown.y - (A.y - c.S1.y),
    };
    const R = composeReleaseLeftover(pinch, E, { scrollShiftX: c.S1.x - c.S0.x, scrollShiftY: c.S1.y - c.S0.y });
    const naive = { ...pinch, z: pinch.z * E.z, tx: pinch.tx + E.tx, ty: pinch.ty + E.ty };
    for (const p of [{ x: 0, y: 0 }, { x: 400, y: 900 }, { x: 900, y: 1500 }, { x: -50, y: 2400 }]) {
      const want = shown(p);
      const L = { x: c.k * p.x, y: c.k * p.y };
      const got = apply({ ox: R.ax, oy: R.ay, s: R.z, tx: R.tx, ty: R.ty }, L);
      assert.ok(Math.hypot(got.x - c.S1.x - want.x, got.y - c.S1.y - want.y) < 1e-6, `${c.name}: no jump in the release frame`);
      const old = apply({ ox: naive.ax, oy: naive.ay, s: naive.z, tx: naive.tx, ty: naive.ty }, L);
      oldWorst = Math.max(oldWorst, Math.hypot(old.x - c.S1.x - want.x, old.y - c.S1.y - want.y));
    }
  }
  assert.ok(oldWorst > 5, `the old fold jumped ${oldWorst.toFixed(1)} px`);
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

// ---- iOS bottom push (Appetize, iPhone 16 Pro / iOS 26, 2026-10-06) --------
// A one-page PDF that fits the screen has no scroll range: every pixel of a
// push is past an edge, and the page must move WITH the finger.
test('phone: a page that fits the screen stretches in the finger direction at both edges', () => {
  const d = 764;
  let s = { scroll: 0, excess: 0 };
  const shown = [];
  for (let i = 0; i < 40; i += 1) {
    const step = resolveElasticPanStep({ scroll: s.scroll, max: 0, excess: s.excess, delta: -8.5, dimension: d });
    s = step;
    shown.push(step.shown);
  }
  assert.equal(s.scroll, 0);
  assert.ok(s.excess > 0, 'push up = past the bottom (far) end');
  for (let i = 1; i < shown.length; i += 1) assert.ok(shown[i] < shown[i - 1], 'moves up every step, never down');
  assert.ok(Math.abs(shown.at(-1) + rubberBand(340, d)) < 1e-6, '340 px of finger = the iOS rubber band');
  // pulling down past the top edge mirrors it
  const pull = resolveElasticPanStep({ scroll: 0, max: 0, excess: 0, delta: 340, dimension: d });
  assert.ok(pull.excess < 0 && pull.shown > 0);
  assert.ok(Math.abs(pull.shown - rubberBand(340, d)) < 1e-6);
  // a page that scrolls uses its range first, then stretches
  const long = resolveElasticPanStep({ scroll: 90, max: 100, excess: 0, delta: -30, dimension: d });
  assert.equal(long.scroll, 100);
  assert.ok(Math.abs(long.excess - 20) < 1e-9 && long.shown < 0);
  // a scroll range that vanished mid-gesture (browser clamp) never turns into a
  // stretch the other way
  const clamped = resolveElasticPanStep({ scroll: 300, max: 0, excess: 10, delta: -5, dimension: d });
  assert.equal(clamped.scroll, 0);
  assert.ok(Math.abs(clamped.excess - 15) < 1e-9 && clamped.shown < 0);
});

test('phone: only a viewer resize at the same zoom and strip room moves the fit centre', () => {
  const base = { scale: 1, room: 0, height: 740, centerPad: 152 };
  // Safari's toolbar collapses: the viewer grows 290 px, the centre drops 145
  assert.equal(resolveFitCentreShift(base, { ...base, height: 1030, centerPad: 297 }), 145);
  assert.equal(resolveFitCentreShift(base, { ...base, height: 450, centerPad: 7 }), -145);
  assert.equal(resolveFitCentreShift(null, base), 0, 'first measure is not a move');
  assert.equal(resolveFitCentreShift(base, { ...base, scale: 1.2, height: 1030, centerPad: 200 }), 0, 'a zoom keeps its own anchor');
  assert.equal(resolveFitCentreShift(base, { ...base, room: 44, centerPad: 152 }), 0, 'strip room keeps the page still on its own');
  assert.equal(resolveFitCentreShift(base, { ...base, height: 1030, centerPad: 152 }), 0, 'a page taller than the view does not move');
});

test('phone: a viewer resize mid-push is held off screen, then glides to the new centre in ~0.6 s', () => {
  const hold = createLayoutShiftHold();
  // Finger down, pushing up; at t=500 the viewer grows and the centre would drop 145 px.
  hold.absorb(145, 500, { held: true });
  // While the finger is down nothing moves: the drawn offset exactly cancels the drop.
  for (const t of [500, 700, 1200]) assert.equal(hold.frame(t).y, -145);
  assert.ok(hold.held());
  // The viewer shrinks back before the lift: the two cancel out exactly.
  hold.absorb(-60, 1300, { held: true });
  assert.equal(hold.frame(1300).y, -85);
  hold.release(2000);
  // After the lift: the edge spring (critically damped), never past the new centre.
  const ys = [];
  for (let t = 2000; t <= 3000; t += 1000 / 60) ys.push(hold.frame(t).y);
  for (let i = 1; i < ys.length; i += 1) {
    assert.ok(ys[i] >= ys[i - 1] - 1e-9, 'one way only, toward the new place');
    assert.ok(ys[i] <= 0, 'never overshoots');
    assert.ok(ys[i] - ys[i - 1] < 15, 'no frame jumps (85 px glide, ~11 px/frame peak)');
  }
  assert.ok(Math.abs(criticallyDampedSpring(-85, 0, 0.6).x) < 1.5);
  assert.ok(Math.abs(hold.frame(2600).y) < 1.5, 'home within ~0.6 s');
  assert.equal(hold.frame(3100).active, false);
  assert.equal(hold.active(), false);
});

test('phone: a viewer resize while the page springs home joins the spring (no jump)', () => {
  const hold = createLayoutShiftHold();
  hold.absorb(40, 0, { held: false }); // after the lift: springs at once
  const before = hold.frame(100).y;
  hold.absorb(-40, 100); // the toolbar comes back mid-spring
  const after = hold.frame(100).y;
  assert.ok(Math.abs(after - (before + 40)) < 1e-9, 'what is shown does not move in that frame');
  let prev = after;
  for (let t = 100; t < 1000; t += 16) {
    const y = hold.frame(t).y;
    assert.ok(Math.abs(y - prev) < 12);
    prev = y;
  }
  assert.equal(hold.active(), false);
});

// Review 9 / robust 10 (item 2): a one-finger pan that reaches an edge during a
// zoom-limit bounce. Its edge offset rides on top of the bounce in its own
// spring; the bounce is never replaced (it used to snap x1.5 -> x1 in a frame).
test('pan over a running bounce: the edge offset is held, then springs home on its own clock', () => {
  const edge = createOffsetSpring();
  assert.equal(edge.frame(0).active, false);
  edge.set(0, 60);
  assert.ok(edge.held());
  assert.deepEqual(edge.frame(500), { x: 0, y: 60, active: true }, 'held while the finger is down');
  edge.release(1000);
  let prev = 60;
  for (let t = 1000; t <= 2000; t += 1000 / 60) {
    const f = edge.frame(t);
    assert.ok(f.y <= prev + 1e-9 && f.y >= 0, 'one way home, never past the edge');
    assert.ok(prev - f.y < 9, 'no frame jumps');
    prev = f.y;
  }
  assert.equal(edge.active(), false);
  // set(0, 0) clears it at once (a pinch takes the pull over)
  edge.set(5, 5);
  edge.set(0, 0);
  assert.equal(edge.active(), false);
});

// ---- side to side, both extents (owner 2026-10-07) ---------------------------
// "I should be able to go from side to side, both extents, just to continually
// spring back, but there's this thing where it gets stuck in the middle."
// Letting go while pulled past an edge used to drop that axis' speed: the page
// stopped dead in the release frame, then crept back from rest.
test('rubber band slope: the give per px of finger, steepest at the edge', () => {
  const d = 764;
  assert.ok(Math.abs(rubberBandSlope(0, d) - 0.55) < 1e-12);
  for (const x of [10, 80, 300, -120]) {
    const h = 1e-3;
    const numeric = (rubberBand(Math.abs(x) + h, d) - rubberBand(Math.abs(x) - h, d)) / (2 * h);
    assert.ok(Math.abs(rubberBandSlope(x, d) - numeric) < 1e-6, `matches rubberBand's derivative at ${x}`);
  }
  assert.ok(rubberBandSlope(400, d) < rubberBandSlope(100, d));
});

test('release past an edge: the page carries on at its own speed, never a dead stop', () => {
  const d = 354;
  const frame = 1000 / 60;
  // A fitting page pulled right (left edge showing), finger flicking left
  // back across the middle at 1.2 px/ms, let go before the middle.
  let s = { scroll: 0, excess: 0, shown: 0 };
  s = resolveElasticPanStep({ scroll: 0, max: 0, excess: 0, delta: 150, dimension: d });
  const shownBefore = s.shown;
  const step = resolveElasticPanStep({ scroll: 0, max: 0, excess: s.excess, delta: -1.2 * frame, dimension: d });
  const pageV = (step.shown - shownBefore) / frame; // px/ms the page was moving
  const r = resolveEdgeRelease({ shown: step.shown, excess: step.excess, velocity: -1.2, dimension: d, room: false });
  assert.equal(r.glide, 0, 'nothing to scroll on a fitting axis');
  assert.ok(Math.abs(r.spring / 1000 - pageV) < 0.05 * Math.abs(pageV), 'spring starts at the page speed');
  // First frame after the lift keeps moving the same way, about as far.
  const first = criticallyDampedSpring(step.shown, r.spring, frame / 1000).x - step.shown;
  assert.ok(Math.sign(first) === Math.sign(pageV) && Math.abs(first) > 0.7 * Math.abs(pageV * frame), 'no dead stop');
  // ...and a hard flick swings through the middle and springs back from the other side.
  const hard = resolveEdgeRelease({ shown: 40, excess: inverseRubberBand(-40, d), velocity: -3, dimension: d, room: false });
  let crossed = false;
  let end = 0;
  for (let t = 0; t <= 1.5; t += 1 / 60) {
    end = criticallyDampedSpring(40, hard.spring, t).x;
    if (end < -0.5) crossed = true;
  }
  assert.ok(crossed, 'swings past the middle');
  assert.ok(Math.abs(end) < 0.2, 'and settles in the middle');
});

test('release past an edge heading back into a scrollable document glides at the finger speed', () => {
  const r = resolveEdgeRelease({ shown: 30, excess: -60, velocity: -2, dimension: 354, room: true });
  assert.deepEqual(r, { glide: -2, spring: 0 }, 'glide takes the flick, the stretch springs home on top from rest');
  // Not pulled past anything: a plain flick.
  assert.deepEqual(resolveEdgeRelease({ shown: 0, excess: 0, velocity: 1.5, dimension: 354, room: true }), { glide: 1.5, spring: 0 });
  // A slow drift back in (would glide less than the stretch) springs instead,
  // so it still lands exactly on the edge, carrying its speed.
  const slow = resolveEdgeRelease({ shown: 30, excess: -60, velocity: -0.05, dimension: 354, room: true });
  assert.equal(slow.glide, 0);
  assert.ok(slow.spring < 0);
  for (let t = 0; t <= 1.5; t += 1 / 60) assert.ok(criticallyDampedSpring(30, slow.spring, t).x > -1e-9, 'never past the edge into the page');
  // Let go without moving: springs home from rest, as before.
  assert.deepEqual(resolveEdgeRelease({ shown: 30, excess: -60, velocity: 0, dimension: 354, room: true }), { glide: 0, spring: 0 });
});

test('release past an edge heading further out: runs on a little, capped, then comes home', () => {
  const d = 354;
  const r = resolveEdgeRelease({ shown: 50, excess: -110, velocity: 1.2, dimension: d, room: true });
  assert.equal(r.glide, 0, 'no scroll that way');
  assert.ok(r.spring > 0);
  let peak = 50;
  for (let t = 0; t <= 1.5; t += 1 / 60) peak = Math.max(peak, criticallyDampedSpring(50, r.spring, t).x);
  assert.ok(peak > 50 && peak < 50 + d * 0.3, 'goes on a little, never past the 30% cap');
  assert.ok(Math.abs(criticallyDampedSpring(50, r.spring, 1.5).x) < 0.5, 'home');
  // An absurd flick is capped like a flick into an edge.
  const wild = resolveEdgeRelease({ shown: 5, excess: -9, velocity: 400, dimension: d, room: false });
  assert.equal(wild.spring, capBounceVelocity(1e9, d));
});

test('pan over a running bounce: a release with speed starts the edge spring at that speed', () => {
  const edge = createOffsetSpring();
  edge.set(40, 0);
  edge.release(0, { vx: -600 });
  const a = edge.frame(1000 / 60);
  assert.ok(a.x < 40 - 600 / 60 * 0.7, 'moves on at once');
  assert.equal(edge.frame(2000).active, false);
});
