import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  applyInkGeometryMatrix,
  applyPageAffineToInkObject,
  commitInkObjectMove,
  commitInkObjectResize,
  createInkPathAffine,
  getInkCommandBounds,
  scaleInRotatedFrameAroundMatrix,
} from '../src/utils/inkGeometryTransform.js';
import {
  erasePageAnnotations,
  normalizeFabricPath,
  rebaseErasedPathSurvivor,
} from '../src/utils/pageSpaceEraser.js';
import { getEraserOperation } from '../src/utils/eraserPolicy.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { createInkAnnotation } from '../src/utils/pdfAnnotationsPdfLib.js';

const test = (name, fn) => nodeTest(name, async (...args) => {
  process.stderr.write(`[DEBUG-legacy-ink-ci] START ${name}\n`);
  try {
    return await fn(...args);
  } finally {
    process.stderr.write(`[DEBUG-legacy-ink-ci] END ${name}\n`);
  }
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const endpoint = (command) => command.slice(-2);

const assertClose = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) <= 1e-9,
      `${label}[${index}] expected ${expected[index]}, got ${value}`,
    );
  });
};

const multiply = (left, right) => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];

test('every legacy SVG path command normalizes operationally without mutating its carrier', () => {
  const source = [
    ['m', 10, 20],
    ['h', 20],
    ['v', 10],
    ['q', 10, 10, 20, 0],
    ['t', 20, 0],
    ['c', 5, -10, 15, -10, 20, 0],
    ['s', 15, 10, 20, 0],
    ['a', 15, 10, 25, 0, 1, 30, 0],
    ['z'],
  ];
  const before = JSON.stringify(source);
  const normalized = normalizeFabricPath(source);

  assert.equal(JSON.stringify(source), before, 'source path bytes stay unchanged');
  assert.deepEqual(
    normalized.map((command) => command[0]),
    ['M', 'L', 'L', 'Q', 'Q', 'C', 'C', 'C', 'C', 'Z'],
  );
  assert.deepEqual(endpoint(normalized[1]), [30, 20]);
  assert.deepEqual(endpoint(normalized[2]), [30, 30]);
  assert.deepEqual(endpoint(normalized[3]), [50, 30]);
  assert.deepEqual(endpoint(normalized[4]), [70, 30]);
  assert.deepEqual(endpoint(normalized[5]), [90, 30]);
  assert.deepEqual(endpoint(normalized[6]), [110, 30]);
  assert.deepEqual(endpoint(normalized.at(-2)), [140, 30]);
});

test('legacy absolute arc resizes through object fields and keeps the source path byte-stable', () => {
  const source = {
    id: 'legacy-arc-resize',
    type: 'path',
    tool: 'pen',
    path: [
      ['M', 20, 40],
      ['A', 30, 20, 25, 0, 1, 100, 40],
    ],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    stroke: '#111111',
    strokeWidth: 6,
    fill: null,
  };
  const originalPath = source.path;
  const before = JSON.stringify(source.path);
  const resized = commitInkObjectResize(source, {
    scaleX: 3,
    scaleY: 0.5,
    visibleLeft: 7,
    visibleTop: 11,
  });

  assert.equal(resized.path, originalPath, 'resize retains the exact carrier');
  assert.equal(JSON.stringify(source.path), before);
  assert.equal(resized.scaleX, 3);
  assert.equal(resized.scaleY, 0.5);
  assert.equal(resized.inkGeometrySpace, 'local');
  const bounds = getInkCommandBounds(resized.path);
  assert.equal(bounds.maxX, 100);
  assert.equal(bounds.maxY, 40);
  assert.ok(bounds.minX < 20, 'rotated arc control geometry participates in bounds');
  assert.ok(bounds.minY < 20, 'arc is not reduced to its endpoint chord');
});

