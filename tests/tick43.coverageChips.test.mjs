/**
 * Tick-43 coverage chips: cloudy polygon / short poly fail, flatten group+shapes,
 * callout-styled export, importer ArrayBuffer/DataView raw bytes, region merge success.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  convertPdfAnnotationToFabric,
  importAnnotationsFromPdf,
} from '../src/utils/pdfAnnotationImporter.js';
import {
  mergeRegions,
  subtractRegionFromRegion,
  simplifyPolygon,
  rotateCoordsAroundPoint,
  getRegionRotation,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';

function asPdfFile(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
  };
}

function makeViewport(h = 800) {
  return {
    height: h,
    convertToViewportPoint: (x, y) => [x, h - y],
    convertToViewportRectangle: (r) => [r[0], h - r[3], r[2], h - r[1]],
  };
}

test('savePDF cloudy polygon, short poly fails, styled callout, remove by object id', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const blank = await source.save();
  const pageSizes = { 1: { width: 612, height: 792 } };

  // First pass: create a native square so later edited-import can target an object number
  const seeded = await savePDFWithAnnotationsPdfLib(
    asPdfFile(blank),
    {
      1: {
        objects: [
          {
            type: 'rect',
            left: 200,
            top: 200,
            width: 40,
            height: 30,
            stroke: '#000',
            fill: '#eee',
            data: { id: 'seed-sq' },
          },
        ],
      },
    },
    pageSizes,
    null,
    { returnBytes: true, documentId: 'doc-seed43' },
  );
  const seededBytes = seeded?.pdfBytes || seeded;
  const seededU8 = seededBytes instanceof Uint8Array ? seededBytes : new Uint8Array(seededBytes);

  // Discover an annotation object number from the seeded PDF
  const seededDoc = await PDFDocument.load(seededU8);
  const page = seededDoc.getPage(0);
  const annots = page.node.lookup(seededDoc.context.obj([]).constructor /* noop */) || page.node.get?.(
    // fallback below
  );
  // Use pdf-lib Annots array directly
  const { PDFName } = await import('pdf-lib');
  const annotsRef = page.node.lookup(PDFName.of('Annots'));
  let pdfAnnotationId = '999R';
  if (annotsRef && typeof annotsRef.asArray === 'function') {
    const refs = annotsRef.asArray();
    if (refs[0] && typeof refs[0].objectNumber === 'number') {
      pdfAnnotationId = `${refs[0].objectNumber}R`;
    } else if (refs[0]?.tagNumber) {
      pdfAnnotationId = `${refs[0].tagNumber}R`;
    } else {
      // pdf-lib PDFRef has .objectNumber
      const ref = refs[0];
      const num = ref?.objectNumber ?? Number(String(ref).match(/(\d+)/)?.[1]);
      if (num) pdfAnnotationId = `${num}R`;
    }
  }

  const out = await savePDFWithAnnotationsPdfLib(
    asPdfFile(seededU8),
    {
      1: {
        objects: [
          {
            type: 'polygon',
            left: 0,
            top: 0,
            points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 25 }],
            stroke: '#333',
            fill: '#abcdef',
            cloudBorder: true,
            cloudIntensity: 3,
            data: { id: 'cloud-poly' },
          },
          {
            type: 'polygon',
            points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
            data: { id: 'poly-short' },
          },
          {
            type: 'polyline',
            points: [{ x: 0, y: 0 }],
            data: { id: 'pline-short' },
          },
          {
            type: 'polyline',
            left: 50,
            top: 50,
            points: [{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 0 }],
            stroke: '#555',
            data: { id: 'pline-ok' },
          },
          {
            type: 'path',
            isPdfImported: true,
            pdfAnnotationId,
            pdfImportedEditState: 'edited',
            path: [['M', 210, 210], ['L', 230, 210]],
            stroke: '#0a0',
            data: { id: 'edited-hit' },
          },
        ],
      },
    },
    pageSizes,
    null,
    {
      returnBytes: true,
      documentId: 'doc-tick43',
      callouts: [{
        id: 'c-style',
        pageNumber: 1,
        text: 'styled',
        arrowTip: { x: 0.1, y: 0.2 },
        knee: { x: 0.15, y: 0.25 },
        textBoxPosition: { x: 0.2, y: 0.3, width: 0.15, height: 0.04 },
        style: {
          borderColor: '#ff0000',
          lineColor: '#00ff00',
          lineThickness: 3,
          fontColor: '#0000ff',
          fontSize: 16,
        },
      }],
    },
  );
  assert.ok(out);
});

