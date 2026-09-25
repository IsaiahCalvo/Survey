// w39 (2026-09-25): the round-stroke outline must cover the TRUE round stroke
// of an authored curve, including at a turn tighter than the stroke radius.
//
// After the first bite of a partial erase, both renderers paint the true
// source stroke clipped to the outline polygon built here
// (commandsToPolygonSet(..., { fill: false, strokeWidth })). Any part of the
// true stroke the outline misses disappears on screen, far from the eraser.
//
// The defect: centerline compaction dropped every flattened vertex closer
// than min(0.35, r / 10) to the previous one. At the tip of a tight quadratic
// the flattened vertices are ~0.12 apart, so the whole tip was cut: the
// centerline lost 0.17 and the outline missed a 0.18-deep crescent of ink.
//
// Invariant checked here, for outline tolerance `tol`:
//   * every point within r - 2*tol of the true centerline is inside;
//   * nothing farther than r + 2*tol from the true centerline is inside.
// (Error budget: flattening <= tol/2 for a quadratic, 3/4 tol for a cubic;
// tolerance-bounded compaction <= tol/4; round-arc facets <= tol.)
import test from 'node:test';
import assert from 'node:assert/strict';

import { erasePageAnnotations, pathObjectToPagePolygons } from '../src/utils/pageSpaceEraser.js';
import {
  commandsToPolygonSet,
  normalizeMultiPolygon,
} from '../src/utils/paperAnnotationGeometry.js';

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

// Even-odd over every ring (outer rings and holes alike).
function insideOutline(polygons, x, y) {
  let inside = false;
  for (const ring of normalizeMultiPolygon(polygons).flat()) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// Exact-enough distance from a point to an authored path of M / L / Q / C:
// dense parameter sampling, then a golden-section refinement around the best
// sample of each segment (the distance is unimodal on that bracket).
function curveEvaluators(commands) {
  const segments = [];
  let current = null;
  for (const command of commands) {
    const [op, ...v] = command;
    if (op === 'M') { current = { x: v[0], y: v[1] }; continue; }
    const p0 = current;
    if (op === 'L') {
      const p1 = { x: v[0], y: v[1] };
      segments.push((t) => ({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }));
      current = p1;
    } else if (op === 'Q') {
      const c = { x: v[0], y: v[1] };
      const p1 = { x: v[2], y: v[3] };
      segments.push((t) => {
        const u = 1 - t;
        return {
          x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
          y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
        };
      });
      current = p1;
    } else if (op === 'C') {
      const c1 = { x: v[0], y: v[1] };
      const c2 = { x: v[2], y: v[3] };
      const p1 = { x: v[4], y: v[5] };
      segments.push((t) => {
        const u = 1 - t;
        return {
          x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
          y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
        };
      });
      current = p1;
    }
  }
  const SAMPLES = 400;
  const sampled = segments.map((at) => Array.from(
    { length: SAMPLES + 1 },
    (_, index) => at(index / SAMPLES),
  ));
  return (point) => {
    let best = Infinity;
    segments.forEach((at, segmentIndex) => {
      const samples = sampled[segmentIndex];
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let index = 0; index <= SAMPLES; index += 1) {
        const d = Math.hypot(point.x - samples[index].x, point.y - samples[index].y);
        if (d < bestDistance) { bestDistance = d; bestIndex = index; }
      }
      let lo = Math.max(0, bestIndex - 1) / SAMPLES;
      let hi = Math.min(SAMPLES, bestIndex + 1) / SAMPLES;
      const distanceAt = (t) => {
        const q = at(t);
        return Math.hypot(point.x - q.x, point.y - q.y);
      };
      const ratio = (Math.sqrt(5) - 1) / 2;
      for (let iteration = 0; iteration < 40; iteration += 1) {
        const a = hi - ratio * (hi - lo);
        const b = lo + ratio * (hi - lo);
        if (distanceAt(a) < distanceAt(b)) hi = b; else lo = a;
      }
      best = Math.min(best, bestDistance, distanceAt((lo + hi) / 2));
    });
    return best;
  };
}

