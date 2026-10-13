// 2026-10-04 (test-reliability pass): geometry only. This file used to also
// hold one wall-clock budget ("multi-cubic first erase stays inside the
// interaction release budget"), which put ALL fourteen geometry tests below in
// the non-blocking perf lane with it. The budget moved to
// tests/partialEraseCurveLocalityBudget.test.mjs (perf lane, unchanged
// budget); these checks are blocking again.
import test from 'node:test';
import assert from 'node:assert/strict';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  commandsToPolygonSet,
  normalizeMultiPolygon,
} from '../src/utils/paperAnnotationGeometry.js';

const fixtures = {
  quadratic: {
    path: [['M', 20, 150], ['Q', 170, 10, 320, 150]],
    point(t) {
      const mt = 1 - t;
      return {
        x: mt * mt * 20 + 2 * mt * t * 170 + t * t * 320,
        y: mt * mt * 150 + 2 * mt * t * 10 + t * t * 150,
      };
    },
    tangent(t) {
      return {
        x: 2 * (1 - t) * 150 + 2 * t * 150,
        y: 2 * (1 - t) * -140 + 2 * t * 140,
      };
    },
  },
  cubic: {
    path: [['M', 20, 130], ['C', 90, 10, 240, 250, 340, 110]],
    point(t) {
      const mt = 1 - t;
      return {
        x: mt ** 3 * 20 + 3 * mt * mt * t * 90 + 3 * mt * t * t * 240 + t ** 3 * 340,
        y: mt ** 3 * 130 + 3 * mt * mt * t * 10 + 3 * mt * t * t * 250 + t ** 3 * 110,
      };
    },
    tangent(t) {
      const mt = 1 - t;
      return {
        x: 3 * mt * mt * 70 + 6 * mt * t * 150 + 3 * t * t * 100,
        y: 3 * mt * mt * -120 + 6 * mt * t * 240 + 3 * t * t * -140,
      };
    },
  },
};

const segments = (polygons) => normalizeMultiPolygon(polygons)
  .flatMap((polygon) => polygon.flatMap((ring) => (
    ring.slice(1).map((point, index) => [ring[index], point])
  )));

const sampledBoundary = (polygons) => segments(polygons).flatMap(([a, b]) => {
  const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
  return Array.from({ length: count }, (_, index) => {
    const t = index / count;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  });
});

const pointToSegmentDistance = (point, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(
    1,
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared,
  ));
  return Math.hypot(
    point[0] - (a[0] + t * dx),
    point[1] - (a[1] + t * dy),
  );
};

const outsideCutDeviation = (source, target, center, radius) => {
  const targetSegments = segments(target);
  const untouched = sampledBoundary(source).filter((point) => (
    Math.hypot(point[0] - center.x, point[1] - center.y) > radius + 0.35
  ));
  assert.ok(untouched.length > 100);
  return untouched.reduce((maximum, point) => Math.max(
    maximum,
    targetSegments.reduce(
      (nearest, [a, b]) => Math.min(nearest, pointToSegmentDistance(point, a, b)),
      Infinity,
    ),
  ), 0);
};

const makeLegacyInk = (id, path, width, overrides = {}) => ({
  type: 'path',
  id,
  annotationId: id,
  tool: 'pen',
  path,
  left: 0,
  top: 0,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  stroke: '#d11b2d',
  strokeWidth: width,
  fill: null,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  data: { id, tool: 'pen', isPdfImported: true },
  ...overrides,
});

const paintedPolygonSet = (object, curveTolerance = 0.05) => {
  const polygons = normalizeMultiPolygon(object?.polygons);
  if (polygons.length) return polygons;
  return commandsToPolygonSet(object?.path || object?.cmds || [], {
    strokeWidth: object?.strokeWidth || 0,
    curveTolerance,
    simplifyTolerance: 0,
  });
};

