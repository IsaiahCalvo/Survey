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
  left: 0,
  top: 0,
  width: 480,
  height: 40,
  fill: '#e11d48',
  stroke: 'transparent',
  strokeWidth: 0,
  sourceWidth: 40,
  paperInkGeometry: 'v1',
  path: [
    ['M', 80, 120],
    ['L', 560, 120],
    ['L', 560, 160],
    ['L', 80, 160],
    ['Z'],
  ],
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

test('a concave C-cut leaves no filled ink inside the swept channel', () => {
  const before = { objects: [ink] };
  const points = [
    [299.9373040752351, 79.33054393305439], [291.2434793789185, 83.5146494590089],
    [282.5496240693574, 87.69873966233003], [273.8557993730408, 91.88284518828452],
    [265.1619746767241, 96.06695071423901], [256.468119367163, 100.25104091756015],
    [247.77429467084642, 104.43514644351465], [245.7680250783699, 110.29288192174425],
    [243.76175548589342, 116.15063272260721], [241.7554858934169, 122.00836820083683],
    [239.74921630094045, 127.86610367906643], [237.74294670846393, 133.7238544799294],
    [235.73667711598745, 139.581589958159], [237.74294670846393, 145.4393254363886],
    [239.74921630094045, 151.2970762372516], [241.7554858934169, 157.15481171548117],
    [243.76175548589342, 163.0125471937108], [245.7680250783699, 168.87028267194037],
    [247.77429467084642, 174.72803347280336], [256.468119367163, 178.91212367612448],
    [265.1619746767241, 183.09624452471235], [273.8557993730408, 187.28033472803347],
    [282.5496240693574, 191.46442493135459], [291.2434793789185, 195.64854577994248],
    [299.9373040752351, 199.8326359832636],
  ];
  const after = applyGesture(before, { points, radius: 12 });
  const audit = auditPartialEraseGeometry({
    before: before.objects[0].polygons,
    after: after.objects[0]?.polygons || [],
    eraserPoints: points.map(([x, y]) => ({ x, y })),
    radius: 12,
    captureLocations: true,
  });

  assert.equal(audit.violations.retainedInsideContact, false, JSON.stringify(audit.violationSamples.retainedInsideContact));
});

test('a smooth long C-cut leaves no rendered hairline inside the swept channel', async () => {
  const sampledPoints = Array.from({ length: 81 }, (_, index) => {
    const angle = Math.PI / 2 + (Math.PI * index) / 80;
    const radius = 60 + 10 * Math.sin(index / 6);
    return [
      300 + radius * Math.cos(angle),
      140 + radius * Math.sin(angle),
    ];
  });
  const points = sampledPoints.slice(1).flatMap((point, index) => {
    const previous = sampledPoints[index];
    return [
      [(previous[0] + point[0]) / 2, (previous[1] + point[1]) / 2],
      point,
    ];
  });
  points.unshift(sampledPoints[0]);
  const before = { objects: [ink] };
  const after = applyGesture(before, { points, radius: 12 });
  const audit = auditPartialEraseGeometry({
    before: before.objects[0].polygons,
    after: after.objects[0]?.polygons || [],
    eraserPoints: points.map(([x, y]) => ({ x, y })),
    radius: 12,
    captureLocations: true,
  });

  assert.equal(
    audit.violations.retainedInsideContact,
    false,
    JSON.stringify(audit.violationSamples.retainedInsideContact),
  );

  const scale = 4;
  const view = { x: 225, y: 110, width: 80, height: 60 };
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg"
      width="${view.width * scale}" height="${view.height * scale}"
      viewBox="${view.x} ${view.y} ${view.width} ${view.height}">
      <path d="${polygonPath(after.objects[0]?.polygons || [])}" fill="#e11d48" fill-rule="evenodd" />
    </svg>
  `);
  const { data, info } = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const halfPixelDiagonal = Math.SQRT2 / (2 * scale);
  const renderedInside = [];
  for (let py = 0; py < info.height; py += 1) {
    for (let px = 0; px < info.width; px += 1) {
      const alpha = data[(py * info.width + px) * info.channels + 3];
      if (alpha === 0) continue;
      const point = {
        x: view.x + (px + 0.5) / scale,
        y: view.y + (py + 0.5) / scale,
      };
      if (
        pointInPolygons(point, ink.polygons)
        && distanceToGesture(point, points) < 12 - halfPixelDiagonal - 0.002
      ) {
        renderedInside.push({ ...point, alpha });
      }
    }
  }
  assert.deepEqual(renderedInside.slice(0, 20), []);
});
