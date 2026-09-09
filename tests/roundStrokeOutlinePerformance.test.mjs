import test from 'node:test';
import assert from 'node:assert/strict';

import { diff } from 'martinez-polygon-clipping';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  commandsToPolygonSet,
  commandsToPolylines,
  normalizeMultiPolygon,
  styledStrokeCommandsToPolygonSet,
  sweptDiskPolygon,
} from '../src/utils/paperAnnotationGeometry.js';

const signedArea = (ring) => {
  let twiceArea = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    twiceArea += ring[previous][0] * ring[index][1] - ring[index][0] * ring[previous][1];
  }
  return twiceArea / 2;
};

const polygonSetArea = (value) => normalizeMultiPolygon(value).reduce(
  (total, polygon) => total + polygon.reduce(
    (area, ring, index) => area + (index === 0 ? 1 : -1) * Math.abs(signedArea(ring)),
    0,
  ),
  0,
);

const vertexCount = (value) => normalizeMultiPolygon(value).reduce(
  (total, polygon) => total + polygon.reduce((sum, ring) => sum + ring.length, 0),
  0,
);

const pointInRing = ([x, y], ring) => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (
      (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
};

const pointInPolygonSet = (point, value) => normalizeMultiPolygon(value).some(
  ([outer, ...holes]) => (
    pointInRing(point, outer)
    && !holes.some((hole) => pointInRing(point, hole))
  ),
);

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

const distanceToPolygonBoundary = (point, value) => normalizeMultiPolygon(value).reduce(
  (nearest, polygon) => polygon.reduce(
    (polygonNearest, ring) => ring.slice(1).reduce(
      (ringNearest, current, index) => Math.min(
        ringNearest,
        pointToSegmentDistance(point, ring[index], current),
      ),
      polygonNearest,
    ),
    nearest,
  ),
  Infinity,
);

const scaleCommands = (commands, scale) => commands.map((command) => [
  command[0],
  ...command.slice(1).map((coordinate) => coordinate * scale),
]);

// Wall-clock budgets in this file are asserted on the FASTEST of several
// samples after one discarded warm-up. Host load, GC pauses and JIT warm-up can
// only add time, never remove it, so the minimum is the closest reading of the
// eraser's own cost, while a real algorithmic regression raises every sample —
// including the minimum — so the budgets keep their teeth (a deliberate
// slowdown injected into erasePageAnnotations still fails these tests).
// Ruled in KAL-446 (2026-09-09): single-sample readings of this file failed
// on busy hosts (hosted CI 2026-09-07, dev mac at load 37) while the same code
// measured 2-3x inside budget when re-run alone. The budgets are unchanged;
// the per-test `timeout` values are harness guards sized for the extra
// samples, not performance assertions.
const TIMING_SAMPLES = 5;
const bestOf = (run, samples = TIMING_SAMPLES) => {
  run();
  let result;
  let bestMs = Infinity;
  const readings = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    result = run();
    const elapsed = performance.now() - started;
    readings.push(elapsed.toFixed(1));
    bestMs = Math.min(bestMs, elapsed);
  }
  return { result, bestMs, readings: readings.join('/') };
};