for (const [name, fixture] of Object.entries(fixtures)) {
  for (const { width, radius } of [
    { width: 4, radius: 2 },
    { width: 12, radius: 6 },
    { width: 36, radius: 12 },
  ]) {
    test(`${name} width ${width}, eraser ${radius}: untouched outline stays put`, () => {
      const t = 0.53;
      const point = fixture.point(t);
      const tangent = fixture.tangent(t);
      const length = Math.hypot(tangent.x, tangent.y);
      const normal = { x: -tangent.y / length, y: tangent.x / length };
      const bite = Math.min(width * 0.3, radius * 0.5);
      const center = {
        x: point.x + normal.x * (width / 2 + radius - bite),
        y: point.y + normal.y * (width / 2 + radius - bite),
      };
      const before = commandsToPolygonSet(fixture.path, {
        strokeWidth: width,
        curveTolerance: 0.05,
        simplifyTolerance: 0,
      });
      const result = erasePageAnnotations({
        pageAnnotations: { objects: [makeLegacyInk(`${name}-${width}`, fixture.path, width)] },
        eraserPoints: [center],
        eraserRadius: radius,
        mode: 'partial',
      });
      const survivor = result.pageAnnotations.objects[0];
      const after = paintedPolygonSet(survivor);

      assert.equal(result.didChange, true);
      assert.ok(after?.length);
      assert.ok(survivor.polygons?.length);
      assert.ok(survivor.paperEraserCuts?.length);
      assert.ok(
        survivor.paperSourceStroke?.path?.some(
          (command) => command[0] === (name === 'quadratic' ? 'Q' : 'C'),
        ),
        'ordinary round-stroke survivor must retain its analytic render source',
      );
      const deviation = Math.max(
        outsideCutDeviation(before, after, center, radius),
        outsideCutDeviation(after, before, center, radius),
      );
      assert.ok(
        deviation <= 0.1,
        `untouched curve moved ${deviation.toFixed(3)} page units`,
      );
    });
  }
}

test('nonuniformly resized legacy curve keeps untouched world geometry', () => {
  const fixture = fixtures.quadratic;
  const width = 12;
  const scaleX = 0.5;
  const scaleY = 4;
  const radius = 6;
  const center = { x: 85, y: 348 };
  const transform = ([x, y]) => [x * scaleX, y * scaleY];
  const before = commandsToPolygonSet(fixture.path, {
    strokeWidth: width,
    curveTolerance: 0.01,
    simplifyTolerance: 0,
  }).map((polygon) => polygon.map((ring) => ring.map(transform)));

  const result = erasePageAnnotations({
    pageAnnotations: {
      objects: [makeLegacyInk('scaled-quadratic', fixture.path, width, {
        scaleX,
        scaleY,
      })],
    },
    eraserPoints: [center],
    eraserRadius: radius,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];
  const after = paintedPolygonSet(survivor, 0.01);

  assert.equal(result.didChange, true);
  assert.ok(after?.length);
  assert.deepEqual(survivor.paperSourceStroke?.path, fixture.path);
  assert.deepEqual(survivor.paperSourceStroke?.matrix, [scaleX, 0, 0, scaleY, 0, 0]);
  const deviation = Math.max(
    outsideCutDeviation(before, after, center, radius),
    outsideCutDeviation(after, before, center, radius),
  );
  assert.ok(
    deviation <= 0.1,
    `untouched resized curve moved ${deviation.toFixed(3)} page units`,
  );
});

test('high-curvature cubic keeps its analytic untouched boundary', () => {
  const path = [['M', 0, 0], ['C', 150, 1000, 850, -1000, 1000, 0]];
  const width = 12;
  const radius = 6;
  const at = (t) => {
    const mt = 1 - t;
    return {
      x: 3 * mt * mt * t * 150 + 3 * mt * t * t * 850 + t ** 3 * 1000,
      y: 3 * mt * mt * t * 1000 - 3 * mt * t * t * 1000,
    };
  };
  const tangent = (t) => {
    const mt = 1 - t;
    return {
      x: 3 * mt * mt * 150 + 6 * mt * t * 700 + 3 * t * t * 150,
      y: 3 * mt * mt * 1000 - 12 * mt * t * 1000 + 3 * t * t * 1000,
    };
  };
  const midpoint = at(0.5);
  const midpointTangent = tangent(0.5);
  const midpointLength = Math.hypot(midpointTangent.x, midpointTangent.y);
  const center = {
    x: midpoint.x - (midpointTangent.y / midpointLength) * 9,
    y: midpoint.y + (midpointTangent.x / midpointLength) * 9,
  };
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [makeLegacyInk('extreme-cubic', path, width)] },
    eraserPoints: [center],
    eraserRadius: radius,
    mode: 'partial',
  });
  const after = paintedPolygonSet(result.pageAnnotations.objects[0], 0.01);
  const afterSegments = segments(after);

  assert.equal(result.didChange, true);
  let maximum = 0;
  for (let index = 0; index <= 2000; index += 1) {
    const t = index / 2000;
    const point = at(t);
    const direction = tangent(t);
    const length = Math.hypot(direction.x, direction.y);
    if (length === 0) continue;
    const normal = { x: -direction.y / length, y: direction.x / length };
    for (const side of [-1, 1]) {
      const boundary = [
        point.x + normal.x * width / 2 * side,
        point.y + normal.y * width / 2 * side,
      ];
      if (Math.hypot(boundary[0] - center.x, boundary[1] - center.y) <= radius + 0.35) {
        continue;
      }
      const nearest = afterSegments.reduce(
        (distance, [a, b]) => Math.min(distance, pointToSegmentDistance(boundary, a, b)),
        Infinity,
      );
      maximum = Math.max(maximum, nearest);
    }
  }
  assert.ok(
    maximum <= 0.1,
    `analytic untouched boundary moved ${maximum.toFixed(3)} page units`,
  );
});

