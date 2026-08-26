// Textbox textAlign must ride FreeText /Q and print flatten.
// STYLE_KEYS already lists textAlign (metadata reimport works); /Q and
// flatten were the one-sided gap — Acrobat/print always left-aligned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  flattenedTextInlineOffset,
  pdfFreeTextQuadding,
} from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const WIDE_RIGHT = {
  id: 'tb-align-right',
  type: 'textbox',
  left: 24,
  top: 40,
  width: 160,
  height: 32,
  text: 'A',
  fill: '#000000',
  fontSize: 14,
  fontFamily: 'Helvetica',
  textAlign: 'right',
  verticalAlign: 'top',
  data: { id: 'tb-align-right', type: 'textbox', tool: 'text' },
};

const WIDE_LEFT = {
  ...WIDE_RIGHT,
  id: 'tb-align-left',
  textAlign: 'left',
  data: { id: 'tb-align-left', type: 'textbox', tool: 'text' },
};

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'align-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

const dictNumber = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.asNumber ? value.asNumber() : null;
};

async function flattenContent(obj) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [obj] } },
    { 1: { width: 200, height: 200 } },
    { returnBytes: true },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}

function firstTextX(contentText) {
  const match = contentText.match(/([\d.]+)\s+[\d.]+\s+Td\b/)
    || contentText.match(/1\s+0\s+0\s+1\s+([\d.]+)\s+[\d.]+\s+Tm\b/);
  return match ? Number(match[1]) : null;
}

test('pdfFreeTextQuadding + flattenedTextInlineOffset map left/center/right', () => {
  assert.equal(pdfFreeTextQuadding('left'), 0);
  assert.equal(pdfFreeTextQuadding('center'), 1);
  assert.equal(pdfFreeTextQuadding('right'), 2);
  assert.equal(pdfFreeTextQuadding('justify'), 0);
  assert.equal(pdfFreeTextQuadding('nope'), 0);
  assert.equal(flattenedTextInlineOffset(160, 20, 'left'), 0);
  assert.equal(flattenedTextInlineOffset(160, 20, 'center'), 70);
  assert.equal(flattenedTextInlineOffset(160, 20, 'right'), 140);
  assert.equal(flattenedTextInlineOffset(160, 20, 'justify'), 0);
  assert.equal(flattenedTextInlineOffset(20, 40, 'right'), 0);
});

test('annotated export writes FreeText /Q for right; left stays 0', async () => {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [WIDE_RIGHT, WIDE_LEFT] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'tb-align' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  const freeTexts = dicts.filter((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.equal(freeTexts.length, 2);
  const right = freeTexts.find((dict) => dictText(dict, 'Contents') === 'A' && dictNumber(dict, 'Q') === 2);
  const left = freeTexts.find((dict) => dictNumber(dict, 'Q') === 0);
  assert.ok(right, 'right-aligned FreeText must write /Q 2');
  assert.ok(left, 'left-aligned FreeText must write /Q 0');
});

test('print flatten shifts right-aligned glyphs past the left-aligned x', async () => {
  const leftContent = await flattenContent(WIDE_LEFT);
  const rightContent = await flattenContent(WIDE_RIGHT);
  const leftX = firstTextX(leftContent);
  const rightX = firstTextX(rightContent);
  assert.ok(Number.isFinite(leftX), `left flatten must place text (got ${leftContent.slice(0, 200)})`);
  assert.ok(Number.isFinite(rightX), `right flatten must place text (got ${rightContent.slice(0, 200)})`);
  assert.ok(rightX > leftX + 8, `right flatten x ${rightX} must sit past left x ${leftX}`);
});

test('export/flatten hosts still name the textAlign /Q contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function flattenedTextInlineOffset/);
  assert.match(catalog, /export function pdfFreeTextQuadding/);
  assert.match(flatten, /Q: pdfFreeTextQuadding\(fabricObj\.textAlign\)/);
  assert.match(flatten, /flattenedTextInlineOffset\(maxWidth, lineWidth, obj\?\.textAlign\)/);
});