test('tiny high-resolution cubic produces a bounded round outline without scale floors', {
  timeout: 5_000,
}, () => {
  const commands = [
    ['M', 0, 0],
    ['C', 0.04, -0.09, 0.14, 0.1, 0.22, 0],
  ];
  const strokeWidth = 0.0002;
  const curveTolerance = 1e-7;
  const flattened = commandsToPolylines(commands, curveTolerance)[0].points;
  const centerlineLength = flattened.slice(1).reduce(
    (length, point, index) => length + Math.hypot(
      point.x - flattened[index].x,
      point.y - flattened[index].y,
    ),
    0,
  );

  const { result: outline, bestMs, readings } = bestOf(() => commandsToPolygonSet(commands, {
    strokeWidth,
    curveTolerance,
  }));
  const vertices = vertexCount(outline);

  assert.ok(
    bestMs < 250,
    `round outline took ${bestMs.toFixed(1)}ms at best (samples ${readings}ms)`,
  );
  assert.ok(
    vertices <= flattened.length * 4 + 80,
    `${flattened.length} flattened points expanded to ${vertices} outline vertices`,
  );

  const expectedArea = centerlineLength * strokeWidth
    + Math.PI * (strokeWidth / 2) ** 2;
  assert.ok(
    Math.abs(polygonSetArea(outline) - expectedArea) <= expectedArea * 0.003,
    'outline area drifted from the analytic round-stroke area',
  );

  // A proportional 1e-5 rendering must take the same path through the
  // algorithm. An absolute geometry epsilon would collapse this stroke.
  const tinyScale = 1e-5;
  const scaledOutline = commandsToPolygonSet(scaleCommands(commands, tinyScale), {
    strokeWidth: strokeWidth * tinyScale,
    curveTolerance: curveTolerance * tinyScale,
  });
  assert.equal(vertexCount(scaledOutline), vertices);
  const scaledArea = polygonSetArea(scaledOutline);
  assert.ok(scaledArea > 0);
  assert.ok(
    Math.abs(scaledArea / tinyScale ** 2 - polygonSetArea(outline))
      <= expectedArea * 1e-7,
    'proportional tiny outline changed geometry',
  );
});

test('direct round outline retains caps, joins, and a localized first rim bite', () => {
  const strokeWidth = 8;
  const radius = strokeWidth / 2;
  const outline = commandsToPolygonSet([
    ['M', 0, 0],
    ['L', 30, 0],
    ['L', 30, 20],
  ], { strokeWidth, curveTolerance: 0.01 });

  assert.equal(pointInPolygonSet([-3.9, 0], outline), true, 'round start cap missing');
  assert.equal(pointInPolygonSet([33.8, -1], outline), true, 'round outer join missing');
  assert.equal(pointInPolygonSet([30, 23.9], outline), true, 'round end cap missing');

  const eraser = commandsToPolygonSet([
    ['M', 34.5, -1],
    ['L', 34.5, -1.001],
  ], { strokeWidth: 2 });
  const survivor = normalizeMultiPolygon(diff(outline, eraser));
  assert.ok(polygonSetArea(survivor) < polygonSetArea(outline));
  assert.equal(pointInPolygonSet([5, 0], survivor), true, 'rim bite changed distant ink');
  assert.equal(pointInPolygonSet([34, -1], survivor), false, 'first rim bite missed');
});

test('round cap tessellation honors curve tolerance at large coordinate scale', () => {
  const radius = 250;
  const curveTolerance = 0.05;
  const outline = commandsToPolygonSet([
    ['M', 0, 0],
    ['L', 1_000, 0],
  ], {
    strokeWidth: radius * 2,
    curveTolerance,
  });

  let maximumDeviation = 0;
  for (let index = 0; index <= 720; index += 1) {
    const angle = Math.PI / 2 + index / 720 * Math.PI;
    const analyticPoint = [
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
    ];
    maximumDeviation = Math.max(
      maximumDeviation,
      distanceToPolygonBoundary(analyticPoint, outline),
    );
  }
  assert.ok(
    maximumDeviation <= curveTolerance * 1.01,
    `large round cap deviated ${maximumDeviation} with tolerance ${curveTolerance}`,
  );
});

test('proportional tiny lines and their polygon areas do not collapse at fixed epsilons', () => {
  let referenceVertices = null;
  let referenceArea = null;
  for (const scale of [1, 1e-3, 1e-4, 1e-8]) {
    const outline = commandsToPolygonSet([
      ['M', 0, 0],
      ['L', 10 * scale, 0],
    ], {
      strokeWidth: 2 * scale,
      curveTolerance: 0.001 * scale,
    });
    const vertices = vertexCount(outline);
    const normalizedArea = polygonSetArea(outline) / scale ** 2;
    assert.ok(vertices > 4, `scale ${scale} collapsed the line outline`);
    assert.ok(normalizedArea > 0, `scale ${scale} collapsed the line area`);
    if (referenceVertices == null) {
      referenceVertices = vertices;
      referenceArea = normalizedArea;
    } else {
      assert.equal(vertices, referenceVertices, `scale ${scale} changed tessellation`);
      assert.ok(
        Math.abs(normalizedArea - referenceArea) <= referenceArea * 1e-12,
        `scale ${scale} changed proportional area`,
      );
    }
  }
});

