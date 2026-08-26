// Ellipse / Circle Rotation must ride /AP /Matrix + flatten cm.
// Live Rotation already stamps fabric `angle` and metadata + screen already
// rotate, but live `circle` used createCircleAnnotation with no angle so
// /AP stayed axis-aligned, and flatten painted the leftover oval so
// Acrobat / print stayed unrotated until Rotation was re-touched.
// Imported type `ellipse` already had createEllipseAnnotation /AP /Matrix.
// Distinct from leftover-18, Square / rect Rotation /AP /Matrix, and
// textbox FreeText /AP /Matrix. Angle 0 / absent omit /Matrix and keep
// leftover /Rect. Do not invent callout Rotation, Line /AP, or Square /
// Circle /BS.
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

function makeCircle(patch = {}) {
  return {
    id: `el-rotate-export-${patch.idSuffix || 'default'}`,
    type: 'circle',
    left: 40,
    top: 50,
    radius: 20,
    width: 40,
    height: 40,
    fill: composeColorForPatch('#FFFF00', 40),
    stroke: '#000000',
    strokeWidth: 2,
    angle: 45,
    scaleX: 1,
    scaleY: 1,
    data: {
      id: `el-rotate-export-${patch.idSuffix || 'default'}`,
      type: 'ellipse',
      tool: 'ellipse',
    },
    ...patch,
  };
}

function makeEllipse(patch = {}) {
  return {
    id: `el-rotate-export-${patch.idSuffix || 'ellipse'}`,
    type: 'ellipse',
    left: 40,
    top: 50,
    rx: 40,
    ry: 20,
    width: 80,
    height: 40,
    fill: composeColorForPatch('#FFFF00', 40),
    stroke: '#000000',
    strokeWidth: 2,
    angle: 45,
    scaleX: 1,
    scaleY: 1,
    data: {
      id: `el-rotate-export-${patch.idSuffix || 'ellipse'}`,
      type: 'ellipse',
      tool: 'ellipse',
    },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'ellipse-rotate-export-ap-source.pdf',
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

async function exportShape(box) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'ellipse-rotate-export-ap' },
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
  const width = Number(box.rx ? box.rx * 2 : (box.radius || 0) * 2);
  const height = Number(box.ry ? box.ry * 2 : (box.radius || 0) * 2);
  return {
    box,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    rect,
    leftoverRect: [box.left, 200 - (box.top + height), box.left + width, 200 - box.top],
    metadata,
    ...readApMatrix(doc, dict),
  };
}

async function flattenShape(box) {
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

test('faded rotated circle stamps fill 0.4 + angle 45', () => {
  const box = makeCircle({ idSuffix: 'stamp' });
  assert.match(String(box.type), /circle/i);
  assert.match(String(box.fill), /0\.4/);
  assert.equal(box.angle, 45);
});

test('annotated export writes Circle /AP /Matrix and expanded /Rect for live circle 45°', async () => {
  const exported = await exportShape(makeCircle({ idSuffix: 'rot45' }));
  assert.match(String(exported.subtype), /Circle/);
  assert.ok(exported.hasAp, 'rotated export must attach /AP');
  assert.ok(Array.isArray(exported.matrix) && exported.matrix.length === 6, 'rotated /AP must write /Matrix');
  assert.ok(Math.abs(exported.matrix[0] - Math.SQRT1_2) < 0.001, `Matrix a must be cos(-45) (got ${exported.matrix[0]})`);
  assert.ok(Math.abs(exported.matrix[1] + Math.SQRT1_2) < 0.001, `Matrix b must be sin(-45) (got ${exported.matrix[1]})`);
  assert.notDeepEqual(exported.rect, exported.leftoverRect, 'rotated /Rect must not stay the leftover AABB');
  assert.ok(exported.rect[0] < exported.leftoverRect[0], 'rotated /Rect left must expand past leftover');
  assert.equal(exported.metadata?.style?.angle ?? exported.metadata?.geometry?.angle, 45);
  assert.match(String(exported.metadata?.style?.fill || ''), /0\.4/, 'reimport must keep faded fill');
});

test('angle 0 circle omits /Matrix and keeps leftover /Rect; flatten 45 writes rotate cm', async () => {
  const zero = await exportShape(makeCircle({ idSuffix: 'rot0', angle: 0 }));
  assert.equal(zero.hasAp, true, 'angle 0 still attaches leftover Circle /AP');
  assert.equal(zero.matrix, null, 'angle 0 must omit /Matrix so leftover Circle stays byte-identical');
  assert.deepEqual(zero.rect, zero.leftoverRect);

  const flatCircle45 = await flattenShape(makeCircle({ idSuffix: 'flat45', angle: 45 }));
  assert.match(flatCircle45.text, /0\.7071/, 'flatten circle 45 must write the rotation cm');
  assert.match(flatCircle45.text, / cm/);

  const flatEllipse45 = await flattenShape(makeEllipse({ idSuffix: 'flat-el-45', angle: 45 }));
  assert.match(flatEllipse45.text, /0\.7071/, 'flatten ellipse 45 must write the rotation cm');

  const flat0 = await flattenShape(makeCircle({ idSuffix: 'flat0', angle: 0 }));
  assert.doesNotMatch(flat0.text, /0\.7071/, 'flatten 0 must not invent a 45° cm');
});

test('export host still names the circle rotate /AP contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  const circle = writer.slice(writer.indexOf('const createCircleAnnotation'), writer.indexOf('const createEllipseAnnotation'));
  assert.match(circle, /pdfNeedsRotate/);
  assert.match(circle, /pdfRotatedBoxRect/);
  assert.match(circle, /Live Rotation already stamps fabric `angle`/);
  assert.match(writer, /attachIndependentShapeAppearance/);
  const helper = writer.slice(writer.indexOf('const attachIndependentShapeAppearance'));
  assert.match(helper, /pdfRotateMatrixAbout/);
  assert.match(helper, /default Square \/ Circle export stays/);
  const flatten = writer.slice(writer.indexOf("if (type === 'circle' || type === 'ellipse')"));
  assert.match(flatten, /concatTransformationMatrix/);
  assert.match(flatten, /popGraphicsState/);
  assert.match(flatten, /Do not invent callout Rotation/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
