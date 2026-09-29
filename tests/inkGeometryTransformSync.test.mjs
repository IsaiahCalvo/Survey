import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyPageAffineToInkObject,
  applyInkGeometryMatrix,
  commitInkObjectMove,
  commitInkObjectResize,
  createInkPathAffine,
  getExactInkResizeDimension,
  getInkCommandBounds,
  isAbsoluteInkGeometry,
} from '../src/utils/inkGeometryTransform.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';

const makeInk = (overrides = {}) => ({
  type: 'path',
  tool: 'pen',
  left: 0,
  top: 0,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  path: [
    ['M', 10, 20],
    ['Q', 20, 5, 30, 20],
  ],
  polygons: [[[
    [10, 18],
    [30, 18],
    [30, 22],
    [10, 22],
    [10, 18],
  ]]],
  paperCenterline: [
    { x: 10, y: 20, pressure: 0.4 },
    { x: 30, y: 20, pressure: 0.8 },
  ],
  paperCenterlineRuns: [[
    { x: 10, y: 20, pressure: 0.4 },
    { x: 30, y: 20, pressure: 0.8 },
  ]],
  paperSourceStroke: {
    path: [['M', 10, 20], ['Q', 20, 5, 30, 20]],
    matrix: [1, 0, 0, 1, 0, 0],
    stroke: '#111827',
    strokeWidth: 4,
  },
  paperEraserCuts: [[[
    [18, 16],
    [22, 16],
    [22, 24],
    [18, 24],
    [18, 16],
  ]]],
  data: {
    pdfInkPresentationGeometry: {
      version: 1,
      path: [['M', 10, 20], ['C', 12, 18, 28, 18, 30, 20]],
    },
    pdfInkSourceGeometry: {
      version: 1,
      inkLists: [[[10, 20], [30, 20]]],
    },
  },
  ...overrides,
});

test('absolute ink geometry translates every carrier together', () => {
  const ink = makeInk();
  const translated = applyInkGeometryMatrix(ink, [1, 0, 0, 1, 7, -3]);

  assert.deepEqual(translated.path, [
    ['M', 17, 17],
    ['Q', 27, 2, 37, 17],
  ]);
  assert.deepEqual(translated.polygons[0][0][0], [17, 15]);
  assert.deepEqual(translated.paperCenterline, [
    { x: 17, y: 17, pressure: 0.4 },
    { x: 37, y: 17, pressure: 0.8 },
  ]);
  assert.deepEqual(translated.paperCenterlineRuns[0][0], {
    x: 17,
    y: 17,
    pressure: 0.4,
  });
  assert.deepEqual(translated.paperSourceStroke.matrix, [1, 0, 0, 1, 7, -3]);
  assert.deepEqual(translated.paperSourceStroke.path, ink.paperSourceStroke.path);
  assert.deepEqual(translated.paperEraserCuts[0][0][0], [25, 13]);
  assert.deepEqual(translated.data.pdfInkPresentationGeometry.path, [
    ['M', 17, 17],
    ['C', 19, 15, 35, 15, 37, 17],
  ]);
  assert.deepEqual(
    translated.data.pdfInkSourceGeometry,
    ink.data.pdfInkSourceGeometry,
    'immutable imported source geometry is not transformed',
  );
  assert.deepEqual(ink, makeInk(), 'source annotation is not mutated');
});

test('absolute ink geometry resizes every carrier with one affine matrix', () => {
  const resized = applyInkGeometryMatrix(
    makeInk(),
    // Scale x2 / y3 around (10, 20).
    [2, 0, 0, 3, -10, -40],
  );

  assert.deepEqual(resized.path, [
    ['M', 10, 20],
    ['Q', 30, -25, 50, 20],
  ]);
  assert.deepEqual(resized.polygons[0][0][1], [50, 14]);
  assert.deepEqual(resized.paperCenterline[1], {
    x: 50,
    y: 20,
    pressure: 0.8,
  });
  assert.deepEqual(resized.paperSourceStroke.matrix, [2, 0, 0, 3, -10, -40]);
  assert.deepEqual(resized.paperEraserCuts[0][0][0], [26, 8]);
});

