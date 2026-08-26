// Textbox Border Opacity must ride the FreeText /AP stream.
// Live toolbar + flatten already honor rgba stroke, but
// attachCalloutFreeTextFillAppearance attached only when Fill was
// faded, so empty / opaque Fill left Acrobat an opaque leftover
// frame until Fill was re-touched faded. Distinct from leftover-18,
// textbox fillOpacity /ca, textbox stroke /Border width, first-create
// Border Opacity persist, and faded-fill wrap / textAlign /
// verticalAlign / dash. Opaque stroke still omits /AP. Dict /CA
// would fade the glyphs — stroke fade stays ExtGState /CA.
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
    id: `tb-stroke-opacity-ap-${patch.idSuffix || 'default'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 120,
    height: 28,
    text: 'Fade',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    backgroundColor: '',
    stroke: 'rgba(255, 0, 0, 0.4)',
    strokeWidth: 8,
    data: {
      id: `tb-stroke-opacity-ap-${patch.idSuffix || 'default'}`,
      type: 'textbox',
      tool: 'text',
    },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'textbox-stroke-opacity-export-ap-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

function annotAppearanceGs(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return {};
  const nRef = ap.get(PDFName.of('N'));
  const stream = nRef?.dict ? nRef : doc.context.lookup(nRef);
  if (!stream) return {};
  const streamDict = stream.dict || stream;
  const resources = lookupDict(doc, streamDict.lookup?.(PDFName.of('Resources')) || streamDict.get?.(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  if (!ext || typeof ext.entries !== 'function') return {};
  const result = {};
  for (const [, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const ca = gs.get?.(PDFName.of('ca'));
    const CA = gs.get?.(PDFName.of('CA'));
    if (ca != null) result.ca = ca.asNumber ? ca.asNumber() : Number(ca);
    if (CA != null) result.CA = CA.asNumber ? CA.asNumber() : Number(CA);
  }
  return result;
}

function dictRgb(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (!value || typeof value.asArray !== 'function') return null;
  return value.asArray().map((entry) => (entry?.asNumber ? entry.asNumber() : Number(entry)));
}

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (!value) return undefined;
  return value.asNumber ? value.asNumber() : Number(value);
}

function pageIndependentAlphas(doc, page) {
  const resources = lookupDict(doc, page.node.lookup(PDFName.of('Resources')) || page.node.get(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  const strokes = [];
  if (!ext || typeof ext.entries !== 'function') return { strokes };
  for (const [, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const CA = gs.get?.(PDFName.of('CA'));
    if (CA != null) strokes.push(CA.asNumber ? CA.asNumber() : Number(CA));
  }
  return { strokes };
}

async function exportTextbox(patch) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [makeTextbox(patch)] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-stroke-opacity-export-ap' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = annots.asArray().map((ref) => doc.context.lookup(ref))
    .find((entry) => dictText(entry, 'Subtype') === 'FreeText');
  return { doc, dict, gs: annotAppearanceGs(doc, dict) };
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
  const text = streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
  return { text, ...pageIndependentAlphas(doc, page) };
}

test('resolveTextboxBoxStroke keeps rgba Border Opacity on paint', () => {
  assert.equal(resolveTextboxBoxStroke({
    stroke: 'rgba(255, 0, 0, 0.4)',
    strokeWidth: 8,
  }).paint, 'rgba(255, 0, 0, 0.4)');
  assert.equal(resolveTextboxBoxStroke({
    stroke: 'rgba(255, 0, 0, 0.4)',
    strokeWidth: 8,
  }).opacity, 0.4);
  assert.equal(resolveTextboxBoxStroke({
    stroke: composeColorForPatch('#FF0000', 100),
    strokeWidth: 8,
  }).opacity, 1);
  assert.equal(resolveTextboxBoxStroke({
    stroke: 'rgba(255, 0, 0, 0.4)',
    strokeWidth: 0,
  }).visible, false);
});

test('empty-fill faded stroke writes /AP ExtGState /CA; omits /C /ca / dict /CA', async () => {
  const faded = await exportTextbox({ idSuffix: 'empty-fill' });
  assert.ok(faded.dict, 'faded-border textbox must export a FreeText');
  assert.equal(faded.dict.get(PDFName.of('C')), undefined, 'empty fill must not invent /C');
  assert.equal(dictNumber(faded.dict, 'CA'), undefined, 'stroke fade must not invent dict /CA (would fade glyphs)');
  assert.equal(faded.gs.ca, undefined, 'empty fill must not invent AP /ca');
  assert.ok(Math.abs((faded.gs.CA ?? -1) - 0.4) < 0.001, `AP /CA must be stroke 0.4 (got ${JSON.stringify(faded.gs)})`);
  assert.deepEqual(dictRgb(faded.dict, 'C'), null);
});

test('opaque fill + faded stroke writes /AP /CA; opaque stroke omits /AP', async () => {
  const fadedOnOpaque = await exportTextbox({
    idSuffix: 'opaque-fill',
    backgroundColor: '#FFFF00',
  });
  assert.deepEqual(dictRgb(fadedOnOpaque.dict, 'C'), [1, 1, 0], '/C stays the opaque fill hex');
  assert.equal(fadedOnOpaque.gs.ca, undefined, 'opaque fill must not invent AP /ca');
  assert.ok(
    Math.abs((fadedOnOpaque.gs.CA ?? -1) - 0.4) < 0.001,
    `opaque fill still needs stroke /CA 0.4 (got ${JSON.stringify(fadedOnOpaque.gs)})`,
  );

  const opaqueStroke = await exportTextbox({
    idSuffix: 'opaque-stroke',
    stroke: composeColorForPatch('#FF0000', 100),
  });
  assert.equal(opaqueStroke.dict.get(PDFName.of('AP')), undefined, 'opaque stroke + empty fill must still omit /AP');
  assert.equal(annotAppearanceGs(opaqueStroke.doc, opaqueStroke.dict).CA, undefined);

  const fadedFillAndStroke = await exportTextbox({
    idSuffix: 'both',
    backgroundColor: 'rgba(255, 255, 0, 0.4)',
  });
  assert.ok(Math.abs((fadedFillAndStroke.gs.ca ?? -1) - 0.4) < 0.001, 'fill fade stays AP /ca');
  assert.ok(Math.abs((fadedFillAndStroke.gs.CA ?? -1) - 0.4) < 0.001, 'stroke fade stays AP /CA');
});

test('print flatten already applies rgba Border Opacity; export host names the leftover', async () => {
  const faded = await flattenTextbox({ idSuffix: 'flatten' });
  assert.match(faded.text, /1\s+0\s+0\s+RG/, `faded flatten must still paint #FF0000 (got ${faded.text.slice(0, 240)})`);
  assert.ok(faded.strokes.some((value) => Math.abs(value - 0.4) < 0.001), `flatten /CA must be stroke 0.4 (got ${faded.strokes})`);

  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /used to attach only when Fill was faded/);
  assert.match(writer, /needsStrokeAp = Boolean\(boxStroke\.visible && boxStroke\.opacity < 0\.99999\)/);
  assert.match(writer, /needsStrokeGs \? \{ GS1: \{ Type: 'ExtGState', CA: strokeAlpha \} \}/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
