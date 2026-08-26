// Textbox Rotation must ride faded-fill FreeText /AP /Matrix + flatten cm.
// Live Rotation already stamps fabric `angle` and metadata + screen already
// rotate, but faded-fill /AP stayed axis-aligned and flatten painted the
// leftover AABB so Acrobat / print stayed unrotated until Rotation was
// re-touched. Distinct from leftover-18, textbox unicode decode, paren `)`
// escape, wrap `\n`, faded Border /AP /CA, and faded-fill wrap / textAlign
// / verticalAlign / dash. Angle 0 / absent omit /Matrix and keep leftover
// /Rect. Do not invent callout Rotation, Line /AP, or Square / Circle /BS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  parsePdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeTextbox(patch = {}) {
  return {
    id: `tb-rotate-export-${patch.idSuffix || 'default'}`,
    type: 'textbox',
    left: 40,
    top: 50,
    width: 120,
    height: 36,
    text: 'Hi',
    fill: '#000000',
    fontSize: 14,
    fontFamily: 'Helvetica',
    backgroundColor: composeColorForPatch('#FFFF00', 40),
    angle: 45,
    data: {
      id: `tb-rotate-export-${patch.idSuffix || 'default'}`,
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
    name: 'textbox-rotate-export-ap-source.pdf',
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

function readApMatrix(doc, dict) {
  const ap = dict.get(PDFName.of('AP'));
  if (!ap) return { hasAp: false, matrix: null };
  const apDict = lookupDict(doc, ap);
  const n = apDict?.get?.(PDFName.of('N'));
  const stream = n ? lookupDict(doc, n) : null;
  const matrix = stream?.dict?.get?.(PDFName.of('Matrix'));
  return {
    hasAp: true,
    matrix: matrix?.asArray?.()?.map((v) => (v?.asNumber ? v.asNumber() : Number(v))) ?? null,
  };
}

async function exportTextbox(patch) {
  const box = makeTextbox(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-rotate-export-ap' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  const metadataRaw = dict.get(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY));
  const metadataText = metadataRaw?.decodeText?.() || '';
  const metadata = parsePdfAppAnnotationMetadata(metadataText);
  const rect = dict.get(PDFName.of('Rect'))?.asArray?.()?.map((n) => n.asNumber?.()) || [];
  return {
    box,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    rect,
    leftoverRect: [40, 200 - (50 + 36), 40 + 120, 200 - 50],
    metadata,
    ...readApMatrix(doc, dict),
  };
}

async function flattenTextbox(patch) {
  const box = makeTextbox(patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    { returnBytes: true },
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
  return { box, text };
}

test('faded rotated textbox stamps Hi + fill 0.4 + angle 45', () => {
  const box = makeTextbox({ idSuffix: 'stamp' });
  assert.equal(box.text, 'Hi');
  assert.match(String(box.type), /textbox/i);
  assert.match(String(box.backgroundColor), /0\.4/);
  assert.equal(box.angle, 45);
});

test('annotated export writes FreeText /AP /Matrix and expanded /Rect for 45°', async () => {
  const exported = await exportTextbox({ idSuffix: 'rot45' });
  assert.match(String(exported.subtype), /FreeText/);
  assert.ok(exported.hasAp, 'faded + rotated export must attach /AP');
  assert.ok(Array.isArray(exported.matrix) && exported.matrix.length === 6, 'rotated /AP must write /Matrix');
  assert.ok(Math.abs(exported.matrix[0] - Math.SQRT1_2) < 0.001, `Matrix a must be cos(-45) (got ${exported.matrix[0]})`);
  assert.ok(Math.abs(exported.matrix[1] + Math.SQRT1_2) < 0.001, `Matrix b must be sin(-45) (got ${exported.matrix[1]})`);
  assert.notDeepEqual(exported.rect, exported.leftoverRect, 'rotated /Rect must not stay the leftover AABB');
  assert.ok(exported.rect[0] > exported.leftoverRect[0], 'rotated /Rect left must expand past leftover');
  assert.equal(exported.metadata?.style?.angle ?? exported.metadata?.geometry?.angle, 45);
  assert.match(String(exported.metadata?.style?.backgroundColor || ''), /0\.4/, 'reimport must keep faded fill');
});

test('angle 0 faded export omits /Matrix and keeps leftover /Rect; flatten 45 writes rotate cm', async () => {
  const zero = await exportTextbox({ idSuffix: 'rot0', angle: 0 });
  assert.equal(zero.hasAp, true, 'faded angle 0 still attaches /AP for fade');
  assert.equal(zero.matrix, null, 'angle 0 must omit /Matrix so leftover faded-fill stays byte-identical');
  assert.deepEqual(zero.rect, zero.leftoverRect);

  const flat45 = await flattenTextbox({ idSuffix: 'flat45', angle: 45 });
  assert.match(flat45.text, /0\.7071/, 'flatten 45 must write the rotation cm');
  assert.match(flat45.text, / cm/);

  const flat0 = await flattenTextbox({ idSuffix: 'flat0', angle: 0 });
  assert.doesNotMatch(flat0.text, /0\.7071/, 'flatten 0 must not invent a 45° cm');
});

test('export host still names the textbox rotate /AP contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /pdfNeedsRotate/);
  assert.match(writer, /pdfRotateMatrixAbout/);
  assert.match(writer, /pdfRotatedBoxRect/);
  assert.match(writer, /Live Rotation already stamps `angle`/);
  assert.match(writer, /Angle 0 \/ absent omit \/Matrix/);
  const flatten = writer.slice(writer.indexOf('const drawFlattenedText ='));
  assert.match(flatten, /concatTransformationMatrix/);
  assert.match(flatten, /popGraphicsState/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
