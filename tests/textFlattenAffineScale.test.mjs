// Text/textbox export + print: honor unbaked scaleX/scaleY.
// Individual SVG resize and text-edit commit bake scale to 1. Group-resize
// (mixed selection) leaves scale on the object; screen (renderText) uses
// width*|scaleX|. fontSize stays unscaled — same as the renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const PAGE = 200;
const PAGE_SIZES = { 1: { width: PAGE, height: PAGE } };

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE, PAGE]);
  const bytes = await doc.save();
  return {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function numberArray(dict, key) {
  const value = dict.get(PDFName.of(key));
  return value ? value.asArray().map((n) => n.asNumber()) : null;
}

async function exportObject(obj) {
  const bytes = await savePDFWithAnnotationsPdfLib(await makePdfFile(), {
    1: { objects: [obj] },
  }, PAGE_SIZES, null, { returnBytes: true });
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'expected an exported annotation');
  return doc.context.lookup(annots.asArray()[0]);
}

async function flattenContent(obj) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [obj] } },
    PAGE_SIZES,
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

function countTextShows(contentText) {
  return (contentText.match(/Tj\b/g) || []).length;
}

const SCALED_BOX = {
  type: 'textbox',
  left: 10,
  top: 20,
  width: 40,
  height: 16,
  scaleX: 2,
  scaleY: 2,
  text: 'Note',
  fill: '#111111',
  fontSize: 12,
};

test('intended: FreeText /Rect uses width*|scaleX| and height*|scaleY|', async () => {
  const dict = await exportObject(SCALED_BOX);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'FreeText');
  // Screen box 80×32: [10, 200-(20+32)=148, 90, 180]
  assert.deepEqual(numberArray(dict, 'Rect'), [10, 148, 90, 180]);
});

test('break: unscaled textbox /Rect is not written when scaleX=2', async () => {
  const dict = await exportObject(SCALED_BOX);
  const unscaled = [10, PAGE - (20 + 16), 10 + 40, PAGE - 20];
  assert.notDeepEqual(numberArray(dict, 'Rect'), unscaled);
});

test('edge: scale default 1 unchanged; scaleX/scaleY stretch independently', async () => {
  const unit = await exportObject({
    type: 'textbox',
    left: 10,
    top: 20,
    width: 40,
    height: 16,
    text: 'Note',
    fill: '#111111',
    fontSize: 12,
  });
  assert.deepEqual(numberArray(unit, 'Rect'), [10, PAGE - (20 + 16), 50, PAGE - 20]);

  const stretched = await exportObject({
    type: 'textbox',
    left: 10,
    top: 20,
    width: 40,
    height: 16,
    scaleX: 2,
    scaleY: 3,
    text: 'Note',
    fill: '#111111',
    fontSize: 12,
  });
  assert.deepEqual(numberArray(stretched, 'Rect'), [10, PAGE - (20 + 48), 90, PAGE - 20]);
});

test('intended: print wrap width honors scaleX (one line at 80, not two at 40)', async () => {
  const scaled = await flattenContent({
    type: 'textbox',
    left: 10,
    top: 20,
    width: 40,
    height: 40,
    scaleX: 2,
    scaleY: 1,
    text: 'AAAA BBBB',
    fill: '#000000',
    fontSize: 12,
  });
  assert.equal(countTextShows(scaled), 1, `scaled wrap should stay one line\n${scaled}`);
});

test('break: print wrap at raw width=40 is not used when scaleX=2', async () => {
  const raw = await flattenContent({
    type: 'textbox',
    left: 10,
    top: 20,
    width: 40,
    height: 40,
    text: 'AAAA BBBB',
    fill: '#000000',
    fontSize: 12,
  });
  assert.ok(countTextShows(raw) >= 2, `unscaled width=40 must wrap\n${raw}`);

  const scaled = await flattenContent({
    type: 'textbox',
    left: 10,
    top: 20,
    width: 40,
    height: 40,
    scaleX: 2,
    scaleY: 1,
    text: 'AAAA BBBB',
    fill: '#000000',
    fontSize: 12,
  });
  assert.notEqual(countTextShows(scaled), countTextShows(raw));
});
