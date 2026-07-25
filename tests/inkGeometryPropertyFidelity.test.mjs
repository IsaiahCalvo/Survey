import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPageAffineToInkObject,
  commitInkObjectMove,
  commitInkObjectResize,
  createInkPathAffine,
} from '../src/utils/inkGeometryTransform.js';
import { normalizeOperationalInkPath } from '../src/utils/inkPathNormalization.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  commandsToPolygonSet,
  normalizeMultiPolygon,
} from '../src/utils/paperAnnotationGeometry.js';

const SEEDS = [
  0x00000001,
  0x13579bdf,
  0x2468ace0,
  0x5eed1234,
  0x7fffffff,
  0x80000001,
  0x9e3779b9,
  0xc001d00d,
  0xdeadbeef,
];

const seedLabel = (seed) => `0x${seed.toString(16).padStart(8, '0')}`;

const randomFor = (initialSeed) => {
  let state = initialSeed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
};

const multiply = (left, right) => {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

const translation = (x, y) => [1, 0, 0, 1, x, y];

const rotation = (degrees) => {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine, sine, -sine, cosine, 0, 0];
};

const dimensions = ({
  scaleX,
  scaleY,
  flipX = false,
  flipY = false,
  skewX = 0,
  skewY = 0,
}) => {
  const signedX = scaleX * (flipX ? -1 : 1);
  const signedY = scaleY * (flipY ? -1 : 1);
  const tangentX = Math.tan(skewX * Math.PI / 180);
  const tangentY = Math.tan(skewY * Math.PI / 180);
  return [
    signedX * (1 + tangentX * tangentY),
    signedY * tangentY,
    signedX * tangentX,
    signedY,
    0,
    0,
  ];
};

const around = (matrix, x, y) => (
  multiply(translation(x, y), multiply(matrix, translation(-x, -y)))
);

const assertClose = (actual, expected, context, relativeTolerance = 2e-9) => {
  assert.equal(actual.length, expected.length, context);
  for (let index = 0; index < expected.length; index += 1) {
    const scale = Math.max(1, Math.abs(actual[index]), Math.abs(expected[index]));
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= relativeTolerance * scale,
      `${context}; index=${index}; expected=${expected[index]}; actual=${actual[index]}`,
    );
  }
};

const carrierSnapshot = (object) => JSON.stringify({
  path: object.path,
  cmds: object.cmds,
  polygons: object.polygons,
  paperCenterline: object.paperCenterline,
  paperCenterlineRuns: object.paperCenterlineRuns,
  pdfInkPresentationGeometry: object.data?.pdfInkPresentationGeometry,
  pdfInkSourceGeometry: object.data?.pdfInkSourceGeometry,
});

const allRelativeCommands = (coordinateScale, offsetX, offsetY, jitter) => [
  ['m', offsetX, offsetY],
  ['l', 18 * coordinateScale, (1 + jitter) * coordinateScale],
  ['h', 12 * coordinateScale],
  ['v', (9 - jitter) * coordinateScale],
  ['q', 7 * coordinateScale, 11 * coordinateScale, 15 * coordinateScale, 1 * coordinateScale],
  ['t', 14 * coordinateScale, -2 * coordinateScale],
  [
    'c',
    5 * coordinateScale,
    -12 * coordinateScale,
    13 * coordinateScale,
    14 * coordinateScale,
    21 * coordinateScale,
    0,
  ],
  ['s', 14 * coordinateScale, -11 * coordinateScale, 22 * coordinateScale, 2 * coordinateScale],
  [
    'a',
    9 * coordinateScale,
    6 * coordinateScale,
    17 + jitter,
    0,
    1,
    16 * coordinateScale,
    8 * coordinateScale,
  ],
  ['z'],
];

