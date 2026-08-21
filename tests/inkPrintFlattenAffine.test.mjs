// Ink print flatten must bake the same affine export uses
// (createInkPageTransform). After move/scale/rotate the authored path stays
// local; raw path commands printed the unmoved stroke.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import { savePDFWithFlattenedRegularAnnotationsForPrint } from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  commitInkObjectMove,
  commitInkObjectResize,
  createInkPathAffine,
} from '../src/utils/inkGeometryTransform.js';

const PAGE = 200;
const PAGE_SIZES = { 1: { width: PAGE, height: PAGE } };
const TOL = 0.75;

const RAW_PATH = [
  ['M', 50, 60],
  ['L', 90, 100],
];

function rawInk(overrides = {}) {
  return {
    type: 'path',
    tool: 'pen',
    left: 0,
    top: 0,
    stroke: '#ff0000',
    strokeWidth: 2,
    path: RAW_PATH.map((cmd) => [...cmd]),
    ...overrides,
  };
}

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

function expectedDevice(obj, localX, localY) {
  const affine = createInkPathAffine(obj, obj.path);
  const page = affine.point(localX, localY);
  return { x: page.x, y: PAGE - page.y };
}

function firstMoveOrLine(points) {
  const hit = points.find((p) => p.op === 'm' || p.op === 'l');
  assert.ok(hit, 'expected a path move/line in the flattened content');
  return hit;
}

function assertNear(actual, expected, label) {
  assert.ok(
    Math.abs(actual.x - expected.x) < TOL && Math.abs(actual.y - expected.y) < TOL,
    `${label}: expected (~${expected.x}, ~${expected.y}), got (${actual.x}, ${actual.y})`,
  );
}

test('edge: unmoved absolute ink print flatten stays identity', async () => {
  const obj = rawInk();
  const points = devicePathPoints(await flattenContent(obj));
  const first = firstMoveOrLine(points);
  assertNear(first, { x: 50, y: PAGE - 60 }, 'unmoved start');
  const last = points.filter((p) => p.op === 'm' || p.op === 'l').at(-1);
  assertNear(last, { x: 90, y: PAGE - 100 }, 'unmoved end');
});

test('intended: print flatten ink honors commitInkObjectMove', async () => {
  const obj = commitInkObjectMove(rawInk(), 20, 10);
  const points = devicePathPoints(await flattenContent(obj));
  const first = firstMoveOrLine(points);
  assertNear(first, expectedDevice(obj, 50, 60), 'moved start');
  assertNear(first, { x: 70, y: PAGE - 70 }, 'moved start world');
});

test('break: moved ink print is not the raw path', async () => {
  const obj = commitInkObjectMove(rawInk(), 20, 10);
  const first = firstMoveOrLine(devicePathPoints(await flattenContent(obj)));
  assert.ok(
    Math.abs(first.x - 50) > 5 || Math.abs(first.y - (PAGE - 60)) > 5,
    `moved start must not stay at raw (50, ${PAGE - 60}); got (${first.x}, ${first.y})`,
  );
});

test('intended: print flatten ink honors commitInkObjectResize scale', async () => {
  const localized = commitInkObjectMove(rawInk(), 0, 0);
  const obj = commitInkObjectResize(localized, {
    scaleX: 2,
    scaleY: 2,
    visibleLeft: 30,
    visibleTop: 40,
  });
  const first = firstMoveOrLine(devicePathPoints(await flattenContent(obj)));
  assertNear(first, expectedDevice(obj, 50, 60), 'scaled start');
  assert.ok(
    Math.abs(first.x - 50) > 5 || Math.abs(first.y - (PAGE - 60)) > 5,
    `scaled start must not stay at raw (50, ${PAGE - 60}); got (${first.x}, ${first.y})`,
  );
});

test('intended: print flatten ink honors rotation + pathOffset', async () => {
  const obj = {
    type: 'path',
    left: 100,
    top: 80,
    scaleX: 2,
    scaleY: 0.5,
    angle: 90,
    pathOffset: { x: 10, y: 20 },
    stroke: '#112233',
    strokeWidth: 2,
    path: [
      ['M', 10, 20],
      ['Q', 20, 0, 30, 20],
      ['C', 40, 30, 50, 10, 60, 20],
    ],
  };
  const first = firstMoveOrLine(devicePathPoints(await flattenContent(obj)));
  assertNear(first, expectedDevice(obj, 10, 20), 'rotated start');
  assert.ok(
    Math.abs(first.x - 10) > 5 || Math.abs(first.y - (PAGE - 20)) > 5,
    `rotated start must not stay at raw (10, ${PAGE - 20}); got (${first.x}, ${first.y})`,
  );
});
