// Textbox Border/Width must ride FreeText /Border and print flatten.
// Live toolbar writes stroke + strokeWidth (often rgba() from composeColorForPatch).
// Flatten never painted the frame, and export hard-coded Border [0,0,0],
// so a user-picked box never printed. Distinct from backgroundColor /C.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveTextboxBoxStroke } from '../src/utils/annotationStyleCatalog.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-stroke-${patch.strokeWidth ?? 'empty'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 120,
    height: 28,
    text: 'Stroke',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    backgroundColor: '',
    data: { id: `tb-stroke-${patch.strokeWidth ?? 'empty'}`, type: 'textbox', tool: 'text' },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'textbox-stroke-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

function dictBorderWidth(dict) {
  const value = dict.get(PDFName.of('Border'));
  if (!value || typeof value.asArray !== 'function') return null;
  const entries = value.asArray();
  if (entries.length < 3) return null;
  const width = entries[2];
  return width?.asNumber ? width.asNumber() : Number(width);
}

async function exportTextbox(patch) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [makeTextbox(patch)] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-stroke' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  return annots.asArray().map((ref) => doc.context.lookup(ref));
}

async function flattenTextbox(patch) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [makeTextbox(patch)] } },
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

test('resolveTextboxBoxStroke maps live stroke + strokeWidth and ignores font fill', () => {
  assert.deepEqual(resolveTextboxBoxStroke({}), {
    hex: null,
    opacity: 0,
    visible: false,
    paint: 'transparent',
    width: 0,
    dash: null,
  });
  assert.equal(resolveTextboxBoxStroke({ stroke: '#FF0000' }).visible, false);
  assert.equal(resolveTextboxBoxStroke({ strokeWidth: 8 }).visible, false);
  assert.equal(resolveTextboxBoxStroke({ stroke: '#FF0000', strokeWidth: 8 }).hex, '#FF0000');
  assert.equal(resolveTextboxBoxStroke({ stroke: '#FF0000', strokeWidth: 8 }).width, 8);
  assert.equal(resolveTextboxBoxStroke({ stroke: '#FF0000', strokeWidth: 8 }).visible, true);
  assert.equal(resolveTextboxBoxStroke({ stroke: 'rgba(0, 0, 255, 1)', strokeWidth: 4 }).hex, '#0000FF');
  assert.equal(
    resolveTextboxBoxStroke({ stroke: 'rgba(0, 0, 255, 0.4)', strokeWidth: 4 }).paint,
    'rgba(0, 0, 255, 0.4)',
  );
  assert.equal(
    resolveTextboxBoxStroke({ stroke: composeColorForPatch('#FF0000', 0), strokeWidth: 6 }).visible,
    false,
  );
  assert.equal(
    resolveTextboxBoxStroke({ fill: '#00FF00', backgroundColor: '#0000FF', strokeWidth: 3 }).visible,
    false,
    'font fill / box fill must not become a leftover border',
  );
});

test('annotated export writes FreeText /Border from strokeWidth; empty and opacity-0 stay 0', async () => {
  const thick = await exportTextbox({ stroke: '#FF0000', strokeWidth: 8 });
  const thickText = thick.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(thickText, 'thick textbox must export a FreeText');
  assert.equal(dictBorderWidth(thickText), 8);

  const rgba = await exportTextbox({ stroke: 'rgba(0, 0, 255, 1)', strokeWidth: 4 });
  const rgbaText = rgba.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.equal(dictBorderWidth(rgbaText), 4);

  const empty = await exportTextbox({ backgroundColor: '#FFFF00' });
  const emptyText = empty.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(emptyText, 'fill-only textbox must still export a FreeText');
  assert.equal(dictBorderWidth(emptyText), 0, 'fill-only must keep /Border 0');

  const clear = await exportTextbox({
    stroke: composeColorForPatch('#FF0000', 0),
    strokeWidth: 6,
  });
  const clearText = clear.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.equal(dictBorderWidth(clearText), 0, 'opacity-0 rgba must keep /Border 0');
});

test('print flatten paints stroke and does not invent a frame for empty/opacity-0', async () => {
  const red = await flattenTextbox({ stroke: '#FF0000', strokeWidth: 8 });
  assert.match(red, /1\s+0\s+0\s+RG/, `red flatten must stroke #FF0000 (got ${red.slice(0, 240)})`);
  assert.match(red, /8\s+w/, 'red flatten must use live Width 8');

  const empty = await flattenTextbox({ backgroundColor: '#FFFF00' });
  assert.doesNotMatch(empty, /1\s+0\s+0\s+RG/, 'fill-only flatten must not invent a red frame');
  assert.doesNotMatch(empty, /8\s+w/, 'fill-only flatten must not invent Width 8');

  const faded = await flattenTextbox({ stroke: 'rgba(0, 0, 255, 0.4)', strokeWidth: 4 });
  assert.match(faded, /0\s+0\s+1\s+RG/, 'partial rgba still paints the stroke color');

  const zero = await flattenTextbox({ stroke: 'rgba(255, 0, 0, 0)', strokeWidth: 6 });
  assert.doesNotMatch(zero, /1\s+0\s+0\s+RG/, 'opacity-0 rgba must not print an opaque red frame');
});

test('export/flatten hosts still name the textbox stroke contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function resolveTextboxBoxStroke/);
  assert.match(flatten, /const boxStroke = resolveTextboxBoxStroke\(fabricObj\)/);
  assert.match(flatten, /const boxStroke = resolveTextboxBoxStroke\(obj\)/);
  assert.match(flatten, /Border: \[0, 0, borderWidth\]/);
  assert.doesNotMatch(flatten, /Border: \[0, 0, 0\], \/\/ No border for text boxes/);
});
