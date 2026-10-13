import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { adaptInk } from '../src/utils/pdfNativeExport/adapters/ink.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

const PAGE_SIZE = 400;

async function exportInk(object) {
  const source = await PDFDocument.create();
  source.addPage([PAGE_SIZE, PAGE_SIZE]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'affine-ink.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  };
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      { 1: { objects: [object] } },
      { 1: { width: PAGE_SIZE, height: PAGE_SIZE } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'affine-ink-test',
      },
    );
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
    return {
      bytes,
      doc,
      dict: doc.context.lookup(annots.asArray()[0]),
    };
  } finally {
    globalThis.window = originalWindow;
  }
}

function numbers(array) {
  return array.asArray().map((value) => (
    typeof value?.value === 'function' ? value.value() : Number(value)
  ));
}

function readInkList(dict) {
  return dict.get(PDFName.of('InkList')).asArray().map(numbers);
}

function readRect(dict) {
  return numbers(dict.get(PDFName.of('Rect')));
}

function appearanceContent(doc, dict) {
  const appearance = doc.context.lookup(dict.get(PDFName.of('AP')));
  assert.ok(appearance, 'annotation must have an appearance dictionary');
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  assert.ok(normal, 'annotation must have a normal appearance stream');
  return new TextDecoder().decode(decodePDFRawStream(normal).decode());
}

function appearanceBBox(doc, dict) {
  const appearance = doc.context.lookup(dict.get(PDFName.of('AP')));
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  return numbers(normal.dict.get(PDFName.of('BBox')));
}

function closeTo(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) < 1e-4,
      `${label}[${index}] expected ${expected[index]}, received ${value}`,
    );
  });
}

test('PDF ink export applies left/top, scale, rotation, and pathOffset exactly once', async () => {
  const { doc, dict } = await exportInk({
    id: 'affine-curve',
    type: 'path',
    path: [
      ['M', 10, 20],
      ['Q', 20, 0, 30, 20],
      ['C', 40, 30, 50, 10, 60, 20],
    ],
    left: 100,
    top: 100,
    scaleX: 2,
    scaleY: 0.5,
    angle: 90,
    pathOffset: { x: 10, y: 20 },
    stroke: '#112233',
    strokeWidth: 2,
  });

  closeTo(
    readInkList(dict)[0],
    [147.5, 352.5, 147.5, 312.5, 147.5, 252.5],
    'InkList',
  );
  closeTo(readRect(dict), [140.5, 250.5, 159.5, 354.5], 'Rect');

  const appearance = doc.context.lookup(dict.get(PDFName.of('AP')));
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  const content = new TextDecoder().decode(decodePDFRawStream(normal).decode());
  assert.match(
    content,
    /0 -2 -0\.5 0 17 122 cm/,
    'appearance must retain the complete nonuniform affine matrix',
  );
  assert.match(content, /\b2 w\b/, 'stroke width stays local and is transformed by the matrix');
});

test('PDF filled-ink export transforms its polygon and editable centerline together', async () => {
  const { dict } = await exportInk({
    id: 'affine-filled',
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['L', 20, 10],
      ['L', 0, 10],
      ['Z'],
    ],
    polygons: [[[
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
      [0, 0],
    ]]],
    paperCenterline: [{ x: 0, y: 5 }, { x: 20, y: 5 }],
    paperInkGeometry: 'v1',
    left: 100,
    top: 50,
    scaleX: 2,
    scaleY: 3,
    angle: 90,
    pathOffset: { x: 10, y: 5 },
    fill: '#ff0000',
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: 4,
  });

  closeTo(readRect(dict), [85, 330, 115, 370], 'Rect');
  closeTo(readInkList(dict)[0], [100, 370, 100, 330], 'InkList');
});

