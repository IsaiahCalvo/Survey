// Shape Fill vs Border opacity must ride independent ExtGState /ca vs /CA.
// Live toolbar writes fill/stroke as composeAnnotationColor rgba. Export
// Square/Circle wrote /C+/IC from hex only and a single dict /CA cannot
// represent both, so a faded fill printed and exported opaque (or a shared
// /CA faded the border too). Distinct from callout borderOpacity Line /CA
// and textbox fill /C / stroke /Border.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveShapeFill, resolveShapeStroke } from '../src/utils/annotationStyleCatalog.js';
import { composeAnnotationColor } from '../src/utils/annotationCreationCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeRect(patch = {}) {
  return {
    id: `shape-fill-stroke-${patch.idSuffix || 'default'}`,
    type: 'rect',
    left: 20,
    top: 30,
    width: 80,
    height: 50,
    fill: 'rgba(255, 0, 0, 0.4)',
    stroke: 'rgba(0, 0, 255, 1)',
    strokeWidth: 2,
    data: { id: `shape-fill-stroke-${patch.idSuffix || 'default'}`, type: 'rect', tool: 'rect' },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'shape-fill-stroke-opacity-source.pdf',
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

function dictRgb(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (!value || typeof value.asArray !== 'function') return null;
  return value.asArray().map((entry) => (entry?.asNumber ? entry.asNumber() : Number(entry)));
}

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

async function exportRect(patch) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [makeRect(patch)] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'shape-fill-stroke' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { doc, dict, gs: annotAppearanceGs(doc, dict) };
}

