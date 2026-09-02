import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  convertInkToFabricPath,
  importAnnotationsFromPdf,
} from '../src/utils/pdfAnnotationImporter.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { markEditedImportedPdfAnnotationsOnPage } from '../src/viewerShared.js';

const PAGE_WIDTH = 300;
const PAGE_HEIGHT = 200;

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

function worldPath(object) {
  const left = Number(object?.left) || 0;
  const top = Number(object?.top) || 0;
  return (object?.path || []).map((command) => {
    if (command[0] === 'Z') return ['Z'];
    const transformed = [command[0]];
    for (let index = 1; index + 1 < command.length; index += 2) {
      transformed.push(command[index] + left, command[index + 1] + top);
    }
    return transformed;
  });
}

function worldPolygons(object) {
  const left = Number(object?.left) || 0;
  const top = Number(object?.top) || 0;
  return (object?.polygons || []).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => [x + left, y + top])
  )));
}

function coordinateBounds(value) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (entry) => {
    if (!Array.isArray(entry)) return;
    if (
      entry.length === 2
      && Number.isFinite(Number(entry[0]))
      && Number.isFinite(Number(entry[1]))
    ) {
      minX = Math.min(minX, Number(entry[0]));
      minY = Math.min(minY, Number(entry[1]));
      maxX = Math.max(maxX, Number(entry[0]));
      maxY = Math.max(maxY, Number(entry[1]));
      return;
    }
    if (typeof entry[0] === 'string' && entry[0] !== 'Z') {
      for (let index = 1; index + 1 < entry.length; index += 2) {
        visit([entry[index], entry[index + 1]]);
      }
      return;
    }
    entry.forEach(visit);
  };
  visit(value);
  return { minX, minY, maxX, maxY };
}

function assertBoundsClose(actual, expected, tolerance = 1e-5) {
  for (const key of ['minX', 'minY', 'maxX', 'maxY']) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= tolerance,
      `${key}: expected ${expected[key]}, received ${actual[key]}`,
    );
  }
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
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
}

function pointInPolygonSet(point, polygons) {
  return polygons.some((polygon) => polygon.reduce(
    (inside, ring) => (pointInRing(point, ring) ? !inside : inside),
    false,
  ));
}

function pointToSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  const t = Math.max(0, Math.min(1, (
    (point[0] - start[0]) * dx + (point[1] - start[1]) * dy
  ) / lengthSquared));
  return Math.hypot(
    point[0] - (start[0] + t * dx),
    point[1] - (start[1] + t * dy),
  );
}

function distanceToPolygonBoundary(point, polygons) {
  let distance = Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let index = 1; index < ring.length; index += 1) {
        distance = Math.min(
          distance,
          pointToSegmentDistance(point, ring[index - 1], ring[index]),
        );
      }
    }
  }
  return distance;
}

async function exportProductionInkWithoutAppMetadata(object) {
  const source = await PDFDocument.create();
  source.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'appearance-mapping-fidelity.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  };

  const originalWindow = globalThis.window;
  globalThis.window = {};
  let bytes;
  try {
    bytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      { 1: { objects: [object] } },
      { 1: { width: PAGE_WIDTH, height: PAGE_HEIGHT } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'appearance-mapping-fidelity',
      },
    );
  } finally {
    globalThis.window = originalWindow;
  }

  const pdf = await PDFDocument.load(bytes);
  const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'));
  const dict = pdf.context.lookup(annots.asArray()[0]);
  dict.delete(PDFName.of('SurveyAppAnnotation'));
  return pdf.save();
}

async function saveExistingPdfWithObjects(bytes, objects) {
  const pdfFile = {
    name: 'appearance-layer-round-trip.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    },
  };
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    return await savePDFWithAnnotationsPdfLib(
      pdfFile,
      { 1: { objects } },
      { 1: { width: PAGE_WIDTH, height: PAGE_HEIGHT } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'appearance-layer-round-trip',
      },
    );
  } finally {
    globalThis.window = originalWindow;
  }
}

async function createRawInkPdf({
  content,
  rect,
  bbox,
  matrix,
  color = [1, 0, 0],
  borderWidth = 99,
  appearanceResources = {},
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const appearance = pdf.context.flateStream(`${content.trim()}\n`, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: bbox,
    ...(matrix ? { Matrix: matrix } : {}),
    Resources: appearanceResources,
  });
  const appearanceRef = pdf.context.register(appearance);
  const annotationRef = pdf.context.register(pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Ink',
    Rect: rect,
    InkList: [[rect[0], rect[1], rect[2], rect[3]]],
    C: color,
    BS: { W: borderWidth },
    AP: { N: appearanceRef },
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([annotationRef]));
  return pdf.save();
}

