import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  convertInkToFabricPath,
  importAnnotationsFromPdf,
} from '../src/utils/pdfAnnotationImporter.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { renderPathToSvgAttrs, renderPathToSvgD } from '../src/utils/svgPathAttrs.js';

const viewport = {
  height: 120,
  convertToViewportPoint: (x, y) => [x, 120 - y],
};

async function importRawPdf(bytes) {
  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;
  try {
    return await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  } finally {
    await loadingTask.destroy();
  }
}

async function exportObject(object) {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'ink-fidelity-source.pdf',
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
    return await savePDFWithAnnotationsPdfLib(
      pdfFile,
      { 1: { objects: [object] } },
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'ink-fidelity-test',
      },
    );
  } finally {
    globalThis.window = originalWindow;
  }
}

test('open PDF Ink preserves exact source points as its M/L live geometry and keeps /BS width', () => {
  const annotation = {
    id: 'source-open-ink',
    subtype: 'Ink',
    inkLists: [[0, 0, 40, 80, 90, 15]],
    color: [0, 0, 0],
    borderWidth: 10,
    rect: [0, 0, 100, 100],
  };
  const original = structuredClone(annotation);

  const imported = convertInkToFabricPath(annotation, viewport, 1);

  assert.ok(imported);
  assert.deepEqual(annotation, original, 'import must not mutate the PDF.js annotation');
  assert.equal(imported.inkGeometrySpace, 'local');
  assert.equal(imported.data?.inkGeometrySpace, 'local');
  assert.equal(imported.strokeWidth, 10, 'stored/rendered width must remain the native /BS width');
  assert.deepEqual(
    imported.data?.pdfInkSourceGeometry?.inkLists,
    [[[0, 0], [40, 80], [90, 15]]],
    'the exact source centerline must survive independently of the editable local carrier',
  );
  assert.equal(imported.data?.pdfInkSourceGeometry?.borderWidth, 10);
  assert.equal(imported.data?.pdfInkSourceGeometry?.kind, 'ink-list');
  assert.deepEqual(
    imported.path.map((command) => command[0]),
    ['M', 'L', 'L'],
    'plain InkList geometry must not be replaced by importer-generated quadratic smoothing',
  );
  assert.deepEqual(
    imported.path.map((command) => {
      if (command[0] === 'Z') return ['Z'];
      const next = [command[0]];
      for (let index = 1; index < command.length; index += 2) {
        next.push(command[index] + imported.left, command[index + 1] + imported.top);
      }
      return next;
    }),
    [
      ['M', 0, 120],
      ['L', 40, 40],
      ['L', 90, 105],
    ],
  );
  const attrs = renderPathToSvgAttrs(imported);
  const renderedPath = renderPathToSvgD(imported, attrs);
  assert.equal(attrs.smoothOpenStroke, undefined);
  assert.equal(
    renderedPath,
    imported.path.map((command) => command.join(' ')).join(' '),
    'rendering must use the exact authored M/L path instead of invented Catmull-Rom curves',
  );
  assert.doesNotMatch(renderedPath, /\bC\b/);

  annotation.inkLists[0][0] = 999;
  assert.equal(
    imported.data.pdfInkSourceGeometry.inkLists[0][0][0],
    0,
    'source metadata must not alias mutable importer input',
  );
});

test('open PDF Ink uses an authoritative stroked AP without rewriting its commands', () => {
  const annotation = {
    id: 'source-open-ap-ink',
    subtype: 'Ink',
    inkLists: [[0, 0, 20, 20, 40, 0]],
    color: [0, 0, 0],
    borderWidth: 3,
    rect: [0, 0, 100, 100],
    _appearance: {
      path: [
        ['M', 0, 0],
        ['C', 10, 30, 30, 30, 40, 0],
      ],
      hasFill: false,
      hasStroke: true,
      strokeWidth: 3,
    },
  };

  const imported = convertInkToFabricPath(annotation, viewport, 1);

  assert.ok(imported);
  assert.deepEqual(imported.path.map((command) => command[0]), ['M', 'C']);
  assert.equal(imported.fill, null);
  assert.equal(imported.strokeWidth, 3);
  assert.equal(imported.data.pdfInkSourceGeometry.kind, 'appearance-path');
  assert.deepEqual(
    imported.data.pdfInkSourceGeometry.inkLists,
    [[[0, 0], [20, 20], [40, 0]]],
    'fallback InkList remains available as immutable source metadata',
  );
  assert.equal(
    renderPathToSvgD(imported, renderPathToSvgAttrs(imported)),
    imported.path.map((command) => command.join(' ')).join(' '),
    'authoritative AP cubic controls must render byte-for-byte instead of being rebuilt from endpoints',
  );
});