test('PDF filled-ink appearance keeps the current live cubic path', async () => {
  const { doc, dict } = await exportInk({
    id: 'filled-authored-curve',
    type: 'path',
    path: [
      ['M', 0, 0],
      ['C', 5, -4, 15, -4, 20, 0],
      ['L', 20, 10],
      ['C', 15, 14, 5, 14, 0, 10],
      ['Z'],
    ],
    polygons: [[[
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
      [0, 0],
    ]]],
    paperInkGeometry: 'v1',
    fill: '#ff0000',
    stroke: 'transparent',
    strokeWidth: 0,
  });
  const appearance = doc.context.lookup(dict.get(PDFName.of('AP')));
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  const content = new TextDecoder().decode(decodePDFRawStream(normal).decode());
  assert.match(content, /\bc\b/, 'filled appearance must preserve cubic operators');
});

test('PDF ink appearance preserves microscopic decimal geometry and exact BBox mapping', async () => {
  const tinyFilled = await exportInk({
    id: 'tiny-filled-export',
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 1e-6, 0],
      ['L', 1e-6, 1e-6],
      ['L', 0, 1e-6],
      ['Z'],
    ],
    polygons: [[[
      [0, 0],
      [1e-6, 0],
      [1e-6, 1e-6],
      [0, 1e-6],
      [0, 0],
    ]]],
    paperInkGeometry: 'v1',
    fill: '#ff0000',
    stroke: 'transparent',
    strokeWidth: 0,
  });
  const filledRect = readRect(tinyFilled.dict);
  const filledBBox = appearanceBBox(tinyFilled.doc, tinyFilled.dict);
  assert.equal(filledRect[2] - filledRect[0], 1e-6);
  assert.ok(Math.abs((filledRect[3] - filledRect[1]) - 1e-6) <= 1e-14);
  assert.deepEqual(filledBBox, [0, 0, 1e-6, 1e-6]);

  const tinyStroke = await exportInk({
    id: 'tiny-stroke-export',
    type: 'path',
    path: [
      ['M', 0, 0],
      ['C', 1e-13, 2e-7, 7e-7, -2e-7, 1e-6, 0],
    ],
    stroke: '#112233',
    strokeWidth: 1e-7,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    fill: null,
    tool: 'pen',
  });
  const strokeRect = readRect(tinyStroke.dict);
  const strokeBBox = appearanceBBox(tinyStroke.doc, tinyStroke.dict);
  assert.ok(Math.abs((strokeRect[2] - strokeRect[0]) - strokeBBox[2]) <= 1e-18);
  assert.ok(Math.abs((strokeRect[3] - strokeRect[1]) - strokeBBox[3]) <= 1e-13);
  const content = appearanceContent(tinyStroke.doc, tinyStroke.dict);
  assert.doesNotMatch(content, /(?:^|\s)[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+/);
  assert.match(
    content,
    /0\.0000000000001/,
    'microscopic control coordinate remains a legal PDF decimal',
  );
});

