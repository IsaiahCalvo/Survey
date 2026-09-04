import test from 'node:test';
import assert from 'node:assert/strict';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

const SUBJECT = [[[
  [0, 0],
  [640, 0],
  [640, 240],
  [0, 240],
  [0, 0],
]]];

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

function distanceToGesture(point, points) {
  let distance = Math.hypot(point.x - points[0].x, point.y - points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, points[index - 1], points[index]));
  }
  return distance;
}

function makeGesture(kind, random) {
  const radius = 3 + random() * 17;
  const count = 18 + Math.floor(random() * 70);
  const centerX = 150 + random() * 340;
  const centerY = 70 + random() * 100;
  const size = 18 + random() * 58;
  const points = [];

  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    if (kind === 'c') {
      const angle = -Math.PI * 0.72 + t * Math.PI * 1.44;
      points.push({ x: centerX + Math.cos(angle) * size, y: centerY + Math.sin(angle) * size });
    } else if (kind === 'hump') {
      points.push({ x: centerX - size + t * size * 2, y: centerY - Math.sin(t * Math.PI) * size });
    } else if (kind === 'hairpin') {
      const leg = t < 0.5 ? t * 2 : (1 - t) * 2;
      const separation = radius * (0.08 + random() * 1.8);
      points.push({
        x: centerX - size + leg * size * 2,
        y: centerY + (t < 0.5 ? -separation / 2 : separation / 2),
      });
    } else if (kind === 'loop') {
      const angle = t * Math.PI * 2;
      points.push({ x: centerX + Math.sin(angle) * size, y: centerY + Math.sin(angle * 2) * size * 0.65 });
    } else if (kind === 'backtrack') {
      const phase = t * 5;
      const leg = phase % 2 < 1 ? phase % 1 : 1 - (phase % 1);
      points.push({ x: centerX - size + leg * size * 2, y: centerY + Math.sin(t * Math.PI * 6) * radius * 0.35 });
    } else {
      const angle = t * Math.PI * (4 + random() * 2);
      const wobble = size * (0.35 + random() * 0.65);
      points.push({
        x: centerX + Math.cos(angle) * wobble,
        y: centerY + Math.sin(angle * 1.37) * wobble * 0.7,
      });
    }
  }
  return { kind, points, radius };
}

function probesForGesture(gesture, random) {
  const probes = [];
  const { points, radius } = gesture;
  for (let index = 1; index < points.length; index += Math.max(1, Math.floor(points.length / 16))) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const side of [-1, 1]) {
      for (const scale of [0, 0.5, 0.97, 1.03, 1.5]) {
        probes.push({
          x: midpoint.x + (-dy / length) * radius * scale * side,
          y: midpoint.y + (dx / length) * radius * scale * side,
        });
      }
    }
  }
  for (let index = 0; index < 80; index += 1) {
    probes.push({ x: 20 + random() * 600, y: 20 + random() * 200 });
  }
  return probes;
}

test('seeded folded-path stress preserves exact cursor contact', { timeout: 120_000 }, (context) => {
  const kinds = ['c', 'hump', 'hairpin', 'loop', 'backtrack', 'scribble'];
  const caseCount = Math.max(1, Number.parseInt(process.env.ERASER_STRESS_CASES || '360', 10));
  const startSeed = Math.max(1, Number.parseInt(process.env.ERASER_STRESS_START_SEED || '1', 10));
  const requestedSeeds = String(process.env.ERASER_STRESS_SEEDS || '')
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isFinite);
  const seeds = requestedSeeds.length
    ? requestedSeeds
    : Array.from({ length: caseCount }, (_, index) => startSeed + index);
  const failures = [];
  let checkedProbes = 0;

  for (const seed of seeds) {
    const random = mulberry32(seed);
    const gesture = makeGesture(kinds[(seed - 1) % kinds.length], random);
    const result = erasePageAnnotations({
      pageAnnotations: {
        objects: [{
          type: 'path',
          id: `stress-${seed}`,
          fill: '#e11d48',
          sourceWidth: 40,
          paperInkGeometry: 'v1',
          polygons: SUBJECT,
          data: { id: `stress-${seed}`, tool: 'pen', authorId: 'owner' },
          meta: { authorId: 'owner' },
        }],
      },
      eraserPoints: gesture.points,
      eraserRadius: gesture.radius,
      mode: 'partial',
    });
    const polygons = result.pageAnnotations.objects[0]?.polygons || [];

    for (const point of probesForGesture(gesture, random)) {
      if (point.x <= 1 || point.x >= 639 || point.y <= 1 || point.y >= 239) continue;
      const distance = distanceToGesture(point, gesture.points);
      if (Math.abs(distance - gesture.radius) < 0.02) continue;
      const expectedPainted = distance > gesture.radius;
      const actualPainted = pointInPolygons(point, polygons);
      checkedProbes += 1;
      if (actualPainted !== expectedPainted) {
        failures.push({
          seed,
          kind: gesture.kind,
          radius: gesture.radius,
          point,
          distance,
          expectedPainted,
          actualPainted,
          points: gesture.points,
        });
        break;
      }
    }
    if (failures.length >= 5) break;
  }

  assert.deepEqual(failures, [], `checked ${checkedProbes} probes; failures: ${JSON.stringify(failures)}`);
  assert.ok(checkedProbes > seeds.length * 190, `only checked ${checkedProbes} probes`);
  context.diagnostic(`${seeds.length} gestures; ${checkedProbes} exact-contact probes`);
});