test('production paper ink raw AP reimports at its original world placement', async () => {
  const original = createProductionPaperInk({
    id: 'production-appearance-map',
    tool: 'pen',
    points: [{ x: 20, y: 70 }, { x: 180, y: 70 }],
    color: '#ff0000',
    width: 20,
  });
  const bytes = await exportProductionInkWithoutAppMetadata(original);
  const imported = await importRawPdf(bytes);
  const restored = imported.annotationsByPage[1].objects[0];

  assert.deepEqual(
    worldPath(restored).map((command) => command[0]),
    original.path.map((command) => command[0]),
    'the live AP path must remain the authored path, not an InkList fallback',
  );
  assertBoundsClose(
    coordinateBounds(worldPath(restored)),
    coordinateBounds(original.path),
  );
  assertBoundsClose(
    coordinateBounds(worldPolygons(restored)),
    coordinateBounds(original.polygons),
    0.02,
  );
  assert.deepEqual(
    worldPath(restored)[0].slice(0, 3),
    original.path[0].slice(0, 3),
    'the AP form origin must map through BBox and annotation Rect',
  );
});

test('AP mapping applies Rect, BBox, Form Matrix, content cm, paint color, and exact affine stroke outline', async () => {
  const bytes = await createRawInkPdf({
    rect: [50, 40, 250, 160],
    bbox: [0, 0, 100, 60],
    matrix: [1, 0, 0, 1, 10, 5],
    color: [1, 0, 0],
    borderWidth: 99,
    content: `
      q
      0 0 100 60 re
      W
      n
      0.2 0.4 0.6 RG
      4 w
      2 0 0 3 5 4 cm
      0 10 m
      40 10 l
      S
      Q
    `,
  });
  const imported = await importRawPdf(bytes);
  const ink = imported.annotationsByPage[1].objects[0];

  assertBoundsClose(coordinateBounds(worldPolygons(ink)), {
    minX: 60,
    minY: 80,
    maxX: 220,
    maxY: 104,
  }, 0.02);
  assert.deepEqual(
    ink.data.pdfInkSourceGeometry.appearancePath,
    [
      ['M', 0, 10],
      ['L', 40, 10],
    ],
    're W n clipping geometry is not painted ink geometry',
  );
  assert.equal(ink.fill, 'rgba(51, 102, 153, 1)');
  assert.equal(ink.stroke, 'transparent');
  assert.equal(ink.strokeWidth, 0);
  assert.ok(
    Math.abs(ink.sourceWidth - (4 * Math.sqrt(24))) < 1e-6,
    `expected transformed AP source width ${4 * Math.sqrt(24)}, received ${ink.sourceWidth}`,
  );
});

test('q/Q restores the content CTM between separately painted AP subpaths', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 30, 20],
    bbox: [0, 0, 30, 20],
    matrix: [1, 0, 0, 1, 0, 0],
    color: [0, 0, 0],
    borderWidth: 1,
    content: `
      0 0 0 RG
      1 w
      q
      2 0 0 2 10 0 cm
      0 0 m
      10 0 l
      S
      Q
      0 10 m
      10 10 l
      S
    `,
  });
  const imported = await importRawPdf(bytes);
  const layers = imported.annotationsByPage[1].objects;

  assert.equal(layers.length, 1);
  const polygons = worldPolygons(layers[0]);
  assert.equal(polygons.length, 2);
  assertBoundsClose(coordinateBounds(polygons[0]), {
    minX: 10,
    minY: 199,
    maxX: 30,
    maxY: 200,
  });
  assertBoundsClose(coordinateBounds(polygons[1]), {
    minX: 0,
    minY: 189.5,
    maxX: 10,
    maxY: 190.5,
  });
});