test('explicit PDF zero-width strokes stay zero-width hairlines while rendering one device pixel', () => {
  const annotation = {
    id: 'source-hairline-ap-ink',
    subtype: 'Ink',
    inkLists: [[0, 0, 40, 0]],
    color: [0, 0, 0],
    borderWidth: 0,
    rect: [0, 0, 100, 100],
    _appearance: {
      path: [
        ['M', 0, 0],
        ['L', 40, 0],
      ],
      hasFill: false,
      hasStroke: true,
      strokeWidth: 0,
    },
  };

  const imported = convertInkToFabricPath(annotation, viewport, 1);
  const attrs = renderPathToSvgAttrs(imported);

  assert.equal(imported.strokeWidth, 0);
  assert.equal(imported.pdfStrokeHairline, true);
  assert.equal(imported.data?.pdfStrokeHairline, true);
  assert.equal(attrs.strokeWidth, 1);
  assert.equal(attrs.vectorEffect, 'non-scaling-stroke');
});

test('filled PDF Ink retains exact AP source geometry and renders the authored cubic path', () => {
  const appearancePath = [
    ['M', 10, 30],
    ['C', 10, 45, 20, 55, 35, 55],
    ['C', 50, 55, 60, 45, 60, 30],
    ['C', 60, 15, 50, 5, 35, 5],
    ['C', 20, 5, 10, 15, 10, 30],
    ['Z'],
  ];
  const annotation = {
    id: 'source-filled-ap-ink',
    subtype: 'Ink',
    inkLists: [],
    color: [255, 0, 0],
    borderWidth: 0,
    rect: [0, 0, 100, 100],
    _appearance: {
      path: structuredClone(appearancePath),
      hasFill: true,
      hasStroke: false,
      strokeWidth: 0,
    },
  };

  const imported = convertInkToFabricPath(annotation, viewport, 1);

  assert.ok(imported);
  assert.equal(imported.data?.pdfInkSourceGeometry?.kind, 'appearance-path');
  assert.deepEqual(
    imported.data?.pdfInkSourceGeometry?.appearancePath,
    appearancePath,
    'the authored AP commands must survive import exactly',
  );
  annotation._appearance.path[1][1] = 999;
  assert.equal(
    imported.data.pdfInkSourceGeometry.appearancePath[1][1],
    10,
    'AP source metadata must not alias mutable importer input',
  );

  assert.deepEqual(
    imported.path?.map((command) => command[0]),
    ['M', 'C', 'C', 'C', 'C', 'Z'],
    'the exact cubic presentation must remain the live path beside clipping polygons',
  );

  const d = renderPathToSvgD(imported, renderPathToSvgAttrs(imported));
  assert.match(d, /\bC\b/, 'the pristine import must render the authored cubic, not its flattened clipping mesh');
});

test('filled M/L appearance geometry remains M/L instead of ellipse or Catmull-Rom reconstruction', () => {
  const appearancePath = [
    ['M', 10, 10],
    ['L', 30, 8],
    ['L', 45, 20],
    ['L', 30, 32],
    ['L', 10, 30],
    ['Z'],
  ];
  const annotation = {
    id: 'source-filled-linear-ap-ink',
    subtype: 'Ink',
    inkLists: [],
    color: [255, 0, 0],
    borderWidth: 0,
    rect: [0, 0, 100, 100],
    _appearance: {
      path: structuredClone(appearancePath),
      hasFill: true,
      hasStroke: false,
      strokeWidth: 0,
    },
  };

  const imported = convertInkToFabricPath(annotation, viewport, 1);

  assert.ok(imported);
  assert.deepEqual(
    imported.path.map((command) => command[0]),
    ['M', 'L', 'L', 'L', 'L', 'Z'],
  );
});

