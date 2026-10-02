// Phone edge rubber band + zoom-limit overshoot math (owner 2026-10-02,
// Drawboard PDF iPhone parity; numbers measured from the owner's recording).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ELASTIC_ZOOM_OVER_MAX,
  ELASTIC_ZOOM_UNDER_MIN,
  capBounceVelocity,
  criticallyDampedSpring,
  easeInOutSine,
  inverseRubberBand,
  rubberBand,
  rubberClamp,
  rubberScale,
} from '../src/utils/mobileElasticEdges.js';

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
  // measured on Drawboard: ~35% left at 200 ms, ~7% at 400 ms, ~1% at 600 ms
  assert.ok(Math.abs(criticallyDampedSpring(100, 0, 0.2).x - 27) < 10);
  assert.ok(criticallyDampedSpring(100, 0, 0.4).x < 8);
  assert.ok(criticallyDampedSpring(100, 0, 0.6).x < 1.5);
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