test('raw evenodd AP overlap remains a hole in imported clipping geometry', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 30, 20],
    bbox: [0, 0, 30, 20],
    matrix: [1, 0, 0, 1, 0, 0],
    color: [1, 0, 0],
    borderWidth: 0,
    content: `
      0 0 1 rg
      0 0 20 20 re
      10 0 20 20 re
      f*
    `,
  });
  const imported = await importRawPdf(bytes);
  const ink = imported.annotationsByPage[1].objects[0];
  const polygons = worldPolygons(ink);

  assert.equal(ink.fillRule, 'evenodd');
  assert.equal(ink.fill, 'rgba(0, 0, 255, 1)');
  assert.equal(pointInPolygonSet([5, 190], polygons), true);
  assert.equal(pointInPolygonSet([15, 190], polygons), false);
  assert.equal(pointInPolygonSet([25, 190], polygons), true);

  const firstBite = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 5, y: 190 }],
    eraserRadius: 2,
    mode: 'partial',
  });
  assert.equal(firstBite.didChange, true);
  const survivorPolygons = worldPolygons(firstBite.pageAnnotations.objects[0]);
  assert.equal(
    pointInPolygonSet([15, 190], survivorPolygons),
    false,
    'the first eraser bite must not turn the source evenodd overlap into ink',
  );
  assert.equal(pointInPolygonSet([25, 190], survivorPolygons), true);
});

test('typed-array InkList source coordinates remain in immutable provenance', () => {
  const annotation = {
    id: 'typed-ink-list',
    subtype: 'Ink',
    inkLists: [new Float32Array([10, 20, 30, 40, 50, 60])],
    color: [0, 0, 0],
    borderWidth: 2,
    rect: [10, 20, 50, 60],
  };
  const viewport = {
    height: PAGE_HEIGHT,
    convertToViewportPoint: (x, y) => [x, PAGE_HEIGHT - y],
  };
  const imported = convertInkToFabricPath(annotation, viewport, 1);

  assert.deepEqual(
    imported.data.pdfInkSourceGeometry.inkLists,
    [[[10, 20], [30, 40], [50, 60]]],
  );
});

test('mixed B appearance preserves separate fill and stroke paint layers', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    color: [0, 1, 0],
    borderWidth: 4,
    content: `
      1 0 0 rg
      0 0 1 RG
      4 w
      10 10 20 20 re
      B
    `,
  });
  const imported = await importRawPdf(bytes);
  const layers = imported.annotationsByPage[1].objects;

  assert.equal(layers.length, 2);
  assert.deepEqual(
    layers.map((layer) => layer.data.pdfAppearanceLayerKind),
    ['fill', 'stroke'],
  );
  assert.deepEqual(
    layers.map((layer) => layer.fill),
    ['rgba(255, 0, 0, 1)', 'rgba(0, 0, 255, 1)'],
  );
  assertBoundsClose(coordinateBounds(worldPolygons(layers[0])), {
    minX: 10,
    minY: 170,
    maxX: 30,
    maxY: 190,
  }, 0.02);
  const strokeBounds = coordinateBounds(worldPolygons(layers[1]));
  assert.ok(strokeBounds.minX < 10 && strokeBounds.maxX > 30);
  assert.ok(strokeBounds.minY < 170 && strokeBounds.maxY > 190);
});

test('materialized nonzero fill keeps overlapping same-winding subpaths solid', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 0,
    content: `
      1 0 0 rg
      0 0 20 20 re
      10 0 20 20 re
      f
      0 0 1 RG
      2 w
      0 30 m
      30 30 l
      S
    `,
  });
  const layers = (await importRawPdf(bytes)).annotationsByPage[1].objects;
  const fillLayer = layers.find(
    (layer) => layer.data.pdfAppearanceLayerKind === 'fill',
  );

  assert.ok(fillLayer);
  assert.equal(fillLayer.fillRule, 'nonzero');
  assert.equal(
    pointInPolygonSet([15, 190], worldPolygons(fillLayer)),
    true,
    'the same-winding overlap must remain painted',
  );
});

test('an authoritative stroked AP is never reclassified as a filled outline', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 0,
    content: `
      0 0 0 RG
      4 w
      5 5 m
      35 5 l
      35 35 l
      5 35 l
      5 5.5 l
      S
    `,
  });
  const ink = (await importRawPdf(bytes)).annotationsByPage[1].objects[0];

  assert.equal(ink.strokeWidth, 4);
  assert.equal(ink.fill, null);
  assert.equal(ink.paperInkGeometry, undefined);
  assert.equal(ink.data.pdfInkRenderMode, undefined);
});

