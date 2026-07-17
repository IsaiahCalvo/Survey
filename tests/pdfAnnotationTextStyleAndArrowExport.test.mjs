// Regression tests for the 2026-07-17 export/print fixes in
// src/utils/pdfAnnotationsPdfLib.js:
//   Bug B — exported FreeText /DA carries the real glyph color + Helvetica
//            variant (bold/italic), /C is background-only.
//   Bug C — print flatten picks the bold/oblique embedded font and draws
//            underline/strikethrough as real lines.
//   Bug D — legacy fabric arrow GROUPS (line child + triangle arrowHead)
//            export as Line annotations instead of being skipped.
// Survey-marker print exclusion (Bug A investigation) stays covered by
// 'printable regular annotation filter excludes survey highlights' in
// tests/pdfSaveExportContract.test.mjs — it is intentional design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  buildPdfExportAnnotationPlan,
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

async function makePdfFile(name = 'source.pdf') {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const PAGE_SIZES = { 1: { width: 200, height: 200 } };

async function getAnnotationDicts(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref));
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

test('exported text annotation /DA carries the picked color and the bold Helvetica variant', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {
    1: {
      objects: [{
        id: 'red-bold-text',
        type: 'textbox',
        left: 10,
        top: 10,
        width: 100,
        height: 20,
        text: 'Red bold',
        fill: '#ff0000',
        fontSize: 12,
        fontWeight: 'bold',
      }],
    },
  }, PAGE_SIZES, null, { returnBytes: true });

  const dicts = await getAnnotationDicts(bytes);
  const freeText = dicts.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(freeText, 'FreeText annotation must be exported');
  const da = dictText(freeText, 'DA');
  assert.equal(da, '1 0 0 rg /Helvetica-Bold 12 Tf');
  // /C is background color, not glyph color — plain text has no background.
  assert.equal(freeText.get(PDFName.of('C')), undefined);
});

test('exported callout text maps bold+italic flags to Helvetica-BoldOblique and keeps /C as background', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {}, PAGE_SIZES, null, {
    returnBytes: true,
    callouts: [{
      id: 'styled-callout',
      pageNumber: 1,
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.2 },
      textBoxWidth: 0.3,
      textBoxHeight: 0.1,
      text: 'Styled',
      style: {
        fontColor: '#0000ff',
        fontSize: 14,
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        backgroundColor: '#ffff00',
      },
    }],
  });

  const dicts = await getAnnotationDicts(bytes);
  const freeText = dicts.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(freeText, 'callout text piece must be exported');
  const da = dictText(freeText, 'DA');
  assert.equal(da, '0 0 1 rg /Helvetica-BoldOblique 14 Tf');
  const c = freeText.get(PDFName.of('C'));
  assert.ok(c, 'callout text box background must land in /C');
  const cValues = c.asArray().map((n) => n.asNumber());
  assert.deepEqual(cValues, [1, 1, 0]);
});

async function collectPageFontsAndContent(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const fontNames = [];
  const fontsDict = page.node.Resources()?.lookup(PDFName.of('Font'));
  if (fontsDict) {
    fontsDict.entries().forEach(([, ref]) => {
      const fontDict = doc.context.lookup(ref);
      const baseFont = fontDict?.get(PDFName.of('BaseFont'));
      if (baseFont) fontNames.push(baseFont.decodeText());
    });
  }
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  const contentText = streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
  return { fontNames, contentText };
}

