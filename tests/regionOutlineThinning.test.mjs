// Owner 2026-10-01: "If I do a subtractive region onto another region and it's a
// curve, it puts a bunch of points on that curve. That's too much."
// Freehand strokes and add/subtract results are thinned to the fewest points
// that stay within ~1.5 screen px of the drawn line; rectangle corners stay
// exact; curved parts are drawn smooth through the kept points.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  thinFreehandStroke,
  thinBooleanResultRing,
  buildSmoothVertexLookup,
  buildRegionOutlinePathD,
  flattenRegionOutline,
  getRegionOutlineCoordinates,
  getRegionSmoothFlags,
} from '../src/utils/regionOutline.js';
import { subtractRegionFromRegion } from '../src/utils/regionMath.js';

const SCALE = 1.5; // screen px per page unit at the zoom the stroke was drawn
const TOL = 1.5 / SCALE; // 1.5 screen px in page units

const rect = (x, y, w, h) => ({
  regionId: 'r', shapeType: 'rectangular', operation: 'add',
  coordinates: [x, y, x + w, y, x + w, y + h, x, y + h],
});

// A mouse/finger stroke: one sample every ~3 screen px along a path, with a
// little hand jitter.
const sampleStroke = (fn, n, jitter = 0.3, seed = 7) => {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s / 2147483647) - 0.5; };
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const p = fn(i / (n - 1));
    out.push(p.x + rnd() * jitter, p.y + rnd() * jitter);
  }
  return out;
};

const maxDistToPolyline = (pts, ring) => {
  // max distance from each stroke point to the closed outline polygon
  let worst = 0;
  for (let i = 0; i < pts.length; i += 2) {
    let best = Infinity;
    for (let j = 0; j < ring.length; j += 2) {
      const ax = ring[j]; const ay = ring[j + 1];
      const bx = ring[(j + 2) % ring.length]; const by = ring[(j + 3) % ring.length];
      const dx = bx - ax; const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((pts[i] - ax) * dx + (pts[i + 1] - ay) * dy) / ((dx * dx + dy * dy) || 1)));
      best = Math.min(best, Math.hypot(pts[i] - (ax + dx * t), pts[i + 1] - (ay + dy * t)));
    }
    worst = Math.max(worst, best);
  }
  return worst;
};

const semicircleCutter = () => {
  // A closed freehand loop: semicircle radius 60 dipping into the rect's top
  // edge at y=100, closed by a straight return above the rect.
  const arc = sampleStroke((t) => ({ x: 140 + 60 * Math.cos(Math.PI * (1 - t)), y: 100 + 60 * Math.sin(Math.PI * t) }), 90);
  return [...arc, 200, 70, 140, 60, 80, 70];
};

const sCurveCutter = () => {
  // Three peaks biting up into the rect's bottom edge (y=300).
  const curve = sampleStroke((t) => ({ x: 60 + 240 * t, y: 300 - 40 * Math.abs(Math.sin(3 * Math.PI * t)) }), 160);
  return [...curve, 300, 330, 60, 330];
};

const messyLoop = () => sampleStroke((t) => {
  const a = 2 * Math.PI * t;
  const r = 80 + 18 * Math.sin(5 * a) + 7 * Math.cos(11 * a);
  return { x: 200 + r * Math.cos(a), y: 200 + r * Math.sin(a) };
}, 260, 1.2);

test('a freehand stroke keeps few points and stays within 1.5 screen px of the drawn line', () => {
  const raw = messyLoop();
  const thin = thinFreehandStroke(raw, TOL);
  const n = thin.coordinates.length / 2;
  assert.ok(n < raw.length / 2 / 3, `thinned ${raw.length / 2} -> ${n}`);
  assert.equal(thin.smoothVertices.length, n);
  assert.ok(thin.smoothVertices.every((f) => f === 1));
  // The drawn (smooth) outline stays within 1.5 screen px of every stroke sample.
  const drawn = flattenRegionOutline(thin.coordinates, thin.smoothVertices, 0.25);
  assert.ok(maxDistToPolyline(raw, drawn) <= TOL * 1.05, `curve error ${maxDistToPolyline(raw, drawn)}`);
});

test('a gentle curve keeps very few points', () => {
  const raw = sampleStroke((t) => ({ x: 100 + 80 * Math.cos(2 * Math.PI * t), y: 100 + 80 * Math.sin(2 * Math.PI * t) }), 200, 0);
  const thin = thinFreehandStroke(raw, TOL);
  assert.ok(thin.coordinates.length / 2 <= 24, `circle kept ${thin.coordinates.length / 2}`);
});

test('a semicircle bite out of a rectangle: rectangle corners stay exact, the bite is thinned and smooth', () => {
  const subject = rect(40, 100, 300, 200);
  const raw = { regionId: 'c', shapeType: 'polygon', operation: 'subtract', coordinates: semicircleCutter() };
  const before = subtractRegionFromRegion(subject, raw)[0].coordinates.length / 2;
  const thin = thinFreehandStroke(raw.coordinates, TOL);
  const cutter = { ...raw, coordinates: thin.coordinates, smoothVertices: thin.smoothVertices };
  const [result] = subtractRegionFromRegion(subject, cutter, { thinTolerance: TOL });
  const after = result.coordinates.length / 2;
  assert.ok(after < before / 3, `semicircle bite ${before} -> ${after}`);
  const flags = getRegionSmoothFlags(result);
  assert.ok(flags, 'result carries smooth flags');
  for (const [cx, cy] of [[40, 100], [340, 100], [340, 300], [40, 300]]) {
    const i = result.coordinates.findIndex((v, k) => k % 2 === 0 && v === cx && result.coordinates[k + 1] === cy);
    assert.ok(i >= 0, `corner ${cx},${cy} kept exactly`);
    assert.equal(flags[i / 2], 0, `corner ${cx},${cy} is a sharp corner`);
  }
});

