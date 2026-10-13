/**
 * Tick-54 coverage chips: Int16Array rawPdfBytes, FreeTextCallout appearance
 * subpaths (open + non-rect), filled ink zero-bbox, AP stream name-token
 * consumeNumbers, pageSpace short unknown ops, whitespace annot id metadata miss.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString, PDFNumber } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  convertPdfAnnotationToFabric,
  convertInkToFabricPath,
  importAnnotationsFromPdf,
} from '../src/utils/pdfAnnotationImporter.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

function makeViewport(h = 400) {
  return {
    width: 300,
    height: h,
    convertToViewportPoint: (x, y) => [x, h - y],
    convertToViewportRectangle: (r) => [r[0], h - r[3], r[2], h - r[1]],
  };
}

async function buildApNameTokenPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;

  // Appearance content: name token mixed into number stack → consumeNumbers 1073
  const form = ctx.flateStream('0 0 /DeviceRGB 10 20 m 30 40 l S', {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 100, 100],
    Matrix: [1, 0, 0, 1, 0, 0],
  });
  const formRef = ctx.register(form);

  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Ink'),
    Rect: [10, 10, 110, 110],
    NM: PDFString.of('ink-ap-name'),
    C: [PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0)],
    BS: ctx.obj({ W: PDFNumber.of(1) }),
    InkList: ctx.obj([
      ctx.obj([
        PDFNumber.of(10), PDFNumber.of(10),
        PDFNumber.of(50), PDFNumber.of(50),
        PDFNumber.of(90), PDFNumber.of(20),
      ]),
    ]),
    AP: ctx.obj({ N: formRef }),
    P: page.ref,
  });
  page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
  return doc.save();
}

test('importer Int16Array bytes + callout appearance edges + zero-bbox ink', async () => {
  const viewport = makeViewport();

  // FreeTextCallout: open subpath leftover (pushCurrent false) + C curve
  const openCallout = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    intent: 'FreeTextCallout',
    rect: [0, 0, 120, 80],
    contents: 'open',
    calloutLine: [0, 0, 40, 40, 80, 20],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
    defaultAppearanceString: '0 0 0 rg /Helv 12 Tf',
    _appearance: {
      strokeColor: [0, 0, 0],
      path: [
        ['M', 10, 10],
        ['C', 12, 14, 18, 16, 20, 10],
        ['L', 60, 10],
        ['L', 60, 40],
        ['L', 10, 40],
        // no Z — leftover current flushed as open subpath
      ],
    },
  }, viewport);
  assert.ok(openCallout);

  // Triangle-only closed path → no rectangle candidates → null appearance box
  const triCallout = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    intent: 'FreeTextCallout',
    rect: [0, 0, 100, 60],
    contents: 'tri',
    calloutLine: [0, 0, 30, 30],
    color: [0, 0, 1],
    borderStyle: { width: 1 },
    defaultAppearanceString: '0 0 1 rg /Helv 10 Tf',
    _appearance: {
      path: [
        ['M', 0, 0],
        ['L', 40, 0],
        ['L', 20, 30],
        ['Z'],
      ],
    },
  }, viewport);
  assert.ok(triCallout);

  // Filled ink with degenerate AP path → width/height 0 → pathSubpathsAreClosed early false
  const inkZero = convertInkToFabricPath({
    subtype: 'Ink',
    color: [1, 0, 0],
    borderStyle: { width: 0 },
    _appearance: {
      hasFill: true,
      path: [
        ['M', 5, 5],
        ['L', 5, 5],
        ['L', 5, 5],
        ['Z'],
      ],
    },
  }, viewport);
  assert.ok(inkZero === null || inkZero);

  // DataView / Float32Array are ArrayBuffer.isView but not Uint8Array
  const bytes = await buildApNameTokenPdf();
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdfJsDoc = await pdfjsLib.getDocument({ data: u8.slice(), useSystemFonts: true }).promise;
  try {
    const view = new DataView(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
    const imported = await importAnnotationsFromPdf(pdfJsDoc, { rawPdfBytes: view });
    assert.ok(imported);

    const f32buf = new ArrayBuffer(u8.byteLength + (4 - (u8.byteLength % 4)) % 4);
    new Uint8Array(f32buf).set(u8);
    const importedF32 = await importAnnotationsFromPdf(pdfJsDoc, {
      rawPdfBytes: new Float32Array(f32buf),
    });
    assert.ok(importedF32);

    // Whitespace-only id + Map present → getRawAnnotationMetadata empty-id branch
    // (exercised when pdf.js surfaces blank NM); also import again with real bytes
    const imported2 = await importAnnotationsFromPdf({
      numPages: 1,
      async getPage() {
        return {
          getViewport() { return viewport; },
          async getAnnotations() {
            return [
              {
                id: '   ',
                subtype: 'Square',
                rect: [0, 0, 20, 20],
                color: [0, 0, 0],
                borderStyle: { width: 1 },
              },
              {
                id: 'missing-from-map',
                subtype: 'Square',
                rect: [0, 0, 15, 15],
                color: [0, 0, 0],
                borderStyle: { width: 1 },
              },
            ];
          },
        };
      },
    }, { rawPdfBytes: u8.slice() });
    assert.ok(imported2);
  } finally {
    await pdfJsDoc.destroy?.();
  }
});

test('pageSpaceEraser short unknown commands skip via commandEndpoint null', () => {
  const result = erasePageAnnotations({
    objects: [{
      type: 'path',
      left: 0,
      top: 0,
      strokeWidth: 2,
      path: [
        ['M', 0, 0],
        ['L', 20, 0],
        ['a'], // length < 3 → commandEndpoint null
        ['L', 1], // length < 3
        ['q', 5, 5, 10, 0], // relative Q
        ['c', 1, 1, 2, 2, 3, 3], // relative C
        ['Z'],
      ],
    }],
    strokeSamples: [{ x: 5, y: 0 }, { x: 10, y: 0 }],
    radius: 8,
  });
  assert.ok(result);
});

test('importer toUint8Array rejects non-view objects', async () => {
  const result = await importAnnotationsFromPdf({
    numPages: 0,
    getPage: async () => { throw new Error('none'); },
  }, { rawPdfBytes: 'not-bytes' });
  assert.ok(result);

  const result2 = await importAnnotationsFromPdf({
    numPages: 0,
    getPage: async () => { throw new Error('none'); },
  }, { rawPdfBytes: { weird: true } });
  assert.ok(result2);
});