test('flatten print covers group, circle, line, poly, counter, callout', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const blank = await source.save();
  const pageSizes = { 1: { width: 612, height: 792 } };

  const flat = await savePDFWithFlattenedRegularAnnotationsForPrint(
    asPdfFile(blank),
    {
      1: {
        objects: [
          {
            type: 'group',
            left: 10,
            top: 10,
            objects: [
              { type: 'rect', left: 0, top: 0, width: 20, height: 10, fill: '#ccc', stroke: '#000' },
              { type: 'line', x1: 0, y1: 0, x2: 20, y2: 10, stroke: '#111' },
            ],
          },
          {
            type: 'circle',
            left: 80,
            top: 80,
            radius: 12,
            fill: '#faa',
            stroke: '#000',
            data: { id: 'circ' },
          },
          {
            type: 'ellipse',
            left: 120,
            top: 80,
            rx: 16,
            ry: 10,
            fill: '#afa',
            stroke: '#000',
            data: { id: 'ell' },
          },
          {
            type: 'circle',
            left: 160,
            top: 80,
            radius: 10,
            fill: '#aaf',
            data: { id: 'ctr', type: 'counter', displayNumber: 7 },
          },
          {
            type: 'polygon',
            left: 0,
            top: 200,
            points: [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 12, y: 20 }],
            stroke: '#222',
            fill: '#ddd',
            data: { id: 'fpoly' },
          },
          {
            type: 'polyline',
            left: 50,
            top: 200,
            points: [{ x: 0, y: 0 }, { x: 30, y: 5 }, { x: 40, y: 20 }],
            stroke: '#333',
            data: { id: 'fpline' },
          },
          { type: 'unknown', data: { id: 'skip' } },
        ],
      },
    },
    pageSizes,
    {
      documentId: 'doc-flat43',
      callouts: [{
        id: 'fc',
        pageNumber: 1,
        text: 'flat-callout',
        arrowTip: { x: 0.05, y: 0.05 },
        knee: { x: 0.1, y: 0.08 },
        textBox: { x: 0.15, y: 0.1, width: 0.12, height: 0.04 },
        style: { borderColor: '#123456', lineThickness: 2, fontColor: '#000' },
      }],
    },
  );
  assert.ok(flat);
});

test('importer rawPdfBytes ArrayBuffer/DataView + highlight/callout FreeText', async () => {
  const viewport = makeViewport(200);

  const highlight = convertPdfAnnotationToFabric({
    subtype: 'Highlight',
    rect: [10, 20, 50, 40],
    color: [1, 1, 0],
    id: 'hl1',
  }, viewport);
  assert.ok(highlight);

  const calloutFt = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [0, 0, 80, 40],
    contents: 'callout-ft',
    color: [0, 0, 0],
    defaultAppearanceString: '0 0 0 rg /Helv 11 Tf',
    endPointer: 'OpenArrow',
    callout: [10, 10, 30, 20, 50, 30],
    lineCoordinates: [10, 10, 50, 30],
  }, viewport);
  assert.ok(calloutFt);

  const source = await PDFDocument.create();
  source.addPage([400, 400]);
  const blank = await source.save();
  const exported = await savePDFWithAnnotationsPdfLib(
    asPdfFile(blank),
    {
      1: {
        objects: [
          {
            type: 'rect',
            left: 20,
            top: 20,
            width: 30,
            height: 20,
            stroke: '#000',
            fill: '#fee',
            data: { id: 'ab-sq' },
          },
        ],
      },
    },
    { 1: { width: 400, height: 400 } },
    null,
    { returnBytes: true, documentId: 'doc-ab43' },
  );
  const bytes = exported?.pdfBytes || exported;
  const u8 = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);

  const pdfJsDoc = await pdfjsLib.getDocument({ data: u8.slice(), useSystemFonts: true }).promise;
  try {
    await importAnnotationsFromPdf(pdfJsDoc, {
      rawPdfBytes: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
    });
    await importAnnotationsFromPdf(pdfJsDoc, {
      rawPdfBytes: new DataView(u8.buffer, u8.byteOffset, u8.byteLength),
    });
    await importAnnotationsFromPdf(pdfJsDoc, { rawPdfBytes: null });
  } finally {
    await pdfJsDoc.destroy?.();
  }
});

test('regionMath successful merge + simplify + rotate helpers', () => {
  const a = {
    regionId: 'a',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 20, 0, 20, 20, 0, 20],
  };
  const b = {
    ...a,
    regionId: 'b',
    coordinates: [10, 10, 30, 10, 30, 30, 10, 30],
  };
  const merged = mergeRegions(a, b);
  assert.ok(merged?.coordinates?.length >= 6);
  assert.ok(merged.originCenter);

  const hole = {
    ...a,
    regionId: 'h',
    operation: REGION_OPERATIONS.SUBTRACT,
    coordinates: [5, 5, 15, 5, 15, 15, 5, 15],
  };
  const cut = subtractRegionFromRegion(merged, hole);
  assert.ok(Array.isArray(cut));

  const simp = simplifyPolygon([0, 0, 10, 0, 10, 0.1, 10, 10, 0, 10, 0, 0], 2);
  assert.ok(Array.isArray(simp));
  assert.equal(getRegionRotation({ rotation: 450 }), 90);
  assert.ok(rotateCoordsAroundPoint([0, 0, 10, 0, 10, 10], 5, 5, 90).length >= 6);
});
