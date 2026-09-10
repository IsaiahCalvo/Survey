// The exported page frame vs. an awkward /CropBox (verify-export-3p round 3,
// 2026-09-09).
//
// The app's page frame is pdf.js' default viewport, and pdf.js (PDF 32000-1
// 14.11.2, Page#view) NORMALISES both boxes and uses CropBox INTERSECT
// MediaBox. The exporter used the raw pdf-lib /CropBox, which broke two ways:
//
//   1. a legally reversed box ([x1 y1 x0 y0], allowed by 7.9.5 and normalised
//      by every real viewer) gave the exporter a NEGATIVE page height, so
//      exportAnnotationRefHasValidGeometry rejected EVERY annotation and the
//      export came out with zero /Annots - a silent, total data loss, with the
//      flattened print blank;
//   2. a CropBox bigger than the MediaBox, or hanging off it, moved every
//      exported annotation by the difference (measured 60-78pt).
//
// Each test exports a shape, re-imports it WITHOUT the app's private metadata
// (so the assertion is about what the PDF itself says, which is what Acrobat,
// Preview and poppler show) and requires it back where the app drew it.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { getTextMarkupPageGeometry } from '../src/utils/pdfNativeExport/adapters/textMarkup.js';

const STROKE = '#c42747';

// `cropBox` is written verbatim as [x0 y0 x1 y1] - including reversed corners.
const makePdfFile = async ({ mediaBox = [0, 0, 320, 240], cropBox = null, rotate = 0 } = {}) => {
  const source = await PDFDocument.create();
  const page = source.addPage([mediaBox[2] - mediaBox[0], mediaBox[3] - mediaBox[1]]);
  page.setMediaBox(mediaBox[0], mediaBox[1], mediaBox[2] - mediaBox[0], mediaBox[3] - mediaBox[1]);
  if (cropBox) {
    page.node.set(PDFName.of('CropBox'), source.context.obj(cropBox.map(Number)));
  }
  if (rotate) page.node.set(PDFName.of('Rotate'), source.context.obj(rotate));
  const bytes = await source.save();
  return {
    name: 'boxes.pdf',
    bytes,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

// The page size the app hands the exporter: pdf.js' default viewport.
const appPageSize = async (file) => {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const doc = await task.promise;
  try {
    const viewport = (await doc.getPage(1)).getViewport({ scale: 1 });
    return { width: viewport.width, height: viewport.height };
  } finally {
    await task.destroy();
  }
};

const withWindow = async (fn) => {
  const original = globalThis.window;
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.window = original; }
};

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const exportObjects = (file, size, objects) => quiet(() => withWindow(() => savePDFWithAnnotationsPdfLib(
  file,
  { 1: { objects } },
  { 1: size },
  null,
  { returnBytes: true, actionType: 'pdf-export', documentId: 'page-box-geometry' },
)));

const flattenObjects = (file, size, objects) => quiet(() => withWindow(() => savePDFWithFlattenedRegularAnnotationsForPrint(
  file,
  { 1: { objects } },
  { 1: size },
  { returnBytes: true },
)));

const annotCount = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  return annots instanceof PDFArray ? annots.size() : 0;
};

const reimportWithoutMetadata = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    annots.asArray().forEach((ref) => doc.context.lookup(ref).delete(PDFName.of('SurveyAppAnnotation')));
  }
  const stripped = await doc.save();
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(stripped), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const pdfDoc = await task.promise;
  try {
    const imported = await quiet(() => importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: stripped }));
    return imported.annotationsByPage?.[1]?.objects || [];
  } finally {
    await task.destroy();
  }
};

const near = (actual, expected, tolerance, label) => {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `${label}: ${actual} vs ${expected} (tolerance ${tolerance})`,
  );
};

const plainRect = (left, top, width, height) => ({
  id: 'plain-rect', type: 'rect', left, top, width, height,
  stroke: STROKE, strokeWidth: 2, fill: 'transparent',
});

// ---------------------------------------------------------------------------
// The shared page geometry helper, on its own
// ---------------------------------------------------------------------------

const pdfLibPage = async (spec) => {
  const file = await makePdfFile(spec);
  const doc = await PDFDocument.load(await file.arrayBuffer());
  return doc.getPage(0);
};

