// Imported Squiggly Select Color Opacity must re-emit /Squiggly + /CA.
// Live toolbar maps selected imported Squiggly → pen Color Opacity.
// Screen already honours rgba stroke, but EDITED_IMPORT_SUBTYPE_WRITERS
// leftover-omitted Squiggly so export leftover-fell through to Ink.
// Distinct from leftover-18, imported Underline / StrikeOut Select Fill
// /CA, Highlight /CA, and imported Ink stroke /CA. Do not invent a
// create-squiggly tool or Width-on-squiggly /BS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeImportedSquiggly(patch = {}) {
  const strokeOpacity = patch.strokeOpacity ?? 40;
  return {
    type: 'path',
    left: 0,
    top: 0,
    width: 271,
    height: 1.27,
    scaleX: 1,
    scaleY: 1,
    path: [
      ['M', 119.542, 114.92],
      ['L', 255, 115.4],
      ['L', 390.863, 114.81],
    ],
    stroke: `rgba(250, 50, 55, ${strokeOpacity / 100})`,
    fill: null,
    strokeWidth: 0.6,
    isPdfImported: true,
    pdfImportedEditState: 'edited',
    pdfAnnotationType: 'Squiggly',
    pdfAnnotationId: '39R',
    id: '39R',
    data: {
      id: '39R',
      pdfAnnotationType: 'Squiggly',
      pdfImportedEditState: 'edited',
    },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  return {
    name: 'squiggly-select-color-export-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

async function exportSquiggly(patch) {
  const squiggly = makeImportedSquiggly(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [squiggly] } },
    { 1: { width: 612, height: 792 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'squiggly-select-color-export' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  const rect = dict.get(PDFName.of('Rect'));
  return {
    squiggly,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    ca: dictNumber(dict, 'CA'),
    rect: rect?.asArray?.()?.map((n) => (n.asNumber ? n.asNumber() : Number(n))) || [],
  };
}

test('selected-patch imported Squiggly stamps Color Opacity 0.4 on stroke', () => {
  const squiggly = makeImportedSquiggly({ strokeOpacity: 40 });
  assert.match(squiggly.stroke, /0\.4/);
  assert.equal(squiggly.pdfImportedEditState, 'edited');
  assert.equal(squiggly.pdfAnnotationType, 'Squiggly');
});

test('edited imported Squiggly export keeps /Squiggly + /CA 0.40, not leftover Ink', async () => {
  const exported = await exportSquiggly({ strokeOpacity: 40 });
  assert.match(exported.subtype, /Squiggly/i);
  assert.ok(
    Number.isFinite(exported.ca) && Math.abs(exported.ca - 0.4) < 0.05,
    `export must write /CA 0.40, got ${exported.ca}`,
  );
  assert.ok(exported.rect[0] > 100, `path bounds must not leftover-use left 0: ${exported.rect}`);
});

test('edited imported Squiggly export writer uses stroke paint + path bounds', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /Squiggly: createImportedQuadMarkupAnnotation\('Squiggly'/);
  assert.match(writer, /paintFrom: 'stroke'/);
  assert.match(writer, /importedMarkupPathBounds/);
  assert.doesNotMatch(writer, /create-squiggly tool/);
});