function pageIndependentAlphas(doc, page) {
  const resources = lookupDict(doc, page.node.lookup(PDFName.of('Resources')) || page.node.get(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  const fills = [];
  const strokes = [];
  if (!ext || typeof ext.entries !== 'function') return { fills, strokes };
  for (const [, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const ca = gs.get?.(PDFName.of('ca'));
    const CA = gs.get?.(PDFName.of('CA'));
    if (ca != null) fills.push(ca.asNumber ? ca.asNumber() : Number(ca));
    if (CA != null) strokes.push(CA.asNumber ? CA.asNumber() : Number(CA));
  }
  return { fills, strokes };
}

async function flattenRect(patch) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [makeRect(patch)] } },
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

test('resolveShapeFill / resolveShapeStroke map live rgba and leftover dash', () => {
  assert.deepEqual(resolveShapeFill({}), {
    hex: null,
    opacity: 0,
    visible: false,
    paint: 'transparent',
  });
  assert.equal(resolveShapeFill({ fill: '#ff0000' }).hex, '#FF0000');
  assert.equal(resolveShapeFill({ fill: 'rgba(255, 0, 0, 0.4)' }).paint, 'rgba(255, 0, 0, 0.4)');
  assert.equal(resolveShapeFill({ fill: 'rgba(255, 0, 0, 0.4)' }).hex, '#FF0000');
  assert.equal(resolveShapeFill({ fill: composeAnnotationColor('#FF0000', 0) }).visible, false);
  assert.equal(resolveShapeFill({ fill: 'rgba(255, 255, 255, 0)' }).visible, false);
  assert.equal(resolveShapeFill({ fill: 'transparent' }).visible, false);

  assert.equal(resolveShapeStroke({ stroke: '#0000FF', strokeWidth: 2 }).hex, '#0000FF');
  assert.equal(resolveShapeStroke({ stroke: 'rgba(0, 0, 255, 0.2)', strokeWidth: 2 }).opacity, 0.2);
  assert.equal(resolveShapeStroke({ stroke: '#0000FF', strokeWidth: 0 }).visible, false);
  assert.deepEqual(
    resolveShapeStroke({
      stroke: '#00FF00',
      strokeWidth: 3,
      strokeDashArray: [6, 4],
    }).dash,
    [6, 4],
  );
});

test('annotated export keeps fill /ca independent of stroke /CA', async () => {
  const fadedFill = await exportRect({
    idSuffix: 'fill-fade',
    fill: 'rgba(255, 0, 0, 0.4)',
    stroke: 'rgba(0, 0, 255, 1)',
  });
  assert.deepEqual(dictRgb(fadedFill.dict, 'C'), [0, 0, 1], '/C stays the stroke hex');
  assert.deepEqual(dictRgb(fadedFill.dict, 'IC'), [1, 0, 0], '/IC stays the fill hex');
  assert.equal(fadedFill.dict.get(PDFName.of('CA')), undefined, 'faded fill must not share dict /CA with the border');
  assert.ok(Math.abs((fadedFill.gs.ca ?? -1) - 0.4) < 0.001, `AP /ca must be fill 0.4 (got ${JSON.stringify(fadedFill.gs)})`);
  assert.equal(fadedFill.gs.CA, undefined, 'opaque stroke must omit ExtGState /CA');

  const divergent = await exportRect({
    idSuffix: 'divergent',
    fill: 'rgba(255, 0, 0, 0.4)',
    stroke: 'rgba(0, 0, 255, 0.2)',
  });
  assert.equal(divergent.dict.get(PDFName.of('CA')), undefined, 'divergent alphas must not share dict /CA');
  assert.ok(Math.abs((divergent.gs.ca ?? -1) - 0.4) < 0.001, `AP /ca must stay fill 0.4 (got ${JSON.stringify(divergent.gs)})`);
  assert.ok(Math.abs((divergent.gs.CA ?? -1) - 0.2) < 0.001, `AP /CA must stay stroke 0.2 (got ${JSON.stringify(divergent.gs)})`);

  const strokeOnly = await exportRect({
    idSuffix: 'stroke-only',
    fill: 'rgba(255, 255, 255, 0)',
    stroke: 'rgba(0, 0, 255, 0.4)',
  });
  assert.equal(strokeOnly.dict.get(PDFName.of('IC')), undefined, 'opacity-0 fill must not invent /IC');
  assert.equal(dictNumber(strokeOnly.dict, 'CA'), 0.4, 'stroke-only fade may use dict /CA');

  const opaque = await exportRect({
    idSuffix: 'opaque',
    fill: '#FF0000',
    stroke: '#0000FF',
  });
  assert.equal(opaque.dict.get(PDFName.of('CA')), undefined, 'opaque Square must omit dict /CA');
  assert.equal(opaque.gs.ca, undefined, 'opaque fill must not invent AP /ca');
  assert.equal(opaque.gs.CA, undefined, 'opaque stroke must not invent AP /CA');
});

test('print flatten applies independent fill /ca vs stroke /CA and skips opacity-0 fill', async () => {
  const faded = await flattenRect({
    idSuffix: 'flat-divergent',
    fill: 'rgba(255, 0, 0, 0.4)',
    stroke: 'rgba(0, 0, 255, 0.2)',
  });
  assert.match(faded.text, /1\s+0\s+0\s+rg/, `red flatten must fill #FF0000 (got ${faded.text.slice(0, 240)})`);
  assert.match(faded.text, /0\s+0\s+1\s+RG/, `blue flatten must stroke #0000FF (got ${faded.text.slice(0, 240)})`);
  assert.ok(faded.fills.some((value) => Math.abs(value - 0.4) < 0.001), `flatten /ca must be fill 0.4 (got ${faded.fills})`);
  assert.ok(faded.strokes.some((value) => Math.abs(value - 0.2) < 0.001), `flatten /CA must be stroke 0.2 (got ${faded.strokes})`);

  const opaque = await flattenRect({
    idSuffix: 'flat-opaque',
    fill: '#FF0000',
    stroke: '#0000FF',
  });
  assert.match(opaque.text, /1\s+0\s+0\s+rg/, 'opaque flatten still paints the fill color');
  assert.ok(opaque.fills.every((value) => value >= 0.999), `opaque flatten must not invent a fill fade (got ${opaque.fills})`);
  assert.ok(opaque.strokes.every((value) => value >= 0.999), `opaque flatten must not invent a stroke fade (got ${opaque.strokes})`);

  const zeroFill = await flattenRect({
    idSuffix: 'flat-zero-fill',
    fill: 'rgba(255, 0, 0, 0)',
    stroke: '#0000FF',
  });
  assert.doesNotMatch(zeroFill.text, /1\s+0\s+0\s+rg/, `opacity-0 fill must not invent opaque red (got ${zeroFill.text.slice(0, 240)})`);
  assert.match(zeroFill.text, /0\s+0\s+1\s+RG/, 'opacity-0 fill still strokes the live border');
});

test('export/flatten hosts still name the independent shape /ca vs /CA contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function resolveShapeFill/);
  assert.match(catalog, /export function resolveShapeStroke/);
  assert.match(flatten, /const attachIndependentShapeAppearance = /);
  assert.match(flatten, /resolveLiveShapeFill\(fabricObj\)/);
  assert.match(flatten, /if \(!fill\?\.visible && needsStrokeGs\) annotationDict\.CA = strokeAlpha/);
});
