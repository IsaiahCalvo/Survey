// Line / Arrow Rotation must bake /L + flatten endpoints.
// Live Rotation already stamps fabric `angle` and metadata + screen already
// rotate about the bbox center, but createLineAnnotation / drawFlattenedLine
// used leftover getLineEndpoints so Acrobat / print stayed untilted until
// Rotation was re-touched. Native Line has no /AP — bake the tilted world
// pair into /L. Angle 0 / absent keep leftover /L. Do not invent Line /AP
// or callout Rotation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  parsePdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeLine(patch = {}) {
  return {
    id: `line-rotate-export-${patch.idSuffix || 'default'}`,
    type: 'Line',
    left: 20,
    top: 40,
    width: 80,
    height: 0,
    x1: -40,
    y1: 0,
    x2: 40,
    y2: 0,
    stroke: 'rgba(255, 0, 0, 0.4)',
    strokeWidth: 2,
    angle: 45,
    tool: 'line',
    data: {
      id: `line-rotate-export-${patch.idSuffix || 'default'}`,
      tool: 'line',
    },
    ...patch,
  };
}

function makeArrow(patch = {}) {
  return makeLine({
    id: `arrow-rotate-export-${patch.idSuffix || 'default'}`,
    tool: 'arrow',
    lineEnding2: 'ClosedArrow',
    data: {
      id: `arrow-rotate-export-${patch.idSuffix || 'default'}`,
      tool: 'arrow',
      annotationType: 'arrow',
      arrowheadStyle: 'solidTriangle',
    },
    ...patch,
  });
}

function leftoverEndpoints(obj) {
  const centerX = (Number(obj.left) || 0) + (Number(obj.width) || 0) / 2;
  const centerY = (Number(obj.top) || 0) + (Number(obj.height) || 0) / 2;
  return {
    x1: centerX + (Number(obj.x1) || 0),
    y1: centerY + (Number(obj.y1) || 0),
    x2: centerX + (Number(obj.x2) || 0),
    y2: centerY + (Number(obj.y2) || 0),
  };
}

function rotateAppPoint(x, y, cx, cy, fabricAngleDeg) {
  const rad = (Number(fabricAngleDeg) || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

function expectedExportL(obj, pageHeight) {
  const leftover = leftoverEndpoints(obj);
  const angle = Number(obj.angle) || 0;
  const cx = (Math.min(leftover.x1, leftover.x2) + Math.max(leftover.x1, leftover.x2)) / 2;
  const cy = (Math.min(leftover.y1, leftover.y2) + Math.max(leftover.y1, leftover.y2)) / 2;
  const start = Math.abs(angle) > 0.0001
    ? rotateAppPoint(leftover.x1, leftover.y1, cx, cy, angle)
    : leftover;
  const end = Math.abs(angle) > 0.0001
    ? rotateAppPoint(leftover.x2, leftover.y2, cx, cy, angle)
    : { x: leftover.x2, y: leftover.y2 };
  const p1 = Math.abs(angle) > 0.0001 ? start : { x: leftover.x1, y: leftover.y1 };
  return [
    p1.x,
    pageHeight - p1.y,
    end.x,
    pageHeight - end.y,
  ];
}

function leftoverL(obj, pageHeight) {
  const leftover = leftoverEndpoints(obj);
  return [leftover.x1, pageHeight - leftover.y1, leftover.x2, pageHeight - leftover.y2];
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'line-rotate-export-flatten-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function exportLine(line) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [line] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'line-rotate-export-flatten' },
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
  const L = dict.get(PDFName.of('L'))?.asArray?.()?.map((n) => n.asNumber?.()) || [];
  const ap = dict.get(PDFName.of('AP'));
  return {
    line,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    L,
    leftoverL: leftoverL(line, 200),
    expectedL: expectedExportL(line, 200),
    metadata,
    hasAp: Boolean(ap),
  };
}

async function flattenLine(line) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [line] } },
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
  return { line, text, expectedL: expectedExportL(line, 200), leftoverL: leftoverL(line, 200) };
}

function near(actual, expected, slack = 0.02) {
  return Math.abs(Number(actual) - Number(expected)) < slack;
}

test('rotated line stamps leftover endpoints + angle 45', () => {
  const line = makeLine({ idSuffix: 'stamp' });
  const leftover = leftoverEndpoints(line);
  assert.equal(line.angle, 45);
  assert.deepEqual(leftover, { x1: 20, y1: 40, x2: 100, y2: 40 });
  assert.match(String(line.stroke), /0\.4/);
});

test('annotated export bakes Line /L for live 45° and keeps leftover + angle in metadata', async () => {
  const exported = await exportLine(makeLine({ idSuffix: 'rot45' }));
  assert.match(String(exported.subtype), /Line/);
  assert.equal(exported.hasAp, false, 'must not invent Line /AP');
  assert.ok(exported.L.length === 4, 'export must write /L');
  exported.expectedL.forEach((value, index) => {
    assert.ok(near(exported.L[index], value), `/L[${index}] ${exported.L[index]} must be ${value}`);
  });
  assert.ok(
    !exported.leftoverL.every((value, index) => near(exported.L[index], value)),
    'rotated /L must not stay the leftover pair',
  );
  assert.equal(exported.metadata?.geometry?.angle ?? exported.metadata?.style?.angle, 45);
  assert.equal(exported.metadata?.geometry?.x1, -40, 'metadata must keep leftover x1 so reimport is not double-rotated');
  assert.equal(exported.metadata?.geometry?.y1, 0);
});

test('angle 0 keeps leftover /L; flatten 45 writes rotated coords', async () => {
  const zero = await exportLine(makeLine({ idSuffix: 'rot0', angle: 0 }));
  assert.equal(zero.hasAp, false, 'angle 0 must not invent Line /AP');
  zero.leftoverL.forEach((value, index) => {
    assert.ok(near(zero.L[index], value), `angle 0 /L[${index}] must stay leftover ${value}`);
  });

  const flat45 = await flattenLine(makeLine({ idSuffix: 'flat45', angle: 45 }));
  assert.match(flat45.text, /31\.7/, 'flatten 45 must write the rotated x');
  assert.doesNotMatch(flat45.text, /100 160 l/, 'flatten 45 must not paint leftover /L');

  const flatArrow = await flattenLine(makeArrow({ idSuffix: 'flat-arrow-45', angle: 45 }));
  assert.match(flatArrow.text, /31\.7/, 'flatten arrow 45 must write the rotated x');

  const flat0 = await flattenLine(makeLine({ idSuffix: 'flat0', angle: 0 }));
  assert.match(flat0.text, /20 160 m/, 'flatten 0 must keep leftover start');
  assert.match(flat0.text, /100 160 l/, 'flatten 0 must keep leftover /L');
});

test('export host still names the Line rotate /L contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /const getExportLineEndpoints = /);
  assert.match(writer, /Native Line has no \/AP/);
  const create = writer.slice(writer.indexOf('const createLineAnnotation'), writer.indexOf('const PDF_DA_FONT_BASEFONT'));
  assert.match(create, /getExportLineEndpoints\(fabricObj\)/);
  assert.doesNotMatch(create, /annotationDict\.AP/);
  const flatten = writer.slice(writer.indexOf('const drawFlattenedLine'));
  assert.match(flatten.slice(0, 1200), /getExportLineEndpoints\(obj\)/);
  assert.match(flatten.slice(0, 1200), /Do not invent callout Rotation/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