const makeCarrierRichInk = ({
  id,
  path,
  strokeWidth,
  left = 0,
  top = 0,
  scaleX = 1,
  scaleY = 1,
  angle = 0,
  flipX = false,
  flipY = false,
  skewX = 0,
  skewY = 0,
  inkGeometrySpace = 'page',
}) => {
  const normalized = normalizeOperationalInkPath(path);
  const first = normalized.find((command) => command[0] === 'M') || ['M', 0, 0];
  const last = [...normalized].reverse().find((command) => (
    ['M', 'L', 'Q', 'C'].includes(command[0])
  )) || first;
  const lastX = last.at(-2);
  const lastY = last.at(-1);
  return {
    type: 'path',
    id,
    annotationId: id,
    tool: 'pen',
    path,
    cmds: structuredClone(path),
    polygons: [[[
      [first[1], first[2]],
      [lastX, first[2]],
      [lastX, lastY],
      [first[1], lastY],
      [first[1], first[2]],
    ]]],
    paperCenterline: [
      { x: first[1], y: first[2], pressure: 0.25 },
      { x: lastX, y: lastY, pressure: 0.75 },
    ],
    paperCenterlineRuns: [[
      { x: first[1], y: first[2], pressure: 0.25 },
      { x: lastX, y: lastY, pressure: 0.75 },
    ]],
    left,
    top,
    scaleX,
    scaleY,
    angle,
    flipX,
    flipY,
    skewX,
    skewY,
    inkGeometrySpace,
    stroke: '#d11b2d',
    strokeWidth,
    sourceWidth: strokeWidth,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    data: {
      id,
      tool: 'pen',
      inkGeometrySpace,
      pdfInkPresentationGeometry: {
        version: 1,
        path: structuredClone(path),
      },
      pdfInkSourceGeometry: {
        version: 1,
        inkLists: [[[first[1], first[2]], [lastX, lastY]]],
      },
    },
  };
};

const ringSignedArea = (ring) => {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea / 2;
};

const polygonSetArea = (polygons) => normalizeMultiPolygon(polygons).reduce(
  (total, polygon) => total + polygon.reduce(
    (polygonArea, ring, index) => (
      polygonArea + (index === 0 ? 1 : -1) * Math.abs(ringSignedArea(ring))
    ),
    0,
  ),
  0,
);

const pointToSegmentDistance = (point, start, end) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(
    1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
  ));
  return Math.hypot(
    point[0] - (start[0] + t * dx),
    point[1] - (start[1] + t * dy),
  );
};

const classifyPointInRing = (point, ring, tolerance) => {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if (pointToSegmentDistance(point, ring[previous], ring[index]) <= tolerance) {
      return 'boundary';
    }
    if (
      (y > point[1]) !== (previousY > point[1])
      && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x
    ) {
      inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
};

const pointInPolygonSet = (point, polygons, tolerance) => (
  normalizeMultiPolygon(polygons).some(([outer, ...holes]) => {
    const outerPosition = classifyPointInRing(point, outer, tolerance);
    if (outerPosition === 'boundary') return true;
    if (outerPosition === 'outside') return false;
    return holes.every((hole) => classifyPointInRing(point, hole, tolerance) !== 'inside');
  })
);

const assertPolygonSetContained = (inner, outer, outerArea, context) => {
  const allCoordinates = normalizeMultiPolygon(outer)
    .flat(2)
    .flat();
  const maximumCoordinate = allCoordinates.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value)),
    0,
  );
  const tolerance = Math.max(
    1e-12,
    Math.sqrt(Math.abs(outerArea)) * 1e-7,
    maximumCoordinate * Number.EPSILON * 64,
  );
  for (const polygon of normalizeMultiPolygon(inner)) {
    for (const ring of polygon) {
      const stride = Math.max(1, Math.ceil((ring.length - 1) / 32));
      for (let index = 1; index < ring.length; index += stride) {
        const start = ring[index - 1];
        const end = ring[index];
        for (const t of [0, 0.5, 1]) {
          const sample = [
            start[0] + (end[0] - start[0]) * t,
            start[1] + (end[1] - start[1]) * t,
          ];
          assert.equal(
            pointInPolygonSet(sample, outer, tolerance),
            true,
            `${context}; outside sample=${JSON.stringify(sample)}`,
          );
        }
      }
    }
  }
};

const transformPolygons = (polygons, affine) => normalizeMultiPolygon(polygons).map(
  (polygon) => polygon.map((ring) => ring.map(([x, y]) => {
    const point = affine.point(x, y);
    return [point.x, point.y];
  })),
);

const assertHealthyPolygonSet = (polygons, referenceArea, context) => {
  const normalized = normalizeMultiPolygon(polygons);
  assert.ok(normalized.length > 0, `${context}; no polygons`);
  const areaFloor = Math.max(Number.MIN_VALUE, Math.abs(referenceArea) * 1e-14);
  for (const [polygonIndex, polygon] of normalized.entries()) {
    assert.ok(polygon.length > 0, `${context}; empty polygon=${polygonIndex}`);
    for (const [ringIndex, ring] of polygon.entries()) {
      assert.ok(ring.length >= 4, `${context}; short ring=${polygonIndex}/${ringIndex}`);
      for (const [pointIndex, point] of ring.entries()) {
        assert.equal(point.length >= 2, true, `${context}; malformed point=${pointIndex}`);
        assert.equal(
          Number.isFinite(point[0]) && Number.isFinite(point[1]),
          true,
          `${context}; non-finite point=${polygonIndex}/${ringIndex}/${pointIndex}`,
        );
      }
      assert.ok(
        Math.abs(ringSignedArea(ring)) > areaFloor,
        `${context}; zero-area/degenerate ring=${polygonIndex}/${ringIndex}`,
      );
    }
  }
};

