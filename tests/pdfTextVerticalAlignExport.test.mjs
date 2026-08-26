// Textbox verticalAlign must ride annotated export metadata and print flatten.
// textAlign was already in STYLE_KEYS; verticalAlign was the one-sided gap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  applyPdfAppAnnotationMetadata,
  buildPdfAppAnnotationMetadata,
  PDF_APP_ANNOTATION_METADATA_KEY,
} from '../src/utils/pdfAppAnnotationMetadata.js';
import { flattenedTextBlockOffset } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const TALL_TEXT = {
  id: 'tb-valign-bottom',
  type: 'textbox',
  left: 24,
  top: 40,
  width: 160,
  height: 120,
  text: 'A',
  fill: '#000000',
  fontSize: 14,
  fontFamily: 'Helvetica',
  textAlign: 'left',
  verticalAlign: 'bottom',
  data: { id: 'tb-valign-bottom', type: 'textbox', tool: 'text' },
};

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'valign-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

test('STYLE_KEYS + apply keep textbox verticalAlign on the metadata round-trip', () => {
  const metadata = buildPdfAppAnnotationMetadata(TALL_TEXT, {
    id: TALL_TEXT.id,
    pageNumber: 1,
    type: 'textbox',
  });
  assert.equal(metadata.style.verticalAlign, 'bottom');
  assert.equal(metadata.style.textAlign, 'left');
  const applied = applyPdfAppAnnotationMetadata({ type: 'textbox', text: 'A' }, metadata);
  assert.equal(applied.verticalAlign, 'bottom');
  assert.equal(applied.textAlign, 'left');
});

test('flattenedTextBlockOffset shifts middle/bottom; unknown falls back to top', () => {
  assert.equal(flattenedTextBlockOffset(120, 20, 'top'), 0);
  assert.equal(flattenedTextBlockOffset(120, 20, 'middle'), 50);
  assert.equal(flattenedTextBlockOffset(120, 20, 'bottom'), 100);
  assert.equal(flattenedTextBlockOffset(120, 20, 'nope'), 0);
  assert.equal(flattenedTextBlockOffset(20, 40, 'bottom'), 0);
});

test('annotated export writes SurveyAppAnnotation verticalAlign; apply restores it', async () => {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [TALL_TEXT] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'tb-valign' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  const freeText = dicts.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(freeText, 'textbox exports as FreeText');
  const raw = dictText(freeText, PDF_APP_ANNOTATION_METADATA_KEY);
  assert.ok(raw, 'SurveyAppAnnotation metadata must be present');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.style.verticalAlign, 'bottom');
  const applied = applyPdfAppAnnotationMetadata({ type: 'textbox' }, parsed);
  assert.equal(applied.verticalAlign, 'bottom');
});

test('print flatten and metadata hosts still name the verticalAlign contract', () => {
  const meta = read('src/utils/pdfAppAnnotationMetadata.js');
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(meta, /'textAlign',\s*\n\s*'verticalAlign',\s*\n\s*'underline'/);
  assert.match(catalog, /export function flattenedTextBlockOffset/);
  assert.match(flatten, /flattenedTextBlockOffset\(height, lines\.length \* lineHeight, obj\?\.verticalAlign\)/);
});
