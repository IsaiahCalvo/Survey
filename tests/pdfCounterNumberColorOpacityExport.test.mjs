// Counter Number color opacity must ride Circle /AP ExtGState GS1 /ca.
// Live toolbar writes numberColor as composeColorForPatch rgba (Counter
// colors Number Opacity). Export Circle /AP painted the label hex-only
// after the Fill /ca reset, so a faded Number printed/exported opaque.
// Flatten already applies parsePdfDrawColor opacity. Distinct from
// Counter Fill Circle /ca, Counter first-pin fillOpacity, and leftover-18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveCounterNumberColor } from '../src/utils/annotationStyleCatalog.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeCounter(patch = {}) {
  const { data: dataPatch, ...rest } = patch;
  return {
    id: `ctr-number-${patch.idSuffix || 'default'}`,
    type: 'circle',
    left: 40,
    top: 40,
    radius: 14,
    fill: '#EF4444',
    stroke: '#ffffff',
    strokeWidth: 1.5,
    opacity: 1,
    data: {
      id: `ctr-number-${patch.idSuffix || 'default'}`,
      type: 'counter',
      seriesId: 's1',
      number: 1,
      displayNumber: 1,
      pointerAngle: 225,
      numberColor: 'rgba(255, 255, 255, 0.4)',
      ...(dataPatch || {}),
    },
    ...rest,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'counter-number-color-opacity-source.pdf',
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
  const named = {};
  const cas = [];
  if (!ext || typeof ext.entries !== 'function') return { named, cas };
  for (const [name, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const key = name?.decodeText ? name.decodeText() : String(name || '');
    const ca = gs.get?.(PDFName.of('ca'));
    const CA = gs.get?.(PDFName.of('CA'));
    const row = {};
    if (ca != null) {
      row.ca = ca.asNumber ? ca.asNumber() : Number(ca);
      cas.push(row.ca);
    }
    if (CA != null) row.CA = CA.asNumber ? CA.asNumber() : Number(CA);
    named[key.replace(/^\/+/, '')] = row;
  }
  return { named, cas };
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
    { returnBytes: true, actionType: 'pdf-export', documentId: 'counter-number-color-opacity' },
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

test('resolveCounterNumberColor maps live Number rgba', () => {
  assert.equal(resolveCounterNumberColor({ data: { numberColor: 'rgba(255, 255, 255, 0.4)' } }).paint, 'rgba(255, 255, 255, 0.4)');
  assert.equal(resolveCounterNumberColor({ data: { numberColor: composeColorForPatch('#FFFFFF', 40) } }).opacity, 0.4);
  assert.equal(resolveCounterNumberColor({ data: { numberColor: composeColorForPatch('#FFFFFF', 0) } }).visible, false);
  assert.equal(resolveCounterNumberColor({ data: { numberColor: '#FFFFFF' } }).opacity, 1);
});

test('annotated export writes Circle AP GS1 /ca from Number; opaque omits GS1; opacity-0 still /ca 0', async () => {
  const faded = await exportCounter({ idSuffix: 'fade' });
  assert.equal(faded.dict.get(PDFName.of('CA')), undefined, 'faded Number must not share dict /CA with the pin');
  assert.equal(faded.gs.named.GS0, undefined, 'opaque fill must not invent GS0');
  assert.ok(Math.abs((faded.gs.named.GS1?.ca ?? -1) - 0.4) < 0.001, `AP GS1 /ca must be Number 0.4 (got ${JSON.stringify(faded.gs)})`);
  assert.equal(faded.gs.named.GS1?.CA, undefined, 'Number fade is /ca, not /CA');

  const opaque = await exportCounter({
    idSuffix: 'opaque',
    data: { numberColor: '#FFFFFF' },
  });
  assert.equal(opaque.dict.get(PDFName.of('CA')), undefined, 'opaque Number must omit dict /CA');
  assert.equal(opaque.gs.named.GS1, undefined, 'opaque Number must not invent GS1 /ca');

  const zero = await exportCounter({
    idSuffix: 'zero',
    data: { numberColor: composeColorForPatch('#FFFFFF', 0) },
  });
  assert.ok(Math.abs((zero.gs.named.GS1?.ca ?? -1) - 0) < 0.001, `opacity-0 Number must write GS1 /ca 0 (got ${JSON.stringify(zero.gs)})`);
  assert.equal(dictNumber(zero.dict, 'CA'), undefined, 'opacity-0 Number must not invent dict /CA');
});

test('print flatten applies Number opacity and does not invent a fade for opaque', async () => {
  const faded = await flattenCounter({ idSuffix: 'flat-fade' });
  assert.ok(faded.fills.some((value) => Math.abs(value - 0.4) < 0.001), `flatten /ca must include Number 0.4 (got ${faded.fills})`);

  const opaque = await flattenCounter({
    idSuffix: 'flat-opaque',
    data: { numberColor: '#FFFFFF' },
  });
  assert.ok(opaque.fills.every((value) => value >= 0.999), `opaque Number flatten must not invent a fade (got ${opaque.fills})`);

  const zero = await flattenCounter({
    idSuffix: 'flat-zero',
    data: { numberColor: composeColorForPatch('#FFFFFF', 0) },
  });
  assert.ok(
    zero.fills.some((value) => value <= 0.001),
    `opacity-0 Number must flatten at /ca 0, not opaque (got fills=${zero.fills})`,
  );
});

test('export/flatten hosts still name the counter Number /ca contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(flatten, /resolveCounterNumberColor/);
  assert.match(flatten, /const needsNumberGs = numberAlpha < 0\.99999/);
  assert.match(flatten, /if \(needsNumberGs\) content\.push\('\/GS1 gs'\)/);
  assert.match(flatten, /GS1: \{ Type: 'ExtGState', ca: numberAlpha \}/);
  assert.match(read('src/utils/annotationStyleCatalog.js'), /export function resolveCounterNumberColor/);
});
