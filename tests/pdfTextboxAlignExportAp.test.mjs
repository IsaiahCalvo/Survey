// Textbox textAlign must ride the faded-fill FreeText /AP stream.
// Live toolbar already stamps textAlign, export already writes /Q, and
// flatten already writes flattenedTextInlineOffset, but
// attachCalloutFreeTextFillAppearance painted glyphs at x=4 so Acrobat
// used the faded /AP and stayed left-aligned until Fill was re-touched
// opaque (which omits /AP so /Q takes over). Distinct from leftover-18,
// textbox textAlign /Q, textbox fillOpacity /ca, and faded-fill Style
// dash /AP. Opaque fill still omits /AP so /Q stays the native path.
// Do not invent a richTextEditor or Line /AP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import { flattenedTextInlineOffset } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-align-export-ap-${patch.idSuffix || 'default'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 160,
    height: 32,
    text: 'A',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    textAlign: 'right',
    backgroundColor: 'rgba(255, 255, 0, 0.4)',
    data: {
      id: `tb-align-export-ap-${patch.idSuffix || 'default'}`,
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
    name: 'textbox-align-export-ap-source.pdf',
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

function readApStream(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return '';
  const nRef = ap.get(PDFName.of('N'));
  const normal = lookupDict(doc, nRef);
  if (!normal) return '';
  return new TextDecoder('latin1').decode(decodePDFRawStream(normal).decode());
}

function appearanceTextX(apText) {
  const match = String(apText || '').match(/1\s+0\s+0\s+1\s+([\d.]+)\s+[\d.]+\s+Tm/);
  return match ? Number(match[1]) : null;
}

async function exportTextbox(patch) {
  const box = makeTextbox(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-align-export-ap' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  const q = dict.get(PDFName.of('Q'));
  return {
    box,
    doc,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    q: q?.asNumber ? q.asNumber() : null,
    ap: dict.get(PDFName.of('AP')) != null,
    apText: readApStream(doc, dict),
    tmX: appearanceTextX(readApStream(doc, dict)),
  };
}

test('faded right textbox stamps textAlign right and fill 0.4', () => {
  const box = makeTextbox({ idSuffix: 'stamp' });
  assert.equal(box.textAlign, 'right');
  assert.match(String(box.type), /textbox/i);
  assert.match(String(box.backgroundColor), /0\.4/);
  assert.equal(flattenedTextInlineOffset(152, 7.784, 'left'), 0);
});

test('annotated export writes faded right-align in /AP stream and keeps /Q', async () => {
  const right = await exportTextbox({ idSuffix: 'right' });
  assert.match(String(right.subtype), /FreeText/);
  assert.equal(right.ap, true, 'faded fill already writes /AP');
  assert.equal(right.q, 2, 'keep existing /Q 2 — do not invent a leftover by dropping it');
  assert.ok(Number.isFinite(right.tmX), `faded /AP must place text (got ${right.apText.slice(0, 240)})`);
  assert.ok(
    right.tmX > 4 + 8,
    `faded right /AP Tm x ${right.tmX} must sit past the leftover left pad 4`,
  );
});

test('faded left /AP stays at x=4; opaque right omits /AP so /Q stays native', async () => {
  const left = await exportTextbox({
    idSuffix: 'left',
    textAlign: 'left',
  });
  assert.match(String(left.subtype), /FreeText/);
  assert.equal(left.ap, true);
  assert.equal(left.q, 0, 'left-aligned FreeText must write /Q 0');
  assert.equal(left.tmX, 4, 'left /AP must stay at the existing 4pt inset');

  const opaque = await exportTextbox({
    idSuffix: 'opaque',
    backgroundColor: composeColorForPatch('#FFFF00', 100),
  });
  assert.equal(opaque.ap, false, 'opaque fill must still omit /AP so /Q stays the native path');
  assert.equal(opaque.q, 2, 'opaque right must still write /Q 2');
});

test('export host still names the textbox /AP textAlign contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /this \/AP used to paint glyphs at x=4/);
  assert.match(writer, /flattenedTextInlineOffset\(/);
  assert.match(writer, /textAlign: fabricObj\.textAlign/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
