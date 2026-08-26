// High Unicode in textbox text must survive PDFString / PDFHexString write.
// Live editor + faded Fill already stamp "Hi 😀" / "✓ Hi" + rgba fill, but
// PDFString.of writes charCodeAt as a single PDFDocEncoding byte so 😀
// injects a NUL and ✓ becomes 0x13. decodeText then invalidates the
// SurveyAppAnnotation JSON and Survey-to-Survey reimport lost text + fade.
// Distinct from leftover-18, textbox paren `)` escape, wrap `\n` JSON
// escape, faded Border /AP /CA, and faded-fill wrap / textAlign /
// verticalAlign / dash. ASCII `a) Hi` and wrap `\n` stay on the escaped
// PDFString path. Do not invent a richTextEditor or font embed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  parsePdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-unicode-export-${patch.idSuffix || 'default'}`,
    type: 'textbox',
    left: 24,
    top: 40,
    width: 160,
    height: 28,
    text: 'Hi 😀',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    backgroundColor: 'rgba(255, 255, 0, 0.4)',
    data: {
      id: `tb-unicode-export-${patch.idSuffix || 'default'}`,
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
    name: 'textbox-unicode-export-decode-source.pdf',
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
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-unicode-export-decode' },
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
    contentsObj: dict.get(PDFName.of('Contents')),
    metadataObj: metadataRaw,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    contents,
    metadata,
    metadataText,
  };
}

test('faded emoji textbox stamps Hi 😀 and fill 0.4', () => {
  const box = makeTextbox({ idSuffix: 'stamp' });
  assert.equal(box.text, 'Hi 😀');
  assert.match(String(box.type), /textbox/i);
  assert.match(String(box.backgroundColor), /0\.4/);
});

test('annotated export keeps Contents Hi 😀 and faded metadata after load', async () => {
  const exported = await exportTextbox({ idSuffix: 'emoji' });
  assert.match(String(exported.subtype), /FreeText/);
  assert.ok(
    exported.contentsObj instanceof PDFHexString,
    'high Unicode Contents must ride PDFHexString.fromText',
  );
  assert.ok(
    exported.metadataObj instanceof PDFHexString,
    'high Unicode SurveyAppAnnotation must ride PDFHexString.fromText',
  );
  assert.equal(exported.contents, 'Hi 😀', `Contents must survive emoji (got ${JSON.stringify(exported.contents)})`);
  assert.ok(exported.metadata, `SurveyAppAnnotation JSON must survive decodeText (got ${JSON.stringify(exported.metadataText.slice(0, 180))})`);
  assert.equal(exported.metadata.geometry?.text, 'Hi 😀', 'reimport must keep the live emoji text');
  assert.match(String(exported.metadata.style?.backgroundColor || ''), /0\.4/, 'reimport must keep faded fill');
});

test('checkmark, CJK, euro, and ASCII a) Hi still survive load', async () => {
  const check = await exportTextbox({
    idSuffix: 'check',
    text: '✓ Hi',
  });
  assert.equal(check.contents, '✓ Hi');
  assert.equal(check.metadata?.geometry?.text, '✓ Hi');
  assert.match(String(check.metadata?.style?.backgroundColor || ''), /0\.4/);
  assert.ok(check.contentsObj instanceof PDFHexString);

  const cjk = await exportTextbox({
    idSuffix: 'cjk',
    text: '中文',
  });
  assert.equal(cjk.contents, '中文');
  assert.equal(cjk.metadata?.geometry?.text, '中文');
  assert.match(String(cjk.metadata?.style?.backgroundColor || ''), /0\.4/);

  const euro = await exportTextbox({
    idSuffix: 'euro',
    text: '€100',
  });
  assert.equal(euro.contents, '€100');
  assert.equal(euro.metadata?.geometry?.text, '€100');
  assert.match(String(euro.metadata?.style?.backgroundColor || ''), /0\.4/);

  const paren = await exportTextbox({
    idSuffix: 'paren',
    text: 'a) Hi',
    backgroundColor: composeColorForPatch('#FFFF00', 40),
  });
  assert.equal(paren.contents, 'a) Hi');
  assert.equal(paren.metadata?.geometry?.text, 'a) Hi');
  assert.match(String(paren.metadata?.style?.backgroundColor || ''), /0\.4/);
  assert.equal(paren.contentsObj instanceof PDFHexString, false, 'ASCII a) Hi must stay on escaped PDFString');
});

test('export host still names the textbox unicode decode contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /pdfLiteralString/);
  assert.match(writer, /pdfJsonString/);
  assert.match(writer, /pdfEncodedString/);
  assert.match(writer, /PDFHexString\.fromText/);
  assert.match(writer, /JSON `\\n` `\\t`/);
  assert.match(writer, /unbalanced `\)`/);
  assert.match(writer, /a\) Hi/);
  assert.match(writer, /😀|checkmark ✓/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