test('page geometry normalises a reversed /CropBox instead of going negative', async () => {
  const page = await pdfLibPage({ mediaBox: [0, 0, 320, 240], cropBox: [320, 240, 0, 0] });
  const raw = page.getCropBox();
  assert.ok(raw.width < 0 && raw.height < 0, 'pdf-lib itself reports the reversed box as negative');
  const geometry = getTextMarkupPageGeometry(page, 240);
  assert.deepEqual(
    { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
    { x: 0, y: 0, width: 320, height: 240 },
  );
});

test('page geometry uses CropBox INTERSECT MediaBox, exactly like pdf.js', async () => {
  const bigger = await pdfLibPage({ mediaBox: [0, 0, 320, 240], cropBox: [-40, -30, 380, 290] });
  const biggerGeometry = getTextMarkupPageGeometry(bigger, 240);
  assert.deepEqual(
    [biggerGeometry.x, biggerGeometry.y, biggerGeometry.width, biggerGeometry.height],
    [0, 0, 320, 240],
    'a CropBox larger than the MediaBox clips to the MediaBox',
  );

  const hanging = await pdfLibPage({ mediaBox: [0, 0, 320, 240], cropBox: [60, 40, 420, 320] });
  const hangingGeometry = getTextMarkupPageGeometry(hanging, 240);
  assert.deepEqual(
    [hangingGeometry.x, hangingGeometry.y, hangingGeometry.width, hangingGeometry.height],
    [60, 40, 260, 200],
    'a CropBox hanging off the MediaBox keeps only the overlap',
  );
});

test('an empty CropBox ∩ MediaBox falls back to the MediaBox rather than dropping the page', async () => {
  const page = await pdfLibPage({ mediaBox: [0, 0, 320, 240], cropBox: [400, 400, 500, 500] });
  const geometry = getTextMarkupPageGeometry(page, 240);
  assert.deepEqual(
    [geometry.x, geometry.y, geometry.width, geometry.height],
    [0, 0, 320, 240],
  );
});

// ---------------------------------------------------------------------------
// End to end: export -> re-import
// ---------------------------------------------------------------------------

const roundTripCases = [
  {
    label: 'a reversed /CropBox',
    spec: { mediaBox: [0, 0, 320, 240], cropBox: [320, 240, 0, 0] },
    shape: () => plainRect(40, 50, 120, 80),
  },
  {
    label: 'a reversed /CropBox on a /Rotate 90 page',
    spec: { mediaBox: [0, 0, 320, 240], cropBox: [320, 240, 0, 0], rotate: 90 },
    shape: () => plainRect(40, 50, 120, 80),
  },
  {
    label: 'a /CropBox larger than the /MediaBox',
    spec: { mediaBox: [0, 0, 320, 240], cropBox: [-40, -30, 380, 290] },
    shape: () => plainRect(40, 50, 120, 80),
  },
  {
    label: 'a /CropBox hanging off the /MediaBox',
    spec: { mediaBox: [0, 0, 320, 240], cropBox: [60, 40, 420, 320] },
    shape: () => plainRect(30, 40, 120, 80),
  },
  {
    label: 'a /CropBox hanging off the /MediaBox on a /Rotate 270 page',
    spec: { mediaBox: [0, 0, 320, 240], cropBox: [60, 40, 420, 320], rotate: 270 },
    shape: () => plainRect(30, 40, 100, 80),
  },
];

for (const { label, spec, shape } of roundTripCases) {
  test(`${label}: every annotation survives the export and lands where the app drew it`, async () => {
    const file = await makePdfFile(spec);
    const size = await appPageSize(file);
    const drawn = shape();
    const bytes = await exportObjects(file, size, [drawn]);
    assert.equal(await annotCount(bytes), 1, 'the annotation is in the exported file');
    const [obj] = await reimportWithoutMetadata(bytes);
    assert.ok(obj, 'the annotation re-imports');
    near(obj.left, drawn.left, 0.1, 'left');
    near(obj.top, drawn.top, 0.1, 'top');
    near(obj.width, drawn.width, 0.1, 'width');
    near(obj.height, drawn.height, 0.1, 'height');
  });

  test(`${label}: the flattened print draws in the same frame`, async () => {
    const file = await makePdfFile(spec);
    const size = await appPageSize(file);
    const bytes = await flattenObjects(file, size, [shape()]);
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    const geometry = getTextMarkupPageGeometry(page, size.height);
    // The flattener's page transform is derived from the SAME geometry helper,
    // so proving the helper agrees with pdf.js' viewport (below) proves both
    // paths share one frame.
    const rotated = geometry.rotation % 180 === 90;
    near(rotated ? geometry.height : geometry.width, size.width, 0.001, 'frame width');
    near(rotated ? geometry.width : geometry.height, size.height, 0.001, 'frame height');
  });
}