for (const [index, seed] of SEEDS.entries()) {
  test(`seed ${seedLabel(seed)}: relative M/L/H/V/Q/T/C/S/A/Z normalizes read-only`, () => {
    const random = randomFor(seed);
    const coordinateScale = [1e-4, 1, 1e5][index % 3];
    const coordinateOffset = [0, 1e6, -2e8][Math.floor(index / 3) % 3];
    const path = allRelativeCommands(
      coordinateScale,
      coordinateOffset + random() * coordinateScale,
      -coordinateOffset / 3 + random() * coordinateScale,
      random() - 0.5,
    );
    const before = JSON.stringify(path);
    const normalized = normalizeOperationalInkPath(path);

    assert.equal(JSON.stringify(path), before, `seed=${seedLabel(seed)} mutated authored path`);
    assert.ok(normalized.length >= path.length, `seed=${seedLabel(seed)} lost commands`);
    assert.equal(normalized[0][0], 'M');
    assert.equal(normalized.at(-1)[0], 'Z');
    assert.ok(
      normalized.every((command) => ['M', 'L', 'Q', 'C', 'Z'].includes(command[0])),
      `seed=${seedLabel(seed)} left an unsupported operational command`,
    );
    assert.ok(
      normalized.flatMap((command) => command.slice(1)).every(Number.isFinite),
      `seed=${seedLabel(seed)} produced non-finite coordinates`,
    );
  });
}

for (const [index, seed] of SEEDS.entries()) {
  test(`seed ${seedLabel(seed)}: move/resize/page affine preserve carriers and exact matrix`, () => {
    const random = randomFor(seed);
    const coordinateScale = [1e-4, 1, 1e5][index % 3];
    const strokeWidth = [2e-5, 3.5, 2500][index % 3];
    const path = allRelativeCommands(
      coordinateScale,
      (random() - 0.5) * coordinateScale * 20,
      (random() - 0.5) * coordinateScale * 20,
      random() - 0.5,
    );
    const object = makeCarrierRichInk({
      id: `property-${seedLabel(seed)}`,
      path,
      strokeWidth,
      scaleX: 0.35 + random() * 3,
      scaleY: 0.2 + random() * 4,
      angle: -150 + random() * 300,
      flipX: random() > 0.5,
      flipY: random() > 0.5,
      skewX: -32 + random() * 64,
      skewY: -18 + random() * 36,
    });
    const beforeObject = JSON.stringify(object);
    const beforeCarriers = carrierSnapshot(object);
    const beforeAffine = createInkPathAffine(object, object.path);
    const dx = (random() - 0.5) * coordinateScale * 40;
    const dy = (random() - 0.5) * coordinateScale * 40;
    const moved = commitInkObjectMove(object, dx, dy);
    const movedAffine = createInkPathAffine(moved, moved.path);

    assert.equal(JSON.stringify(object), beforeObject, `seed=${seedLabel(seed)} mutated input`);
    assert.equal(carrierSnapshot(moved), beforeCarriers, `seed=${seedLabel(seed)} move rewrote carrier`);
    assertClose(
      movedAffine.matrix,
      multiply(translation(dx, dy), beforeAffine.matrix),
      `seed=${seedLabel(seed)} move matrix`,
    );

    const resized = commitInkObjectResize(object, {
      scaleX: 0.1 + random() * 6,
      scaleY: 0.1 + random() * 6,
      visibleLeft: (random() - 0.5) * coordinateScale * 30,
      visibleTop: (random() - 0.5) * coordinateScale * 30,
    });
    assert.equal(carrierSnapshot(resized), beforeCarriers, `seed=${seedLabel(seed)} resize rewrote carrier`);

    const pivotX = (random() - 0.5) * coordinateScale * 50;
    const pivotY = (random() - 0.5) * coordinateScale * 50;
    const pageDimensions = dimensions({
      scaleX: 0.25 + random() * 4,
      scaleY: 0.2 + random() * 5,
      flipX: random() > 0.5,
      flipY: random() > 0.5,
      skewX: -35 + random() * 70,
      skewY: -20 + random() * 40,
    });
    const pageMatrix = multiply(
      translation(
        (random() - 0.5) * coordinateScale * 80,
        (random() - 0.5) * coordinateScale * 80,
      ),
      multiply(
        around(rotation(-160 + random() * 320), pivotX, pivotY),
        around(pageDimensions, pivotX, pivotY),
      ),
    );
    const transformed = applyPageAffineToInkObject(object, pageMatrix);
    const transformedAffine = createInkPathAffine(transformed, transformed.path);

    assert.equal(
      carrierSnapshot(transformed),
      beforeCarriers,
      `seed=${seedLabel(seed)} page affine rewrote carrier`,
    );
    assertClose(
      transformedAffine.matrix,
      multiply(pageMatrix, beforeAffine.matrix),
      `seed=${seedLabel(seed)} page affine matrix; fixture=${JSON.stringify({ pageMatrix, object })}`,
      8e-9,
    );
  });
}