test('absolute ink geometry rotates every carrier without flattening curves', () => {
  const rotated = applyInkGeometryMatrix(
    makeInk(),
    // Rotate 90 degrees clockwise in page coordinates around (20, 20).
    [0, 1, -1, 0, 40, 0],
  );

  assert.deepEqual(rotated.path, [
    ['M', 20, 10],
    ['Q', 35, 20, 20, 30],
  ]);
  assert.equal(rotated.path[1][0], 'Q', 'curve command is preserved');
  assert.deepEqual(rotated.polygons[0][0][0], [22, 10]);
  assert.deepEqual(rotated.paperCenterline[1], {
    x: 20,
    y: 30,
    pressure: 0.8,
  });
});

test('microscopic anisotropic ink remains invertible and nonconformal', () => {
  const ink = makeInk({
    inkGeometrySpace: 'local',
    inkGeometryOrigin: 'center-v1',
    left: 0,
    top: 0,
    width: 20,
    height: 15,
    pathOffset: { x: 20, y: 12.5 },
    scaleX: 1e-12,
    scaleY: 2e-12,
  });
  const affine = createInkPathAffine(ink, ink.path);
  const source = { x: 17.25, y: 11.5 };
  const page = affine.point(source);
  const restored = affine.inverse(page);

  assert.equal(affine.conformal, false);
  assert.ok(Number.isFinite(restored.x) && Number.isFinite(restored.y));
  assert.ok(Math.abs(restored.x - source.x) <= 1e-12);
  assert.ok(Math.abs(restored.y - source.y) <= 1e-12);
});

test('page affine composes onto already-microscopic ink instead of returning it unchanged', () => {
  const ink = makeInk({
    inkGeometrySpace: 'local',
    inkGeometryOrigin: 'center-v1',
    left: 0,
    top: 0,
    width: 20,
    height: 15,
    pathOffset: { x: 20, y: 12.5 },
    scaleX: 1e-12,
    scaleY: 2e-12,
  });
  const transformed = applyPageAffineToInkObject(
    ink,
    [2, 0, 0, 3, 5e-12, -7e-12],
  );
  const before = createInkPathAffine(ink, ink.path);
  const after = createInkPathAffine(transformed, transformed.path);
  const expected = [
    before.matrix[0] * 2,
    before.matrix[1] * 3,
    before.matrix[2] * 2,
    before.matrix[3] * 3,
    before.matrix[4] * 2 + 5e-12,
    before.matrix[5] * 3 - 7e-12,
  ];

  assert.notEqual(transformed, ink);
  after.matrix.forEach((value, index) => {
    const scale = Math.max(Math.abs(value), Math.abs(expected[index]), Number.MIN_VALUE);
    assert.ok(
      Math.abs(value - expected[index]) <= Number.EPSILON * 128 * scale,
      `matrix[${index}] expected ${expected[index]}, got ${value}`,
    );
  });
});

test('pointer resize capture preserves sub-nanounit path dimensions exactly', () => {
  assert.equal(getExactInkResizeDimension(1e-12), 1e-12);
  assert.equal(getExactInkResizeDimension(1e12), 1e12);
  assert.equal(getExactInkResizeDimension(0), 0);
  assert.equal(getExactInkResizeDimension(Number.NaN), 0);
  assert.ok(
    Math.abs(1e-9 / getExactInkResizeDimension(1e-12) - 1_000)
      <= Number.EPSILON * 1_000,
  );
});