for (const fixture of [
  {
    name: 'quadratic',
    curveOp: 'Q',
    path: [
      ['M', 20, 150],
      ['Q', 70, 100, 120, 150],
      ['Q', 220, 50, 320, 150],
    ],
    eraseAt: { x: 220, y: 100 },
  },
  {
    name: 'cubic',
    curveOp: 'C',
    path: [
      ['M', 20, 150],
      ['C', 45, 100, 95, 100, 120, 150],
      ['C', 170, 50, 270, 50, 320, 150],
    ],
    eraseAt: { x: 220, y: 75 },
  },
]) {
  test(`${fixture.name} partial erase retains untouched authored segment exactly`, () => {
    const result = erasePageAnnotations({
      pageAnnotations: {
        objects: [makeLegacyInk(
          `exact-${fixture.name}`,
          fixture.path,
          12,
        )],
      },
      eraserPoints: [fixture.eraseAt],
      eraserRadius: 6,
      mode: 'partial',
    });
    const survivor = result.pageAnnotations.objects[0];

    assert.equal(result.didChange, true);
    assert.ok(survivor.polygons?.length);
    assert.ok(survivor.paperEraserCuts?.length);
    assert.deepEqual(survivor.paperSourceStroke?.path, fixture.path);
    assert.ok(
      survivor.paperSourceStroke.path.some((command) => command[0] === fixture.curveOp),
    );
    assert.ok(
      survivor.paperSourceStroke.path.every(
        (command) => command[0] === 'M' || command[0] === fixture.curveOp,
      ),
      'partial erase must keep analytic source geometry separate from the clipping mesh',
    );
  });
}