test('self-overlapping centerline falls back to a healthy polygon union', () => {
  const outline = commandsToPolygonSet([
    ['M', 0, 0],
    ['L', 30, 30],
    ['L', 0, 30],
    ['L', 30, 0],
  ], { strokeWidth: 6, curveTolerance: 0.01 });

  assert.ok(outline.length > 0);
  assert.ok(polygonSetArea(outline) > 0);
  assert.equal(pointInPolygonSet([15, 15], outline), true);
  assert.equal(pointInPolygonSet([15, 35], outline), false);
});

test('tight folded centerline cannot leave a false hole in the swept disk', () => {
  const points = [
    { x: 0, y: 0 },
    { x: -1.2720385879, y: -3.8076447504 },
    { x: 4.1939100437, y: -9.0134862728 },
    { x: 5.2144901272, y: -7.9463492627 },
  ];
  const radius = 4.9349670705;
  const outline = sweptDiskPolygon(points, radius, {
    curveTolerance: radius * 1e-4,
    minDistance: 0,
  });

  assert.equal(
    pointInPolygonSet([3.7293348684, -3.0917372516], outline),
    true,
    'point inside the analytic swept disk became a false hole',
  );
});

test('seeded swept disks match analytic centerline distance away from tessellation edges', () => {
  let state = 0x5eeda11f;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };

  for (let fixture = 0; fixture < 12; fixture += 1) {
    const points = [{ x: 0, y: 0 }];
    for (let index = 0; index < 4; index += 1) {
      const previous = points.at(-1);
      const angle = random() * Math.PI * 2;
      const length = 1 + random() * 8;
      points.push({
        x: previous.x + Math.cos(angle) * length,
        y: previous.y + Math.sin(angle) * length,
      });
    }
    const radius = 0.5 + random() * 4.5;
    const tolerance = radius * 1e-4;
    const outline = sweptDiskPolygon(points, radius, {
      curveTolerance: tolerance,
      minDistance: 0,
    });
    const minX = Math.min(...points.map((point) => point.x)) - radius * 1.2;
    const maxX = Math.max(...points.map((point) => point.x)) + radius * 1.2;
    const minY = Math.min(...points.map((point) => point.y)) - radius * 1.2;
    const maxY = Math.max(...points.map((point) => point.y)) + radius * 1.2;

    for (let probe = 0; probe < 40; probe += 1) {
      const point = [
        minX + random() * (maxX - minX),
        minY + random() * (maxY - minY),
      ];
      const centerlineDistance = points.slice(1).reduce(
        (nearest, current, index) => Math.min(
          nearest,
          pointToSegmentDistance(
            point,
            [points[index].x, points[index].y],
            [current.x, current.y],
          ),
        ),
        Infinity,
      );
      if (Math.abs(centerlineDistance - radius) <= tolerance * 2) continue;
      assert.equal(
        pointInPolygonSet(point, outline),
        centerlineDistance < radius,
        `fixture ${fixture}, probe ${probe}, distance ${centerlineDistance}, radius ${radius}`,
      );
    }
  }
});