test('origin/imported classification distinguishes page-space and local carriers', () => {
  assert.equal(isAbsoluteInkGeometry({
    type: 'rect',
    inkGeometrySpace: 'page',
    path: makeInk().path,
  }), false);
  assert.equal(isAbsoluteInkGeometry(makeInk()), true);
  assert.equal(isAbsoluteInkGeometry(makeInk({ left: null, top: null })), true);
  assert.equal(isAbsoluteInkGeometry(makeInk({
    left: 0,
    top: 0,
    width: 20,
    height: 20,
    isPdfImported: true,
  })), false, 'normalized PDF ink at the page origin remains local');
  assert.equal(isAbsoluteInkGeometry(makeInk({
    inkGeometrySpace: 'local',
  })), false);
  assert.equal(isAbsoluteInkGeometry(makeInk({
    data: { inkGeometrySpace: 'local' },
  })), false, 'serialized data keeps the coordinate-space contract');
  assert.equal(isAbsoluteInkGeometry(makeInk({
    left: 100,
    top: 200,
    inkGeometrySpace: 'page',
  })), true);
  assert.equal(isAbsoluteInkGeometry(makeInk({
    left: 100,
    top: 200,
    width: 20,
    height: 20,
  })), false);
  assert.equal(isAbsoluteInkGeometry(makeInk({
    left: 20,
    top: 20,
    pathOffset: { x: 20, y: 20 },
  })), false);
});