test('explicit PDF zero-width stroke stays a hairline through edit, export, and reimport', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 0,
    content: `
      0 0 0 RG
      0 w
      5 20 m
      35 20 l
      S
    `,
  });
  const original = (await importRawPdf(bytes)).annotationsByPage[1].objects[0];
  assert.equal(original.strokeWidth, 0);
  assert.equal(original.pdfStrokeHairline, true);
  assert.equal(original.data.pdfStrokeHairline, true);

  const moved = structuredClone(original);
  moved.left += 1;
  const markedPage = markEditedImportedPdfAnnotationsOnPage(
    { objects: [moved] },
    { objects: [original] },
    { source: 'object-modified', userId: 'fidelity-user', pageNumber: 1 },
  );
  assert.equal(markedPage.objects[0].pdfImportedEditState, 'edited');

  const exportedBytes = await saveExistingPdfWithObjects(bytes, markedPage.objects);
  const exportedPdf = await PDFDocument.load(exportedBytes);
  const annots = exportedPdf.getPage(0).node.lookup(PDFName.of('Annots'));
  const exportedDict = exportedPdf.context.lookup(annots.asArray()[0]);
  const border = exportedDict.lookup(PDFName.of('Border'));
  assert.equal(border.asArray()[2].asNumber(), 0);
  const appearance = exportedDict.lookup(PDFName.of('AP'));
  const normal = appearance.lookup(PDFName.of('N'));
  const appearanceContent = new TextDecoder().decode(
    decodePDFRawStream(normal).decode(),
  );
  assert.match(appearanceContent, /(?:^|\n)0 w(?:\n|$)/);

  const reimported = (await importRawPdf(exportedBytes)).annotationsByPage[1].objects[0];
  assert.equal(reimported.strokeWidth, 0);
  assert.equal(reimported.pdfStrokeHairline, true);
  assert.equal(reimported.data.pdfStrokeHairline, true);
  assert.equal(
    reimported.data.pdfInkSourceGeometry.appearanceStrokeWidth,
    0,
  );
});

test('stroked AP uses PDF default width, butt cap, and miter join when omitted', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 100, 100],
    bbox: [0, 0, 100, 100],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 0,
    content: `
      0 0 0 RG
      10 50 m
      90 50 l
      S
    `,
  });
  const ink = (await importRawPdf(bytes)).annotationsByPage[1].objects[0];

  assert.equal(ink.strokeWidth, 1);
  assert.equal(ink.strokeLineCap, 'butt');
  assert.equal(ink.strokeLineJoin, 'miter');
  assert.equal(
    ink.data.pdfInkSourceGeometry.appearancePaintOperations[0].strokeWidth,
    1,
  );
});

test('appearance companions keep stable unique ids/grouping and every layer receives an erase bite', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 4,
    content: `
      1 0 0 rg
      0 0 1 RG
      4 w
      10 10 20 20 re
      B
    `,
  });
  const first = (await importRawPdf(bytes)).annotationsByPage[1].objects;
  const second = (await importRawPdf(bytes)).annotationsByPage[1].objects;

  assert.equal(first.length, 2);
  assert.equal(new Set(first.map((layer) => layer.id)).size, 2);
  assert.equal(new Set(first.map((layer) => layer.data.id)).size, 2);
  assert.equal(new Set(first.map((layer) => layer.data.groupId)).size, 1);
  assert.equal(new Set(first.map((layer) => layer.pdfAnnotationId)).size, 1);
  assert.deepEqual(
    first.map((layer) => layer.id),
    second.map((layer) => layer.id),
    'the same PDF must import with stable object/history ids',
  );

  const bitePoint = [10, 180];
  const partial = erasePageAnnotations({
    pageAnnotations: { objects: first },
    eraserPoints: [{ x: bitePoint[0], y: bitePoint[1] }],
    eraserRadius: 3,
    mode: 'partial',
  });
  assert.equal(partial.didChange, true);
  const groupId = first[0].data.groupId;
  const survivors = partial.pageAnnotations.objects.filter(
    (object) => object?.data?.groupId === groupId,
  );
  assert.ok(survivors.length >= 2);
  assert.ok(
    survivors.every((object) => !pointInPolygonSet(bitePoint, worldPolygons(object))),
    'one partial-erase gesture must carve every overlapping paint companion',
  );

  const full = erasePageAnnotations({
    pageAnnotations: { objects: first },
    eraserPoints: [{ x: bitePoint[0], y: bitePoint[1] }],
    eraserRadius: 3,
    mode: 'full',
  });
  assert.equal(full.didChange, true);
  assert.equal(
    full.pageAnnotations.objects.some((object) => object?.data?.groupId === groupId),
    false,
    'full erase must remove the complete grouped PDF appearance',
  );

  const reloaded = await importRawPdf(await saveExistingPdfWithObjects(bytes, first));
  const roundTripped = reloaded.annotationsByPage[1].objects;
  assert.deepEqual(
    roundTripped.map((layer) => ({
      id: layer.id,
      groupId: layer.data.groupId,
      kind: layer.data.pdfAppearanceLayerKind,
    })),
    first.map((layer) => ({
      id: layer.id,
      groupId: layer.data.groupId,
      kind: layer.data.pdfAppearanceLayerKind,
    })),
  );
});

