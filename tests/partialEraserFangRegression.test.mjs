import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { auditPartialEraseGeometry } from '../src/utils/paperAnnotationGeometry.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/partial-eraser-fang.json', import.meta.url),
  'utf8',
));

const ink = {
  type: 'path',
  id: 'harness-pen',
  fill: '#e11d48',
  sourceWidth: 40,
  paperInkGeometry: 'v1',
  polygons: [[[
    [80, 120], [560, 120], [560, 160], [80, 160], [80, 120],
  ]]],
  data: { id: 'harness-pen', tool: 'pen', authorId: 'owner' },
  meta: { authorId: 'owner' },
};

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
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, (
        (point.x - a[0]) * dx + (point.y - a[1]) * dy
      ) / lengthSquared))
    : 0;
  return Math.hypot(point.x - a[0] - t * dx, point.y - a[1] - t * dy);
}

function distanceToGesture(point, points) {
  let distance = Math.hypot(point.x - points[0][0], point.y - points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, points[index - 1], points[index]));
  }
  return distance;
}

function applyGesture(pageAnnotations, gesture) {
  return erasePageAnnotations({
    pageAnnotations,
    eraserPoints: gesture.points.map(([x, y]) => ({ x, y })),
    eraserRadius: gesture.radius,
    mode: 'partial',
  }).pageAnnotations;
}

function polygonPath(polygons) {
  return polygons.flatMap((polygon) => polygon.map((ring) => (
    `${ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} Z`
  ))).join(' ');
}

test('recorded crossing pass cannot render a pointed survivor inside prior contact', async () => {
  let state = { objects: [ink] };
  const gestures = fixture.gestures.slice(0, 5);
  for (const gesture of gestures) {
    const before = state.objects[0]?.polygons || [];
    state = applyGesture(state, gesture);
    const audit = auditPartialEraseGeometry({
      before,
      after: state.objects[0]?.polygons || [],
      eraserPoints: gesture.points.map(([x, y]) => ({ x, y })),
      radius: gesture.radius,
    });
    assert.deepEqual(audit.violations, {
      addedInk: false,
      removedOutsideContact: false,
      retainedInsideContact: false,
      auditIncomplete: false,
    });
  }
  const after = state.objects[0].polygons;
  const violations = [];

  const scale = 8;
  // A raster pixel covers a square, not only its center. Pixels whose squares
  // cross the exact edge may have partial alpha on either side of the edge.
  const halfPixelDiagonal = Math.SQRT2 / (2 * scale);
  const view = { x: 350, y: 100, width: 180, height: 80 };
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg"
      width="${view.width * scale}" height="${view.height * scale}"
      viewBox="${view.x} ${view.y} ${view.width} ${view.height}">
      ${after.map((polygon) => (
        `<path d="${polygonPath([polygon])}" fill="#e11d48" fill-rule="evenodd" />`
      )).join('')}
    </svg>
  `);
  const { data, info } = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let py = 0; py < info.height; py += 1) {
    for (let px = 0; px < info.width; px += 1) {
      const alpha = data[(py * info.width + px) * info.channels + 3];
      const point = {
        x: view.x + (px + 0.5) / scale,
        y: view.y + (py + 0.5) / scale,
      };
      const wasInk = pointInPolygons(point, ink.polygons);
      const distances = gestures.map((gesture) => ({
        distance: distanceToGesture(point, gesture.points),
        radius: gesture.radius,
      }));
      const touched = distances.some(
        ({ distance, radius }) => distance < radius - halfPixelDiagonal - 0.002,
      );
      const untouched = distances.every(
        ({ distance, radius }) => distance > radius + halfPixelDiagonal + 0.002,
      );
      if ((wasInk && touched && alpha > 0) || (untouched && wasInk && alpha < 255) || (!wasInk && alpha > 0)) {
        const penetration = Math.max(...distances.map(({ distance, radius }) => radius - distance));
        violations.push({ ...point, alpha, penetration, distances, wasInk });
      }
    }
  }

  violations.sort((left, right) => right.penetration - left.penetration);
  assert.deepEqual(violations.slice(0, 20), []);
});
