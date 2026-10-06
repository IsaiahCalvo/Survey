import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Path } from 'fabric';
import { createInkPathAffine } from '../src/utils/inkGeometryTransform.js';
import { getAnnotationBBox } from '../src/utils/svgBoundingBox.js';

const SOURCE = readFileSync(
  new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
  'utf8',
);

function loadProductionTransformBuilder() {
  const startMarker = '/* test-export:start buildFabricPathSvgTransform */';
  const endMarker = '/* test-export:end buildFabricPathSvgTransform */';
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'production path-transform helper markers must exist');
  const body = SOURCE
    .slice(start + startMarker.length, end)
    .replace('export function buildFabricPathSvgTransform', 'function buildFabricPathSvgTransform');
  return Function(
    'createInkPathAffine',
    `${body}\nreturn buildFabricPathSvgTransform;`,
  )(createInkPathAffine);
}

function multiply(left, right) {
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
}

function parseMatrix(value) {
  const match = /^matrix\(([^)]+)\)$/.exec(value);
  assert.ok(match, `expected SVG matrix(), got ${value}`);
  const values = match[1].trim().split(/[,\s]+/).map(Number);
  assert.equal(values.length, 6);
  assert.ok(values.every(Number.isFinite));
  return values;
}

function assertMatrixClose(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) <= 1e-9,
      `${label} matrix[${index}] expected ${expected[index]}, got ${value}`,
    );
  });
}

function fabricFixture(properties = {}) {
  const path = new Path(
    [
      ['M', 10, 20],
      ['C', 20, 0, 30, 40, 50, 20],
    ],
    {
      left: 100,
      top: 50,
      originX: 'center',
      originY: 'center',
      stroke: '#f00',
      strokeWidth: 2,
      fill: null,
      ...properties,
    },
  );
  return {
    path,
    json: {
      ...path.toObject(),
      pathOffset: { x: path.pathOffset.x, y: path.pathOffset.y },
      inkGeometryOrigin: 'center-v1',
    },
  };
}

function fabricLeftTopFixture(properties = {}) {
  const path = new Path(
    [
      ['M', 10, 20],
      ['C', 20, 0, 30, 40, 50, 20],
    ],
    {
      left: 100,
      top: 50,
      originX: 'left',
      originY: 'top',
      stroke: '#f00',
      strokeWidth: 2,
      fill: null,
      ...properties,
    },
  );
  return {
    path,
    json: {
      ...path.toObject(),
      // Survey persists this custom property even though Fabric omits it
      // from the default Path.toObject envelope.
      width: path.width,
      height: path.height,
      pathOffset: { x: path.pathOffset.x, y: path.pathOffset.y },
    },
  };
}

function expectedFabricPathMatrix(path) {
  return multiply(
    path.calcOwnMatrix(),
    [1, 0, 0, 1, -path.pathOffset.x, -path.pathOffset.y],
  );
}

test('SVG path transform preserves the existing untransformed page-space placement', () => {
  const build = loadProductionTransformBuilder();
  const actual = parseMatrix(build({
    type: 'path',
    path: [['M', 40, 25], ['L', 80, 45]],
    left: 7,
    top: 11,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
  }));
  assertMatrixClose(actual, [1, 0, 0, 1, 7, 11], 'untransformed');
});

test('SVG path transform serializes microscopic affine coefficients without zeroing them', () => {
  const build = loadProductionTransformBuilder();
  const matrix = parseMatrix(build({
    type: 'path',
    path: [['M', 0, 0], ['L', 1e15, 0]],
    left: 0,
    top: 0,
    scaleX: 1e-15,
    scaleY: 2e-15,
    stroke: '#111',
    strokeWidth: 1,
    fill: null,
  }));

  assert.equal(matrix[0], 1e-15);
  assert.equal(matrix[3], 2e-15);
});

test('straight horizontal and vertical ink bboxes retain exact visible stroke dimensions', () => {
  const horizontal = {
    type: 'path',
    path: [['M', 0, 0], ['L', 100, 0]],
    stroke: '#111',
    strokeWidth: 4,
    fill: null,
  };
  const vertical = {
    ...horizontal,
    path: [['M', 0, 0], ['L', 0, 100]],
  };
  const microscopic = {
    ...horizontal,
    path: [['M', 0, 0], ['L', 1e-12, 0]],
    strokeWidth: 1e-13,
  };

  assert.equal(getAnnotationBBox(horizontal).height, 4);
  assert.equal(getAnnotationBBox(vertical).width, 4);
  assert.equal(getAnnotationBBox(microscopic).width, 1.1e-12);
  assert.equal(getAnnotationBBox(microscopic).height, 1e-13);
});

test('SVG path transform matches Fabric for center-origin rotate and nonuniform scale', () => {
  const build = loadProductionTransformBuilder();
  const { path, json } = fabricFixture({ angle: 31, scaleX: 2.25, scaleY: 0.4 });
  assertMatrixClose(
    parseMatrix(build(json)),
    expectedFabricPathMatrix(path),
    'rotate + scale',
  );
});