test('partial erase stays proportional from ordinary to microscopic page geometry', () => {
  let expectedPathLength = null;
  let expectedNormalizedArea = null;
  for (const scale of [1e-2, 1e-3, 1e-4, 1e-5, 1e-8]) {
    const object = {
      type: 'path',
      tool: 'pen',
      path: [['M', 0, 0], ['L', scale, 0]],
      left: 0,
      top: 0,
      pathOffset: { x: 0, y: 0 },
      scaleX: 1,
      scaleY: 1,
      stroke: '#000',
      strokeWidth: scale / 10,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      data: { id: 'proportional-line', tool: 'pen' },
    };
    const result = erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [{ x: scale / 2, y: 0 }],
      eraserRadius: scale / 20,
      mode: 'partial',
    });

    assert.equal(result.didChange, true, `scale ${scale} missed the bite`);
    assert.equal(result.deletedIds.length, 0, `scale ${scale} whole-deleted`);
    const survivor = result.pageAnnotations.objects[0];
    assert.equal(survivor.polygons.length, 2, `scale ${scale} changed topology`);
    const normalizedArea = polygonSetArea(survivor.polygons) / scale ** 2;
    if (expectedPathLength == null) {
      expectedPathLength = survivor.path.length;
      expectedNormalizedArea = normalizedArea;
    } else {
      assert.equal(
        survivor.path.length,
        expectedPathLength,
        `scale ${scale} changed survivor tessellation`,
      );
      assert.ok(
        Math.abs(normalizedArea - expectedNormalizedArea)
          <= expectedNormalizedArea * 1e-10,
        `scale ${scale} changed normalized survivor area`,
      );
    }
  }
});

test('huge proportional round strokes stay inside the release-time budget', {
  timeout: 20_000,
}, () => {
  for (const scale of [1e3, 1e6, 1e7]) {
    const object = {
      type: 'path',
      tool: 'pen',
      path: [['M', 0, 0], ['L', scale, 0]],
      left: 0,
      top: 0,
      pathOffset: { x: 0, y: 0 },
      scaleX: 1,
      scaleY: 1,
      stroke: '#000',
      strokeWidth: scale / 10,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      data: { id: 'huge-line', tool: 'pen' },
    };
    const { result, bestMs, readings } = bestOf(() => erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [{ x: scale / 2, y: 0 }],
      eraserRadius: scale / 20,
      mode: 'partial',
    }));

    assert.equal(result.didChange, true);
    assert.equal(result.deletedIds.length, 0);
    assert.equal(result.pageAnnotations.objects[0].polygons.length, 2);
    assert.ok(
      bestMs < 500,
      `scale ${scale} pointer release took ${bestMs.toFixed(1)}ms at best (samples ${readings}ms)`,
    );
  }
});

test('partial erase preserves a proportional cubic through microscopic scales', () => {
  let expectedArea = null;
  let expectedPathLength = null;
  for (const scale of [1, 1e-3, 1e-6, 1e-8, 1e-9, 1e-12]) {
    const object = {
      type: 'path',
      tool: 'pen',
      path: [['M', 0, 0], ['C', 0, scale, scale, scale, scale, 0]],
      left: 0,
      top: 0,
      pathOffset: { x: 0, y: 0 },
      scaleX: 1,
      scaleY: 1,
      stroke: '#000',
      strokeWidth: scale / 10,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      data: { id: 'microscopic-curve', tool: 'pen' },
    };
    const result = erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [{ x: scale / 2, y: scale * 0.83 }],
      eraserRadius: scale / 20,
      mode: 'partial',
    });

    assert.equal(result.didChange, true, `scale ${scale} missed the curved bite`);
    assert.equal(result.deletedIds.length, 0);
    const survivor = result.pageAnnotations.objects[0];
    const normalizedArea = polygonSetArea(survivor.polygons) / scale ** 2;
    if (expectedArea == null) {
      expectedArea = normalizedArea;
      expectedPathLength = survivor.path.length;
    } else {
      assert.ok(
        Math.abs(normalizedArea - expectedArea) <= expectedArea * 2e-5,
        `scale ${scale} changed normalized curved area`,
      );
      assert.ok(
        Math.abs(survivor.path.length - expectedPathLength) <= 1,
        `scale ${scale} changed curved tessellation materially`,
      );
    }
  }
});

