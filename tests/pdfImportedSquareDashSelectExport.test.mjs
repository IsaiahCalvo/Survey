// Imported Square / Circle /BS /S /D must re-export /AP dash after Select
// Width. Import leftover-omitted strokeDashArray so the screen painted
// leftover-solid; Select Width then leftover-replaced native dashed /BS
// with leftover-solid /AP. Distinct from leftover-18, Square rotate
// (class 16), imported Polygon Width/dash (class 18), and inventing
// Square / Circle dict /BS. Circle / Diamond / Butt /LE stay out of scope.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const makeViewport = ({ pageHeight = 792 } = {}) => ({
  width: 612,
  height: pageHeight,
  convertToViewportPoint: (x, y) => [x, pageHeight - y],
  convertToViewportRectangle(rect) {
    const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
    return [x1, y1, x2, y2];
  },
});

function importDashedSquare() {
  return convertPdfAnnotationToFabric({
    id: '5R',
    subtype: 'Square',
    rect: [90, 390, 310, 510],
    color: [0.8, 0.15, 0.15],
    interiorColor: [0.8, 0.15, 0.15],
    borderStyle: { width: 3, style: 'D', dashArray: [6, 4] },
    borderStyleType: 'D',
    borderDashArray: [6, 4],
  }, makeViewport());
}

function importDashedCircle() {
  return convertPdfAnnotationToFabric({
    id: '6R',
    subtype: 'Circle',
    rect: [90, 220, 190, 320],
    color: [0.15, 0.2, 0.8],
    interiorColor: [0.15, 0.2, 0.8],
    borderStyle: { width: 3, style: 'D', dashArray: [6, 4] },
    borderStyleType: 'D',
    borderDashArray: [6, 4],
  }, makeViewport());
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  return {
    name: 'imported-square-dash-select-export-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function readApText(doc, dict) {
  try {
    const ap = dict.get(PDFName.of('AP'));
    const apDict = ap && (typeof ap.lookup === 'function' || typeof ap.get === 'function')
      ? ap
      : doc.context.lookup(ap);
    const n = apDict?.get?.(PDFName.of('N'));
    const stream = n && (n.dict || typeof n.get === 'function') ? n : doc.context.lookup(n);
    if (!stream) return '';
    return new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
  } catch {
    return '';
  }
}

async function exportEdited(imported, patch = {}) {
  const edited = {
    ...imported,
    strokeWidth: 8,
    pdfImportedEditState: 'edited',
    data: { ...(imported.data || {}), pdfImportedEditState: 'edited' },
    ...patch,
  };
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [edited] } },
    { 1: { width: 612, height: 792 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'imported-square-dash-select' },
  );
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  const border = dict.get(PDFName.of('Border'));
  const bs = dict.get(PDFName.of('BS'));
  return {
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    borderW: border?.asArray?.()?.[2]?.asNumber?.() ?? Number(border?.asArray?.()?.[2]),
    hasBs: Boolean(bs),
    apText: readApText(doc, dict),
  };
}

test('imported Square /BS /D stamps strokeDashArray, not leftover solid', () => {
  const obj = importDashedSquare();
  assert.equal(obj.type, 'rect');
  assert.equal(obj.pdfAnnotationType, 'Square');
  assert.deepEqual(obj.strokeDashArray, [6, 4]);
});

test('imported Circle /BS /D stamps strokeDashArray, not leftover solid', () => {
  const obj = importDashedCircle();
  assert.equal(obj.type, 'circle');
  assert.equal(obj.pdfAnnotationType, 'Circle');
  assert.deepEqual(obj.strokeDashArray, [6, 4]);
});

test('edited imported dashed Square export keeps /AP [6 4] 0 d + Width 8', async () => {
  const exported = await exportEdited(importDashedSquare());
  assert.match(exported.subtype, /Square/i);
  assert.equal(exported.borderW, 8);
  assert.match(
    exported.apText,
    /\[6 4\] 0 d/,
    `export must keep /AP dash, not leftover-solid: ${exported.apText}`,
  );
  assert.equal(exported.hasBs, false, 'do not invent Square / Circle dict /BS');
});

test('edited imported dashed Circle export keeps /AP [6 4] 0 d + Width 8', async () => {
  const exported = await exportEdited(importDashedCircle());
  assert.match(exported.subtype, /Circle/i);
  assert.equal(exported.borderW, 8);
  assert.match(
    exported.apText,
    /\[6 4\] 0 d/,
    `export must keep /AP dash, not leftover-solid: ${exported.apText}`,
  );
  assert.equal(exported.hasBs, false, 'do not invent Square / Circle dict /BS');
});

test('importer stamps Square / Circle /BS /D; do not invent /BS leftover', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /leftover-omitted strokeDashArray/);
  assert.match(importer, /Do not invent Square \/ Circle dict \/BS/);
  assert.match(importer, /const dashArray = extractAnnotationDashArray\(annotation\);/);
});
