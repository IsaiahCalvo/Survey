// Textbox Fill must ride FreeText /C and print flatten.
// Live toolbar writes backgroundColor (often rgba() from composeColorForPatch).
// Flatten drew glyphs only, so a user-picked box never printed, and
// opacity-0 rgba still wrote /C (Acrobat showed an opaque box).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveTextboxBoxFill } from '../src/utils/annotationStyleCatalog.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-fill-${patch.backgroundColor || 'empty'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 120,
    height: 28,
    text: 'Fill',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    backgroundColor: '',
    data: { id: `tb-fill-${patch.backgroundColor || 'empty'}`, type: 'textbox', tool: 'text' },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'textbox-fill-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

function dictRgb(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (!value || typeof value.asArray !== 'function') return null;
  return value.asArray().map((entry) => (entry?.asNumber ? entry.asNumber() : Number(entry)));
}

async function exportTextbox(patch) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [makeTextbox(patch)] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-fill' },
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

test('resolveTextboxBoxFill maps live backgroundColor and ignores font fill', () => {
  assert.deepEqual(resolveTextboxBoxFill({}), {
    hex: null,
    opacity: 0,
    visible: false,
    paint: 'transparent',
  });
  assert.deepEqual(resolveTextboxBoxFill({ backgroundColor: '' }), {
    hex: null,
    opacity: 0,
    visible: false,
    paint: 'transparent',
  });
  assert.equal(resolveTextboxBoxFill({ backgroundColor: '#ffff00' }).hex, '#FFFF00');
  assert.equal(resolveTextboxBoxFill({ backgroundColor: '#FFFF00' }).visible, true);
  assert.equal(resolveTextboxBoxFill({ backgroundColor: 'rgba(255, 255, 0, 1)' }).hex, '#FFFF00');
  assert.equal(resolveTextboxBoxFill({ backgroundColor: 'rgba(255, 255, 0, 0.4)' }).paint, 'rgba(255, 255, 0, 0.4)');
  assert.equal(resolveTextboxBoxFill({ backgroundColor: composeColorForPatch('#FF0000', 0) }).visible, false);
  assert.equal(resolveTextboxBoxFill({ backgroundColor: 'rgba(255, 0, 0, 0)' }).visible, false);
  assert.equal(
    resolveTextboxBoxFill({ fill: '#00FF00', backgroundColor: '' }).visible,
    false,
    'font fill must not become a leftover box fill',
  );
  assert.equal(resolveTextboxBoxFill({ fill: '#00FF00', backgroundColor: '#0000FF' }).hex, '#0000FF');
});

test('annotated export writes FreeText /C from backgroundColor; empty and opacity-0 omit /C', async () => {
  const yellow = await exportTextbox({ backgroundColor: '#FFFF00' });
  const yellowText = yellow.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(yellowText, 'yellow textbox must export a FreeText');
  assert.deepEqual(dictRgb(yellowText, 'C'), [1, 1, 0]);

  const rgba = await exportTextbox({ backgroundColor: 'rgba(0, 0, 255, 1)' });
  const rgbaText = rgba.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.deepEqual(dictRgb(rgbaText, 'C'), [0, 0, 1]);

  const empty = await exportTextbox({ backgroundColor: '' });
  const emptyText = empty.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(emptyText, 'empty-fill textbox must still export a FreeText');
  assert.equal(emptyText.get(PDFName.of('C')), undefined);

  const clear = await exportTextbox({ backgroundColor: composeColorForPatch('#FF0000', 0) });
  const clearText = clear.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.equal(clearText.get(PDFName.of('C')), undefined, 'opacity-0 rgba must omit /C');
});

test('print flatten paints backgroundColor and does not invent a box for empty/opacity-0', async () => {
  const yellow = await flattenTextbox({ backgroundColor: '#FFFF00' });
  assert.match(yellow, /1\s+1\s+0\s+rg/, `yellow flatten must fill #FFFF00 (got ${yellow.slice(0, 240)})`);

  const empty = await flattenTextbox({ backgroundColor: '' });
  assert.doesNotMatch(empty, /1\s+1\s+0\s+rg/, 'empty flatten must not invent a yellow box');

  const faded = await flattenTextbox({ backgroundColor: 'rgba(255, 255, 0, 0.4)' });
  assert.match(faded, /1\s+1\s+0\s+rg/, 'partial rgba still paints the fill color');

  const zero = await flattenTextbox({ backgroundColor: 'rgba(255, 0, 0, 0)' });
  assert.doesNotMatch(zero, /1\s+0\s+0\s+rg/, 'opacity-0 rgba must not print an opaque red box');
});

test('export/flatten hosts still name the textbox backgroundColor contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function resolveTextboxBoxFill/);
  assert.match(flatten, /const boxFill = resolveTextboxBoxFill\(fabricObj\)/);
  assert.match(flatten, /const boxFill = resolveTextboxBoxFill\(obj\)/);
  assert.match(flatten, /page\.drawRectangle\(\{/);
  assert.doesNotMatch(
    flatten,
    /const background = fabricObj\.backgroundColor && fabricObj\.backgroundColor !== 'transparent'\s*\n\s*\? hexToRGB\(fabricObj\.backgroundColor\)/,
  );
});
