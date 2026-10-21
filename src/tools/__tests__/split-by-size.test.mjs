import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDFDocument, PDFName, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState,
} from 'pdf-lib';
import { splitBySize, planParts, pageObjects, partName } from '../splitBySize.js';
import { ToolError } from '../errors.js';

const KB = 1000;

// Bytes that don't compress, from a fixed seed so runs match.
function noise(n, seed) {
  const out = new Uint8Array(n);
  let x = seed * 2654435761 >>> 0 || 1;
  for (let i = 0; i < n; i += 1) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

// A gray image of about `bytes` bytes, as a raw (unfiltered) XObject.
function grayImage(doc, bytes, seed) {
  const side = Math.ceil(Math.sqrt(bytes));
  const stream = doc.context.stream(noise(side * side, seed), {
    Type: 'XObject', Subtype: 'Image', Width: side, Height: side, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
  });
  return doc.context.register(stream);
}

function drawOn(page, ref, key) {
  page.node.setXObject(PDFName.of(key), ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(100, 0, 0, 100, 10, 10), drawObject(key), popGraphicsState());
}

// Page i is (100 + i) wide, so a part's pages can be told apart. Each page
// draws its own image of imageBytes[i] bytes, or one image shared by all.
async function sample(imageBytes, { shared = 0 } = {}) {
  const doc = await PDFDocument.create();
  const common = shared ? grayImage(doc, shared, 99) : null;
  imageBytes.forEach((n, i) => {
    const page = doc.addPage([100 + i, 200]);
    if (common) drawOn(page, common, 'Shared');
    if (n) drawOn(page, grayImage(doc, n, i + 1), `Im${i}`);
  });
  return doc.save();
}

const widths = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

test('split by size: every part is under the limit and pages stay in order', async () => {
  const src = await sample(Array(10).fill(300 * KB));
  const limit = 1000 * KB;
  const progress = [];
  const { parts, tooBig } = await splitBySize(src, limit, (m) => progress.push(m));
  assert.deepEqual(tooBig, []);
  assert.ok(parts.length >= 4, `expected 4 or more parts, got ${parts.length}`);
  for (const p of parts) assert.ok(p.bytes.length <= limit, `part of ${p.bytes.length} bytes is over ${limit}`);
  assert.deepEqual(parts.flatMap((p) => p.pages), [...Array(10).keys()]);
  const seen = (await Promise.all(parts.map((p) => widths(p.bytes)))).flat();
  assert.deepEqual(seen, Array.from({ length: 10 }, (_, i) => 100 + i));
  // Parts are filled, not one page each: 3 pages of 300 KB fit in 1 MB.
  assert.ok(parts.some((p) => p.pages.length === 3));
  assert.ok(progress.some((m) => /Making part/.test(m)));
});

test('split by size: an image shared by every page counts once per part', async () => {
  const src = await sample(Array(8).fill(0), { shared: 400 * KB });
  const { parts } = await splitBySize(src, 1000 * KB);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].pages.length, 8);
});

test('split by size: a page over the limit on its own gets its own part', async () => {
  const src = await sample([50 * KB, 900 * KB, 50 * KB, 50 * KB]);
  const { parts, tooBig } = await splitBySize(src, 500 * KB);
  assert.deepEqual(tooBig, [1]);
  assert.deepEqual(parts.map((p) => p.pages), [[0], [1], [2, 3]]);
  assert.ok(parts[1].bytes.length > 500 * KB);
  assert.ok(parts[0].bytes.length <= 500 * KB && parts[2].bytes.length <= 500 * KB);
});

test('split by size: the plan follows the estimate', async () => {
  const sizes = [400, 400, 400, 100].map((n, i) => new Map([['page', 100], [`${i} 0 R`, n * KB]]));
  assert.deepEqual(planParts(sizes, 1000 * KB), [[0, 1], [2, 3]]);
  // Shared objects cost nothing after the first page in a part.
  const shared = [0, 1, 2].map(() => new Map([['page', 100], ['9 0 R', 600 * KB]]));
  assert.deepEqual(planParts(shared, 1000 * KB), [[0, 1, 2]]);
});

test('split by size: page objects stop at the page tree', async () => {
  const src = await PDFDocument.load(await sample([10 * KB, 10 * KB]));
  const [a, b] = src.getPages().map((p) => pageObjects(src, p));
  const total = (m) => [...m.values()].reduce((x, y) => x + y, 0);
  // Each page holds its own image and nothing from the other page.
  assert.ok(total(a) > 10 * KB && total(a) < 12 * KB);
  assert.ok(total(b) > 10 * KB && total(b) < 12 * KB);
});

test('split by size: names and bad limits', async () => {
  assert.equal(partName('Plans', 1, 3), 'Plans (part 1 of 3).pdf');
  await assert.rejects(splitBySize(await sample([0]), 0), ToolError);
});
