// Imported Polygon / PolyLine Rotation must bake /Vertices + flatten.
// Live Rotation already stamps fabric `angle` and metadata + screen already
// rotate about the leftover AABB center, but createPolygonAnnotation /
// createPolyLineAnnotation / drawFlattenedPolygon used leftover
// polygonWorldPoint so Acrobat / print stayed untilted until Rotation
// was re-touched. Native Polygon / PolyLine have no rotation /AP —
// bake the tilted world vertices. Angle 0 / absent keep leftover
// /Vertices. Do not invent a create-poly tool or Line /AP.
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
const PAGE = 200;

function makePolygon(patch = {}) {
  return {
    id: `poly-rotate-export-${patch.idSuffix || 'default'}`,
    type: 'polygon',
    left: 20,
    top: 30,
    width: 80,
    height: 60,
    scaleX: 1,
    scaleY: 1,
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 60 },
      { x: 0, y: 60 },
    ],
    stroke: '#ff0000',
    fill: 'transparent',
    strokeWidth: 2,
    angle: 45,
    data: {
      id: `poly-rotate-export-${patch.idSuffix || 'default'}`,
    },
    ...patch,
  };
}

function makePolyline(patch = {}) {
  return {
    id: `polyline-rotate-export-${patch.idSuffix || 'default'}`,
    type: 'polyline',
    left: 20,
    top: 40,
    width: 80,
    height: 0,
    scaleX: 1,
    scaleY: 1,
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
    ],
    stroke: '#0000aa',
    fill: 'transparent',
    strokeWidth: 2,
    angle: 45,
    data: {
      id: `polyline-rotate-export-${patch.idSuffix || 'default'}`,
    },
    ...patch,
  };
}

function leftoverWorld(obj) {
  const sx = Math.abs(Number(obj.scaleX) || 1);
  const sy = Math.abs(Number(obj.scaleY) || 1);
  const left = Number(obj.left) || 0;
  const top = Number(obj.top) || 0;
  return (obj.points || []).map((point) => ({
    x: left + sx * (Number(point?.x) || 0),
    y: top + sy * (Number(point?.y) || 0),
  }));
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

function expectedWorld(obj) {
  const leftover = leftoverWorld(obj);
  const angle = Number(obj.angle) || 0;
  if (Math.abs(angle) <= 0.0001) return leftover;
  const xs = leftover.map((point) => point.x);
  const ys = leftover.map((point) => point.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return leftover.map((point) => rotateAppPoint(point.x, point.y, cx, cy, angle));
}

function leftoverVertices(obj, pageHeight) {
  return leftoverWorld(obj).flatMap((point) => [point.x, pageHeight - point.y]);
}

function expectedVertices(obj, pageHeight) {
  return expectedWorld(obj).flatMap((point) => [point.x, pageHeight - point.y]);
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE, PAGE]);
  const bytes = await doc.save();
  return {
    name: 'poly-rotate-export-flatten-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function exportObj(obj) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [obj] } },
    { 1: { width: PAGE, height: PAGE } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'poly-rotate-export-flatten' },
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
  const vertices = dict.get(PDFName.of('Vertices'))?.asArray?.()?.map((n) => n.asNumber?.()) || [];
  return {
    obj,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    vertices,
    leftoverVertices: leftoverVertices(obj, PAGE),
    expectedVertices: expectedVertices(obj, PAGE),
    metadata,
  };
}

async function flattenObj(obj) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [obj] } },
    { 1: { width: PAGE, height: PAGE } },
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
  return { obj, text, expected: expectedWorld(obj), leftover: leftoverWorld(obj) };
}

function near(actual, expected, slack = 0.02) {
  return Math.abs(Number(actual) - Number(expected)) < slack;
}

