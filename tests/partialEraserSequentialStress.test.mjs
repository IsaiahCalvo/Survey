import test from 'node:test';
import assert from 'node:assert/strict';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

const SUBJECT = [[[
  [0, 0], [640, 0], [640, 240], [0, 240], [0, 0],
]]];
const DEFAULT_SEQUENTIAL_CASES = 36;

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

function pointInRing({ x, y }, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygons(point, polygons) {
  return (polygons || []).reduce((inside, polygon) => (
    polygon.reduce(
      (ringInside, ring) => (pointInRing(point, ring) ? !ringInside : ringInside),
      inside,
    )
  ), false);
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, (
        (point.x - a.x) * dx + (point.y - a.y) * dy
      ) / lengthSquared))
    : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function distanceToGesture(point, gesture) {
  const { points } = gesture;
  let distance = Math.hypot(point.x - points[0].x, point.y - points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, points[index - 1], points[index]));
  }
  return distance;
}

function makeArch(random, pass) {
  const radius = 5 + random() * 13;
  const count = 42 + Math.floor(random() * 70);
  const halfWidth = 22 + random() * 65;
  const height = 28 + random() * 85;
  const centerX = 60 + random() * 520;
  const baseline = 125 + random() * 75;
  const skew = (random() - 0.5) * 28;
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const angle = Math.PI * t;
    points.push({
      x: centerX - halfWidth + halfWidth * 2 * t + Math.sin(angle) * skew,
      y: baseline - Math.sin(angle) * height,
    });
  }
  // Every third pass doubles back near the last leg. This matches the narrow
  // red streak reported after several arch-shaped erases.
  if (pass % 3 === 2) {
    const end = points.at(-1);
    const separation = radius * (0.08 + random() * 0.7);
    for (let index = 1; index <= 18; index += 1) {
      const t = index / 18;
      points.push({
        x: end.x - t * halfWidth * 0.7,
        y: end.y - Math.sin(t * Math.PI * 0.55) * height * 0.55 + separation,
      });
    }
  }
  return { points, radius };
}

function probeGesture(gesture, probes) {
  const stride = Math.max(1, Math.floor(gesture.points.length / 24));
  for (let index = 1; index < gesture.points.length; index += stride) {
    const a = gesture.points[index - 1];
    const b = gesture.points[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const side of [-1, 1]) {
      for (const scale of [0, 0.35, 0.7, 0.96, 1.04, 1.35]) {
        probes.push({
          x: midpoint.x + (-dy / length) * gesture.radius * scale * side,
          y: midpoint.y + (dx / length) * gesture.radius * scale * side,
        });
      }
    }
  }
}

test('repeated curved cuts never leave ink inside any prior cursor sweep', { timeout: 120_000 }, (context) => {
  // Keep the release suite under its 120s per-file cap. Set
  // ERASER_SEQUENTIAL_CASES=180 for the full nightly/local stress sweep.
  const caseCount = Math.max(1, Number.parseInt(
    process.env.ERASER_SEQUENTIAL_CASES || String(DEFAULT_SEQUENTIAL_CASES),
    10,
  ));
  const startSeed = Math.max(1, Number.parseInt(process.env.ERASER_SEQUENTIAL_START_SEED || '1', 10));
  const failures = [];
  let checkedProbes = 0;

  for (let seed = startSeed; seed < startSeed + caseCount; seed += 1) {
    const random = mulberry32(seed);
    const gestures = [];
    let pageAnnotations = {
      objects: [{
        type: 'path',
        id: `sequential-${seed}`,
        fill: '#e11d48',
        sourceWidth: 40,
        paperInkGeometry: 'v1',
        polygons: SUBJECT,
        data: { id: `sequential-${seed}`, tool: 'pen', authorId: 'owner' },
        meta: { authorId: 'owner' },
      }],
    };

    const passCount = 3 + Math.floor(random() * 6);
    for (let pass = 0; pass < passCount && pageAnnotations.objects.length; pass += 1) {
      const gesture = makeArch(random, pass);
      gestures.push(gesture);
      if (process.env.ERASER_STRESS_TRACE === '1') {
        const vertexCount = (pageAnnotations.objects[0]?.polygons || [])
          .flat(2).length;
        console.error(JSON.stringify({ seed, pass, phase: 'before', vertexCount, gesture }));
      }
      pageAnnotations = erasePageAnnotations({
        pageAnnotations,
        eraserPoints: gesture.points,
        eraserRadius: gesture.radius,
        mode: 'partial',
      }).pageAnnotations;
      if (process.env.ERASER_STRESS_TRACE === '1') {
        const vertexCount = (pageAnnotations.objects[0]?.polygons || [])
          .flat(2).length;
        console.error(JSON.stringify({ seed, pass, phase: 'after', vertexCount }));
      }
    }

    const polygons = pageAnnotations.objects[0]?.polygons || [];
    const probes = [];
    if (seed === 4) probes.push({ x: 491.5490294984955, y: 143.63358333829217 });
    gestures.forEach((gesture) => probeGesture(gesture, probes));
    for (let index = 0; index < 260; index += 1) {
      probes.push({ x: random() * 640, y: random() * 240 });
    }

    for (const point of probes) {
      if (point.x <= 0 || point.x >= 640 || point.y <= 0 || point.y >= 240) continue;
      const margins = gestures.map((gesture) => distanceToGesture(point, gesture) - gesture.radius);
      if (margins.some((margin) => Math.abs(margin) < 0.025)) continue;
      const expectedPainted = margins.every((margin) => margin > 0);
      const actualPainted = pointInPolygons(point, polygons);
      checkedProbes += 1;
      if (actualPainted !== expectedPainted) {
        failures.push({ seed, point, margins, expectedPainted, actualPainted, gestures });
        break;
      }
    }
    if (failures.length >= 3) break;
  }

  assert.deepEqual(failures, [], `checked ${checkedProbes} probes; failures: ${JSON.stringify(failures)}`);
  context.diagnostic(`${caseCount} repeated-cut cases; ${checkedProbes} exact-contact probes`);
});