test('baked affine transform expands arcs safely and never corrupts or mutates the source A command', () => {
  const source = {
    type: 'path',
    path: [
      ['m', 10, 20],
      ['a', 30, 15, 20, 0, 1, 60, 0],
    ],
    data: {
      pdfInkSourceGeometry: {
        kind: 'legacy-path',
        appearancePath: [
          ['m', 10, 20],
          ['a', 30, 15, 20, 0, 1, 60, 0],
        ],
      },
    },
  };
  const before = clone(source);
  const transformed = applyInkGeometryMatrix(source, [2, 0, 0, 3, 5, -7]);

  assert.deepEqual(source, before, 'input and immutable provenance remain untouched');
  assert.deepEqual(
    transformed.path.map((command) => command[0]),
    ['M', 'C', 'C'],
  );
  assert.deepEqual(endpoint(transformed.path.at(-1)), [145, 53]);
  assert.deepEqual(
    transformed.data.pdfInkSourceGeometry,
    source.data.pdfInkSourceGeometry,
  );
});

test('first move localizes a rotated flipped skewed absolute path without moving one pixel', () => {
  const source = {
    type: 'path',
    path: [['M', 10, 20], ['C', 20, 0, 40, 40, 60, 20]],
    left: 7,
    top: 11,
    scaleX: 1.8,
    scaleY: 0.6,
    angle: 27,
    flipX: true,
    skewX: 19,
    skewY: -11,
    stroke: '#111111',
    strokeWidth: 4,
    fill: null,
    inkGeometrySpace: 'page',
  };
  const before = createInkPathAffine(source, source.path).matrix;
  const localized = commitInkObjectMove(source, 0, 0);
  const after = createInkPathAffine(localized, localized.path).matrix;

  assert.equal(localized.path, source.path);
  assert.equal(localized.inkGeometryOrigin, 'center-v1');
  assert.equal(localized.originX, 'center');
  assert.equal(localized.originY, 'center');
  assertClose(after, before, 'localization matrix');
});

test('page affine QR decomposition preserves every carrier and the exact visible matrix', () => {
  const source = {
    type: 'path',
    path: [['M', 10, 20], ['Q', 30, 0, 60, 30]],
    polygons: [[[[10, 18], [60, 28], [60, 32], [10, 22], [10, 18]]]],
    paperCenterline: [{ x: 10, y: 20 }, { x: 60, y: 30 }],
    left: 90,
    top: 70,
    pathOffset: { x: 35, y: 15 },
    originX: 'center',
    originY: 'center',
    inkGeometryOrigin: 'center-v1',
    scaleX: 1.3,
    scaleY: 0.8,
    angle: -17,
    flipX: true,
    skewX: 9,
    skewY: -4,
    stroke: '#111111',
    strokeWidth: 4,
    fill: null,
    data: {
      pdfInkPresentationGeometry: {
        path: [['M', 10, 20], ['Q', 30, 0, 60, 30]],
      },
    },
  };
  const radians = 31 * Math.PI / 180;
  const pageMatrix = [
    2 * Math.cos(radians),
    2 * Math.sin(radians),
    -0.5 * Math.sin(radians),
    0.5 * Math.cos(radians),
    13,
    -9,
  ];
  const expected = multiply(
    pageMatrix,
    createInkPathAffine(source, source.path).matrix,
  );
  const transformed = applyPageAffineToInkObject(source, pageMatrix);
  const actual = createInkPathAffine(transformed, transformed.path).matrix;

  assertClose(actual, expected, 'QR-composed page affine');
  assert.equal(transformed.path, source.path);
  assert.equal(transformed.polygons, source.polygons);
  assert.equal(transformed.paperCenterline, source.paperCenterline);
  assert.equal(
    transformed.data.pdfInkPresentationGeometry,
    source.data.pdfInkPresentationGeometry,
  );
  assert.ok(transformed.scaleX > 0);
  assert.equal(transformed.skewY, 0);
  assert.equal(transformed.inkGeometryOrigin, 'center-v1');
});