test('bridge cleanup is bounded when a huge eraser crosses ultra-thin ink', {
  timeout: 5_000,
}, () => {
  for (const strokeWidth of [1, 1e-2, 1e-3, 1e-5, 1e-8]) {
    const object = {
      type: 'path',
      tool: 'pen',
      path: [['M', 0, 0], ['L', 100, 0]],
      left: 0,
      top: 0,
      pathOffset: { x: 0, y: 0 },
      scaleX: 1,
      scaleY: 1,
      stroke: '#000',
      strokeWidth,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      data: { id: 'extreme-width-ratio', tool: 'pen' },
    };
    const { result, bestMs, readings } = bestOf(() => erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [{ x: 50, y: 0 }],
      eraserRadius: 1,
      mode: 'partial',
    }));

    assert.equal(result.didChange, true);
    assert.equal(result.deletedIds.length, 0);
    assert.equal(result.pageAnnotations.objects[0].polygons.length, 2);
    assert.ok(
      bestMs < 250,
      `width ${strokeWidth} cleanup took ${bestMs.toFixed(1)}ms at best (samples ${readings}ms)`,
    );
  }
});

test('large styled round caps obey tolerance without a facet ceiling', () => {
  const radius = 50_000;
  const tolerance = 0.05;
  const outline = styledStrokeCommandsToPolygonSet([
    ['M', 0, 0],
    ['L', 200_000, 0],
  ], {
    strokeWidth: radius * 2,
    curveTolerance: tolerance,
    lineCap: 'round',
    lineJoin: 'bevel',
  });

  let maximumDeviation = 0;
  for (let index = 0; index <= 720; index += 1) {
    const angle = Math.PI / 2 + index / 720 * Math.PI;
    maximumDeviation = Math.max(
      maximumDeviation,
      distanceToPolygonBoundary([
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ], outline),
    );
  }
  assert.ok(
    maximumDeviation <= tolerance * 1.01,
    `styled round cap deviated ${maximumDeviation}`,
  );
});

test('near-collinear round stroke geometry degrades instead of throwing during union', () => {
  const outline = styledStrokeCommandsToPolygonSet([
    ['M', 244.438, 765.694],
    ['L', 244.457, 765.72],
    ['L', 244.469, 765.732],
    ['L', 244.476, 765.739],
    ['L', 244.482, 765.745],
    ['L', 244.488, 765.751],
    ['L', 244.494, 765.751],
    ['L', 244.494, 765.751],
    ['L', 244.513, 765.751],
    ['L', 244.532, 765.751],
  ], {
    strokeWidth: 1,
    curveTolerance: 0.02,
    lineCap: 'round',
    lineJoin: 'round',
    miterLimit: 10,
  });

  assert.ok(outline.length > 0);
});

test('styled dash geometry remains proportional through 1e-15', () => {
  let expectedComponents = null;
  let expectedNormalizedArea = null;
  for (const scale of [1, 1e-6, 1e-12, 1e-15]) {
    const outline = styledStrokeCommandsToPolygonSet([
      ['M', 0, 0],
      ['L', 10 * scale, 0],
    ], {
      strokeWidth: 0.5 * scale,
      curveTolerance: 1e-4 * scale,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: [2 * scale, 1 * scale],
    });
    const normalizedArea = polygonSetArea(outline) / scale ** 2;
    if (expectedComponents == null) {
      expectedComponents = outline.length;
      expectedNormalizedArea = normalizedArea;
    } else {
      assert.equal(outline.length, expectedComponents, `scale ${scale} changed dash count`);
      assert.ok(
        Math.abs(normalizedArea - expectedNormalizedArea)
          <= expectedNormalizedArea * 1e-10,
        `scale ${scale} changed styled dash area`,
      );
    }
  }
});

test('zero-length projecting-square dashes remain square dots', () => {
  const outline = styledStrokeCommandsToPolygonSet([
    ['M', 0, 0],
    ['L', 30, 0],
  ], {
    strokeWidth: 4,
    curveTolerance: 0.01,
    lineCap: 'square',
    lineJoin: 'miter',
    dashArray: [0, 10],
  });

  assert.equal(outline.length, 4, 'dots remain at 0, 10, 20, and 30');
  for (const x of [0, 10, 20, 30]) {
    assert.equal(pointInPolygonSet([x, 0], outline), true);
  }
  for (const x of [5, 15, 25]) {
    assert.equal(pointInPolygonSet([x, 0], outline), false);
  }
});