test('stroke-fringe-only bite exports every companion and reimports the untouched fill plus bitten stroke', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 4,
    content: `
      1 0 0 rg
      0 0 1 RG
      4 w
      10 10 20 20 re
      B
    `,
  });
  const originalObjects = (await importRawPdf(bytes)).annotationsByPage[1].objects;
  const fillBefore = worldPolygons(originalObjects[0]);
  const fringePoint = [8.5, 180];
  assert.equal(pointInPolygonSet(fringePoint, fillBefore), false);
  assert.equal(pointInPolygonSet(fringePoint, worldPolygons(originalObjects[1])), true);

  const bite = erasePageAnnotations({
    pageAnnotations: { objects: originalObjects },
    eraserPoints: [
      { x: fringePoint[0], y: 175 },
      { x: fringePoint[0], y: 185 },
    ],
    eraserRadius: 1.2,
    mode: 'partial',
  });
  assert.equal(bite.didChange, true);
  assert.deepEqual(
    worldPolygons(bite.pageAnnotations.objects[0]),
    fillBefore,
    'the fringe bite must not alter the interior fill companion',
  );
  const bittenStroke = worldPolygons(bite.pageAnnotations.objects[1]);
  assert.notDeepEqual(bittenStroke, worldPolygons(originalObjects[1]));
  const markedPage = markEditedImportedPdfAnnotationsOnPage(
    bite.pageAnnotations,
    { objects: originalObjects },
    { source: 'eraser-partial', userId: 'fidelity-user', pageNumber: 1 },
  );
  assert.ok(markedPage.objects.every(
    (object) => object.pdfImportedEditState === 'edited'
      && object.data.pdfImportedEditState === 'edited',
  ));

  const exportedBytes = await saveExistingPdfWithObjects(bytes, markedPage.objects);
  const reimported = (await importRawPdf(exportedBytes)).annotationsByPage[1].objects;
  assert.equal(reimported.length, 2);
  assert.equal(new Set(reimported.map((object) => object.data.groupId)).size, 1);
  assert.equal(new Set(reimported.map(
    (object) => object.data.pdfAppearanceCompositeId,
  )).size, 1);
  const fillAfter = reimported.find(
    (object) => object.data.pdfAppearanceLayerKind === 'fill',
  );
  const strokeAfter = reimported.find(
    (object) => object.data.pdfAppearanceLayerKind === 'stroke',
  );
  assert.ok(fillAfter && strokeAfter);
  assert.deepEqual(worldPolygons(fillAfter), fillBefore);
  assert.deepEqual(worldPolygons(strokeAfter), bittenStroke);
  assert.ok(
    strokeAfter.data.pdfInkSourceGeometry.appearancePaintOperations.every(
      (operation) => (
        typeof operation.clipActive === 'boolean'
        && Array.isArray(operation.clipPolygons)
        && Number.isFinite(operation.strokeAlpha)
        && Number.isFinite(operation.fillAlpha)
      ),
    ),
  );
});

test('a failed edited appearance companion preserves the native original atomically', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 4,
    content: `
      1 0 0 rg
      0 0 1 RG
      4 w
      10 10 20 20 re
      B
    `,
  });
  const originalObjects = (await importRawPdf(bytes)).annotationsByPage[1].objects;
  const invalidObjects = structuredClone(originalObjects);
  invalidObjects[1].path = [];
  invalidObjects[1].polygons = [];
  const markedPage = markEditedImportedPdfAnnotationsOnPage(
    { objects: invalidObjects },
    { objects: originalObjects },
    { source: 'eraser-partial', userId: 'fidelity-user', pageNumber: 1 },
  );
  assert.ok(markedPage.objects.every(
    (object) => object.pdfImportedEditState === 'edited',
  ));

  const exportedBytes = await saveExistingPdfWithObjects(bytes, markedPage.objects);
  const reimported = (await importRawPdf(exportedBytes)).annotationsByPage[1].objects;

  assert.equal(reimported.length, 2);
  assert.deepEqual(
    reimported.map(worldPolygons),
    originalObjects.map(worldPolygons),
    'one failed companion must preserve the complete native annotation',
  );
});