test('rotated-frame scale matrix keeps its anchor and scales rotated axes independently', () => {
  const angle = 30;
  const radians = angle * Math.PI / 180;
  const anchor = { x: 40, y: 70 };
  const matrix = scaleInRotatedFrameAroundMatrix(2, 0.5, angle, anchor.x, anchor.y);
  const apply = (point) => ({
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  });
  const xAxisPoint = {
    x: anchor.x + 10 * Math.cos(radians),
    y: anchor.y + 10 * Math.sin(radians),
  };
  const yAxisPoint = {
    x: anchor.x - 10 * Math.sin(radians),
    y: anchor.y + 10 * Math.cos(radians),
  };

  assertClose(
    [apply(anchor).x, apply(anchor).y],
    [anchor.x, anchor.y],
    'rotated scale anchor',
  );
  assertClose(
    [apply(xAxisPoint).x, apply(xAxisPoint).y],
    [
      anchor.x + 20 * Math.cos(radians),
      anchor.y + 20 * Math.sin(radians),
    ],
    'rotated x axis',
  );
  assertClose(
    [apply(yAxisPoint).x, apply(yAxisPoint).y],
    [
      anchor.x - 5 * Math.sin(radians),
      anchor.y + 5 * Math.cos(radians),
    ],
    'rotated y axis',
  );
});

test('first bite uses a pristine filled cubic, then clears stale transform carriers', () => {
  const sourcePath = [
    ['M', 0, 0],
    ['C', 25, -50, 75, -50, 100, 0],
    ['L', 100, 40],
    ['L', 0, 40],
    ['Z'],
  ];
  const immutableSource = {
    kind: 'appearance-path',
    appearancePath: clone(sourcePath),
  };
  const result = erasePageAnnotations({
    pageAnnotations: {
      objects: [{
        id: 'pristine-filled-cubic',
        type: 'path',
        tool: 'pen',
        path: sourcePath,
        cmds: [['M', 999, 999], ['L', 1000, 1000]],
        polygons: [[[
          [0, 0], [100, 0], [100, 40], [0, 40], [0, 0],
        ]]],
        paperInkGeometry: 'v1',
        left: 50,
        top: -5,
        width: 100,
        height: 90,
        pathOffset: { x: 50, y: -5 },
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        inkGeometrySpace: 'local',
        inkGeometryOrigin: 'center-v1',
        fill: '#ff0000',
        fillRule: 'nonzero',
        stroke: 'transparent',
        strokeWidth: 0,
        data: {
          inkGeometrySpace: 'local',
          inkGeometryOrigin: 'center-v1',
          pdfInkSourceGeometry: immutableSource,
        },
      }],
    },
    eraserPoints: [{ x: 98, y: 30 }],
    eraserRadius: 6,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];
  const allPoints = survivor.polygons.flat(2);

  assert.equal(result.didChange, true);
  assert.ok(
    Math.min(...allPoints.map((point) => point[1])) < -30,
    'untouched authored cubic survives instead of the coarse imported polygon',
  );
  assert.equal(survivor.cmds, undefined);
  assert.equal(survivor.inkGeometryOrigin, undefined);
  assert.equal(survivor.data.inkGeometryOrigin, undefined);
  assert.equal(survivor.inkGeometrySpace, 'page');
  assert.equal(survivor.data.inkGeometrySpace, 'page');
  assert.deepEqual(survivor.data.pdfInkSourceGeometry, immutableSource);
});

test('flip and skew use one visible geometry for erase and native PDF export', async () => {
  const path = [['M', 0, 0], ['L', 100, 0]];
  const object = {
    id: 'flip-skew-path',
    type: 'path',
    tool: 'pen',
    path,
    left: 180,
    top: 120,
    width: 100,
    height: 0,
    pathOffset: { x: 50, y: 0 },
    originX: 'center',
    originY: 'center',
    inkGeometryOrigin: 'center-v1',
    scaleX: 1.7,
    scaleY: 0.55,
    angle: 27,
    flipX: true,
    skewX: 19,
    skewY: -11,
    stroke: '#123456',
    strokeWidth: 8,
    fill: null,
  };
  const affine = createInkPathAffine(object, path);
  const visiblePoint = affine.point(25, 0);
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [object] },
    eraserPoints: [visiblePoint],
    eraserRadius: 3,
    mode: 'partial',
  });
  process.stderr.write('[DEBUG-legacy-ink-ci] flip/skew erase returned\n');
  assert.equal(erased.didChange, true, 'eraser hits the shared visible affine');

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([400, 400]);
  const ref = createInkAnnotation(pdfDoc, page, object, 400);
  process.stderr.write('[DEBUG-legacy-ink-ci] flip/skew PDF export returned\n');
  const dict = pdfDoc.context.lookup(ref);
  const inkList = dict.get(PDFName.of('InkList')).asArray()[0].asArray()
    .map((value) => value.value());
  const start = affine.point(0, 0);
  const end = affine.point(100, 0);
  assertClose(
    inkList,
    [start.x, 400 - start.y, end.x, 400 - end.y],
    'exported flip/skew InkList',
  );
});