test('native ink adapter applies the complete transform to curve and centerline carriers', async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_SIZE, PAGE_SIZE]);
  const context = { pdfDoc, page, pageHeight: PAGE_SIZE };
  const curveRef = adaptInk({
    id: 'adapter-affine-curve',
    type: 'path',
    path: [
      ['M', 10, 20],
      ['Q', 20, 0, 30, 20],
      ['C', 40, 30, 50, 10, 60, 20],
    ],
    left: 100,
    top: 100,
    scaleX: 2,
    scaleY: 0.5,
    angle: 90,
    pathOffset: { x: 10, y: 20 },
    stroke: '#112233',
    strokeWidth: 2,
  }, context);
  const curveDict = pdfDoc.context.lookup(curveRef);
  closeTo(
    readInkList(curveDict)[0],
    [147.5, 352.5, 147.5, 312.5, 147.5, 252.5],
    'adapter curve InkList',
  );
  closeTo(readRect(curveDict), [140.5, 250.5, 159.5, 354.5], 'adapter curve Rect');
  const curveAppearance = appearanceContent(pdfDoc, curveDict);
  assert.match(curveAppearance, /0 -2 -0\.5 0 17 122 cm/);
  assert.equal(
    curveAppearance.match(/\bc\b/g)?.length,
    2,
    'adapter appearance must preserve both quadratic and cubic curves',
  );

  const centerlineRef = adaptInk({
    id: 'adapter-affine-filled',
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['L', 20, 10],
      ['L', 0, 10],
      ['Z'],
    ],
    paperCenterline: [{ x: 0, y: 5 }, { x: 20, y: 5 }],
    paperInkGeometry: 'v1',
    left: 100,
    top: 50,
    scaleX: 2,
    scaleY: 3,
    angle: 90,
    pathOffset: { x: 10, y: 5 },
    fill: '#ff0000',
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: 4,
  }, context);
  const centerlineDict = pdfDoc.context.lookup(centerlineRef);
  closeTo(readInkList(centerlineDict)[0], [100, 370, 100, 330], 'adapter centerline InkList');
  closeTo(readRect(centerlineDict), [85, 330, 115, 370], 'adapter centerline Rect');
  closeTo(numbers(centerlineDict.get(PDFName.of('C'))), [1, 0, 0], 'adapter centerline color');
  assert.match(appearanceContent(pdfDoc, centerlineDict), /f\*/);
});

test('native ink adapter keeps erased filled ink red and visible without a stale centerline', async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_SIZE, PAGE_SIZE]);
  const ref = adaptInk({
    id: 'adapter-erased-filled',
    type: 'path',
    path: [
      ['M', 20, 20],
      ['C', 30, 10, 50, 10, 60, 20],
      ['L', 60, 40],
      ['C', 50, 50, 30, 50, 20, 40],
      ['Z'],
    ],
    polygons: [[[
      [20, 20],
      [60, 20],
      [60, 40],
      [20, 40],
      [20, 20],
    ]]],
    paperInkGeometry: 'v1',
    paperEraserGeometry: 'v1',
    paperCenterline: [{ x: 20, y: 30 }, { x: 60, y: 30 }],
    fill: '#ff0000',
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: 12,
  }, { pdfDoc, page, pageHeight: PAGE_SIZE });
  const dict = pdfDoc.context.lookup(ref);

  closeTo(numbers(dict.get(PDFName.of('C'))), [1, 0, 0], 'erased fill color');
  closeTo(numbers(dict.get(PDFName.of('Border'))), [0, 0, 0], 'erased border');
  assert.notDeepEqual(
    readInkList(dict)[0],
    [20, 370, 60, 370],
    'erased geometry must not resurrect the stale centerline',
  );
  const content = appearanceContent(pdfDoc, dict);
  assert.match(content, /1 0 0 rg/);
  assert.match(content, /\bc\b/, 'erased live cubic remains in the visible appearance');
  assert.match(content, /f\*/);
});