test('seeded group affine and sequential single affine reconstruct one matrix per object', () => {
  const seed = 0xa11f1ee1;
  const random = randomFor(seed);
  const groupPivot = { x: 220, y: -140 };
  const groupMatrix = multiply(
    around(rotation(37), groupPivot.x, groupPivot.y),
    around(dimensions({
      scaleX: 2.4,
      scaleY: 0.42,
      flipX: true,
      skewX: 27,
      skewY: -11,
    }), groupPivot.x, groupPivot.y),
  );
  const followupMatrix = multiply(
    translation(-31, 44),
    around(rotation(-19), groupPivot.x, groupPivot.y),
  );
  const combined = multiply(followupMatrix, groupMatrix);

  for (let index = 0; index < 5; index += 1) {
    const path = allRelativeCommands(
      0.5 + random() * 5,
      -50 + random() * 100,
      -50 + random() * 100,
      random() - 0.5,
    );
    const object = makeCarrierRichInk({
      id: `group-${index}`,
      path,
      strokeWidth: 0.5 + random() * 12,
      left: -100 + random() * 200,
      top: -100 + random() * 200,
      inkGeometrySpace: 'local',
      scaleX: 0.3 + random() * 3,
      scaleY: 0.3 + random() * 3,
      angle: -120 + random() * 240,
      flipY: index % 2 === 0,
      skewX: -20 + random() * 40,
      skewY: -10 + random() * 20,
    });
    const carrierBytes = carrierSnapshot(object);
    const initial = createInkPathAffine(object, object.path).matrix;
    const grouped = applyPageAffineToInkObject(object, groupMatrix);
    const sequential = applyPageAffineToInkObject(grouped, followupMatrix);

    assert.equal(carrierSnapshot(grouped), carrierBytes, `group index=${index} rewrote carrier`);
    assert.equal(carrierSnapshot(sequential), carrierBytes, `single index=${index} rewrote carrier`);
    assertClose(
      createInkPathAffine(grouped, grouped.path).matrix,
      multiply(groupMatrix, initial),
      `seed=${seedLabel(seed)} group object=${index}`,
      8e-9,
    );
    assertClose(
      createInkPathAffine(sequential, sequential.path).matrix,
      multiply(combined, initial),
      `seed=${seedLabel(seed)} sequential object=${index}`,
      1.2e-8,
    );
  }
});

const eraseScenarios = [
  {
    seed: 0x10101010,
    coordinateScale: 1e-3,
    offsetX: 0,
    offsetY: 0,
    strokeWidth: 2e-4,
    radiusFactor: 0.2,
  },
  {
    seed: 0x20202020,
    coordinateScale: 1,
    offsetX: 1e6,
    offsetY: -2e6,
    strokeWidth: 4,
    radiusFactor: 0.45,
  },
  {
    seed: 0x30303030,
    coordinateScale: 1e3,
    offsetX: -2e7,
    offsetY: 3e7,
    strokeWidth: 260,
    radiusFactor: 0.9,
  },
  {
    seed: 0x40404040,
    coordinateScale: 0.25,
    offsetX: -900,
    offsetY: 1200,
    strokeWidth: 0.08,
    radiusFactor: 0.35,
  },
  {
    seed: 0x50505050,
    coordinateScale: 75,
    offsetX: 4e5,
    offsetY: 8e5,
    strokeWidth: 35,
    radiusFactor: 0.65,
  },
];

