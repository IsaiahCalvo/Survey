// Textbox verticalAlign must ride the faded-fill FreeText /AP stream.
// Live toolbar already stamps verticalAlign, export already writes
// metadata, and flatten already writes flattenedTextBlockOffset, but
// attachCalloutFreeTextFillAppearance painted glyphs at
// y = formHeight - size - 4 so Acrobat used the faded /AP and stayed
// top-aligned until Fill was re-touched opaque (which omits /AP).
// Distinct from leftover-18, textbox verticalAlign metadata + flatten,
// textbox textAlign /Q + /AP Tm x, textbox fillOpacity /ca, and
// faded-fill Style dash /AP. There is no /Q counterpart. Opaque fill
// still omits /AP. Do not invent a richTextEditor or Line /AP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import { flattenedTextBlockOffset } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-valign-export-ap-${patch.idSuffix || 'default'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 160,
    height: 80,
    text: 'A',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    textAlign: 'left',
    verticalAlign: 'bottom',
    backgroundColor: 'rgba(255, 255, 0, 0.4)',
    data: {
      id: `tb-valign-export-ap-${patch.idSuffix || 'default'}`,
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
    name: 'textbox-valign-export-ap-source.pdf',
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

function appearanceTextY(apText) {
  const match = String(apText || '').match(/1\s+0\s+0\s+1\s+[\d.]+\s+([\d.]+)\s+Tm/);
  return match ? Number(match[1]) : null;
}

function leftoverTopY(formHeight, fontSize) {
  const size = Math.max(4, Number(fontSize) || 12);
  return Math.max(2, formHeight - size - 4);
}

async function exportTextbox(patch) {
  const box = makeTextbox(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-valign-export-ap' },
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
    ap: dict.get(PDFName.of('AP')) != null,
    apText: readApStream(doc, dict),
    tmY: appearanceTextY(readApStream(doc, dict)),
    leftoverTop: leftoverTopY(box.height, box.fontSize),
  };
}

test('faded bottom textbox stamps verticalAlign bottom and fill 0.4', () => {
  const box = makeTextbox({ idSuffix: 'stamp' });
  assert.equal(box.verticalAlign, 'bottom');
  assert.match(String(box.type), /textbox/i);
  assert.match(String(box.backgroundColor), /0\.4/);
  assert.equal(flattenedTextBlockOffset(72, 14, 'top'), 0);
  assert.equal(leftoverTopY(80, 14), 62);
});

test('annotated export writes faded bottom-align in /AP stream Tm y', async () => {
  const bottom = await exportTextbox({ idSuffix: 'bottom' });
  assert.match(String(bottom.subtype), /FreeText/);
  assert.equal(bottom.ap, true, 'faded fill already writes /AP');
  assert.ok(Number.isFinite(bottom.tmY), `faded /AP must place text (got ${bottom.apText.slice(0, 240)})`);
  assert.ok(
    bottom.tmY < bottom.leftoverTop - 20,
    `faded bottom /AP Tm y ${bottom.tmY} must sit below leftover top ${bottom.leftoverTop}`,
  );
  assert.equal(bottom.tmY, 4, '4pt bottom inset matches the existing 4pt top/left pad');
});

test('faded top /AP stays at leftover y; opaque bottom omits /AP', async () => {
  const top = await exportTextbox({
    idSuffix: 'top',
    verticalAlign: 'top',
  });
  assert.match(String(top.subtype), /FreeText/);
  assert.equal(top.ap, true);
  assert.equal(top.tmY, 62, 'top /AP must stay at formHeight - size - 4');

  const opaque = await exportTextbox({
    idSuffix: 'opaque',
    backgroundColor: composeColorForPatch('#FFFF00', 100),
  });
  assert.equal(opaque.ap, false, 'opaque fill must still omit /AP');
});

test('export host still names the textbox /AP verticalAlign contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /this \/AP used to paint glyphs at/);
  assert.match(writer, /y = formHeight - size - 4 \(top\)/);
  assert.match(writer, /flattenedTextBlockOffset\(/);
  assert.match(writer, /verticalAlign: fabricObj\.verticalAlign/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