test('real SVG commit seams use object transforms for move and resize', () => {
  const source = readFileSync(
    new URL('../src/hooks/useSVGInteraction.js', import.meta.url),
    'utf8',
  );

  assert.equal(
    source.match(/commitInkObjectMove\s*\(/g)?.length,
    2,
    'single move and group move use object-position fields',
  );
  assert.equal(
    source.match(/commitInkObjectResize\s*\(/g)?.length,
    1,
    'legacy fallback keeps object scale fields',
  );
  assert.equal(
    source.match(/applyPageAffineToInkObject\s*\(/g)?.length,
    2,
    'single and group path resize compose onto the existing visible affine',
  );
  assert.match(source, /action:\s*'move'[\s\S]*?commitInkObjectMove|commitInkObjectMove[\s\S]*?action:\s*'move'/);
  assert.match(source, /action:\s*'group-move'[\s\S]*?commitInkObjectMove|commitInkObjectMove[\s\S]*?action:\s*'group-move'/);
  assert.match(source, /action:\s*'scale'[\s\S]*?commitInkObjectResize|commitInkObjectResize[\s\S]*?action:\s*'scale'/);
  assert.match(source, /groupPageMatrix[\s\S]*?applyPageAffineToInkObject/);
  assert.match(
    source,
    /groupContainsPath[\s\S]*?!groupContainsPath[\s\S]*?Math\.abs\(sx\)\s*<\s*0\.05[\s\S]*?sx\s*===\s*0[\s\S]*?Number\.MIN_VALUE/,
    'a path-containing group keeps signed sub-0.05 scale and guards only singular zero',
  );
  assert.match(source, /pathResizePageMatrix[\s\S]*?applyPageAffineToInkObject/);
  // RULED 2026-09-28 (w63, owner-directed): a single path resize still keeps
  // its SIGN (it flips through) and never snaps to 10 %, but it now stops at
  // 4 page units per axis — or the path's own starting size, if it was already
  // thinner, so microscopic geometry is never blown up. The zero-matrix guard
  // moved into clampResizeScale (tests/resizeMinimum.test.mjs). The old
  // "only guards the singular zero" regex was replaced for that reason, not to
  // make a failing test pass.
  assert.match(
    source,
    /isExactPathResize\s*=\s*typeForFlip\s*===\s*'path'[\s\S]*?supportsFlip[\s\S]*?\|\|\s*isExactPathResize[\s\S]*?clampResizeScale\(newScaleX,[\s\S]*?allowFlip:\s*supportsFlip/,
    'single path resize keeps signed scales (flip) with the shared 4-unit floor',
  );
  assert.match(
    source,
    /rotObj\.angle\s*=\s*ds\.currentAngle/,
    'rotation remains a shared object transform instead of rebaking curves',
  );
});

const pointToPage = (object, x, y) => ({
  x: (object.left ?? 0) + (object.scaleX ?? 1) * (x - (object.pathOffset?.x ?? 0)),
  y: (object.top ?? 0) + (object.scaleY ?? 1) * (y - (object.pathOffset?.y ?? 0)),
});

test('absolute open Q/C ink resizes through object fields with exact uniform stroke scaling', () => {
  const source = makeInk({
    stroke: '#111',
    fill: null,
    strokeWidth: 10,
    sourceWidth: 10,
    polygons: undefined,
    paperCenterline: undefined,
    paperCenterlineRuns: undefined,
    path: [
      ['M', 10, 20],
      ['Q', 20, 5, 30, 20],
      ['C', 35, 30, 45, 30, 50, 20],
    ],
  });
  const originalPath = structuredClone(source.path);
  const resized = commitInkObjectResize(source, {
    scaleX: 2,
    scaleY: 2,
    visibleLeft: 100,
    visibleTop: 200,
  });

  assert.deepEqual(resized.path, originalPath, 'Q/C geometry is not rebaked');
  assert.equal(resized.path, source.path, 'uppercase curve carrier remains byte-stable');
  assert.equal(resized.scaleX, 2);
  assert.equal(resized.scaleY, 2);
  assert.equal(resized.strokeWidth, 10, 'authored width remains local');
  assert.equal(resized.strokeWidth * resized.scaleY, 20, 'visible width scales exactly');
  assert.deepEqual(pointToPage(resized, 10, 5), { x: 100, y: 200 });
  assert.deepEqual(pointToPage(resized, 50, 30), { x: 180, y: 250 });
  const metadataOnly = {
    ...resized,
    inkGeometrySpace: undefined,
    inkGeometryOrigin: undefined,
  };
  const resizedAgain = commitInkObjectResize(metadataOnly, {
    scaleX: 3,
    scaleY: 4,
    visibleLeft: 1,
    visibleTop: 2,
  });
  assert.deepEqual(resizedAgain.path, originalPath);
  assert.deepEqual(pointToPage(resizedAgain, 10, 5), { x: 1, y: 2 });
});

test('absolute open Q/C ink keeps exact extreme nonuniform stroke scaling', () => {
  const source = makeInk({
    stroke: '#111',
    fill: null,
    strokeWidth: 10,
    sourceWidth: 10,
    polygons: undefined,
    paperCenterline: undefined,
    paperCenterlineRuns: undefined,
    path: [
      ['M', 10, 20],
      ['Q', 20, 5, 30, 20],
      ['C', 35, 30, 45, 30, 50, 20],
    ],
  });
  const resized = commitInkObjectResize(source, {
    scaleX: 20,
    scaleY: 0.05,
    visibleLeft: 3,
    visibleTop: 7,
  });

  assert.deepEqual(resized.path, source.path);
  assert.equal(resized.strokeWidth, 10);
  assert.equal(resized.strokeWidth * resized.scaleX, 200);
  assert.equal(resized.strokeWidth * resized.scaleY, 0.5);
  assert.deepEqual(pointToPage(resized, 10, 5), { x: 3, y: 7 });
  assert.deepEqual(pointToPage(resized, 50, 30), { x: 803, y: 8.25 });
});

test('resize then tiny partial erase does not whole-delete a narrow stroke', () => {
  const source = makeInk({
    id: 'tiny-resized-curve',
    annotationId: 'tiny-resized-curve',
    stroke: '#111',
    fill: null,
    strokeWidth: 20,
    sourceWidth: 20,
    polygons: undefined,
    paperCenterline: undefined,
    paperCenterlineRuns: undefined,
    data: { id: 'tiny-resized-curve', tool: 'pen' },
    path: [
      ['M', 0, 50],
      ['C', 50, 40, 150, 60, 200, 50],
    ],
  });
  const resized = commitInkObjectResize(source, {
    scaleX: 0.05,
    scaleY: 0.05,
    visibleLeft: 20,
    visibleTop: 30,
  });
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [resized] },
    eraserPoints: [{ x: 25, y: 30.4 }],
    eraserRadius: 0.15,
    mode: 'partial',
  });

  assert.equal(result.didChange, true);
  assert.equal(result.deletedIds.length, 0);
  assert.equal(result.pageAnnotations.objects.length, 1);
  assert.equal(result.pageAnnotations.objects[0].sourceWidth, 1);
});

test('extreme nonuniform resize keeps both real halves after a crossing erase', () => {
  const source = makeInk({
    id: 'flat-resized-curve',
    annotationId: 'flat-resized-curve',
    stroke: '#111',
    fill: null,
    strokeWidth: 20,
    sourceWidth: 20,
    polygons: undefined,
    paperCenterline: undefined,
    paperCenterlineRuns: undefined,
    data: { id: 'flat-resized-curve', tool: 'pen' },
    path: [
      ['M', 0, 50],
      ['L', 200, 50],
    ],
  });
  const resized = commitInkObjectResize(source, {
    scaleX: 20,
    scaleY: 0.05,
    visibleLeft: 0,
    visibleTop: 0,
  });
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [resized] },
    eraserPoints: [{ x: 2000, y: -5 }, { x: 2000, y: 5 }],
    eraserRadius: 0.2,
    mode: 'partial',
  });

  assert.equal(result.didChange, true);
  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.pageAnnotations.objects.length, 1);
  assert.equal(
    result.pageAnnotations.objects[0].polygons.length,
    2,
    'both long, visually real halves survive debris cleanup',
  );
  assert.equal(
    result.pageAnnotations.objects[0].sourceWidth,
    1,
    'cleanup uses the narrow visible axis, not geometric-mean scale',
  );
});