test('concurrent flip and skew rebase an existing bite instead of dropping it', () => {
  const base = {
    id: 'concurrent-transform-ink',
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 50], ['L', 100, 50]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    stroke: '#111111',
    strokeWidth: 12,
    fill: null,
  };
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [base] },
    eraserPoints: [{ x: 35, y: 44 }],
    eraserRadius: 4,
    mode: 'partial',
  });
  const survivor = erased.pageAnnotations.objects[0];
  const current = {
    ...base,
    left: 140,
    top: 80,
    flipX: true,
    skewX: 17,
    skewY: -9,
  };
  const rebased = rebaseErasedPathSurvivor(current, base, survivor);

  assert.ok(rebased, 'supported affine edits must not discard the stale bite');
  const oldAffine = createInkPathAffine(base, base.path);
  const newAffine = createInkPathAffine(current, current.path);
  const sourcePoint = survivor.polygons[0][0][0];
  const local = oldAffine.inverse({ x: sourcePoint[0], y: sourcePoint[1] });
  const expected = newAffine.point(local);
  assertClose(
    rebased.polygons[0][0][0],
    [expected.x, expected.y],
    'rebased flip/skew point',
  );
});

test('concurrent stroke geometry style change rejects a stale partial-erase survivor', () => {
  const base = {
    id: 'concurrent-style-ink',
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 50], ['L', 100, 50]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    stroke: '#111111',
    strokeWidth: 12,
    strokeLineCap: 'butt',
    strokeLineJoin: 'miter',
    strokeDashArray: [8, 4],
    fill: null,
  };
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [base] },
    eraserPoints: [{ x: 35, y: 50 }],
    eraserRadius: 4,
    mode: 'partial',
  });
  const survivor = erased.pageAnnotations.objects[0];

  assert.equal(
    rebaseErasedPathSurvivor(
      {
        ...base,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        strokeDashArray: [3, 3],
      },
      base,
      survivor,
    ),
    null,
    'a stale bite must not overwrite a collaborator stroke-style edit',
  );
});

test('butt-cap and dashed pen stay partial-erasable without gaining round pixels', () => {
  const butt = {
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 0], ['L', 100, 0]],
    stroke: '#111111',
    strokeWidth: 10,
    strokeLineCap: 'butt',
    strokeLineJoin: 'miter',
    left: 0,
    top: 0,
    scaleX: 2,
    scaleY: 1,
    fill: null,
  };
  assert.equal(getEraserOperation(butt, 'partial'), 'partial');
  assert.equal(getEraserOperation({
    ...butt,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeDashArray: [4, 2],
  }, 'partial'), 'partial');

  const result = erasePageAnnotations({
    pageAnnotations: { objects: [butt] },
    eraserPoints: [{ x: 100, y: 0 }],
    eraserRadius: 2,
    mode: 'partial',
  });
  const points = result.pageAnnotations.objects[0].polygons.flat(2);
  assert.equal(result.didChange, true);
  assert.deepEqual(result.deletedIds, []);
  assert.ok(Math.min(...points.map((point) => point[0])) >= -1e-9);
  assert.ok(Math.max(...points.map((point) => point[0])) <= 200 + 1e-9);
});