test('print flatten uses the bold-oblique font and draws underline + strikethrough lines', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(pdfFile, {
    1: {
      objects: [{
        id: 'decorated-text',
        type: 'textbox',
        left: 10,
        top: 10,
        width: 120,
        height: 20,
        text: 'Decorated',
        fill: '#ff0000',
        fontSize: 12,
        fontWeight: 700,
        fontStyle: 'italic',
        underline: true,
        linethrough: true,
      }],
    },
  }, PAGE_SIZES, { returnBytes: true });

  const { fontNames, contentText } = await collectPageFontsAndContent(bytes);
  assert.ok(
    fontNames.some((name) => name.includes('Helvetica-BoldOblique')),
    `bold+italic text must be drawn with Helvetica-BoldOblique (got ${JSON.stringify(fontNames)})`,
  );
  // The only line-stroke operators on this page are the two decoration lines
  // (drawText never strokes): one underline + one strikethrough.
  const strokedLines = (contentText.match(/ l\s*\n?S\b/g) || []).length;
  assert.equal(strokedLines, 2, `expected exactly underline + strikethrough strokes, got ${strokedLines}`);
});

test('print flatten keeps callout text style flags (bold callout prints with the bold font)', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(pdfFile, {}, PAGE_SIZES, {
    returnBytes: true,
    callouts: [{
      id: 'bold-callout',
      pageNumber: 1,
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.2 },
      textBoxWidth: 0.3,
      textBoxHeight: 0.1,
      text: 'Bold callout',
      style: { fontColor: '#1e293b', fontSize: 14, bold: true },
    }],
  });

  const { fontNames } = await collectPageFontsAndContent(bytes);
  assert.ok(
    fontNames.some((name) => name.includes('Helvetica-Bold') && !name.includes('Oblique')),
    `bold callout text must use Helvetica-Bold (got ${JSON.stringify(fontNames)})`,
  );
});

const LEGACY_ARROW_GROUP = {
  id: 'legacy-arrow-1',
  type: 'group',
  left: 20,
  top: 30,
  stroke: '#ff0000',
  strokeWidth: 3,
  objects: [
    { type: 'line', x1: 0, y1: 0, x2: 50, y2: 40, stroke: '#ff0000', strokeWidth: 3 },
    { type: 'triangle', name: 'arrowHead', left: 45, top: 35, width: 10, height: 10 },
  ],
};

test('legacy arrow group is planned for export as a line, not skipped as unsupported-type', () => {
  const plan = buildPdfExportAnnotationPlan({
    annotationsByPage: { 1: { objects: [LEGACY_ARROW_GROUP] } },
    pageSizes: PAGE_SIZES,
  });

  assert.equal(plan.diagnostics.objectsExported, 1);
  assert.equal(plan.diagnostics.skippedByReason['unsupported-type'] || 0, 0);
  assert.equal(plan.items.length, 1);
  const exported = plan.items[0].object;
  assert.equal(exported.type, 'line');
  // group offset folded into absolute endpoints
  assert.equal(exported.x1, 20);
  assert.equal(exported.y1, 30);
  assert.equal(exported.x2, 70);
  assert.equal(exported.y2, 70);
  assert.equal(exported.lineEnding2, 'ClosedArrow');
});

test('legacy arrow group lands in the PDF as a Line annotation with a ClosedArrow ending', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {
    1: { objects: [LEGACY_ARROW_GROUP] },
  }, PAGE_SIZES, null, { returnBytes: true });

  const dicts = await getAnnotationDicts(bytes);
  const line = dicts.find((dict) => dictText(dict, 'Subtype') === 'Line');
  assert.ok(line, 'legacy arrow group must export a Line annotation');
  const le = line.get(PDFName.of('LE'));
  assert.ok(le, 'arrowhead child must map to /LE line endings');
  const leNames = le.asArray().map((name) => name.decodeText());
  assert.deepEqual(leNames, ['None', 'ClosedArrow']);
});

test('arbitrary groups without a line child stay unexported (gate stays narrow)', () => {
  const plan = buildPdfExportAnnotationPlan({
    annotationsByPage: {
      1: {
        objects: [{
          id: 'not-an-arrow',
          type: 'group',
          left: 0,
          top: 0,
          objects: [{ type: 'rect', left: 0, top: 0, width: 10, height: 10 }],
        }],
      },
    },
    pageSizes: PAGE_SIZES,
  });

  assert.equal(plan.diagnostics.objectsExported, 0);
  assert.equal(plan.diagnostics.skippedByReason['unsupported-type'], 1);
});
