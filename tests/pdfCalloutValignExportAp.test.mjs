// Callout faded-fill FreeText /AP + flatten must bake the live
// screen-center contract (buildCalloutTextContentStyle justifyContent
// center). Live Color Fill Opacity already attached /AP, but the
// writer passed no verticalAlign so Acrobat / print stayed leftover
// top until Fill was re-touched opaque (which omits /AP). Distinct
// from leftover-18, textbox verticalAlign /AP Tm y, callout box /AP
// dash, and callout leader /L. Opaque fill still omits /AP. Do not
// invent a user-settable callout verticalAlign control. Do not invent
// callout Rotation or Line /AP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { defaultCalloutStyle } from '../src/components/Callout/types.js';
import { flattenedTextBlockOffset } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE_SIZES = { 1: { width: 200, height: 200 } };
const FONT_SIZE = 14;
const TEXT_PAD = 4;

function makeCallout(patch = {}) {
  return {
    id: `callout-valign-export-ap-${patch.idSuffix || 'default'}`,
    pageNumber: 1,
    arrowTip: { x: 0.10, y: 0.10 },
    knee: { x: 0.20, y: 0.20 },
    textBoxPosition: { x: 0.30, y: 0.18 },
    textBoxWidth: 0.30,
    textBoxHeight: 0.40,
    text: 'Hi',
    style: {
      ...defaultCalloutStyle,
      fillColor: '#FFFF00',
      fillOpacity: 0.4,
      ...(patch.style || {}),
    },
    ...patch,
  };
}

function exportedBoxHeight(callout) {
  return Math.max(18, Number(callout.textBoxHeight) * PAGE_SIZES[1].height);
}

function leftoverTopY(formHeight, fontSize = FONT_SIZE) {
  const size = Math.max(4, Number(fontSize) || 12);
  return Math.max(2, formHeight - size - TEXT_PAD);
}

function screenCenterY(formHeight, fontSize = FONT_SIZE) {
  const size = Math.max(4, Number(fontSize) || 12);
  const innerHeight = Math.max(0, formHeight - 2 * TEXT_PAD);
  const extraDown = flattenedTextBlockOffset(innerHeight, size, 'middle');
  return Math.max(2, formHeight - size - TEXT_PAD - extraDown);
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'callout-valign-export-ap-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function dictText(dict, key) {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : String(value || '');
}

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

function readApStream(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return '';
  const nRef = ap.get(PDFName.of('N'));
  const normal = lookupDict(doc, nRef);
  if (!normal) return '';
  return new TextDecoder('latin1').decode(decodePDFRawStream(normal).decode());
}

function appearanceTextY(apText) {
  const match = String(apText || '').match(/1\s+0\s+0\s+1\s+[\d.]+\s+([\d.]+)\s+Tm/);
  return match ? Number(match[1]) : null;
}

async function exportCallout(patch) {
  const callout = makeCallout(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    {},
    PAGE_SIZES,
    null,
    {
      returnBytes: true,
      actionType: 'pdf-export',
      documentId: 'callout-valign-export-ap',
      callouts: [callout],
    },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  const text = dicts.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  const lines = dicts.filter((dict) => dictText(dict, 'Subtype') === 'Line');
  const formHeight = exportedBoxHeight(callout);
  return {
    callout,
    dict: text,
    ap: text?.get(PDFName.of('AP')) != null,
    apText: text ? readApStream(doc, text) : '',
    tmY: text ? appearanceTextY(readApStream(doc, text)) : null,
    leftoverTop: leftoverTopY(formHeight),
    screenCenter: screenCenterY(formHeight),
    lineAp: lines.map((dict) => dict.get(PDFName.of('AP')) != null),
  };
}

async function flattenCallout(patch) {
  const callout = makeCallout(patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    {},
    PAGE_SIZES,
    { returnBytes: true, callouts: [callout] },
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

test('faded tall callout stamps fill 0.4 and screen-center sits below leftover top', () => {
  const callout = makeCallout({ idSuffix: 'stamp' });
  const formHeight = exportedBoxHeight(callout);
  assert.equal(callout.style.fillOpacity, 0.4);
  assert.match(String(callout.text), /Hi/);
  assert.equal(leftoverTopY(formHeight), 62);
  assert.ok(
    screenCenterY(formHeight) < leftoverTopY(formHeight) - 20,
    'tall box must leave leftover top and screen-center far apart',
  );
  assert.equal(flattenedTextBlockOffset(72, 14, 'top'), 0);
  assert.ok(flattenedTextBlockOffset(72, 14, 'middle') > 20);
});

test('annotated export writes faded callout screen-center in /AP stream Tm y', async () => {
  const faded = await exportCallout({ idSuffix: 'faded' });
  assert.ok(faded.dict, 'faded callout must export a FreeText');
  assert.equal(faded.ap, true, 'faded fill already writes /AP');
  assert.ok(Number.isFinite(faded.tmY), `faded /AP must place text (got ${faded.apText.slice(0, 240)})`);
  assert.ok(
    faded.tmY < faded.leftoverTop - 20,
    `faded /AP Tm y ${faded.tmY} must sit below leftover top ${faded.leftoverTop}`,
  );
  assert.equal(faded.tmY, faded.screenCenter, 'faded /AP Tm y must match the screen-center contract');
  assert.deepEqual(faded.lineAp, [false, false], 'do not invent Line /AP');
});

test('faded leftover-top is not used; opaque fill still omits /AP; flatten leaves leftover top', async () => {
  const faded = await exportCallout({ idSuffix: 'not-top' });
  assert.notEqual(faded.tmY, faded.leftoverTop, 'faded /AP must not stay leftover top');

  const opaque = await exportCallout({
    idSuffix: 'opaque',
    style: { fillColor: '#FFFF00', fillOpacity: 1 },
  });
  assert.equal(opaque.ap, false, 'opaque fill must still omit /AP so /BS stays the native path');
  assert.deepEqual(opaque.lineAp, [false, false], 'do not invent Line /AP');

  const flat = await flattenCallout({ idSuffix: 'flat' });
  assert.match(flat, /<4869> Tj/, `flatten must still paint glyphs (got ${flat.slice(0, 280)})`);
  const flattenTm = String(flat).match(/1\s+0\s+0\s+1\s+[\d.]+\s+([\d.]+)\s+Tm/);
  const flattenY = flattenTm ? Number(flattenTm[1]) : null;
  // Leftover top flatten parks at pageHeight - (boxTop+4 + fontSize+2).
  // textBox y=0.18 h=0.40 on a 200 page → 200 - (36+4+16) = 144.
  const leftoverFlattenY = PAGE_SIZES[1].height
    - (makeCallout().textBoxPosition.y * PAGE_SIZES[1].height + 4 + FONT_SIZE + 2);
  assert.ok(Number.isFinite(flattenY), 'flatten must place a Tm y');
  assert.ok(
    flattenY < leftoverFlattenY - 15,
    `flatten Tm y ${flattenY} must sit below leftover top ${leftoverFlattenY}`,
  );
});

test('export host still names the callout screen-center /AP contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /justifyContent center/);
  assert.match(writer, /verticalAlign: 'middle'/);
  assert.match(writer, /do not invent a user-settable callout/);
  assert.match(writer, /Faded-fill \/AP used leftover top/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