test('filled imported cubic keeps its exact authored fill under a separate cut mask', () => {
  const path = [
    ['M', 20, 100],
    ['C', 80, 20, 240, 20, 300, 100],
    ['L', 300, 150],
    ['L', 20, 150],
    ['Z'],
  ];
  const result = erasePageAnnotations({
    pageAnnotations: {
      objects: [{
        ...makeLegacyInk('filled-imported-cubic', path, 0),
        stroke: null,
        fill: '#d11b2d',
        fillRule: 'nonzero',
      }],
    },
    eraserPoints: [{ x: 160, y: 45 }],
    eraserRadius: 12,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.ok(survivor.polygons?.length);
  assert.ok(survivor.paperEraserCuts?.length);
  assert.equal(survivor.paperSourceStroke?.paintMode, 'fill');
  assert.equal(survivor.paperSourceStroke?.fill, '#d11b2d');
  assert.equal(survivor.paperSourceStroke?.fillRule, 'nonzero');
  assert.deepEqual(survivor.paperSourceStroke?.path, path);
  assert.ok(survivor.paperSourceStroke.path.some((command) => command[0] === 'C'));
});

test('resized authored fill keeps one exact source through cumulative bites', () => {
  const path = [
    ['M', 20, 100],
    ['C', 80, 20, 240, 20, 300, 100],
    ['L', 300, 150],
    ['L', 20, 150],
    ['Z'],
  ];
  const original = {
    ...makeLegacyInk('resized-filled-cubic', path, 0),
    scaleX: 1.5,
    scaleY: 0.75,
    stroke: null,
    fill: '#d11b2d',
    fillRule: 'nonzero',
  };
  const first = erasePageAnnotations({
    pageAnnotations: { objects: [original] },
    eraserPoints: [{ x: 150, y: 80 }],
    eraserRadius: 12,
    mode: 'partial',
  });
  const firstSurvivor = first.pageAnnotations.objects[0];
  const firstCuts = structuredClone(firstSurvivor.paperEraserCuts);
  const second = erasePageAnnotations({
    pageAnnotations: first.pageAnnotations,
    eraserPoints: [{ x: 300, y: 80 }],
    eraserRadius: 12,
    mode: 'partial',
  });
  const survivor = second.pageAnnotations.objects[0];

  assert.equal(first.didChange, true);
  assert.equal(second.didChange, true);
  assert.deepEqual(survivor.paperSourceStroke.path, path);
  assert.deepEqual(survivor.paperSourceStroke.matrix, [1.5, 0, 0, 0.75, 0, 0]);
  assert.equal(survivor.paperSourceStroke.fillRule, 'nonzero');
  assert.notDeepEqual(survivor.paperEraserCuts, firstCuts);
});

test('authored SVG arc remains byte-exact while its operational copy uses cubics', () => {
  const path = [
    ['M', 20, 100],
    ['A', 80, 80, 0, 0, 1, 180, 100],
  ];
  const attempt = (y) => erasePageAnnotations({
    pageAnnotations: {
      objects: [makeLegacyInk('authored-arc', path, 12)],
    },
    eraserPoints: [{ x: 100, y }],
    eraserRadius: 6,
    mode: 'partial',
  });
  let result = attempt(20);
  if (!result.didChange) result = attempt(180);
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.deepEqual(survivor.paperSourceStroke?.path, path);
  assert.ok(
    survivor.paperSourceStroke?.operationalPath?.some((command) => command[0] === 'C'),
  );
  assert.equal(
    survivor.paperSourceStroke.operationalPath.some((command) => command[0] === 'A'),
    false,
  );
});

test('relative authored SVG arc remains byte-exact while its operational copy uses cubics', () => {
  const path = [
    ['m', 20, 100],
    ['a', 80, 80, 0, 0, 1, 160, 0],
  ];
  const attempt = (y) => erasePageAnnotations({
    pageAnnotations: {
      objects: [makeLegacyInk('relative-authored-arc', path, 12)],
    },
    eraserPoints: [{ x: 100, y }],
    eraserRadius: 6,
    mode: 'partial',
  });
  let result = attempt(20);
  if (!result.didChange) result = attempt(180);
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.deepEqual(survivor.paperSourceStroke?.path, path);
  assert.ok(
    survivor.paperSourceStroke?.operationalPath?.some((command) => command[0] === 'C'),
  );
  assert.equal(
    survivor.paperSourceStroke.operationalPath.some(
      (command) => String(command[0]).toUpperCase() === 'A',
    ),
    false,
  );
});