// 2026-10-06 (test plan 68): a partially erased authored curve exports as its
// survivor polygons, filled even-odd, like the screen renderers. It used to be
// the authored Q/C stroked under a clip of those polygons; the clip edge sat on
// the curve's own edge, so viewers anti-aliased it twice and thin lines
// printed lighter than untouched ones.
test('partially erased authored curve exports as its filled survivor polygons', async () => {
  const authoredPath = [
    ['M', 20, 150],
    ['Q', 170, 10, 320, 150],
  ];
  const erased = erasePageAnnotations({
    pageAnnotations: {
      objects: [{
        id: 'adapter-clipped-curve',
        annotationId: 'adapter-clipped-curve',
        type: 'path',
        tool: 'pen',
        path: authoredPath,
        left: 0,
        top: 0,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        stroke: '#ff0000',
        strokeWidth: 12,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        fill: null,
        data: { id: 'adapter-clipped-curve', tool: 'pen' },
      }],
    },
    eraserPoints: [{ x: 170, y: 80 }],
    eraserRadius: 6,
    mode: 'partial',
  });
  const survivor = erased.pageAnnotations.objects[0];
  assert.deepEqual(survivor.paperSourceStroke.path, authoredPath);
  assert.ok(survivor.paperEraserCuts.length > 0);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_SIZE, PAGE_SIZE]);
  const ref = adaptInk(survivor, { pdfDoc, page, pageHeight: PAGE_SIZE });
  const dict = pdfDoc.context.lookup(ref);
  const content = appearanceContent(pdfDoc, dict);
  const rect = readRect(dict);

  assert.doesNotMatch(content, /W\*?\s+n/, 'no clip: one anti-aliased edge');
  assert.match(content, /1 0 0 rg/, 'the stroke colour fills the survivor');
  assert.match(content, /(?:^|\s)f\*(?:\s|$)/m, 'the survivor polygons are filled even-odd');
  assert.doesNotMatch(content, /\bS\b/);
  assert.doesNotMatch(content, /\bc\b/, 'the survivor is polygons, not the source curve');
  closeTo(
    rect,
    [14, 244, 326, 326],
    'annotation Rect follows the exact painted quadratic extrema',
  );
});

test('partially erased authored fill exports as its filled survivor polygons', async () => {
  const authoredPath = [
    ['M', 20, 100],
    ['C', 80, 20, 240, 20, 300, 100],
    ['L', 300, 150],
    ['L', 20, 150],
    ['Z'],
  ];
  const erased = erasePageAnnotations({
    pageAnnotations: {
      objects: [{
        id: 'adapter-clipped-fill',
        annotationId: 'adapter-clipped-fill',
        type: 'path',
        tool: 'pen',
        path: authoredPath,
        left: 0,
        top: 0,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        stroke: null,
        strokeWidth: 0,
        fill: '#ff0000',
        fillRule: 'nonzero',
        data: { id: 'adapter-clipped-fill', tool: 'pen', isPdfImported: true },
      }],
    },
    eraserPoints: [{ x: 160, y: 45 }],
    eraserRadius: 12,
    mode: 'partial',
  });
  const survivor = erased.pageAnnotations.objects[0];
  assert.deepEqual(survivor.paperSourceStroke.path, authoredPath);
  assert.equal(survivor.paperSourceStroke.paintMode, 'fill');
  survivor.fill = '#0000ff';

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_SIZE, PAGE_SIZE]);
  const ref = adaptInk(survivor, { pdfDoc, page, pageHeight: PAGE_SIZE });
  const dict = pdfDoc.context.lookup(ref);
  const content = appearanceContent(pdfDoc, dict);

  closeTo(numbers(dict.get(PDFName.of('C'))), [0, 0, 1], 'live recolored fill');
  assert.doesNotMatch(content, /W\*?\s+n/);
  assert.match(content, /0 0 1 rg/);
  assert.match(content, /(?:^|\s)f\*(?:\s|$)/m);
  assert.doesNotMatch(content, /\bS\b/);
});

test('partially erased authored arc exports as its filled survivor polygons', async () => {
  const authoredPath = [
    ['M', 20, 100],
    ['A', 80, 80, 0, 0, 1, 180, 100],
  ];
  let erased = erasePageAnnotations({
    pageAnnotations: {
      objects: [{
        id: 'adapter-clipped-arc',
        annotationId: 'adapter-clipped-arc',
        type: 'path',
        tool: 'pen',
        path: authoredPath,
        left: 0,
        top: 0,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        stroke: '#ff0000',
        strokeWidth: 12,
        fill: null,
        data: { id: 'adapter-clipped-arc', tool: 'pen' },
      }],
    },
    eraserPoints: [{ x: 100, y: 20 }],
    eraserRadius: 6,
    mode: 'partial',
  });
  if (!erased.didChange) {
    erased = erasePageAnnotations({
      pageAnnotations: erased.pageAnnotations,
      eraserPoints: [{ x: 100, y: 180 }],
      eraserRadius: 6,
      mode: 'partial',
    });
  }
  const survivor = erased.pageAnnotations.objects[0];
  assert.deepEqual(survivor.paperSourceStroke.path, authoredPath);
  assert.ok(survivor.paperSourceStroke.operationalPath.some((command) => command[0] === 'C'));

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_SIZE, PAGE_SIZE]);
  const ref = adaptInk(survivor, { pdfDoc, page, pageHeight: PAGE_SIZE });
  const content = appearanceContent(pdfDoc, pdfDoc.context.lookup(ref));

  assert.doesNotMatch(content, /W\*?\s+n/);
  assert.match(content, /(?:^|\s)f\*(?:\s|$)/m);
  assert.doesNotMatch(content, /\bS\b/);
});

