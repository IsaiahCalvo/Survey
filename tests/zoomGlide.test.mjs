import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM_CHASE_TAU_MS,
  ZOOM_GLIDE_DONE_LOG,
  ZOOM_GLIDE_MS,
  createZoomGlide,
  easeOutCubic,
  retargetZoomGlide,
  stepZoomGlide,
} from '../src/utils/zoomGlide.js';

const FRAME = 1000 / 60;

// Run a glide frame by frame from `t` until it lands; returns the shown scales.
function play(glide, t, maxFrames = 200) {
  const shown = [];
  let g = glide;
  let now = t;
  for (let i = 0; i < maxFrames && !g.done; i += 1) {
    now += FRAME;
    g = stepZoomGlide(g, now);
    shown.push(g.shown);
  }
  return { g, shown, now };
}

const isMonotonic = (values, dir) => values.every((v, i) => i === 0 || (dir > 0 ? v >= values[i - 1] : v <= values[i - 1]));

test('easeOutCubic runs 0 -> 1, fast first, and clamps', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(-1), 0);
  assert.equal(easeOutCubic(2), 1);
  assert.ok(easeOutCubic(0.25) > 0.5, 'most of the way in the first quarter (ease-out)');
});

test('a button glide lands exactly on its target in ~ZOOM_GLIDE_MS, monotonic', () => {
  const { g, shown, now } = play(createZoomGlide({ from: 1, to: 1.2, now: 0, mode: 'tween' }), 0);
  assert.equal(g.done, true);
  assert.equal(g.shown, 1.2, 'lands on the exact target (same final scale as the old snap)');
  assert.ok(now >= ZOOM_GLIDE_MS && now <= ZOOM_GLIDE_MS + 2 * FRAME, `took ${now} ms`);
  assert.ok(isMonotonic(shown, 1));
  assert.ok(shown.length >= 12, 'about 13 frames at 60 fps, not a jump');
  // ease-out: the first frame moves further than the last one
  const first = Math.log(shown[0] / 1);
  const last = Math.log(shown.at(-1) / shown.at(-2));
  assert.ok(first > last);
});

test('zoom out glides down monotonically and lands exactly', () => {
  const { g, shown } = play(createZoomGlide({ from: 2, to: 2 / 1.2, now: 0 }), 0);
  assert.equal(g.shown, 2 / 1.2);
  assert.ok(isMonotonic(shown, -1));
});

test('the first frame always moves, even if its time stamp is before the press', () => {
  const g = stepZoomGlide(createZoomGlide({ from: 1, to: 2, now: 100 }), 95);
  assert.ok(g.shown > 1);
});

test('a second press mid-glide carries on from what is shown: no jump back, one continuous glide', () => {
  let g = createZoomGlide({ from: 1, to: 1.2, now: 0 });
  const shown = [];
  let now = 0;
  for (let i = 0; i < 4; i += 1) { now += FRAME; g = stepZoomGlide(g, now); shown.push(g.shown); }
  const before = g.shown;
  g = retargetZoomGlide(g, { to: 1.2 * 1.2, now });
  assert.equal(g.from, before, 'restarts from the shown scale, not from 1');
  const rest = play(g, now);
  shown.push(...rest.shown);
  assert.ok(isMonotonic(shown, 1), 'never steps back');
  assert.equal(rest.g.shown, 1.44, 'two quick presses land where two slow presses would');
  // no jolt: the frame after the second press moves about as fast as the one
  // before it (within 40%), where a restarted ease-out would jump ~2x
  const steps = shown.map((v, i) => Math.log(v / (i ? shown[i - 1] : 1)));
  const ratio = steps[4] / steps[3];
  assert.ok(ratio > 0.8 && ratio < 1.4, `speed ratio across the press ${ratio.toFixed(2)}`);
});

test('a press as a glide comes to rest still answers at once', () => {
  let g = createZoomGlide({ from: 1, to: 1.2, now: 0 });
  g = stepZoomGlide(g, ZOOM_GLIDE_MS - 1);
  g = retargetZoomGlide(g, { to: 1.44, now: ZOOM_GLIDE_MS - 1 });
  const next = stepZoomGlide(g, ZOOM_GLIDE_MS - 1 + FRAME);
  assert.ok(Math.log(next.shown / g.from) > 0.1 * Math.log(1.44 / g.from), 'covers over a tenth of the way on its first frame');
});