test('separately painted strokes keep their own widths and exact nonconformal CTMs', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 100, 100],
    bbox: [0, 0, 100, 100],
    matrix: [1, 0, 0, 1, 0, 0],
    color: [0, 0, 0],
    borderWidth: 1,
    content: `
      q
      1 0 0 RG
      2 w
      1 J
      2 0.5 1 3 20 10 cm
      0 0 m
      20 0 l
      S
      Q
      q
      0 0 1 RG
      6 w
      1 J
      10 20 m
      30 20 l
      S
      Q
    `,
  });
  const imported = await importRawPdf(bytes);
  const layers = imported.annotationsByPage[1].objects;

  assert.equal(layers.length, 2);
  assert.deepEqual(
    layers.map((layer) => layer.fill),
    ['rgba(255, 0, 0, 1)', 'rgba(0, 0, 255, 1)'],
  );
  assertBoundsClose(coordinateBounds(worldPolygons(layers[0])), {
    minX: 20 - Math.sqrt(5),
    minY: PAGE_HEIGHT - (20 + Math.sqrt(9.25)),
    maxX: 60 + Math.sqrt(5),
    maxY: PAGE_HEIGHT - (10 - Math.sqrt(9.25)),
  }, 0.08);
  assertBoundsClose(coordinateBounds(worldPolygons(layers[1])), {
    minX: 7,
    minY: 177,
    maxX: 33,
    maxY: 183,
  }, 0.04);
});

test('AP dash arrays and ExtGState paint are preserved as real gaps and alpha', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 60, 40],
    bbox: [0, 0, 60, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 1,
    appearanceResources: {
      ExtGState: {
        GS0: {
          Type: 'ExtGState',
          LW: 6,
          LC: 1,
          LJ: 1,
          D: [[6, 8], 0],
          CA: 0.5,
        },
      },
    },
    content: `
      1 0 0 RG
      /GS0 gs
      10 20 m
      50 20 l
      S
    `,
  });
  const ink = (await importRawPdf(bytes)).annotationsByPage[1].objects[0];
  const polygons = worldPolygons(ink);

  assert.equal(ink.fill, 'rgba(255, 0, 0, 0.5)');
  assert.equal(pointInPolygonSet([12, 180], polygons), true);
  assert.equal(pointInPolygonSet([20, 180], polygons), false);
  assert.equal(pointInPolygonSet([25, 180], polygons), true);
});

test('simple one-op AP stroke and fill preserve ExtGState alpha without materialization', async () => {
  const resources = {
    ExtGState: {
      GS0: {
        Type: 'ExtGState',
        CA: 0.5,
        ca: 0.4,
      },
    },
  };
  const strokeBytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    appearanceResources: resources,
    content: `
      1 0 0 RG
      4 w
      /GS0 gs
      10 20 m
      30 20 l
      S
    `,
  });
  const stroke = (await importRawPdf(strokeBytes)).annotationsByPage[1].objects[0];
  assert.equal(stroke.stroke, 'rgba(255, 0, 0, 0.5)');
  assert.equal(stroke.fill, null);

  const fillBytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    appearanceResources: resources,
    content: `
      0 0 1 rg
      /GS0 gs
      10 10 20 20 re
      f
    `,
  });
  const fill = (await importRawPdf(fillBytes)).annotationsByPage[1].objects[0];
  assert.equal(fill.fill, 'rgba(0, 0, 255, 0.4)');
});

test('active clipping path and Form BBox both clip painted AP geometry', async () => {
  const explicitClipBytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    color: [1, 0, 0],
    borderWidth: 0,
    content: `
      0 0 20 40 re
      W
      n
      1 0 0 rg
      0 0 40 40 re
      f
    `,
  });
  const explicitClip = (await importRawPdf(explicitClipBytes)).annotationsByPage[1].objects[0];
  assertBoundsClose(coordinateBounds(worldPolygons(explicitClip)), {
    minX: 0,
    minY: 160,
    maxX: 20,
    maxY: 200,
  }, 0.02);

  const bboxClipBytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    color: [1, 0, 0],
    borderWidth: 0,
    content: `
      1 0 0 rg
      -10 -10 60 60 re
      f
    `,
  });
  const bboxClip = (await importRawPdf(bboxClipBytes)).annotationsByPage[1].objects[0];
  assertBoundsClose(coordinateBounds(worldPolygons(bboxClip)), {
    minX: 0,
    minY: 160,
    maxX: 40,
    maxY: 200,
  }, 0.02);
});

test('a fully clipped AP paint stays invisible instead of falling back to InkList', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 40, 40],
    bbox: [0, 0, 40, 40],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 4,
    content: `
      100 100 10 10 re
      W
      n
      1 0 0 rg
      0 0 40 40 re
      f
    `,
  });
  const imported = await importRawPdf(bytes);

  assert.deepEqual(
    imported.annotationsByPage[1]?.objects || [],
    [],
    'the disjoint active clip is authoritative zero-paint geometry',
  );
});

