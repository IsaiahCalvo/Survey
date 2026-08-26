// Textbox underline / strike must ride the faded-fill FreeText /AP stream.
// Live edit U / S already stamps underline / linethrough, metadata +
// flatten already draw the decoration, but /DA has no text-decoration
// operator and attachCalloutFreeTextFillAppearance painted glyphs only
// so Acrobat stayed undecorated until Fill was re-touched opaque.
// Distinct from leftover-18, textbox wrap /AP, textAlign /Q, verticalAlign
// /AP Tm y, and faded-fill Style dash /AP. Opaque + no decoration still
// omit /AP. Do not invent a richTextEditor. Do not invent callout Rotation or Line /AP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
} from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-underline-export-ap-${patch.idSuffix || 'default'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 160,
    height: 32,
    text: 'Hi',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    underline: true,
    linethrough: false,
    backgroundColor: 'rgba(255, 255, 0, 0.4)',
    data: {
      id: `tb-underline-export-ap-${patch.idSuffix || 'default'}`,
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
    name: 'textbox-underline-export-ap-source.pdf',
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

function decorationAfterEt(apText) {
  const text = String(apText || '');
  const et = text.lastIndexOf('\nET\n');
  const after = et >= 0 ? text.slice(et) : text;
  return / m [\d.]+ [\d.]+ l S/.test(after) || / m\n[\d.]+ [\d.]+ l S/.test(after)
    || /\d[\d.]* \d[\d.]* m \d[\d.]* \d[\d.]* l S/.test(after);
}

async function exportTextbox(patch) {
  const box = makeTextbox(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-underline-export-ap' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  const meta = dict.get(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY))?.decodeText?.() || '';
  return {
    box,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    ap: dict.get(PDFName.of('AP')) != null,
    apText: readApStream(doc, dict),
    meta,
  };
}

test('faded underlined textbox stamps underline and fill 0.4', () => {
  const box = makeTextbox({ idSuffix: 'stamp' });
  assert.equal(box.underline, true);
  assert.equal(box.linethrough, false);
  assert.match(String(box.type), /textbox/i);
  assert.match(String(box.backgroundColor), /0\.4/);
});

test('annotated export writes faded underline in /AP stream and keeps metadata', async () => {
  const faded = await exportTextbox({ idSuffix: 'under' });
  assert.match(String(faded.subtype), /FreeText/);
  assert.equal(faded.ap, true, 'faded fill already writes /AP');
  assert.match(faded.apText, /\(Hi\) Tj/, `faded /AP must still paint glyphs (got ${faded.apText.slice(0, 240)})`);
  assert.equal(
    decorationAfterEt(faded.apText),
    true,
    `faded underline /AP must stroke a decoration after ET (got ${faded.apText.slice(-240)})`,
  );
  assert.match(faded.meta, /"underline"\s*:\s*true/, 'metadata must keep leftover underline');
});

test('faded plain /AP stays glyph-only; opaque underline attaches /AP; opaque plain omits /AP', async () => {
  const plain = await exportTextbox({
    idSuffix: 'plain',
    underline: false,
    linethrough: false,
  });
  assert.match(String(plain.subtype), /FreeText/);
  assert.equal(plain.ap, true);
  assert.match(plain.apText, /\(Hi\) Tj/);
  assert.equal(decorationAfterEt(plain.apText), false, 'plain faded /AP must stay glyph-only');

  const strike = await exportTextbox({
    idSuffix: 'strike',
    underline: false,
    linethrough: true,
  });
  assert.equal(strike.ap, true);
  assert.equal(decorationAfterEt(strike.apText), true, 'faded strike /AP must stroke a decoration after ET');

  const opaqueUnder = await exportTextbox({
    idSuffix: 'opaque-under',
    backgroundColor: composeColorForPatch('#FFFF00', 100),
  });
  assert.equal(opaqueUnder.ap, true, '/DA cannot carry underline — opaque + U still attaches /AP');
  assert.equal(decorationAfterEt(opaqueUnder.apText), true);

  const opaque = await exportTextbox({
    idSuffix: 'opaque',
    underline: false,
    backgroundColor: composeColorForPatch('#FFFF00', 100),
  });
  assert.equal(opaque.ap, false, 'opaque + no decoration must still omit /AP');
});

test('export host still names the textbox /AP underline contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /this \/AP used to paint glyphs only/);
  assert.match(writer, /wantsUnderline = fabricObj\.underline === true/);
  assert.match(writer, /Do not invent callout Rotation or Line \/AP/);
  assert.match(writer, /const wantsUnderline = obj\?\.underline === true/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
