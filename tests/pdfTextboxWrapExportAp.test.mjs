// Textbox wrap must ride the faded-fill FreeText /AP stream.
// Live editor + flatten already wrap via wrapFlattenedTextLines, but
// attachCalloutFreeTextFillAppearance painted the whole Contents as
// one Tj so Acrobat used the faded /AP and stayed a single leftover
// line until Fill was re-touched opaque (which omits /AP).
// Distinct from leftover-18, textbox verticalAlign /AP Tm y,
// textbox textAlign /Q + /AP Tm x, textbox fillOpacity /ca, and
// faded-fill Style dash /AP. Opaque fill still omits /AP. Single-line
// stays one Tm + Tj. Do not invent a richTextEditor, callout
// verticalAlign, or Line /AP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import { wrapFlattenedTextLines } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-wrap-export-ap-${patch.idSuffix || 'default'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 160,
    height: 80,
    text: 'Hi\nGo',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    textAlign: 'left',
    verticalAlign: 'top',
    backgroundColor: 'rgba(255, 255, 0, 0.4)',
    data: {
      id: `tb-wrap-export-ap-${patch.idSuffix || 'default'}`,
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
    name: 'textbox-wrap-export-ap-source.pdf',
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

function appearanceTmYs(apText) {
  return [...String(apText || '').matchAll(/1\s+0\s+0\s+1\s+[\d.]+\s+([\d.]+)\s+Tm/g)]
    .map((match) => Number(match[1]));
}

function appearanceTjs(apText) {
  return [...String(apText || '').matchAll(/\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*Tj/g)]
    .map((match) => match[1].replace(/\\([\\()])/g, '$1'));
}

async function exportTextbox(patch) {
  const box = makeTextbox(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-wrap-export-ap' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  const apText = readApStream(doc, dict);
  return {
    box,
    doc,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    ap: dict.get(PDFName.of('AP')) != null,
    apText,
    tmYs: appearanceTmYs(apText),
    tjs: appearanceTjs(apText),
  };
}

test('faded wrapped textbox stamps two live lines and fill 0.4', () => {
  const box = makeTextbox({ idSuffix: 'stamp' });
  assert.equal(box.text, 'Hi\nGo');
  assert.match(String(box.type), /textbox/i);
  assert.match(String(box.backgroundColor), /0\.4/);
  assert.deepEqual(wrapFlattenedTextLines('Hi\nGo', { measure: () => 1, maxWidth: 80 }), ['Hi', 'Go']);
});

test('annotated export writes faded wrap as two /AP Tm + Tj', async () => {
  const wrapped = await exportTextbox({ idSuffix: 'wrap' });
  assert.match(String(wrapped.subtype), /FreeText/);
  assert.equal(wrapped.ap, true, 'faded fill already writes /AP');
  assert.deepEqual(wrapped.tjs, ['Hi', 'Go'], `faded /AP must paint two lines (got ${wrapped.apText.slice(0, 280)})`);
  assert.equal(wrapped.tmYs.length, 2, 'faded wrap must place two Tm');
  assert.ok(wrapped.tmYs[0] > wrapped.tmYs[1], `second Tm y ${wrapped.tmYs[1]} must sit below first ${wrapped.tmYs[0]}`);
  assert.equal(wrapped.tmYs[0] - wrapped.tmYs[1], 14, 'line step is the live fontSize');
  assert.doesNotMatch(wrapped.apText, /\(Hi\\nGo\)\s*Tj|\(Hi\nGo\)\s*Tj/, 'leftover single Tj must not keep the newline blob');
});

test('faded single-line /AP stays one Tm; opaque wrap omits /AP', async () => {
  const single = await exportTextbox({
    idSuffix: 'single',
    text: 'A',
  });
  assert.match(String(single.subtype), /FreeText/);
  assert.equal(single.ap, true);
  assert.deepEqual(single.tjs, ['A']);
  assert.equal(single.tmYs.length, 1);
  assert.equal(single.tmYs[0], 62, 'top single-line /AP must stay at formHeight - size - 4');

  const opaque = await exportTextbox({
    idSuffix: 'opaque',
    backgroundColor: composeColorForPatch('#FFFF00', 100),
  });
  assert.equal(opaque.ap, false, 'opaque fill must still omit /AP');
});

test('export host still names the textbox /AP wrap contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /used to paint the whole Contents as one Tj/);
  assert.match(writer, /wrapFlattenedTextLines\(/);
  assert.match(writer, /y = formHeight - size - 4 \(top\)/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