test('SVG path transform matches Fabric flips around the path center', () => {
  const build = loadProductionTransformBuilder();
  const { path, json } = fabricFixture({
    angle: -18,
    scaleX: 1.8,
    scaleY: 0.65,
    flipX: true,
    flipY: true,
  });
  assertMatrixClose(parseMatrix(build(json)), expectedFabricPathMatrix(path), 'flip');
});

test('center-v1 overrides stale left/top origin fields retained from native ink', () => {
  const build = loadProductionTransformBuilder();
  const { path, json } = fabricFixture({
    angle: 14,
    scaleX: 1.6,
    scaleY: 0.7,
    skewX: 9,
  });
  json.originX = 'left';
  json.originY = 'top';
  assertMatrixClose(
    parseMatrix(build(json)),
    expectedFabricPathMatrix(path),
    'center-v1 origin override',
  );
});

test('SVG path transform matches Fabric skew ordering with flip and rotation', () => {
  const build = loadProductionTransformBuilder();
  const { path, json } = fabricFixture({
    angle: 27,
    scaleX: 1.7,
    scaleY: 0.55,
    flipX: true,
    skewX: 19,
    skewY: -11,
  });
  assertMatrixClose(parseMatrix(build(json)), expectedFabricPathMatrix(path), 'skew');
});

test('SVG path transform matches a real left/top-origin Fabric path', () => {
  const build = loadProductionTransformBuilder();
  const { path, json } = fabricLeftTopFixture({
    angle: 31,
    scaleX: 2.25,
    scaleY: 0.4,
  });
  assertMatrixClose(
    parseMatrix(build(json)),
    expectedFabricPathMatrix(path),
    'left/top rotate + scale',
  );
});

test('SVG path transform matches left/top-origin Fabric flip and skew', () => {
  const build = loadProductionTransformBuilder();
  const { path, json } = fabricLeftTopFixture({
    angle: 27,
    scaleX: 1.7,
    scaleY: 0.55,
    flipX: true,
    flipY: true,
    skewX: 19,
    skewY: -11,
  });
  assertMatrixClose(
    parseMatrix(build(json)),
    expectedFabricPathMatrix(path),
    'left/top flip + skew',
  );
});

test('SVG path transform matches Fabric numeric origins', () => {
  const build = loadProductionTransformBuilder();
  const path = new Path(
    [
      ['M', 10, 20],
      ['C', 20, 0, 30, 40, 50, 20],
    ],
    {
      left: 100,
      top: 50,
      originX: 0,
      originY: 1,
      angle: 27,
      scaleX: 1.7,
      scaleY: 0.55,
      skewX: 19,
      skewY: -11,
      stroke: '#f00',
      strokeWidth: 2,
      fill: null,
    },
  );
  const json = {
    ...path.toObject(),
    width: path.width,
    height: path.height,
    pathOffset: { x: path.pathOffset.x, y: path.pathOffset.y },
  };

  assertMatrixClose(
    parseMatrix(build(json)),
    expectedFabricPathMatrix(path),
    'numeric origin',
  );
});

test('visible path, hover halo, and hit target all consume the same transform helper', () => {
  // 2026-10-06 (smooth zoom): a moved-only path writes its move into the path
  // data (resolveBakedFabricPath, utils/svgPathBake.js); all three surfaces
  // take the same baked result, or the same transform helper otherwise.
  assert.match(
    SOURCE,
    /cloneElement\(renderElement, baked\s*\?\s*\{ d: baked\.d, transform: undefined \}\s*:\s*\{ transform: cachedMarkGeometry\('pathTransform', renderObj, renderObj === obj, buildFabricPathSvgTransform\) \}\)/s,
  );
  assert.match(
    SOURCE,
    /const pathTransform = cachedMarkGeometry\('pathTransform', renderObj, renderObj === obj, buildFabricPathSvgTransform\);/,
  );
  assert.match(SOURCE, /const bakedPath = cachedMarkGeometry\('bakedPath', renderObj, renderObj === obj, resolveBakedFabricPath\);/);
  assert.match(SOURCE, /const targetD = bakedPath \? bakedPath\.d : pathD;/);
  assert.match(SOURCE, /const targetTransform = bakedPath \? undefined : pathTransform;/);
  // (perf 2026-09-30: the helper result is cached per committed object; live
  // previews — renderObj !== obj — are always computed fresh)
  assert.match(SOURCE, /if \(!committed \|\| !target \|\| typeof target !== 'object'\) return compute\(target\);/);
});

test('path resize preview applies its page affine exactly once and shares it with the overlay', () => {
  assert.match(
    SOURCE,
    /usesPathPageResize[\s\S]*?!usesPathPageResize[\s\S]*?!isImportedPath/,
    'page-affine path preview skips the legacy render-object rewrite',
  );
  assert.match(
    SOURCE,
    /Array\.isArray\(visualTransform\.resize\.pageMatrix\)[\s\S]*?applyPageAffineToInkObject/,
    'selection overlay derives from the same page affine as the visible path',
  );
  assert.match(
    SOURCE,
    /Array\.isArray\(visualTransform\.resize\.pageMatrix\)[\s\S]*?return `matrix\(\$\{visualTransform\.resize\.pageMatrix\.join\(' '\)\}\)`/,
    'visible wrapper consumes the exact page matrix',
  );
});