test('analytic PDF bounds do not apply a miter limit where no join exists', async () => {
  const authoredPath = [
    ['M', 20, 100],
    ['L', 120, 100],
  ];
  const erased = erasePageAnnotations({
    pageAnnotations: {
      objects: [{
        id: 'adapter-clipped-butt-line',
        annotationId: 'adapter-clipped-butt-line',
        type: 'path',
        tool: 'pen',
        path: authoredPath,
        left: 0,
        top: 0,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        stroke: '#ff0000',
        strokeWidth: 10,
        strokeLineCap: 'butt',
        strokeLineJoin: 'miter',
        strokeMiterLimit: 10,
        fill: null,
        data: { id: 'adapter-clipped-butt-line', tool: 'pen' },
      }],
    },
    eraserPoints: [{ x: 70, y: 100 }],
    eraserRadius: 2,
    mode: 'partial',
  });
  assert.equal(erased.didChange, true);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_SIZE, PAGE_SIZE]);
  const ref = adaptInk(erased.pageAnnotations.objects[0], {
    pdfDoc,
    page,
    pageHeight: PAGE_SIZE,
  });
  const dict = pdfDoc.context.lookup(ref);

  closeTo(
    readRect(dict),
    [15, 295, 125, 305],
    'straight butt line receives only the conservative stroke radius',
  );
  closeTo(
    appearanceBBox(pdfDoc, dict),
    [0, 0, 110, 10],
    'straight butt line appearance is not inflated by an unused miter limit',
  );
});

test('analytic PDF bounds round high-curvature cubic extrema outward', async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_SIZE, PAGE_SIZE]);
  const ref = adaptInk({
      id: 'high-curvature-source-bounds',
      annotationId: 'high-curvature-source-bounds',
      type: 'path',
      tool: 'pen',
      path: [
        ['M', 0, -6],
        ['L', 1000, -6],
        ['L', 1000, 6],
        ['L', 0, 6],
        ['Z'],
      ],
      polygons: [[[
        [0, -6],
        [1000, -6],
        [1000, 6],
        [0, 6],
        [0, -6],
      ]]],
      left: 0,
      top: 0,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      inkGeometrySpace: 'page',
      stroke: 'transparent',
      strokeWidth: 0,
      fill: '#ff0000',
      paperEraserGeometry: 'v1',
      paperSourceStroke: {
        path: [
          ['M', 0, 0],
          ['C', 150, 1000, 850, -1000, 1000, 0],
        ],
        matrix: [1, 0, 0, 1, 0, 0],
        paintMode: 'stroke',
        stroke: '#ff0000',
        strokeWidth: 12,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
      },
      paperEraserCuts: [[[
        [495, -10],
        [505, -10],
        [505, 10],
        [495, 10],
        [495, -10],
      ]]],
  }, { pdfDoc: document, page, pageHeight: PAGE_SIZE });
  const rect = readRect(document.context.lookup(ref));
  const paintedExtremum = 1000 / (2 * Math.sqrt(3)) + 6;

  assert.ok(rect[1] <= PAGE_SIZE - paintedExtremum);
  assert.ok(rect[3] >= PAGE_SIZE + paintedExtremum);
});