test('tiny cubic takes a localized radius-.001 bite without a miss or whole delete', () => {
  const path = [['M', 0, 0], ['C', 0, 100, 100, -100, 100, 0]];
  const source = {
    id: 'thin-cubic',
    type: 'path',
    tool: 'pen',
    path,
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    stroke: '#111111',
    strokeWidth: 0.001,
    fill: null,
  };
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [source] },
    eraserPoints: [{
      x: 0.018215179443359375,
      y: 2.289104461669922,
    }],
    eraserRadius: 0.001,
    mode: 'partial',
  });

  assert.equal(result.didChange, true);
  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.pageAnnotations.objects.length, 1);
  assert.deepEqual(source.path, path);
});

test('stroked PDF appearance preserves butt/dash, closing edges, and tiny coordinates', async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([300, 300]);
  const ref = createInkAnnotation(pdfDoc, page, {
    type: 'path',
    tool: 'pen',
    path: [
      ['M', 0.000004, 0.000006],
      ['L', 100, 0],
      ['L', 100, 20],
      ['Z'],
    ],
    left: 0,
    top: 0,
    scaleX: 2,
    scaleY: 1,
    stroke: '#123456',
    strokeWidth: 10,
    strokeLineCap: 'butt',
    strokeLineJoin: 'miter',
    strokeMiterLimit: 7,
    strokeDashArray: [4, 2],
    strokeDashOffset: 0.5,
    fill: null,
  }, 300);
  const dict = pdfDoc.context.lookup(ref);
  const appearance = pdfDoc.context.lookup(dict.get(PDFName.of('AP')));
  const normal = pdfDoc.context.lookup(appearance.get(PDFName.of('N')));
  const content = new TextDecoder().decode(decodePDFRawStream(normal).decode());
  const list = dict.get(PDFName.of('InkList')).asArray()[0].asArray()
    .map((value) => value.value());

  assert.match(content, /\b0 J\b/);
  assert.match(content, /\b0 j\b/);
  assert.match(content, /\b7 M\b/);
  assert.match(content, /\[4 2\] 0\.5 d/);
  assert.match(content, /0\.000004 0\.000006 m/);
  assert.match(content, /\nh\nS\nQ\n$/, 'Z emits the native close-path operator');
  assertClose(
    list.slice(-2),
    list.slice(0, 2),
    'closed InkList endpoint',
  );
});

test('native PDF export and reimport retain legacy arc and shorthand visual geometry', async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([300, 300]);
  const sourcePath = [
    ['m', 20, 80],
    ['h', 30],
    ['q', 15, -20, 30, 0],
    ['t', 30, 0],
    ['s', 20, 20, 30, 0],
    ['a', 20, 12, 0, 0, 1, 40, 0],
  ];
  const sourceBefore = JSON.stringify(sourcePath);
  const annotationRef = createInkAnnotation(pdfDoc, page, {
    type: 'path',
    tool: 'pen',
    path: sourcePath,
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    stroke: '#123456',
    strokeWidth: 4,
    fill: null,
  }, 300);
  page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([annotationRef]));

  assert.equal(JSON.stringify(sourcePath), sourceBefore, 'export does not rewrite live source');
  const dict = pdfDoc.context.lookup(annotationRef);
  const ap = pdfDoc.context.lookup(dict.get(PDFName.of('AP')));
  const normal = pdfDoc.context.lookup(ap.get(PDFName.of('N')));
  const content = new TextDecoder().decode(decodePDFRawStream(normal).decode());
  assert.equal(
    content.match(/\bc\b/g)?.length,
    5,
    'Q/T/S/A geometry is emitted as exact cubic appearance operators',
  );

  const bytes = await pdfDoc.save();
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const loaded = await task.promise;
  try {
    const imported = await importAnnotationsFromPdf(loaded, { rawPdfBytes: bytes });
    const ink = imported.annotationsByPage[1].objects[0];
    const sourceGeometry = ink.data.pdfInkSourceGeometry;
    assert.equal(sourceGeometry.kind, 'appearance-path');
    assert.deepEqual(
      sourceGeometry.appearancePath.map((command) => command[0]),
      ['M', 'L', 'C', 'C', 'C', 'C', 'C'],
    );
    assert.deepEqual(endpoint(sourceGeometry.appearancePath.at(-1)), [180, 80]);
  } finally {
    await task.destroy();
  }
});
