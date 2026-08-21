// P1-04 leftovers: circle export + polyline/polygon scale.
// Resize commits scaleX/scaleY and leaves radius/points unbaked. Screen
// (renderEllipse / renderPolygon) multiplies; export/print must too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const PAGE = 200;
const PAGE_SIZES = { 1: { width: PAGE, height: PAGE } };

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE, PAGE]);
  const bytes = await doc.save();
  return {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function numberArray(dict, key) {
  const value = dict.get(PDFName.of(key));
  return value ? value.asArray().map((n) => n.asNumber()) : null;
}

async function exportObject(obj) {
  const bytes = await savePDFWithAnnotationsPdfLib(await makePdfFile(), {
    1: { objects: [obj] },
  }, PAGE_SIZES, null, { returnBytes: true });
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'expected an exported annotation');
  return doc.context.lookup(annots.asArray()[0]);
}

async function flattenContent(obj) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [obj] } },
    PAGE_SIZES,
    { returnBytes: true },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}

function devicePathPoints(contentText) {
  const identity = [1, 0, 0, 1, 0, 0];
  const mul = (a, b) => [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
  const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  let ctm = identity;
  const stack = [];
  const nums = [];
  const points = [];
  const pushPoints = (op, count) => {
    for (let i = count * 2; i > 0; i -= 2) {
      points.push({ ...apply(ctm, nums[nums.length - i], nums[nums.length - i + 1]), op });
    }
  };
  for (const tok of contentText.split(/\s+/).filter(Boolean)) {
    const n = Number(tok);
    if (Number.isFinite(n) && /^[-.\d]/.test(tok)) { nums.push(n); continue; }
    if (tok === 'q') stack.push(ctm);
    else if (tok === 'Q') ctm = stack.pop() || identity;
    else if (tok === 'cm' && nums.length >= 6) ctm = mul(nums.slice(-6), ctm);
    else if (tok === 'm' || tok === 'l') pushPoints(tok, 1);
    else if (tok === 'c') pushPoints(tok, 3);
    nums.length = 0;
  }
  return points;
}

test('intended: circle export /Rect uses radius*|scaleX|/|scaleY|', async () => {
  const dict = await exportObject({
    type: 'circle',
    left: 20,
    top: 30,
    radius: 10,
    scaleX: 2,
    scaleY: 2,
    stroke: '#000000',
  });
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Circle');
  // Screen diameter 40: [20, 200-(30+40)=130, 60, 170]
  assert.deepEqual(numberArray(dict, 'Rect'), [20, 130, 60, 170]);
});

test('break: unscaled radius /Rect is not written when scaleX=2', async () => {
  const dict = await exportObject({
    type: 'circle',
    left: 20,
    top: 30,
    radius: 10,
    scaleX: 2,
    scaleY: 2,
    stroke: '#000000',
  });
  const unscaled = [20, PAGE - (30 + 20), 40, PAGE - 30];
  assert.notDeepEqual(numberArray(dict, 'Rect'), unscaled);
});

test('edge: scale default 1 and imported oval aspect both land in /Rect', async () => {
  const unit = await exportObject({
    type: 'circle',
    left: 20,
    top: 30,
    radius: 10,
    stroke: '#000000',
  });
  assert.deepEqual(numberArray(unit, 'Rect'), [20, 150, 40, 170]);

  // Importer stores axis-aligned oval as radius=min/2 + scaleX/scaleY.
  const oval = await exportObject({
    type: 'circle',
    left: 10,
    top: 20,
    radius: 10,
    scaleX: 2,
    scaleY: 1,
    stroke: '#000000',
  });
  assert.deepEqual(numberArray(oval, 'Rect'), [10, PAGE - (20 + 20), 50, PAGE - 20]);
});

test('intended: polygon export /Vertices apply scaleX/scaleY', async () => {
  const dict = await exportObject({
    type: 'polygon',
    left: 10,
    top: 20,
    scaleX: 2,
    scaleY: 2,
    stroke: '#00aa00',
    points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }],
  });
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Polygon');
  assert.deepEqual(numberArray(dict, 'Vertices'), [
    10, PAGE - 20,
    50, PAGE - 20,
    50, PAGE - 40,
  ]);
});

test('break: polygon scaleX=2 is not left+point.x', async () => {
  const dict = await exportObject({
    type: 'polygon',
    left: 10,
    top: 20,
    scaleX: 2,
    scaleY: 2,
    stroke: '#00aa00',
    points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }],
  });
  assert.notDeepEqual(numberArray(dict, 'Vertices'), [
    10, PAGE - 20,
    30, PAGE - 20,
    30, PAGE - 30,
  ]);
});

test('edge: polyline scale 1 stays left+point.x; scale 2 stretches', async () => {
  const unit = await exportObject({
    type: 'polyline',
    left: 10,
    top: 20,
    stroke: '#0000aa',
    points: [{ x: 0, y: 0 }, { x: 20, y: 10 }],
  });
  assert.equal(unit.get(PDFName.of('Subtype')).decodeText(), 'PolyLine');
  assert.deepEqual(numberArray(unit, 'Vertices'), [
    10, PAGE - 20,
    30, PAGE - 30,
  ]);

  const scaled = await exportObject({
    type: 'polyline',
    left: 10,
    top: 20,
    scaleX: 2,
    scaleY: 3,
    stroke: '#0000aa',
    points: [{ x: 0, y: 0 }, { x: 20, y: 10 }],
  });
  assert.deepEqual(numberArray(scaled, 'Vertices'), [
    10, PAGE - 20,
    50, PAGE - 50,
  ]);
});

test('intended: print flatten polygon vertices honor scale', async () => {
  const content = await flattenContent({
    type: 'polygon',
    left: 10,
    top: 20,
    scaleX: 2,
    scaleY: 2,
    stroke: '#00aa00',
    strokeWidth: 1,
    fill: 'transparent',
    points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }],
  });
  const pts = devicePathPoints(content);
  const lineOps = pts.filter((p) => p.op === 'm' || p.op === 'l');
  assert.ok(lineOps.length >= 3, 'expected polygon path ops');
  assert.ok(Math.abs(lineOps[1].x - 50) < 0.5, `scaled second vertex x, got ${lineOps[1].x}`);
  assert.ok(Math.abs(lineOps[1].y - (PAGE - 20)) < 0.5, `scaled second vertex y, got ${lineOps[1].y}`);
});

test('intended: print flatten circle uses radius*scale', async () => {
  const content = await flattenContent({
    type: 'circle',
    left: 20,
    top: 30,
    radius: 10,
    scaleX: 2,
    scaleY: 2,
    stroke: '#000000',
    strokeWidth: 1,
  });
  const pts = devicePathPoints(content);
  assert.ok(pts.length >= 4, 'expected ellipse bezier ops');
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  assert.ok(spanX > 35 && spanX < 45, `scaled diameter ~40, got spanX ${spanX}`);
  assert.ok(spanY > 35 && spanY < 45, `scaled diameter ~40, got spanY ${spanY}`);
});
