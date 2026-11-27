import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ELASTIC_ZOOM_SPRING_DECAY,
  WHEEL_OVERSCROLL_MAC_IDLE_MS,
  ZOOM_NOTCH_MAX_LOG,
  createWheelOverscroll,
  createZoomNotchBounce,
  easeInOutSine,
  inverseRubberScale,
  rubberScale,
  stepRubberScale,
  zoomLimitSpring,
} from '../src/utils/elasticEdges.js';

test('inverseRubberScale round-trips rubberScale above max and below min', () => {
  const min = 0.5;
  const max = 8;
  for (const raw of [0.25, 0.4, 0.5, 2, 8, 12, 24]) {
    const shown = rubberScale(raw, min, max);
    const inv = inverseRubberScale(shown, min, max);
    assert.ok(Math.abs(inv - raw) < 1e-4, `raw=${raw} shown=${shown} inv=${inv}`);
  }
});

test('stepRubberScale bounds hard overshoot and unwinds immediately on reverse pinch (zero stuck dead-zone)', () => {
  const min = 0.5;
  const max = 8;
  // Push hard past maxScale (simulating 60 rapid pinch-out ticks past the ceiling)
  let raw = max;
  let shown = max;
  for (let i = 0; i < 60; i += 1) {
    ({ rawScale: raw, shownScale: shown } = stepRubberScale(raw, 1.12, min, max));
  }
  assert.ok(shown > max * 1.65 && shown < max * 1.8, `saturated near ceiling: ${shown}`);
  assert.ok(Number.isFinite(raw) && raw < max * 50, `rawScale stays bounded: ${raw}`);

  // Now reverse pinch by one 8% inward tick: shownScale MUST drop visibly on frame 1!
  const beforeReverse = shown;
  const rev = stepRubberScale(raw, 0.92, min, max);
  assert.ok(rev.shownScale < beforeReverse * 0.95, `immediate unwind on frame 1 (${beforeReverse} -> ${rev.shownScale})`);

  // Mirror check below minScale
  raw = min;
  for (let i = 0; i < 60; i += 1) {
    ({ rawScale: raw, shownScale: shown } = stepRubberScale(raw, 0.88, min, max));
  }
  assert.ok(shown < min * 0.5 && shown > min * 0.42);
  const beforeUnderRev = shown;
  const underRev = stepRubberScale(raw, 1.08, min, max);
  assert.ok(underRev.shownScale > beforeUnderRev * 1.05, `immediate unwind below min (${beforeUnderRev} -> ${underRev.shownScale})`);
});

test('zoomLimitSpring launches immediately at full speed on release and never crosses limit', () => {
  assert.ok(ELASTIC_ZOOM_SPRING_DECAY >= 12);
  const z0 = 1.5;
  const tx0 = 60;
  const ty0 = -40;
  // First 16ms frame: immediate visible launch (>18% progress vs <1% with easeInOutSine)
  const f1 = zoomLimitSpring(z0, tx0, ty0, 0.016);
  const logProgress = 1 - Math.log(f1.z) / Math.log(z0);
  const oldSineProgress = easeInOutSine(16 / 250);
  assert.ok(logProgress > 0.18, `first frame launches briskly: ${(logProgress * 100).toFixed(1)}%`);
  assert.ok(logProgress > oldSineProgress * 10, 'eliminates slow easeInOutSine hang');

  // Monotonic decay to 1.0 without crossing
  let prevZ = z0;
  let prevDist = Math.hypot(tx0, ty0);
  for (let ms = 16; ms <= 600; ms += 16) {
    const s = zoomLimitSpring(z0, tx0, ty0, ms / 1000);
    assert.ok(s.z >= 1 && s.z <= prevZ + 1e-9, `monotonic z at ${ms}ms`);
    const dist = Math.hypot(s.tx, s.ty);
    assert.ok(dist <= prevDist + 1e-9, `monotonic offset at ${ms}ms`);
    prevZ = s.z;
    prevDist = dist;
  }
  const end = zoomLimitSpring(z0, tx0, ty0, 0.6);
  assert.equal(end.done, true);
  assert.equal(end.z, 1);
  assert.equal(end.tx, 0);
  assert.equal(end.ty, 0);
});

test('createZoomNotchBounce gives crisp tactile pulse at min and max zoom and caps rapid notches', () => {
  const b = createZoomNotchBounce();
  b.kick({ direction: 1, intensity: 1, now: 0 });
  let peak = 1;
  let peakAt = 0;
  for (let t = 0; t <= 500; t += 1000 / 60) {
    const f = b.frame(t);
    if (f.z > peak) { peak = f.z; peakAt = t; }
  }
  assert.ok(peak > 1.05 && peak < 1.14, `single max-zoom notch peak ${peak.toFixed(3)}`);
  assert.ok(peakAt >= 65 && peakAt <= 120, `peaks around ~90ms (${peakAt.toFixed(0)}ms)`);
  assert.equal(b.frame(500).active, false, 'settled cleanly under 500ms');

  // Min zoom (direction -1)
  b.reset();
  b.kick({ direction: -1, intensity: 1, now: 0 });
  let trough = 1;
  for (let t = 0; t <= 500; t += 1000 / 60) trough = Math.min(trough, b.frame(t).z);
  assert.ok(trough < 0.95 && trough > 0.86, `single min-zoom notch trough ${trough.toFixed(3)}`);

  // Rapid 10 notches stay smoothly soft-capped
  b.reset();
  let rapidPeak = 1;
  for (let t = 0; t <= 700; t += 1000 / 60) {
    if (t < 300 && Math.round(t) % 30 < 17) b.kick({ direction: 1, intensity: 1.2, now: t });
    rapidPeak = Math.max(rapidPeak, b.frame(t).z);
  }
  assert.ok(rapidPeak <= Math.exp(ZOOM_NOTCH_MAX_LOG) + 1e-6, `soft-capped rapid peak ${rapidPeak.toFixed(3)}`);
});

test('2D corner trackpad overscroll stretches both X and Y and releases cleanly with snappier 60ms idle', () => {
  assert.equal(WHEEL_OVERSCROLL_MAC_IDLE_MS, 60);
  const c = createWheelOverscroll({ mac: true });
  let t = 0;
  for (let i = 0; i < 20; i += 1) {
    c.wheel('x', { delta: 8, room: 0, dimension: 1200, cancelable: true, now: t });
    c.wheel('y', { delta: 10, room: 0, dimension: 900, cancelable: true, now: t });
    t += 10;
  }
  const peak = c.frame(t);
  assert.ok(peak.x > 15 && peak.y > 15, `both axes stretch smoothly (${peak.x.toFixed(1)}, ${peak.y.toFixed(1)})`);
  // Windows PTP empty lift on both axes springs both home immediately
  c.wheel('x', { delta: 0, room: 0, dimension: 1, now: t + 10 });
  c.wheel('y', { delta: 0, room: 0, dimension: 1, now: t + 10 });
  const after = c.frame(t + 160);
  assert.ok(after.x < peak.x * 0.3 && after.y < peak.y * 0.3, 'both axes spring home briskly');
  assert.equal(c.frame(t + 1000).active, false);
});
