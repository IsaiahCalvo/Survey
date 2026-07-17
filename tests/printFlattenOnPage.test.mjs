// Print flatten — pen strokes, polygons/polylines, and counter pins must land
// ON the page (drawSvgPath origin regression guard).
//
// pdf-lib's page.drawSvgPath negates path y (scale(1,-1)) around options.{x,y},
// and the origin DEFAULTS to (0,0) at the page's BOTTOM-left. Passing
// pre-flipped getPdfY coordinates with the default origin lands the whole path
// at negative device y — entirely off-page, silently invisible in the printed
// PDF. The verified-correct pattern (see drawFlattenedArrowheadSpec in
// src/utils/pdfAnnotationsPdfLib.js and its GOTCHA comment) is origin
// {x: 0, y: pageHeight} with RAW app-space (y-down) coordinates.
//
// These tests decode the flattened page's content stream and replay the
// graphics state (q/Q/cm) to compute DEVICE-space coordinates for every path
// construction op — a genuine on-page proof, not a raw-number proxy. Before
// the 2026-07-17 origin fix all three shapes landed at device y < 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import { savePDFWithFlattenedRegularAnnotationsForPrint } from '../src/utils/pdfAnnotationsPdfLib.js';

const PAGE = 200;
const PAGE_SIZES = { 1: { width: PAGE, height: PAGE } };

async function makePdfFile(name = 'source.pdf') {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE, PAGE]);
  const bytes = await doc.save();
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function flattenObjectContent(obj) {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    pdfFile,
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

// Replay q/Q/cm and map every m/l/c/v/y/re path point into DEVICE space.
// Each returned point is { x, y, op }.
function devicePathPoints(contentText) {
  const identity = [1, 0, 0, 1, 0, 0];
  // result = a-then-b (PDF cm: newCTM = Mcm x CTM)
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
      const x = nums[nums.length - i];
      const y = nums[nums.length - i + 1];
      points.push({ ...apply(ctm, x, y), op });
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
    else if (tok === 'v' || tok === 'y') pushPoints(tok, 2);
    else if (tok === 're' && nums.length >= 4) {
      const [x, y, w, h] = nums.slice(-4);
      points.push({ ...apply(ctm, x, y), op: 're' });
      points.push({ ...apply(ctm, x + w, y + h), op: 're' });
    }
    nums.length = 0;
  }
  return points;
}

// Bezier control points for arc segments may bulge slightly past the exact
// geometry; give the on-page box a small tolerance.
const TOL = 2;
const assertAllOnPage = (points, label) => {
  assert.ok(points.length >= 2, `${label}: expected path construction ops in the content stream`);
  for (const { x, y, op } of points) {
    assert.ok(x >= -TOL && x <= PAGE + TOL, `${label}: device x ${x} (${op}) must be on the ${PAGE}pt page`);
    assert.ok(y >= -TOL && y <= PAGE + TOL, `${label}: device y ${y} (${op}) must be on the ${PAGE}pt page`);
  }
};

test('print flatten draws a pen stroke ON the page', async () => {
  const contentText = await flattenObjectContent({
    type: 'path',
    stroke: '#ff0000',
    strokeWidth: 2,
    path: [['M', 50, 60], ['Q', 70, 80, 90, 100], ['C', 100, 110, 110, 130, 120, 140], ['L', 130, 150]],
  });
  const points = devicePathPoints(contentText);
  assertAllOnPage(points, 'pen stroke');
  // The stroke must actually track its app-space geometry: first point
  // (app 50,60) belongs at device (50, pageHeight-60).
  const first = points[0];
  assert.ok(Math.abs(first.x - 50) < TOL && Math.abs(first.y - (PAGE - 60)) < TOL,
    `pen stroke start must map to device (50, ${PAGE - 60}), got (${first.x}, ${first.y})`);
});

test('print flatten draws a polygon ON the page', async () => {
  const contentText = await flattenObjectContent({
    type: 'polygon',
    left: 40,
    top: 50,
    stroke: '#00aa00',
    strokeWidth: 2,
    fill: 'transparent',
    points: [{ x: 0, y: 0 }, { x: 60, y: 10 }, { x: 30, y: 50 }],
  });
  const points = devicePathPoints(contentText);
  assertAllOnPage(points, 'polygon');
  const first = points[0];
  assert.ok(Math.abs(first.x - 40) < TOL && Math.abs(first.y - (PAGE - 50)) < TOL,
    `polygon first vertex must map to device (40, ${PAGE - 50}), got (${first.x}, ${first.y})`);
});

test('print flatten draws a polyline ON the page', async () => {
  const contentText = await flattenObjectContent({
    type: 'polyline',
    left: 30,
    top: 120,
    stroke: '#0000aa',
    strokeWidth: 2,
    points: [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 90, y: 5 }],
  });
  assertAllOnPage(devicePathPoints(contentText), 'polyline');
});

test('print flatten draws the counter pin body ON the page with the on-screen arc orientation', async () => {
  const radius = 12;
  const left = 80;
  const top = 80;
  const contentText = await flattenObjectContent({
    type: 'circle',
    radius,
    left,
    top,
    fill: '#ef4444',
    data: { type: 'counter', displayNumber: '3', pointerAngle: 225 },
  });
  const points = devicePathPoints(contentText);
  assertAllOnPage(points, 'counter pin');
  // Arc-orientation guard (sweep flag): the pin's circular arc must trace the
  // REAL circle — centered at app (left+r, top+r) => device (92, pageHeight-92).
  // A wrong sweep flag makes pdf-lib pick the mirrored arc center, landing the
  // curve points ~2x the chord distance away from the true center.
  const cx = left + radius;
  const cy = PAGE - (top + radius);
  const curvePoints = points.filter((p) => p.op === 'c');
  assert.ok(curvePoints.length >= 4, 'counter pin arc must emit bezier curve ops');
  for (const { x, y } of curvePoints) {
    const dist = Math.hypot(x - cx, y - cy);
    assert.ok(dist <= radius * 1.15,
      `counter pin arc point (${x}, ${y}) must lie on the pin circle around (${cx}, ${cy}); dist ${dist}`);
  }
});