test('microscopic AP clipping materializes the clipped half instead of the live full path', async () => {
  const size = 1e-5;
  const bytes = await createRawInkPdf({
    rect: [0, 0, size, size],
    bbox: [0, 0, size, size],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 0,
    content: `
      0 0 .000005 .00001 re
      W
      n
      1 0 0 rg
      0 0 .00001 .00001 re
      f
    `,
  });
  const ink = (await importRawPdf(bytes)).annotationsByPage[1].objects[0];
  assertBoundsClose(coordinateBounds(worldPolygons(ink)), {
    minX: 0,
    minY: PAGE_HEIGHT - size,
    maxX: size / 2,
    maxY: PAGE_HEIGHT,
  }, 1e-10);
  const sourceOperation = ink.data.pdfInkSourceGeometry.appearancePaintOperations[0];
  assert.equal(sourceOperation.clipActive, true);
  assert.equal(sourceOperation.hasExplicitClip, true);
  assert.ok(sourceOperation.clipPolygons.length > 0);
});

test('microscopic anisotropic AP CTM keeps transformed stroke thickness', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 20, 20],
    bbox: [0, 0, 20, 20],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: 1,
    content: `
      0 0 0 RG
      1 w
      .0000001 0 0 .0000002 10 10 cm
      0 0 m
      1 0 l
      S
    `,
  });
  const ink = (await importRawPdf(bytes)).annotationsByPage[1].objects[0];
  const bounds = coordinateBounds(worldPolygons(ink));
  assert.ok(
    Math.abs((bounds.maxY - bounds.minY) - 2e-7) <= 2e-10,
    `expected 2e-7 transformed thickness, received ${bounds.maxY - bounds.minY}`,
  );
  assert.equal(ink.strokeWidth, 0);
});

test('huge-width near-anisotropic AP CTM materializes its exact transformed boundary', async () => {
  const width = 1_000_000_000;
  const verticalScale = 1 + 5e-9;
  const bytes = await createRawInkPdf({
    rect: [-width, -width, width, width],
    bbox: [-width, -width, width, width],
    matrix: [1, 0, 0, 1, 0, 0],
    borderWidth: width,
    content: `
      0 0 0 RG
      ${width} w
      1 0 0 ${verticalScale} 0 0 cm
      0 0 m
      1 0 l
      S
    `,
  });
  const ink = (await importRawPdf(bytes)).annotationsByPage[1].objects[0];
  const bounds = coordinateBounds(worldPolygons(ink));
  const expectedThickness = width * verticalScale;

  assert.equal(
    ink.strokeWidth,
    0,
    'even a five-parts-per-billion anisotropy must not remain a scalar live stroke',
  );
  assert.ok(
    Math.abs((bounds.maxY - bounds.minY) - expectedThickness) <= 1e-5,
    `expected ${expectedThickness} transformed thickness, received ${bounds.maxY - bounds.minY}`,
  );
});

test('curved AP clipping stays subpixel under an extreme nonuniform Form transform', async () => {
  const verticalScale = 100_000;
  const pageHeight = verticalScale * 2 + 20;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([30, pageHeight]);
  const appearance = pdf.context.flateStream(`
    0 0 m
    0 1 1 1 1 0 c
    1 -1 l
    0 -1 l
    h
    W
    n
    1 0 0 rg
    -1 -1 3 2 re
    f
  `, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, -1, 1, 1],
    Matrix: [1, 0, 0, verticalScale, 0, verticalScale],
    Resources: {},
  });
  const appearanceRef = pdf.context.register(appearance);
  const annotationRef = pdf.context.register(pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Ink',
    Rect: [10, 5, 11, verticalScale * 2 + 5],
    InkList: [[10, 5, 11, verticalScale * 2 + 5]],
    C: [1, 0, 0],
    Border: [0, 0, 0],
    AP: { N: appearanceRef },
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([annotationRef]));

  const ink = (await importRawPdf(await pdf.save())).annotationsByPage[1].objects[0];
  const polygons = worldPolygons(ink);
  let maxError = 0;
  for (let index = 0; index <= 100; index += 1) {
    const t = index / 100;
    const localX = 3 * (1 - t) * t * t + t * t * t;
    const localY = 3 * (1 - t) * t;
    const worldPoint = [
      10 + localX,
      pageHeight - (5 + verticalScale + localY * verticalScale),
    ];
    maxError = Math.max(
      maxError,
      distanceToPolygonBoundary(worldPoint, polygons),
    );
  }
  assert.ok(maxError <= 0.06, `expected <= 0.06px curve error, received ${maxError}`);
});