test('filled AP remains authoritative when /Border carries a nonzero fallback width', () => {
  const annotation = {
    id: 'source-filled-ap-with-border',
    subtype: 'Ink',
    inkLists: [[10, 20, 50, 20]],
    color: [255, 0, 0],
    borderWidth: 12,
    rect: [0, 0, 100, 100],
    _appearance: {
      path: [
        ['M', 10, 14],
        ['L', 50, 14],
        ['L', 50, 26],
        ['L', 10, 26],
        ['Z'],
      ],
      hasFill: true,
      hasStroke: false,
      strokeWidth: 0,
    },
  };

  const imported = convertInkToFabricPath(annotation, viewport, 1);

  assert.ok(imported);
  assert.equal(imported.fillRule, 'evenodd');
  assert.equal(imported.paperInkGeometry, 'v1');
  assert.equal(imported.stroke, 'transparent');
  assert.equal(imported.strokeWidth, 0);
  assert.deepEqual(imported.path.map((command) => command[0]), ['M', 'L', 'L', 'L', 'Z']);
  assert.equal(imported.data.pdfInkSourceGeometry.kind, 'appearance-path');
  assert.equal(imported.data.pdfInkSourceGeometry.borderWidth, 12);
});

test('main-export production ink reimports from its filled AP despite the fallback Border width', async () => {
  const paperInk = createProductionPaperInk({
    id: 'production-filled-roundtrip',
    tool: 'pen',
    points: [{ x: 20, y: 70 }, { x: 180, y: 70 }],
    color: '#ff0000',
    width: 20,
  });
  const exportedBytes = await exportObject(paperInk);

  // Remove the app-owned geometry metadata so this exercises the native
  // Ink/AP importer rather than simply restoring the embedded Fabric object.
  const exported = await PDFDocument.load(exportedBytes);
  const annots = exported.getPage(0).node.lookup(PDFName.of('Annots'));
  const dict = exported.context.lookup(annots.asArray()[0]);
  const border = dict.get(PDFName.of('Border')).asArray();
  const fallbackWidth = Number(border[2]);
  assert.ok(fallbackWidth > 0, 'main export carries a nonzero InkList fallback Border');
  dict.delete(PDFName.of('SurveyAppAnnotation'));
  const nativeOnlyBytes = await exported.save();

  const imported = await importRawPdf(nativeOnlyBytes);
  const ink = imported.annotationsByPage[1].objects[0];

  assert.equal(ink.fillRule, 'evenodd');
  assert.equal(ink.paperInkGeometry, 'v1');
  assert.equal(ink.stroke, 'transparent');
  assert.equal(ink.strokeWidth, 0);
  assert.ok(Array.isArray(ink.polygons) && ink.polygons.length > 0);
  assert.equal(ink.data.pdfInkSourceGeometry.kind, 'appearance-path');
  assert.equal(ink.data.pdfInkSourceGeometry.appearanceHasFill, true);
  assert.equal(ink.data.pdfInkSourceGeometry.borderWidth, fallbackWidth);
});

test('filled AP preserves the source nonzero fill rule and exact overlapping paths', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([100, 100]);
  const appearance = pdf.context.flateStream(
    [
      'q',
      '1 0 0 rg',
      '0 0 20 20 re',
      '10 0 20 20 re',
      'f',
      'Q',
      '',
    ].join('\n'),
    {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [0, 0, 30, 20],
      Resources: {},
    },
  );
  const appearanceRef = pdf.context.register(appearance);
  const annotationRef = pdf.context.register(pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Ink',
    Rect: [0, 0, 30, 20],
    InkList: [[0, 10, 30, 10]],
    C: [1, 0, 0],
    Border: [0, 0, 0],
    AP: { N: appearanceRef },
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([annotationRef]));

  const imported = await importRawPdf(await pdf.save());
  const ink = imported.annotationsByPage[1].objects[0];
  const attrs = renderPathToSvgAttrs(ink);
  const d = renderPathToSvgD(ink, attrs);

  assert.equal(ink.fillRule, 'nonzero');
  assert.equal(attrs.fillRule, 'nonzero');
  assert.equal(ink.data.pdfInkSourceGeometry.appearanceFillRule, 'nonzero');
  assert.doesNotMatch(d, /\bC\b/, 'authored rectangles must not be smoothed');
  assert.equal(
    ink.path.filter((command) => command[0] === 'M').length,
    2,
    'both overlapping source subpaths remain live',
  );
});

