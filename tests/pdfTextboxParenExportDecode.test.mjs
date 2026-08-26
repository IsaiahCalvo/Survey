// Unbalanced `)` in textbox text must survive PDFString literal write.
// Live editor + faded Fill already stamp "a) Hi" + rgba fill, but
// PDFString.of left Contents / SurveyAppAnnotation unescaped so an
// extra `)` terminated the literal, PDFDocument.load dropped the annot,
// and Survey-to-Survey reimport lost text + fade. Distinct from
// leftover-18, textbox wrap `\n` JSON escape, faded Border /AP /CA,
// and faded-fill wrap / textAlign / verticalAlign / dash. Balanced
// "(world)" already survived. Do not invent a richTextEditor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  parsePdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-paren-export-${patch.idSuffix || 'default'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 160,
    height: 28,
    text: 'a) Hi',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    backgroundColor: 'rgba(255, 255, 0, 0.4)',
    data: {
      id: `tb-paren-export-${patch.idSuffix || 'default'}`,
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
    name: 'textbox-paren-export-decode-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function exportTextbox(patch) {
  const box = makeTextbox(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-paren-export-decode' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  const contents = dict.get(PDFName.of('Contents'))?.decodeText?.() || '';
  const metadataRaw = dict.get(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY));
  const metadataText = metadataRaw?.decodeText?.() || '';
  const metadata = parsePdfAppAnnotationMetadata(metadataText);
  return {
    box,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    contents,
    metadata,
    metadataText,
  };
}

test('faded list-style textbox stamps a) Hi and fill 0.4', () => {
  const box = makeTextbox({ idSuffix: 'stamp' });
  assert.equal(box.text, 'a) Hi');
  assert.match(String(box.type), /textbox/i);
  assert.match(String(box.backgroundColor), /0\.4/);
});

test('annotated export keeps Contents a) Hi and faded metadata after load', async () => {
  const exported = await exportTextbox({ idSuffix: 'paren' });
  assert.match(String(exported.subtype), /FreeText/);
  assert.equal(exported.contents, 'a) Hi', `Contents must survive unbalanced ) (got ${JSON.stringify(exported.contents)})`);
  assert.ok(exported.metadata, `SurveyAppAnnotation JSON must survive PDFString decodeText (got ${JSON.stringify(exported.metadataText.slice(0, 180))})`);
  assert.equal(exported.metadata.geometry?.text, 'a) Hi', 'reimport must keep the live list-style text');
  assert.match(String(exported.metadata.style?.backgroundColor || ''), /0\.4/, 'reimport must keep faded fill');
});

test('balanced (world) and no-paren Fade still survive load', async () => {
  const balanced = await exportTextbox({
    idSuffix: 'balanced',
    text: 'Hello (world)',
  });
  assert.equal(balanced.contents, 'Hello (world)');
  assert.equal(balanced.metadata?.geometry?.text, 'Hello (world)');
  assert.match(String(balanced.metadata?.style?.backgroundColor || ''), /0\.4/);

  const plain = await exportTextbox({
    idSuffix: 'plain',
    text: 'Fade',
    backgroundColor: composeColorForPatch('#FFFF00', 40),
  });
  assert.equal(plain.contents, 'Fade');
  assert.equal(plain.metadata?.geometry?.text, 'Fade');
  assert.match(String(plain.metadata?.style?.backgroundColor || ''), /0\.4/);
});

test('export host still names the textbox paren decode contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /pdfLiteralString/);
  assert.match(writer, /pdfJsonString/);
  assert.match(writer, /JSON `\\n` `\\t`/);
  assert.match(writer, /unbalanced `\)`/);
  assert.match(writer, /a\) Hi/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
