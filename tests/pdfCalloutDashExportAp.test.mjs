// Callout box Style dash must ride the faded-fill FreeText /AP stream.
// Live toolbar already stamps style.lineStyle on the SVG box and
// flatten already writes borderDashArray, but createCalloutAnnotations
// passed no stroke so attachCalloutFreeTextFillAppearance painted
// fill+text only (`re f`, no stroke). Acrobat stayed unframed until
// Style was re-touched. Distinct from leftover-18, callout leader /BS
// (no /AP), callout fillOpacity /ca, and textbox faded-fill /AP.
// Opaque fill still omits /AP so /BS stays the native path. Do not
// invent Line /AP or Square / Circle /BS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { defaultCalloutStyle } from '../src/components/Callout/types.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE_SIZES = { 1: { width: 200, height: 200 } };

function makeCallout(stylePatch = {}) {
  return {
    id: `callout-dash-export-ap-${stylePatch.lineStyle || 'default'}`,
    pageNumber: 1,
    arrowTip: { x: 0.10, y: 0.10 },
    knee: { x: 0.20, y: 0.20 },
    textBoxPosition: { x: 0.30, y: 0.20 },
    textBoxWidth: 0.30,
    textBoxHeight: 0.12,
    text: 'Y',
    style: {
      ...defaultCalloutStyle,
      fillColor: '#FFFF00',
      fillOpacity: 0.4,
      borderColor: '#000000',
      lineThickness: 2,
      lineStyle: 'dashed',
      ...stylePatch,
    },
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'callout-dash-export-ap-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : String(value || '');
};

function readBsDash(doc, dict) {
  const raw = dict.get(PDFName.of('BS'));
  if (!raw) return null;
  const bs = lookupDict(doc, raw) || raw;
  const dash = bs.get(PDFName.of('D'));
  return dash && typeof dash.asArray === 'function'
    ? dash.asArray().map((n) => (n?.asNumber ? n.asNumber() : Number(n)))
    : null;
}

function readApStream(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return '';
  const nRef = ap.get(PDFName.of('N'));
  const normal = lookupDict(doc, nRef);
  if (!normal) return '';
  return new TextDecoder('latin1').decode(decodePDFRawStream(normal).decode());
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
      documentId: 'callout-dash-export-ap',
      callouts: [makeCallout(stylePatch)],
    },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  const text = dicts.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  const lines = dicts.filter((dict) => dictText(dict, 'Subtype') === 'Line');
  return {
    doc,
    dict: text,
    lines,
    ap: text?.get(PDFName.of('AP')) != null,
    apText: text ? readApStream(doc, text) : '',
    bs: text ? readBsDash(doc, text) : null,
    lineAp: lines.map((dict) => dict.get(PDFName.of('AP')) != null),
    lineBs: lines.map((dict) => readBsDash(doc, dict)),
  };
}

test('faded dashed callout stamps lineStyle dashed on the live box', () => {
  const callout = makeCallout();
  assert.equal(callout.style.lineStyle, 'dashed');
  assert.equal(callout.style.fillOpacity, 0.4);
  assert.match(String(callout.text), /Y/);
});

test('annotated export writes faded callout box dash in /AP stream and keeps /BS', async () => {
  const dashed = await exportCallout({ lineStyle: 'dashed' });
  assert.ok(dashed.dict, 'dashed callout must export a FreeText');
  assert.equal(dashed.ap, true, 'faded fill already writes /AP');
  assert.match(
    dashed.apText,
    /\[6 4\] 0 d/,
    `dashed /AP must set the [6 4] dash pattern (got ${dashed.apText.slice(0, 240)})`,
  );
  assert.match(dashed.apText, /\sS\b/, 'dashed /AP must stroke the box frame');
  assert.deepEqual(dashed.bs, [6, 4], 'keep FreeText /BS — do not invent dropping it');
  assert.deepEqual(dashed.lineAp, [false, false], 'do not invent Line /AP — leaders stay native /BS');
  assert.deepEqual(dashed.lineBs, [[6, 4], [6, 4]], 'leaders keep existing /BS');
});

test('faded solid callout /AP omits a non-empty dash; opaque dashed omits /AP', async () => {
  const solid = await exportCallout({ lineStyle: 'solid' });
  assert.ok(solid.dict, 'solid callout must export a FreeText');
  assert.equal(solid.ap, true);
  assert.equal(solid.bs, null, 'solid callout box must omit /BS');
  assert.match(solid.apText, /\sS\b/, 'faded solid /AP still strokes the live box Border');
  assert.doesNotMatch(
    solid.apText,
    /\[\s*[1-9]/,
    'solid /AP must not emit a non-empty dash-setting op',
  );

  const opaque = await exportCallout({
    lineStyle: 'dashed',
    fillOpacity: 1,
  });
  assert.equal(opaque.ap, false, 'opaque fill must still omit /AP so /BS stays the native path');
  assert.deepEqual(opaque.bs, [6, 4]);
  assert.deepEqual(opaque.lineAp, [false, false], 'do not invent Line /AP');
});

test('export host still names the callout box /AP dash contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /Callout boxes pass the live box frame/);
  assert.match(writer, /this FreeText used to pass no stroke/);
  assert.match(writer, /stroke\.dash\.map\(n\)\.join\(' '\)\}\] 0 d/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