test('rotated polygon stamps leftover points + angle 45', () => {
  const polygon = makePolygon({ idSuffix: 'stamp' });
  assert.equal(polygon.angle, 45);
  assert.deepEqual(leftoverWorld(polygon), [
    { x: 20, y: 30 },
    { x: 100, y: 30 },
    { x: 100, y: 90 },
    { x: 20, y: 90 },
  ]);
});

test('annotated export bakes Polygon /Vertices for live 45° and keeps leftover + angle in metadata', async () => {
  const exported = await exportObj(makePolygon({ idSuffix: 'rot45' }));
  assert.match(String(exported.subtype), /Polygon/);
  assert.ok(exported.vertices.length === 8, 'export must write /Vertices');
  exported.expectedVertices.forEach((value, index) => {
    assert.ok(near(exported.vertices[index], value), `/Vertices[${index}] ${exported.vertices[index]} must be ${value}`);
  });
  assert.ok(
    !exported.leftoverVertices.every((value, index) => near(exported.vertices[index], value)),
    'rotated /Vertices must not stay the leftover pair',
  );
  assert.equal(exported.metadata?.geometry?.angle ?? exported.metadata?.style?.angle, 45);
  assert.equal(exported.metadata?.geometry?.points?.[0]?.x, 0, 'metadata must keep leftover points so reimport is not double-rotated');
  assert.equal(exported.metadata?.geometry?.points?.[0]?.y, 0);
});

test('angle 0 keeps leftover /Vertices; flatten 45 writes rotated coords; PolyLine shares the writer', async () => {
  const zero = await exportObj(makePolygon({ idSuffix: 'rot0', angle: 0 }));
  zero.leftoverVertices.forEach((value, index) => {
    assert.ok(near(zero.vertices[index], value), `angle 0 /Vertices[${index}] must stay leftover ${value}`);
  });

  const line = await exportObj(makePolyline({ idSuffix: 'pl-rot45' }));
  assert.match(String(line.subtype), /PolyLine/);
  line.expectedVertices.forEach((value, index) => {
    assert.ok(near(line.vertices[index], value), `PolyLine /Vertices[${index}] ${line.vertices[index]} must be ${value}`);
  });
  assert.ok(
    !line.leftoverVertices.every((value, index) => near(line.vertices[index], value)),
    'rotated PolyLine /Vertices must not stay leftover',
  );
  assert.equal(line.metadata?.geometry?.angle, 45);
  assert.equal(line.metadata?.geometry?.points?.[0]?.x, 0);

  const flat45 = await flattenObj(makePolygon({ idSuffix: 'flat45', angle: 45 }));
  assert.match(flat45.text, /52\.9/, 'flatten 45 must write the rotated x');
  assert.doesNotMatch(flat45.text, /20 30 m/, 'flatten 45 must not paint leftover start');

  const flatLine = await flattenObj(makePolyline({ idSuffix: 'flat-pl-45', angle: 45 }));
  assert.match(flatLine.text, /31\.7/, 'flatten polyline 45 must write the rotated x');

  const flat0 = await flattenObj(makePolygon({ idSuffix: 'flat0', angle: 0 }));
  assert.match(flat0.text, /20 30 m/, 'flatten 0 must keep leftover start');
  assert.match(flat0.text, /100 30 l/, 'flatten 0 must keep leftover /Vertices');
});

test('export host still names the poly rotate /Vertices contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /const leftoverPolygonWorldPoint = /);
  assert.match(writer, /const polygonRotatePivot = /);
  assert.match(writer, /Native Polygon \/ PolyLine have no rotation \/AP/);
  const world = writer.slice(writer.indexOf('const leftoverPolygonWorldPoint'), writer.indexOf('const polygonAppearancePath'));
  assert.match(world, /rotateAppPointAround/);
  assert.match(world, /pdfNeedsRotate/);
  const flatten = writer.slice(writer.indexOf('const drawFlattenedPolygon'));
  assert.match(flatten.slice(0, 900), /polygonWorldPoint\(obj, point\)/);
  assert.match(flatten.slice(0, 900), /Do not invent a create-poly tool/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