test('carried speed never makes a glide overshoot (monotonic for any carried speed)', () => {
  for (const v of [0, 0.001, 0.01, 0.1, -0.01]) {
    const g = retargetZoomGlide({ ...createZoomGlide({ from: 1.1, to: 1.2, now: 0 }), velocity: v }, { to: 1.3, now: 0 });
    const { shown, g: end } = play(g, 0);
    assert.ok(isMonotonic([1.1, ...shown], 1), `velocity ${v}`);
    assert.ok(shown.every((s) => s <= 1.3 + 1e-12));
    assert.equal(end.shown, 1.3);
  }
});

test('pressing in then out returns to the start without overshoot below it', () => {
  let g = createZoomGlide({ from: 1, to: 1.2, now: 0 });
  let now = 0;
  for (let i = 0; i < 5; i += 1) { now += FRAME; g = stepZoomGlide(g, now); }
  g = retargetZoomGlide(g, { to: 1, now });
  const { g: end, shown } = play(g, now);
  assert.equal(end.shown, 1);
  assert.ok(shown.every((v) => v >= 1 - 1e-12));
  assert.ok(isMonotonic(shown, -1));
});

test('wheel chase: each notch adds to the target, shown closes in exponentially and lands', () => {
  const notch = 1.156;
  let g = createZoomGlide({ from: 1, to: notch, now: 0, mode: 'chase' });
  const shown = [];
  let now = 0;
  // three notches 50 ms apart
  for (let n = 1; n < 3; n += 1) {
    for (let i = 0; i < 3; i += 1) { now += FRAME; g = stepZoomGlide(g, now); shown.push(g.shown); }
    g = retargetZoomGlide(g, { to: g.target * notch, now, mode: 'chase' });
  }
  const rest = play(g, now);
  shown.push(...rest.shown);
  assert.ok(isMonotonic(shown, 1));
  assert.ok(Math.abs(rest.g.shown - notch ** 3) < 1e-12, 'lands on exactly three notches');
  // settles within ~5 time constants of the last notch
  assert.ok(rest.now - now < 6 * ZOOM_CHASE_TAU_MS, `settled ${rest.now - now} ms after the last notch`);
});

test('chase is frame-rate independent', () => {
  const at = (fps) => {
    let g = createZoomGlide({ from: 1, to: 2, now: 0, mode: 'chase' });
    for (let t = 1000 / fps; t <= 100 + 1e-9; t += 1000 / fps) g = stepZoomGlide(g, t);
    return g.shown;
  };
  assert.ok(Math.abs(Math.log(at(60) / at(120))) < 0.01);
  assert.ok(Math.abs(Math.log(at(30) / at(120))) < 0.01);
});

test('a chase lands once within ZOOM_GLIDE_DONE_LOG of its target', () => {
  let g = createZoomGlide({ from: 1, to: 1.002, now: 0, mode: 'chase' });
  g = stepZoomGlide(g, 4 * ZOOM_CHASE_TAU_MS);
  assert.ok(Math.log(1.002) * Math.exp(-4) < ZOOM_GLIDE_DONE_LOG);
  assert.equal(g.done, true);
  assert.equal(g.shown, 1.002);
});

test('a stalled frame does not leap the whole chase in one step', () => {
  const g = stepZoomGlide(createZoomGlide({ from: 1, to: 2, now: 0, mode: 'chase' }), 1000);
  assert.ok(g.shown < 2 && !g.done);
});

test('a button press during a wheel chase switches to the eased glide from the shown scale', () => {
  let g = createZoomGlide({ from: 1, to: 1.3, now: 0, mode: 'chase' });
  g = stepZoomGlide(g, FRAME);
  const shown = g.shown;
  g = retargetZoomGlide(g, { to: 1.3 * 1.2, now: FRAME, mode: 'tween' });
  assert.equal(g.mode, 'tween');
  assert.equal(g.from, shown);
  const { g: end } = play(g, FRAME);
  assert.equal(end.shown, 1.56);
});

test('bad input never produces NaN', () => {
  const g = stepZoomGlide(createZoomGlide({ from: 0, to: NaN, now: 0 }), 50);
  assert.ok(Number.isFinite(g.shown) && g.shown > 0);
  assert.equal(stepZoomGlide(null, 10), null);
});