function assertOutlineMatchesTrueStroke({ label, commands, strokeWidth, polygons, tolerance, random, probes = 700 }) {
  const radius = strokeWidth / 2;
  const epsilon = 2 * tolerance;
  const distance = curveEvaluators(commands);
  // Probe where the invariant can fail: around the true stroke's edge, from
  // random points of the centerline in random directions.
  const segmentsCount = commands.filter(([op]) => op !== 'M').length;
  const points = [];
  let current = null;
  const segmentAt = [];
  for (const command of commands) {
    const [op, ...v] = command;
    if (op === 'M') { current = { x: v[0], y: v[1] }; continue; }
    const p0 = current;
    const end = { x: v.at(-2), y: v.at(-1) };
    segmentAt.push({ p0, v, op });
    current = end;
  }
  const evaluate = ({ p0, v, op }, t) => {
    const u = 1 - t;
    if (op === 'L') return { x: p0.x + (v[0] - p0.x) * t, y: p0.y + (v[1] - p0.y) * t };
    if (op === 'Q') {
      return {
        x: u * u * p0.x + 2 * u * t * v[0] + t * t * v[2],
        y: u * u * p0.y + 2 * u * t * v[1] + t * t * v[3],
      };
    }
    return {
      x: u * u * u * p0.x + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t * v[4],
      y: u * u * u * p0.y + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t * v[5],
    };
  };
  for (let probe = 0; probe < probes; probe += 1) {
    const segment = segmentAt[Math.floor(random() * segmentsCount)];
    const base = evaluate(segment, random());
    const angle = random() * Math.PI * 2;
    // Mostly within a few epsilons of the rim, sometimes anywhere across it.
    const reach = random() < 0.8
      ? radius + (random() - 0.5) * 8 * epsilon
      : random() * (radius + 4 * epsilon);
    points.push({ x: base.x + Math.cos(angle) * reach, y: base.y + Math.sin(angle) * reach });
  }
  for (const point of points) {
    const d = distance(point);
    const inside = insideOutline(polygons, point.x, point.y);
    if (d <= radius - epsilon) {
      assert.ok(
        inside,
        `${label}: (${point.x}, ${point.y}) is ${(radius - d).toFixed(4)} inside the true round stroke `
        + `(r ${radius.toFixed(4)}, tolerance ${tolerance}) but outside the outline`,
      );
    } else if (d >= radius + epsilon) {
      assert.ok(
        !inside,
        `${label}: (${point.x}, ${point.y}) is ${(d - radius).toFixed(4)} outside the true round stroke `
        + `but inside the outline`,
      );
    }
  }
}

// The exact case from w38's partialEraserLaneRenderProperty stroked-curve test
// (seed 0xc0ffee, case index 21 at ERASER_PROPERTY_CASES=150).
const CASE_21 = Object.freeze({
  width: 19.964544558897614,
  path: [
    ['M', 60, 60],
    ['Q', 71.42195124644786, 56.00933843990788, 92.21236609853804, 49.393912616651505],
    ['Q', 92.59663879172876, 75.0657635461539, 85.55425778729841, 11.454451102763414],
    ['Q', 70.35289314342663, -4.495698192622513, 68.39348163921386, -13.350300129968673],
  ],
  eraserRadius: 4.86792241409421,
});

