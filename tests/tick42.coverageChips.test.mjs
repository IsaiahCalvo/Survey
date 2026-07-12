/**
 * Tick-42 coverage chips: pdfLib multi-subpath ink + highlight exportType +
 * missing PDF page, importer subtype/inkList edges, undo key-set shallowEqual,
 * regionMath point-in-set + bad-coord bounds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  convertPdfAnnotationToFabric,
  convertInkToFabricPath,
  importAnnotationsFromPdf,
  categorizeAnnotations,
  pdfHasAnnotations,
} from '../src/utils/pdfAnnotationImporter.js';
import {
  createUndoManager,
  userUndo,
} from '../src/lib/collab/crdtUndoManager.js';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';
import {
  isPointInsideRegionSet,
  mergeRegions,
  mergeOverlappingRegions,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';

function makeViewport(pageHeight = 800) {
  return {
    height: pageHeight,
    convertToViewportPoint: (x, y) => [x, pageHeight - y],
    convertToViewportRectangle: (r) => [r[0], pageHeight - r[3], r[2], pageHeight - r[1]],
  };
}

function asPdfFile(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
  };
}

test('savePDF multi-M ink, highlight exportType, missing page, edited import, flatten', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const bytes = await source.save();
  const pdfFile = asPdfFile(bytes);
  const pageSizes = { 1: { width: 612, height: 792 }, 2: { width: 612, height: 792 } };

  const out = await savePDFWithAnnotationsPdfLib(
    pdfFile,
    {
      1: {
        objects: [
          {
            type: 'path',
            stroke: '#112233',
            path: [
              ['M', 0, 0], ['L', 10, 0],
              ['M', 20, 5], ['L', 30, 5],
              ['Z'],
            ],
            data: { id: 'multi-m' },
          },
          {
            type: 'path',
            path: [['Z'], ['unknown', 1]],
            data: { id: 'no-points' },
          },
          {
            type: 'rect',
            exportType: 'survey-marker',
            left: 40,
            top: 40,
            width: 30,
            height: 12,
            fill: '#ffff00',
            opacity: 0.35,
            data: { id: 'hl-export' },
          },
          {
            type: 'rect',
            left: 5,
            top: 5,
            width: 20,
            height: 15,
            fill: 'transparent',
            stroke: '#000000',
            data: { id: 'sq-trans' },
          },
          {
            type: 'path',
            isPdfImported: true,
            pdfAnnotationId: 'missing-native',
            pdfImportedEditState: 'edited',
            path: [['M', 1, 1], ['L', 8, 1]],
            stroke: '#00aa00',
            data: { id: 'edited-miss' },
          },
        ],
      },
      2: {
        objects: [
          { type: 'rect', left: 0, top: 0, width: 10, height: 10, data: { id: 'page2-missing' } },
        ],
      },
    },
    pageSizes,
    null,
    { returnBytes: true, documentId: 'doc-tick42' },
  );
  assert.ok(out);

  const flat = await savePDFWithFlattenedRegularAnnotationsForPrint(
    pdfFile,
    {
      1: {
        objects: [
          { type: 'path', path: [['M', 0, 0], ['L', 20, 0]], stroke: '#000', data: { id: 'flat-ink' } },
          { type: 'textbox', left: 10, top: 10, width: 60, height: 20, text: 'print', fill: '#000', data: { id: 'flat-txt' } },
          { type: 'rect', left: 50, top: 50, width: 20, height: 10, fill: '#ccc', data: { id: 'flat-sq' } },
        ],
      },
    },
    pageSizes,
    { documentId: 'doc-print42', callouts: [] },
  );
  assert.ok(flat);
});

test('importer inkList formats + markup subtypes + round-trip raw bytes', async () => {
  const viewport = makeViewport(200);

  const ink = convertInkToFabricPath({
    subtype: 'Ink',
    color: [0, 0, 1],
    borderStyle: { width: 2 },
    inkLists: [
      [[0, 0], [10, 0], [10, 10]],
      [{ x: 20, y: 20 }, { x: 30, y: 20 }],
      [40, 40, 50, 40, 50, 50],
      [1], // too short — skip
      null,
    ],
  }, viewport);
  assert.ok(ink?.path?.length);

  const subtypes = [
    { subtype: 'Text', rect: [0, 0, 20, 20], contents: 'note', color: [1, 0.9, 0.2] },
    { subtype: 'Underline', rect: [0, 10, 40, 20], color: [1, 0, 0] },
    { subtype: 'StrikeOut', rect: [0, 10, 40, 20], color: [0, 0, 1] },
    { subtype: 'Squiggly', rect: [0, 10, 50, 22], color: [0, 1, 0] },
    { subtype: 'Caret', rect: [5, 5, 15, 25], color: [0, 0, 0] },
    { subtype: 'PolyLine', rect: [0, 0, 40, 40], vertices: [0, 0, 20, 10, 40, 0], color: [0, 0, 0] },
    { subtype: 'Polygon', rect: [0, 0, 30, 30], vertices: [0, 0, 30, 0, 15, 30], color: [0.5, 0.5, 0.5] },
    {
      subtype: 'Square',
      rect: [0, 0, 40, 20],
      title: 'AutoCAD SHX Text',
      contents: 'SHX',
      borderStyle: { width: 1 },
      color: [0, 0, 0],
    },
    {
      subtype: 'FreeText',
      rect: [0, 0, 80, 30],
      contents: 'rc',
      defaultAppearanceString: '0 0 0 rg /Helv 12 Tf',
      defaultStyleString: 'font: Helvetica 12pt; color: #00ff00',
      color: [1, 0, 0],
    },
  ];
  for (const ann of subtypes) {
    const obj = convertPdfAnnotationToFabric(ann, viewport);
    assert.ok(obj, `expected fabric for ${ann.subtype}`);
  }

  const cats = categorizeAnnotations([
    { subtype: 'Ink' },
    { subtype: 'Link' },
    { subtype: 'Popup' },
    { subtype: 'Widget' },
    { subtype: 'Movie' },
  ]);
  assert.equal(cats.unsupported.some((a) => a.subtype === 'Movie'), true);
  assert.equal(cats.unsupported.some((a) => a.subtype === 'Link'), false);

  // Round-trip: export annotated PDF → pdf.js import with raw bytes (dict readers)
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const blank = await source.save();
  const exported = await savePDFWithAnnotationsPdfLib(
    asPdfFile(blank),
    {
      1: {
        objects: [
          {
            type: 'path',
            path: [['M', 10, 10], ['L', 80, 10], ['L', 80, 40]],
            stroke: '#224466',
            data: { id: 'rt-ink' },
          },
          {
            type: 'rect',
            left: 100,
            top: 100,
            width: 40,
            height: 25,
            stroke: '#000',
            fill: '#ffeeee',
            data: { id: 'rt-sq' },
          },
        ],
      },
    },
    { 1: { width: 612, height: 792 } },
    null,
    { returnBytes: true, documentId: 'doc-rt42' },
  );
  const exportedBytes = exported?.pdfBytes || exported;
  const u8 = exportedBytes instanceof Uint8Array
    ? exportedBytes.slice()
    : new Uint8Array(exportedBytes);

  assert.equal(await pdfHasAnnotations({
    numPages: 1,
    getPage: async () => ({
      getAnnotations: async () => [{ subtype: 'Ink' }],
    }),
  }), true);

  const pdfJsDoc = await pdfjsLib.getDocument({ data: u8.slice(), useSystemFonts: true }).promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfJsDoc, { rawPdfBytes: u8.slice() });
    assert.ok(imported?.annotationsByPage);
  } finally {
    await pdfJsDoc.destroy?.();
  }
});

test('undo shallowEqual object key-set mismatch', () => {
  const ydoc = new Y.Doc();
  const ctx = { userId: 'u42', deviceId: 'd1', sessionId: 's42', clientID: ydoc.clientID };
  const { undoManager, origin, dispose } = createUndoManager({ ydoc, ...ctx, captureTimeout: 0 });
  const yMap = ydoc.getMap('annotations');

  applyFabricCommit(
    ydoc,
    yMap,
    { type: 'rect', left: 0, top: 0, width: 4, height: 4, data: { id: 'keys' }, pageNumber: 1 },
    origin,
    ctx,
  );

  // More keys than fabric map → aKeys.length !== bKeys.length branch
  ydoc.getMap('__annotationLatestFabric').set('keys', {
    type: 'rect',
    left: 0,
    top: 0,
    width: 4,
    height: 4,
    extraA: 1,
    extraB: 2,
  });
  // Also seed a key where fabric has array and latest has non-array
  ydoc.getMap('__annotationLatestFabric').set('keys', {
    type: 'rect',
    left: 1,
    top: 0,
    width: 4,
    height: 4,
    path: 'not-an-array',
  });

  userUndo(ydoc, undoManager, ctx);
  dispose();
  ydoc.destroy();
});

test('regionMath point-in-set subtract + non-numeric coords', () => {
  const add = {
    regionId: 'a',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 20, 0, 20, 20, 0, 20],
  };
  const sub = {
    ...add,
    regionId: 's',
    operation: REGION_OPERATIONS.SUBTRACT,
    coordinates: [5, 5, 15, 5, 15, 15, 5, 15],
  };
  assert.equal(isPointInsideRegionSet(10, 10, [null, add, sub]), false);
  assert.equal(isPointInsideRegionSet(2, 2, [null, add, sub]), true);

  const junk = {
    ...add,
    regionId: 'j',
    coordinates: ['x', 'y', 'z', 'w', 'a', 'b'],
  };
  assert.equal(mergeRegions(add, junk), null);
  assert.ok(Array.isArray(mergeOverlappingRegions([add, junk])));
});