test('filled PDF Ink applies its AP form matrix without changing cubic commands', () => {
  const annotation = {
    id: 'matrix-filled-ap-ink',
    subtype: 'Ink',
    inkLists: [],
    color: [255, 0, 0],
    borderWidth: 0,
    rect: [0, 0, 100, 100],
    _appearance: {
      path: [
        ['M', 0, 0],
        ['C', 5, 10, 10, 10, 15, 0],
        ['C', 10, -10, 5, -10, 0, 0],
        ['Z'],
      ],
      matrix: [2, 0, 0, 3, 10, 20],
      bbox: [0, -10, 15, 10],
      hasFill: true,
      hasStroke: false,
      strokeWidth: 0,
    },
  };

  const imported = convertInkToFabricPath(annotation, {
    height: 200,
    convertToViewportPoint: (x, y) => [x, 200 - y],
  }, 1);

  assert.deepEqual(
    imported.path.map((command) => command[0]),
    ['M', 'C', 'C', 'Z'],
  );
  const world = imported.path.map((command) => {
    if (command[0] === 'Z') return ['Z'];
    const next = [command[0]];
    for (let index = 1; index < command.length; index += 2) {
      next.push(command[index] + imported.left, command[index + 1] + imported.top);
    }
    return next;
  });
  assert.deepEqual(world, [
    ['M', 10, 180],
    ['C', 20, 150, 30, 150, 40, 180],
    ['C', 30, 210, 20, 210, 10, 180],
    ['Z'],
  ]);
  assert.deepEqual(
    imported.data.pdfInkSourceGeometry.appearanceMatrix,
    [2, 0, 0, 3, 10, 20],
    'the immutable native matrix remains available for provenance',
  );
});

test('raw AP content cm is composed inside Form /Matrix before viewport conversion', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const appearance = pdf.context.flateStream(
    [
      'q',
      '0 0 0 RG',
      '2 w',
      '2 0 0 3 5 7 cm',
      '0 0 m',
      '2 4 8 4 10 0 c',
      'S',
      'Q',
      '',
    ].join('\n'),
    {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [0, -1, 30, 20],
      Matrix: [1, 0, 0, 1, 10, 20],
      Resources: {},
    },
  );
  const appearanceRef = pdf.context.register(appearance);
  const annotationRef = pdf.context.register(pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Ink',
    // Form /Matrix maps BBox [0,-1,30,20] to [10,19,40,40].
    // Matching /Rect keeps PDF.js's outer BBox→Rect transform at identity,
    // isolating this test to Form Matrix ∘ content `cm` composition.
    Rect: [10, 19, 40, 40],
    InkList: [[15, 27, 35, 27]],
    C: [0, 0, 0],
    BS: { W: 2 },
    AP: { N: appearanceRef },
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([annotationRef]));
  const bytes = await pdf.save();

  const imported = await importRawPdf(bytes);
  const ink = imported.annotationsByPage[1].objects[0];
  const worldPolygons = ink.polygons.map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => [x + ink.left, y + ink.top])
  )));
  const points = worldPolygons.flat(2);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  assert.equal(ink.data.pdfAppearanceLayerKind, 'stroke');
  assert.equal(ink.stroke, 'transparent');
  assert.equal(ink.strokeWidth, 0);
  assert.ok(Math.min(...xs) < 15 && Math.max(...xs) > 35);
  assert.ok(Math.min(...ys) < 161.1 && Math.max(...ys) > 174.3);
  assert.deepEqual(
    ink.data.pdfInkSourceGeometry.appearancePath,
    [
      ['M', 0, 0],
      ['C', 2, 4, 8, 4, 10, 0],
    ],
    'immutable metadata keeps raw AP operands before either matrix',
  );
  assert.deepEqual(
    ink.data.pdfInkSourceGeometry.appearanceContentMatrices,
    [[2, 0, 0, 3, 5, 7]],
  );
  assert.deepEqual(
    ink.data.pdfInkSourceGeometry.appearanceMatrix,
    [1, 0, 0, 1, 10, 20],
  );
});
