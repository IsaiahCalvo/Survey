// Callout Fill Opacity must ride FreeText /C + /AP ExtGState /ca.
// Live toolbar writes style.fillColor / fillOpacity. Export passed
// resolveCalloutBoxFill(style).hex, so fillOpacity 0 invented /C and a
// faded fill reached Acrobat opaque. Flatten already applied /ca.
// Distinct from callout fill COLOR /C (d623243d) and leftover-18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveCalloutBoxFill } from '../src/utils/annotationStyleCatalog.js';
import { defaultCalloutStyle } from '../src/components/Callout/types.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE_SIZES = { 1: { width: 200, height: 200 } };

function makeCallout(stylePatch = {}) {
  return {
    id: `callout-fill-opacity-${stylePatch.fillOpacity ?? 'default'}`,
    pageNumber: 1,
    arrowTip: { x: 0.10, y: 0.10 },
    knee: { x: 0.20, y: 0.20 },
    textBoxPosition: { x: 0.30, y: 0.20 },
    textBoxWidth: 0.30,
    textBoxHeight: 0.12,
    text: 'Fill',
    style: {
      ...defaultCalloutStyle,
      fillColor: '#FFFF00',
      fillOpacity: 0.4,
      ...stylePatch,
    },
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'callout-fill-opacity-source.pdf',
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

async function exportCallout(stylePatch) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    {},
    PAGE_SIZES,
    null,
    {
      returnBytes: true,
      actionType: 'pdf-export',
      documentId: 'callout-fill-opacity',
      callouts: [makeCallout(stylePatch)],
    },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  const text = dicts.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  return { doc, dict: text, gs: annotAppearanceGs(doc, text) };
}

async function flattenCallout(stylePatch) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    {},
    PAGE_SIZES,
    { returnBytes: true, callouts: [makeCallout(stylePatch)] },
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

test('resolveCalloutBoxFill keeps fillOpacity on paint and hides opacity-0', () => {
  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 0.4 }).paint, 'rgba(255, 255, 0, 0.4)');
  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 0.4 }).opacity, 0.4);
  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 0 }).visible, false);
  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 0 }).paint, 'transparent');
  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 1 }).paint, '#FFFF00');
});

test('annotated export writes FreeText /C + AP /ca from fillOpacity; opacity-0 omits /C', async () => {
  const faded = await exportCallout({ fillColor: '#FFFF00', fillOpacity: 0.4 });
  assert.ok(faded.dict, 'faded callout must export a FreeText');
  assert.deepEqual(dictRgb(faded.dict, 'C'), [1, 1, 0], '/C stays the fill hex');
  assert.ok(Math.abs((faded.gs.ca ?? -1) - 0.4) < 0.001, `AP /ca must be fill 0.4 (got ${JSON.stringify(faded.gs)})`);
  assert.equal(faded.gs.CA, undefined, 'fill fade must not invent ExtGState /CA');

  const opaque = await exportCallout({ fillColor: '#FFFF00', fillOpacity: 1 });
  assert.deepEqual(dictRgb(opaque.dict, 'C'), [1, 1, 0]);
  assert.equal(opaque.gs.ca, undefined, 'opaque fill must not invent AP /ca');

  const zero = await exportCallout({ fillColor: '#FFFF00', fillOpacity: 0 });
  assert.ok(zero.dict, 'opacity-0 callout must still export a FreeText');
  assert.equal(zero.dict.get(PDFName.of('C')), undefined, 'fillOpacity 0 must not invent /C');
  assert.equal(zero.gs.ca, undefined, 'fillOpacity 0 must not invent AP /ca');
});

test('print flatten applies fillOpacity and does not invent a fade for opaque', async () => {
  const faded = await flattenCallout({ fillColor: '#FFFF00', fillOpacity: 0.4 });
  assert.match(faded.text, /1\s+1\s+0\s+rg/, `faded flatten must still paint #FFFF00 (got ${faded.text.slice(0, 240)})`);
  assert.ok(faded.fills.some((value) => Math.abs(value - 0.4) < 0.001), `flatten /ca must be fill 0.4 (got ${faded.fills})`);

  const opaque = await flattenCallout({ fillColor: '#FFFF00', fillOpacity: 1 });
  assert.match(opaque.text, /1\s+1\s+0\s+rg/, 'opaque flatten still paints the fill color');
  assert.ok(opaque.fills.every((value) => value >= 0.999), `opaque flatten must not invent a fill fade (got ${opaque.fills})`);

  const zero = await flattenCallout({ fillColor: '#FFFF00', fillOpacity: 0 });
  assert.doesNotMatch(zero.text, /1\s+1\s+0\s+rg/, 'fillOpacity 0 must not print an opaque yellow box');
});

test('export/flatten hosts still name the callout fillOpacity /ca contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function resolveCalloutBoxFill/);
  assert.match(flatten, /backgroundColor: boxFill\.visible \? boxFill\.paint : 'transparent'/);
  assert.match(flatten, /attachCalloutFreeTextFillAppearance/);
  assert.match(flatten, /ExtGState: \{ GS0: \{ Type: 'ExtGState', ca: fillAlpha \} \}/);
  assert.doesNotMatch(flatten, /backgroundColor: resolveCalloutBoxFill\(style\)\.hex/);
});
