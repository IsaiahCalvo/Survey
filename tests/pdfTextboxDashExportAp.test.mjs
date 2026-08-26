// Textbox Style dash must ride the faded-fill FreeText /AP stream.
// Live toolbar already stamps strokeDashArray and /BS, and flatten
// already writes borderDashArray, but attachCalloutFreeTextFillAppearance
// painted fill+text only (`re f`, no stroke) so Acrobat stayed unframed
// until Style was re-touched. Distinct from leftover-18, textbox
// first-create dash /BS, textbox fillOpacity /ca, Ellipse /AP dash,
// and Line / Callout leader /BS (those writers have no /AP). Opaque
// fill still omits /AP so /BS stays the native path. Do not invent
// Square / Circle /BS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-dash-export-ap-${patch.idSuffix || 'default'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 120,
    height: 28,
    text: 'Y',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    backgroundColor: 'rgba(255, 255, 0, 0.4)',
    stroke: '#000000',
    strokeWidth: 2,
    strokeDashArray: [6, 4],
    data: {
      id: `tb-dash-export-ap-${patch.idSuffix || 'default'}`,
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
    name: 'textbox-dash-export-ap-source.pdf',
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

async function exportTextbox(patch) {
  const box = makeTextbox(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-dash-export-ap' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  return {
    box,
    doc,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    bs: readBsDash(doc, dict),
    ap: dict.get(PDFName.of('AP')) != null,
    apText: readApStream(doc, dict),
  };
}

test('faded dashed textbox stamps strokeDashArray [6,4]', () => {
  const box = makeTextbox({ idSuffix: 'stamp' });
  assert.deepEqual(box.strokeDashArray, [6, 4]);
  assert.match(String(box.type), /textbox/i);
  assert.match(String(box.backgroundColor), /0\.4/);
});

test('annotated export writes faded textbox dash in /AP stream and keeps /BS', async () => {
  const dashed = await exportTextbox({ idSuffix: 'dashed' });
  assert.match(String(dashed.subtype), /FreeText/);
  assert.equal(dashed.ap, true, 'faded fill already writes /AP');
  assert.match(
    dashed.apText,
    /\[6 4\] 0 d/,
    `dashed /AP must set the [6 4] dash pattern (got ${dashed.apText.slice(0, 240)})`,
  );
  assert.match(dashed.apText, /\sS\b/, 'dashed /AP must stroke the frame');
  assert.deepEqual(dashed.bs, [6, 4], 'keep existing /BS — do not invent a leftover by dropping it');
});

test('faded solid textbox /AP omits a non-empty dash; opaque dashed omits /AP', async () => {
  const solid = await exportTextbox({
    idSuffix: 'solid',
    strokeDashArray: null,
  });
  assert.match(String(solid.subtype), /FreeText/);
  assert.equal(solid.ap, true);
  assert.equal(solid.bs, null, 'solid textbox must omit /BS');
  assert.match(solid.apText, /\sS\b/, 'faded solid /AP still strokes the live Border');
  assert.doesNotMatch(
    solid.apText,
    /\[\s*[1-9]/,
    'solid /AP must not emit a non-empty dash-setting op',
  );

  const opaque = await exportTextbox({
    idSuffix: 'opaque',
    backgroundColor: composeColorForPatch('#FFFF00', 100),
  });
  assert.equal(opaque.ap, false, 'opaque fill must still omit /AP so /BS stays the native path');
  assert.deepEqual(opaque.bs, [6, 4]);
});

test('export host still names the textbox /AP dash contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /this \/AP used to paint fill\+text only/);
  assert.match(writer, /stroke\.dash\.map\(n\)\.join\(' '\)\}\] 0 d/);
  assert.match(writer, /Callout boxes pass the live box frame/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