for (const scenario of eraseScenarios) {
  test(`seed ${seedLabel(scenario.seed)}: first transformed rim bite is contained and healthy`, {
    timeout: 5_000,
  }, () => {
    const {
      seed,
      coordinateScale,
      offsetX,
      offsetY,
      strokeWidth,
      radiusFactor,
    } = scenario;
    const random = randomFor(seed);
    const path = [
      ['m', offsetX, offsetY],
      [
        'c',
        40 * coordinateScale,
        -90 * coordinateScale,
        140 * coordinateScale,
        100 * coordinateScale,
        220 * coordinateScale,
        0,
      ],
    ];
    const operationalPath = normalizeOperationalInkPath(path);
    const object = makeCarrierRichInk({
      id: `erase-${seedLabel(seed)}`,
      path,
      strokeWidth,
      left: (random() - 0.5) * coordinateScale * 10,
      top: (random() - 0.5) * coordinateScale * 10,
      inkGeometrySpace: 'local',
      scaleX: 0.45 + random() * 2.8,
      scaleY: 0.3 + random() * 3.4,
      angle: -80 + random() * 160,
      flipX: random() > 0.5,
      flipY: random() > 0.5,
      skewX: -30 + random() * 60,
      skewY: -14 + random() * 28,
    });
    const sourceBytes = JSON.stringify(object);
    const sourceCarrierBytes = carrierSnapshot(object);
    const affine = createInkPathAffine(object, path);
    const worldWidthFloor = strokeWidth * affine.minScale;
    const radius = Math.max(1e-12, worldWidthFloor * radiusFactor);
    const worldTolerance = Math.max(
      1e-9,
      Math.min(0.05, radius * 0.05, worldWidthFloor * 0.05),
    );
    const localTolerance = worldTolerance / Math.max(affine.maxScale, 1e-12);
    const before = transformPolygons(
      commandsToPolygonSet(operationalPath, {
        fill: false,
        strokeWidth,
        curveTolerance: localTolerance,
        simplifyTolerance: 0,
      }),
      affine,
    );
    const localCurve = {
      x: offsetX + 95 * coordinateScale,
      y: offsetY + 3.75 * coordinateScale,
    };
    const localTangent = {
      x: 240 * coordinateScale,
      y: 142.5 * coordinateScale,
    };
    const tangentLength = Math.hypot(localTangent.x, localTangent.y);
    const localNormal = {
      x: -localTangent.y / tangentLength,
      y: localTangent.x / tangentLength,
    };
    const eraserCenter = affine.point(
      localCurve.x + localNormal.x * strokeWidth / 2,
      localCurve.y + localNormal.y * strokeWidth / 2,
    );
    const fixture = JSON.stringify({
      seed: seedLabel(seed),
      path,
      transform: {
        left: object.left,
        top: object.top,
        scaleX: object.scaleX,
        scaleY: object.scaleY,
        angle: object.angle,
        flipX: object.flipX,
        flipY: object.flipY,
        skewX: object.skewX,
        skewY: object.skewY,
      },
      radius,
      eraserCenter,
    });

    const result = erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [eraserCenter],
      eraserRadius: radius,
      mode: 'partial',
    });

    assert.equal(JSON.stringify(object), sourceBytes, `input mutated; fixture=${fixture}`);
    assert.equal(carrierSnapshot(object), sourceCarrierBytes, `source carrier mutated; fixture=${fixture}`);
    assert.equal(result.didChange, true, `localized rim bite missed; fixture=${fixture}`);
    assert.equal(result.deletedIds.length, 0, `localized rim bite whole-deleted; fixture=${fixture}`);
    assert.equal(result.pageAnnotations.objects.length, 1, `localized rim bite lost object; fixture=${fixture}`);

    const survivor = result.pageAnnotations.objects[0];
    const after = normalizeMultiPolygon(survivor.polygons);
    const beforeArea = polygonSetArea(before);
    const afterArea = polygonSetArea(after);
    assertHealthyPolygonSet(after, beforeArea, `fixture=${fixture}`);
    assert.ok(afterArea > beforeArea * 1e-6, `only degenerate streak survived; fixture=${fixture}`);
    assert.ok(
      afterArea < beforeArea - Math.max(Number.MIN_VALUE, beforeArea * 1e-12),
      `bite removed no measurable area; fixture=${fixture}`,
    );

    assertPolygonSetContained(after, before, beforeArea, `fixture=${fixture}`);
    assert.deepEqual(
      survivor.data?.pdfInkSourceGeometry,
      object.data.pdfInkSourceGeometry,
      `immutable imported source provenance changed; fixture=${fixture}`,
    );
  });
}