test('analytic PDF bounds retain same-sign huge quadratic extrema', async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_SIZE, PAGE_SIZE]);
  const ref = adaptInk({
    id: 'huge-quadratic-source-bounds',
    annotationId: 'huge-quadratic-source-bounds',
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 0], ['L', 2, 0], ['L', 2, 2], ['L', 0, 2], ['Z']],
    polygons: [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    inkGeometrySpace: 'page',
    stroke: 'transparent',
    strokeWidth: 0,
    fill: '#ff0000',
    paperEraserGeometry: 'v1',
    paperSourceStroke: {
      path: [
        ['M', 0, 1e308],
        ['Q', 1, 1.1e308, 2, 1e308],
      ],
      matrix: [1, 0, 0, 1, 0, 0],
      paintMode: 'stroke',
      stroke: '#ff0000',
      strokeWidth: 0,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    },
    paperEraserCuts: [[[[0.9, 0], [1.1, 0], [1.1, 2], [0.9, 2], [0.9, 0]]]],
  }, { pdfDoc: document, page, pageHeight: PAGE_SIZE });
  const rect = readRect(document.context.lookup(ref));

  assert.ok(
    rect[1] <= PAGE_SIZE - 1.05e308,
    `huge quadratic maximum was underbounded: ${rect[1]}`,
  );
});

test('analytic PDF bounds use the control hull for subnormal curve axes', async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_SIZE, PAGE_SIZE]);
  const controlMaxY = 9.027999890260045e-309;
  const ref = adaptInk({
    id: 'subnormal-cubic-source-bounds',
    annotationId: 'subnormal-cubic-source-bounds',
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 0], ['L', 3, 0]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    inkGeometrySpace: 'page',
    stroke: 'transparent',
    strokeWidth: 0,
    fill: '#ff0000',
    paperEraserGeometry: 'v1',
    paperSourceStroke: {
      path: [
        ['M', 0, 1.38439170351875e-309],
        [
          'C',
          1,
          controlMaxY,
          2,
          5.401111574162547e-309,
          3,
          3.5884061790783e-309,
        ],
      ],
      matrix: [1, 0, 0, 1, 0, 0],
      paintMode: 'stroke',
      stroke: '#ff0000',
      strokeWidth: 0,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    },
    paperEraserCuts: [[[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]]],
  }, { pdfDoc: document, page, pageHeight: 0 });
  const rect = readRect(document.context.lookup(ref));

  assert.ok(
    rect[1] <= -controlMaxY,
    `subnormal cubic axis was not conservatively bounded: ${rect[1]}`,
  );
});

test('main PDF export and reimport preserve the full affine path object exactly', async () => {
  const original = {
    id: 'affine-roundtrip',
    type: 'path',
    path: [
      ['M', 10, 20],
      ['Q', 20, 0, 30, 20],
      ['C', 40, 30, 50, 10, 60, 20],
    ],
    left: 100,
    top: 100,
    width: 50,
    height: 30,
    scaleX: 2,
    scaleY: 0.5,
    angle: 90,
    pathOffset: { x: 10, y: 20 },
    stroke: '#112233',
    strokeWidth: 2,
    fill: null,
    tool: 'pen',
  };
  const { bytes } = await exportInk(original);
  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
    const restored = imported.annotationsByPage[1].objects[0];
    assert.deepEqual(restored.path, original.path);
    assert.equal(restored.left, original.left);
    assert.equal(restored.top, original.top);
    assert.equal(restored.scaleX, original.scaleX);
    assert.equal(restored.scaleY, original.scaleY);
    assert.equal(restored.angle, original.angle);
    assert.deepEqual(restored.pathOffset, original.pathOffset);
  } finally {
    await loadingTask.destroy();
  }
});
