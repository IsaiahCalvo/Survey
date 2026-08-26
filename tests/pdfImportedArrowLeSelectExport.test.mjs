// Imported Line /LE OpenArrow must re-export OpenArrow after Select Width.
// Import leftover-omitted data.arrowheadStyle so tool==='arrow' leftover-
// defaulted ClosedArrow; Select Width then leftover-replaced native /LE.
// Distinct from leftover-18, imported Line Width/dash (class 19), callout
// /LE OpenArrow, and inventing Line /AP. Circle / Diamond / Butt stay out
// of scope.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
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

function importOpenArrowLine() {
  return convertPdfAnnotationToFabric({
    id: '5R',
    subtype: 'Line',
    lineCoordinates: [100, 400, 300, 500],
    color: [0.8, 0.15, 0.15],
    lineEndings: ['None', 'OpenArrow'],
  }, makeViewport());
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  return {
    name: 'imported-arrow-le-select-export-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
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
    { returnBytes: true, actionType: 'pdf-export', documentId: 'imported-arrow-le-select' },
  );
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  const le = dict.get(PDFName.of('LE'));
  const border = dict.get(PDFName.of('Border'));
  return {
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    le: le?.asArray?.()?.map((n) => String(n).replace(/^\//, '')) || [],
    borderW: border?.asArray?.()?.[2]?.asNumber?.() ?? Number(border?.asArray?.()?.[2]),
  };
}

test('imported Line /LE OpenArrow stamps openTriangle, not leftover solidTriangle', () => {
  const obj = importOpenArrowLine();
  assert.equal(obj.type, 'line');
  assert.equal(obj.tool, 'arrow');
  assert.deepEqual(obj.data?.pdfLineEndings, ['None', 'OpenArrow']);
  assert.equal(obj.data?.arrowheadStyle, 'openTriangle');
  assert.notEqual(obj.data?.arrowheadStyle, 'solidTriangle');
});

test('edited imported OpenArrow Line export keeps /LE OpenArrow + Width 8', async () => {
  const exported = await exportEdited(importOpenArrowLine());
  assert.match(exported.subtype, /Line/i);
  assert.equal(exported.borderW, 8);
  assert.deepEqual(
    exported.le,
    ['None', 'OpenArrow'],
    `export must keep /LE OpenArrow, not leftover ClosedArrow: ${JSON.stringify(exported.le)}`,
  );
});

test('importer + export writers stamp /LE before Arrow ClosedArrow default', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /importedArrowheadStyle/);
  assert.match(importer, /resolveImportedCalloutArrowheadStyle/);
  assert.match(importer, /Do not invent Line \/AP/);
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /resolveImportedPdfLineEndingStyle/);
  assert.match(writer, /tool === 'arrow' \? ARROWHEAD_STYLES\.SOLID_TRIANGLE/);
  assert.match(writer, /Do not invent Line \/AP/);
});
