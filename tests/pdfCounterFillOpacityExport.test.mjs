// Counter Fill opacity must ride Circle /AP ExtGState /ca.
// Live toolbar writes fill as composeColorForPatch rgba (Counter colors
// Fill Opacity). Export Circle /AP painted the pin hex-only and a faded
// fill printed/exported opaque. Distinct from shape rect/ellipse
// independent /ca vs /CA, callout fillColor /C, and leftover-18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveShapeFill } from '../src/utils/annotationStyleCatalog.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeCounter(patch = {}) {
  return {
    id: `ctr-fill-${patch.idSuffix || 'default'}`,
    type: 'circle',
    left: 40,
    top: 40,
    radius: 14,
    fill: 'rgba(239, 68, 68, 0.4)',
    stroke: '#ffffff',
    strokeWidth: 1.5,
    opacity: 1,
    data: {
      id: `ctr-fill-${patch.idSuffix || 'default'}`,
      type: 'counter',
      seriesId: 's1',
      number: 1,
      displayNumber: 1,
      pointerAngle: 225,
      numberColor: '#ffffff',
    },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'counter-fill-opacity-source.pdf',
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

function pageIndependentAlphas(doc, page) {
  const resources = lookupDict(doc, page.node.lookup(PDFName.of('Resources')) || page.node.get(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  const fills = [];
  if (!ext || typeof ext.entries !== 'function') return { fills };
  for (const [, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const ca = gs.get?.(PDFName.of('ca'));
    if (ca != null) fills.push(ca.asNumber ? ca.asNumber() : Number(ca));
  }
  return { fills };
}

async function exportCounter(patch) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [makeCounter(patch)] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'counter-fill-opacity' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { doc, dict, gs: annotAppearanceGs(doc, dict) };
}

async function flattenCounter(patch) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [makeCounter(patch)] } },
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

test('resolveShapeFill maps live counter rgba fill', () => {
  assert.equal(resolveShapeFill({ fill: 'rgba(239, 68, 68, 0.4)' }).paint, 'rgba(239, 68, 68, 0.4)');
  assert.equal(resolveShapeFill({ fill: composeColorForPatch('#EF4444', 40) }).opacity, 0.4);
  assert.equal(resolveShapeFill({ fill: composeColorForPatch('#EF4444', 0) }).visible, false);
  assert.equal(resolveShapeFill({ fill: '#EF4444' }).opacity, 1);
});

test('annotated export writes Circle AP /ca from fill; opaque omits /ca; opacity-0 omits /IC', async () => {
  const faded = await exportCounter({ idSuffix: 'fade' });
  assert.deepEqual(
    dictRgb(faded.dict, 'IC')?.map((n) => Number(n.toFixed(3))),
    [0.937, 0.267, 0.267],
    '/IC stays the fill hex',
  );
  assert.equal(faded.dict.get(PDFName.of('CA')), undefined, 'faded counter must not share dict /CA with the number');
  assert.ok(Math.abs((faded.gs.ca ?? -1) - 0.4) < 0.001, `AP /ca must be fill 0.4 (got ${JSON.stringify(faded.gs)})`);
  assert.equal(faded.gs.CA, undefined, 'counter number must stay opaque (no ExtGState /CA)');

  const opaque = await exportCounter({
    idSuffix: 'opaque',
    fill: '#EF4444',
  });
  assert.equal(opaque.dict.get(PDFName.of('CA')), undefined, 'opaque counter must omit dict /CA');
  assert.equal(opaque.gs.ca, undefined, 'opaque fill must not invent AP /ca');

  const zero = await exportCounter({
    idSuffix: 'zero',
    fill: composeColorForPatch('#EF4444', 0),
  });
  assert.equal(zero.dict.get(PDFName.of('IC')), undefined, 'opacity-0 fill must not invent /IC');
  assert.equal(zero.gs.ca, undefined, 'opacity-0 fill must not invent AP /ca');
  assert.equal(dictNumber(zero.dict, 'CA'), undefined, 'opacity-0 fill must not invent dict /CA');
});

test('print flatten applies fill opacity and does not invent a fade for opaque', async () => {
  const faded = await flattenCounter({ idSuffix: 'flat-fade' });
  assert.match(
    faded.text,
    /0\.9372549019607843\s+0\.26666666666666666\s+0\.26666666666666666\s+rg/,
    `faded flatten must still paint #EF4444 (got ${faded.text.slice(0, 240)})`,
  );
  assert.ok(faded.fills.some((value) => Math.abs(value - 0.4) < 0.001), `flatten /ca must be fill 0.4 (got ${faded.fills})`);

  const opaque = await flattenCounter({ idSuffix: 'flat-opaque', fill: '#EF4444' });
  assert.match(opaque.text, /0\.9372549019607843\s+0\.26666666666666666\s+0\.26666666666666666\s+rg/, 'opaque flatten still paints the fill color');
  assert.ok(opaque.fills.every((value) => value >= 0.999), `opaque flatten must not invent a fill fade (got ${opaque.fills})`);

  const zero = await flattenCounter({
    idSuffix: 'flat-zero',
    fill: composeColorForPatch('#EF4444', 0),
  });
  assert.ok(
    zero.fills.some((value) => value <= 0.001),
    `opacity-0 fill must flatten at /ca 0, not opaque (got fills=${zero.fills})`,
  );
});

test('export/flatten hosts still name the counter fill /ca contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(flatten, /Independent fade lives in ExtGState \/ca so/);
  assert.match(flatten, /const paintBody = Boolean\(fill\?\.visible && fill\.hex\)/);
  assert.match(flatten, /if \(needsFillGs\) content\.push\('\/GS0 gs'\)/);
  assert.match(flatten, /GS0: \{ Type: 'ExtGState', ca: fillAlpha \}/);
});