test('regression: the outline of a tight quadratic keeps the whole round tip (w38 case 21)', () => {
  const object = {
    type: 'path',
    tool: 'pen',
    data: { id: 'c', tool: 'pen' },
    path: CASE_21.path,
    stroke: '#ff0000',
    strokeWidth: CASE_21.width,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
  };
  const polygons = pathObjectToPagePolygons(object, 4.87);
  const distance = curveEvaluators(CASE_21.path);
  const reported = { x: 88.2246, y: 65.9188 };
  assert.ok(
    distance(reported) < CASE_21.width / 2 - 0.1,
    'the reported point lies well inside the true round stroke',
  );
  assert.ok(
    insideOutline(polygons, reported.x, reported.y),
    'the outline covers the reported point on the outer side of the tight turn',
  );

  // Worst spot before the fix: 0.18 deep inside the true stroke, missing.
  let worstMiss = 0;
  const radius = CASE_21.width / 2;
  for (let y = 44; y <= 80; y += 0.25) {
    for (let x = 76; x <= 106; x += 0.25) {
      const d = distance({ x, y });
      if (d < radius && !insideOutline(polygons, x, y)) worstMiss = Math.max(worstMiss, radius - d);
    }
  }
  // The eraser pipeline uses a 0.05 curve tolerance here.
  assert.ok(worstMiss <= 0.1, `outline misses the true stroke by up to ${worstMiss.toFixed(4)}`);

  assertOutlineMatchesTrueStroke({
    label: 'case 21',
    commands: CASE_21.path,
    strokeWidth: CASE_21.width,
    polygons,
    tolerance: 0.05,
    random: mulberry32(21),
    probes: 1500,
  });
});

test('property: round outlines of random tight quadratics and cubics match the true round stroke', () => {
  const random = mulberry32(0x39e0);
  const CASES = Number(process.env.OUTLINE_PROPERTY_CASES) || 60;
  for (let n = 0; n < CASES; n += 1) {
    const strokeWidth = 1 + random() * 30;
    // The eraser pipeline's own tolerance: min(0.05, eraser r / 20, width / 20).
    const tolerance = Math.min(0.05, (2 + random() * 12) * 0.05, strokeWidth * 0.05);
    const commands = [['M', 50, 50]];
    let x = 50;
    let y = 50;
    const segments = 1 + Math.floor(random() * 3);
    for (let s = 0; s < segments; s += 1) {
      // A far control point and a near end point make a near-cusp: the tip's
      // curvature radius ends up far below the stroke radius.
      const reach = 10 + random() * 60;
      const angle = random() * Math.PI * 2;
      const endDrift = random() * (random() < 0.5 ? 2 : 25);
      const endAngle = random() * Math.PI * 2;
      const endX = x + Math.cos(endAngle) * endDrift;
      const endY = y + Math.sin(endAngle) * endDrift;
      if (random() < 0.5) {
        commands.push(['Q', x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, endX, endY]);
      } else {
        const spread = (random() - 0.5) * 1.2;
        commands.push([
          'C',
          x + Math.cos(angle) * reach,
          y + Math.sin(angle) * reach,
          endX + Math.cos(angle + spread) * reach,
          endY + Math.sin(angle + spread) * reach,
          endX,
          endY,
        ]);
      }
      x = endX;
      y = endY;
    }
    const polygons = commandsToPolygonSet(commands, {
      fill: false,
      strokeWidth,
      curveTolerance: tolerance,
    });
    assertOutlineMatchesTrueStroke({
      label: `case ${n} ${JSON.stringify(commands)} width ${strokeWidth}`,
      commands,
      strokeWidth,
      polygons,
      tolerance,
      random,
    });
  }
});

// w39 review: when a tight turn splits the outline into run pieces, Martinez
// mis-unioned their round caps on these right-angle polylines (a closed square
// whose halves unioned to 137 instead of 185; a zero-area union; a notch; a
// thin wedge cut across the stroke; a throw). The union is now verified and
// retried with other strategies.
const MIS_UNIONED = Object.freeze([
  { label: 'closed square', width: 7.19363028369844, path: [['M', 3.203429188579321, 14.293953054584563], ['L', 10.003562750291895, 14.293953054584563], ['L', 10.003562750291895, 21.094086616297137], ['L', 3.203429188579321, 21.094086616297137], ['L', 3.203429188579321, 14.293953054584563]] },
  { label: 'manhattan (was zero area)', width: 5.50297281332314, path: [['M', -5.5099193239584565, -38.57100261375308], ['L', -5.5099193239584565, -37.62971310194997], ['L', 2.3605047209008347, -37.62971310194997], ['L', 2.3605047209008347, -41.192872082295004], ['L', 4.903796018087444, -41.192872082295004], ['L', 4.903796018087444, -43.6695217803053]] },
  { label: 'hairpin (was a notch)', width: 3.2445587983354924, path: [['M', 22.115980507805943, 9.446792607195675], ['L', 43.21461793407798, 9.446792607195675], ['L', 43.21461793407798, 10.214555225800723], ['L', 22.115980507805943, 9.658556486772985]] },
  { label: 'hairpin (was a throw)', width: 5.267300303746015, path: [['M', -38.261489500291646, 33.70527664665133], ['L', 1.6607542978599668, 33.70527664665133], ['L', 1.6607542978599668, 35.50361876329407], ['L', -38.261489500291646, 33.8622945756732]] },
  { label: 'short legs (was a wedge)', width: 5.09666277654469, path: [['M', -40.083504701033235, 12.778011872433126], ['L', -42.0156341560558, 12.778011872433126], ['L', -42.0156341560558, 11.993738874303336], ['L', -42.889724583016445, 11.993738874303336]] },
]);