test('an S-curve bite with three peaks keeps a point at each peak', () => {
  const subject = rect(40, 100, 300, 200);
  const raw = { regionId: 'c', shapeType: 'polygon', operation: 'subtract', coordinates: sCurveCutter() };
  const before = subtractRegionFromRegion(subject, raw)[0].coordinates.length / 2;
  const thin = thinFreehandStroke(raw.coordinates, TOL);
  const cutter = { ...raw, coordinates: thin.coordinates, smoothVertices: thin.smoothVertices };
  const results = subtractRegionFromRegion(subject, cutter, { thinTolerance: TOL });
  const after = results.reduce((sum, r) => sum + r.coordinates.length / 2, 0);
  assert.ok(after < before / 3, `S bite ${before} -> ${after}`);
  // each peak (y ~ 260 at x = 100, 180, 260) has a kept point next to it
  for (const px of [100, 180, 260]) {
    const near = results.some((r) => r.coordinates.some((v, k) => k % 2 === 0 && Math.abs(v - px) < 8 && Math.abs(r.coordinates[k + 1] - 260) < 3));
    assert.ok(near, `peak at x=${px} kept`);
  }
});

test('old regions without smooth flags are unchanged by every helper', () => {
  const old = rect(10, 10, 100, 50);
  assert.equal(getRegionSmoothFlags(old), null);
  assert.deepEqual(getRegionOutlineCoordinates(old), old.coordinates);
  assert.equal(buildRegionOutlinePathD(old.coordinates, null), 'M 10 10 L 110 10 L 110 60 L 10 60 Z');
  // Two plain rectangles subtract exactly as before (no thinning, no flags).
  const [r] = subtractRegionFromRegion(rect(0, 0, 100, 100), rect(50, 50, 100, 100), { thinTolerance: 5 });
  assert.equal(r.smoothVertices, undefined);
  assert.equal(r.coordinates.length, 12);
  // A flag list that does not match the vertex count is ignored.
  assert.equal(getRegionSmoothFlags({ ...old, smoothVertices: [1, 1] }), null);
});

test('boolean result keeps a vertex shared by a corner and a smooth point as a corner', () => {
  const lookup = buildSmoothVertexLookup([
    { coordinates: [0, 0, 10, 0, 10, 10] },
    { coordinates: [10, 0, 20, 5, 10, 10, 15, 20], smoothVertices: [1, 1, 1, 1] },
  ]);
  assert.equal(lookup.get('10,0'), false);
  assert.equal(lookup.get('20,5'), true);
  const t = thinBooleanResultRing([0, 0, 10, 0, 20, 5, 10, 10], lookup, 0.1);
  assert.deepEqual(t.smoothVertices, [0, 0, 1, 0]);
});

test('the export / overlay polygon lies on the same curve the editor draws', () => {
  const region = { coordinates: [0, 0, 100, 0, 120, 60, 60, 110, 0, 80], smoothVertices: [0, 0, 1, 1, 1] };
  const d = buildRegionOutlinePathD(region.coordinates, region.smoothVertices, 1, 1);
  // Walk the SVG path: straight runs and cubic segments.
  const nums = d.replace(/[MLCZ]/g, ' ').trim().split(/\s+/).map(Number);
  const cmds = d.match(/[MLC]/g);
  const segs = [];
  let k = 0; let cur = null;
  for (const c of cmds) {
    if (c === 'M') { cur = [nums[k], nums[k + 1]]; k += 2; } else if (c === 'L') { const nx = [nums[k], nums[k + 1]]; segs.push({ a: cur, z: nx }); cur = nx; k += 2; } else { const s = { a: cur, c1: [nums[k], nums[k + 1]], c2: [nums[k + 2], nums[k + 3]], z: [nums[k + 4], nums[k + 5]] }; segs.push(s); cur = s.z; k += 6; }
  }
  const dense = [];
  for (const s of segs) {
    for (let i = 0; i <= 400; i += 1) {
      const t = i / 400; const u = 1 - t;
      if (!s.c1) dense.push([s.a[0] + (s.z[0] - s.a[0]) * t, s.a[1] + (s.z[1] - s.a[1]) * t]);
      else dense.push([0, 1].map((j) => u * u * u * s.a[j] + 3 * u * u * t * s.c1[j] + 3 * u * t * t * s.c2[j] + t * t * t * s.z[j]));
    }
  }
  const flat = getRegionOutlineCoordinates(region);
  assert.ok(flat.length > region.coordinates.length, 'curved parts are sampled');
  for (let i = 0; i < flat.length; i += 2) {
    const best = Math.min(...dense.map(([x, y]) => Math.hypot(x - flat[i], y - flat[i + 1])));
    assert.ok(best < 0.2, `export point ${i / 2} is ${best} off the drawn curve`);
  }
});