test('Form XObject Do resolves nested resources, BBox, and Matrix', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const child = pdf.context.flateStream('0 0 1 rg\n0 0 20 20 re\nf\n', {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, 20, 20],
    Matrix: [2, 0, 0, 2, 5, 5],
    Resources: {},
  });
  const childRef = pdf.context.register(child);
  const parent = pdf.context.flateStream('/Fm0 Do\n', {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, 50, 50],
    Resources: {
      XObject: {
        Fm0: childRef,
      },
    },
  });
  const parentRef = pdf.context.register(parent);
  const annotationRef = pdf.context.register(pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Ink',
    Rect: [10, 20, 110, 120],
    InkList: [[10, 20, 110, 120]],
    C: [1, 0, 0],
    Border: [0, 0, 0],
    AP: { N: parentRef },
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([annotationRef]));

  const imported = await importRawPdf(await pdf.save());
  const ink = imported.annotationsByPage[1].objects[0];
  assert.equal(ink.fill, 'rgba(0, 0, 255, 1)');
  assertBoundsClose(coordinateBounds(worldPolygons(ink)), {
    minX: 20,
    minY: 90,
    maxX: 100,
    maxY: 170,
  }, 0.02);
});

test('Form XObject Do supports more than eight nested Forms without recursion loss', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let child = pdf.context.flateStream('0 0 1 rg\n0 0 1 1 re\nf\n', {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, 20, 20],
    Resources: {},
  });
  let childRef = pdf.context.register(child);
  for (let depth = 0; depth < 9; depth += 1) {
    child = pdf.context.flateStream('/F Do\n', {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [0, 0, 20, 20],
      Matrix: [1, 0, 0, 1, 1, 0],
      Resources: { XObject: { F: childRef } },
    });
    childRef = pdf.context.register(child);
  }
  const root = pdf.context.flateStream('/F Do\n', {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, 20, 20],
    Resources: { XObject: { F: childRef } },
  });
  const rootRef = pdf.context.register(root);
  const annotationRef = pdf.context.register(pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Ink',
    Rect: [0, 0, 20, 20],
    InkList: [[0, 0, 20, 20]],
    C: [1, 0, 0],
    Border: [0, 0, 0],
    AP: { N: rootRef },
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([annotationRef]));

  const ink = (await importRawPdf(await pdf.save())).annotationsByPage[1].objects[0];
  assert.equal(ink.fill, 'rgba(0, 0, 255, 1)');
  assertBoundsClose(coordinateBounds(worldPolygons(ink)), {
    minX: 9,
    minY: 199,
    maxX: 10,
    maxY: 200,
  }, 0.02);
});

test('h resets the AP current point to the subpath start for a following v curve', async () => {
  const bytes = await createRawInkPdf({
    rect: [0, 0, 50, 50],
    bbox: [0, 0, 50, 50],
    matrix: [1, 0, 0, 1, 0, 0],
    color: [0, 0, 0],
    borderWidth: 2,
    content: `
      0 0 0 RG
      2 w
      10 10 m
      20 10 l
      20 20 l
      h
      30 30 40 30 v
      S
    `,
  });
  const imported = await importRawPdf(bytes);
  const sourcePath = imported.annotationsByPage[1].objects[0]
    .data.pdfInkSourceGeometry.appearancePath;
  assert.deepEqual(sourcePath.at(-1), ['C', 10, 10, 30, 30, 40, 30]);
});

test('closed InkList-only input stays exact M/L without inferred smoothing', () => {
  const annotation = {
    id: 'closed-ink-list-exact',
    subtype: 'Ink',
    inkLists: [[10, 10, 30, 10, 30, 30, 10, 30, 10, 10]],
    color: [1, 0, 0],
    borderWidth: 0,
    rect: [10, 10, 30, 30],
  };
  const viewport = {
    height: PAGE_HEIGHT,
    convertToViewportPoint: (x, y) => [x, PAGE_HEIGHT - y],
  };
  const imported = convertInkToFabricPath(annotation, viewport, 1);

  assert.deepEqual(
    imported.path.map((command) => command[0]),
    ['M', 'L', 'L', 'L', 'L'],
  );
  assert.deepEqual(worldPath(imported), [
    ['M', 10, 190],
    ['L', 30, 190],
    ['L', 30, 170],
    ['L', 10, 170],
    ['L', 10, 190],
  ]);
});