test('run pieces that Martinez used to mis-union still give the true round stroke', () => {
  const random = mulberry32(0x39a);
  for (const { label, width, path } of MIS_UNIONED) {
    const tolerance = Math.min(0.05, width * 0.05);
    const polygons = commandsToPolygonSet(path, { fill: false, strokeWidth: width, curveTolerance: tolerance });
    assertOutlineMatchesTrueStroke({
      label, commands: path, strokeWidth: width, polygons, tolerance, random, probes: 1500,
    });
  }
});

test('an outline that cannot be verified is refused, and the eraser leaves that mark exactly as it was', () => {
  // Legs shorter than the radius at 45-degree turns: every union strategy
  // leaves a hole here, so the eraser outline refuses rather than clip the
  // stroke to a wrong shape after the first bite.
  const path = [['M', -12.902115541510284, -31.650451640598476], ['L', -16.30420959536823, -27.078164317232012], ['L', -16.98290107410884, -31.703165015811614], ['L', -16.886123245218982, -31.04366428500359], ['L', -19.893822676921555, -33.281598086778175]];
  const strokeWidth = 4.1715681198984385;
  assert.throws(
    () => commandsToPolygonSet(path, { fill: false, strokeWidth, curveTolerance: 0.05 }),
    { name: 'StrokeOutlineUnionError' },
  );
  const object = {
    type: 'path', tool: 'pen', data: { id: 'refused', tool: 'pen' }, stroke: '#ff0000', fill: null,
    strokeWidth, strokeLineCap: 'round', strokeLineJoin: 'round', left: 0, top: 0, scaleX: 1, scaleY: 1, path,
  };
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  let result;
  try {
    result = erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [{ x: -16.3, y: -27.1 }],
      eraserRadius: 2,
      mode: 'partial',
    });
  } finally {
    console.warn = warn;
  }
  assert.equal(result.didChange, false);
  assert.equal(result.pageAnnotations.objects[0], object, 'the mark is untouched');
  assert.deepEqual(result.failedStages, [{
    annotationId: 'refused', failedStages: { outline: 1 }, recovered: false, skipped: true,
  }]);
  assert.ok(warnings.some((text) => text.startsWith('[EraserSkippedMark]')), 'a diagnostic is logged');

  // Whole-mark erase needs no outline: the same mark is still removable.
  console.warn = () => {};
  let full;
  try {
    full = erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [{ x: -16.3, y: -27.1 }],
      eraserRadius: 2,
      mode: 'entire',
    });
  } finally {
    console.warn = warn;
  }
  assert.equal(full.didChange, true);
  assert.deepEqual(full.deletedIds, ['refused']);
  assert.deepEqual(full.pageAnnotations.objects, []);
  // ...and a miss still removes nothing.
  console.warn = () => {};
  let miss;
  try {
    miss = erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [{ x: 60, y: 60 }],
      eraserRadius: 2,
      mode: 'entire',
    });
  } finally {
    console.warn = warn;
  }
  assert.equal(miss.didChange, false);
});