test('lowercase relative Q/C paths move and resize without corrupting geometry', () => {
  const relative = makeInk({
    path: [
      ['m', 10, 20],
      ['q', 10, -15, 20, 0],
      ['c', 5, 10, 15, 10, 20, 0],
    ],
    polygons: undefined,
    paperCenterline: undefined,
    paperCenterlineRuns: undefined,
  });
  const moved = commitInkObjectMove(relative, 7, -3);
  const movedBounds = getInkCommandBounds(moved.path);
  const resized = commitInkObjectResize(moved, {
    scaleX: 2,
    scaleY: 0.5,
    visibleLeft: movedBounds.minX + 7,
    visibleTop: movedBounds.minY - 3,
  });

  assert.equal(moved.path, relative.path, 'move keeps the source carrier byte-stable');
  assert.deepEqual(movedBounds, {
    minX: 10,
    minY: 5,
    maxX: 50,
    maxY: 30,
    width: 40,
    height: 25,
  });
  assert.deepEqual(resized.path, moved.path, 'resize changes transform fields only');
  assert.deepEqual(pointToPage(moved, 10, 5), { x: 17, y: 2 });
  assert.deepEqual(pointToPage(resized, 10, 5), {
    x: movedBounds.minX + 7,
    y: movedBounds.minY - 3,
  });
});

test('moved production ink erases at its visible location, never its stale origin', () => {
  const ink = createProductionPaperInk({
    id: 'moved-production-ink',
    points: [{ x: 10, y: 50 }, { x: 110, y: 50 }],
    color: '#111111',
    width: 20,
  });
  const moved = commitInkObjectMove(ink, 100, 0);
  assert.equal(moved.path, ink.path);
  assert.equal(moved.polygons, ink.polygons);
  assert.equal(moved.paperCenterline, ink.paperCenterline);

  const visible = erasePageAnnotations({
    pageAnnotations: { objects: [moved] },
    eraserPoints: [{ x: 160, y: 50 }],
    eraserRadius: 4,
    mode: 'partial',
  });
  const stale = erasePageAnnotations({
    pageAnnotations: { objects: [moved] },
    eraserPoints: [{ x: 60, y: 50 }],
    eraserRadius: 4,
    mode: 'partial',
  });

  assert.equal(visible.didChange, true);
  assert.equal(stale.didChange, false);
});
