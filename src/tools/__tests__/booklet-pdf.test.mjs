import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { bookletPdf, bookletOrder } from '../impose.js';
import { ToolError } from '../errors.js';
import { makePdf, drawnForms, footprint, near } from './imposeHelpers.mjs';

const pagesOf = async (bytes) => (await PDFDocument.load(bytes)).getPages();

test('booklet order for 8 pages: outer sheet first, front then back', () => {
  // Pages are 0-based: [7, 0] is the back cover beside the front cover.
  assert.deepEqual(bookletOrder(8), [[7, 0], [1, 6], [5, 2], [3, 4]]);
  assert.deepEqual(bookletOrder(4), [[3, 0], [1, 2]]);
});

test('booklet order pads to a multiple of 4 with blanks at the end', () => {
  assert.deepEqual(bookletOrder(1), [[null, 0], [null, null]]);
  assert.deepEqual(bookletOrder(6), [[null, 0], [1, null], [5, 2], [3, 4]]);
  assert.deepEqual(bookletOrder(0), []);
});

test('every page appears exactly once, and each sheet folds into a spread', () => {
  for (let n = 1; n <= 41; n += 1) {
    const sides = bookletOrder(n);
    const total = Math.ceil(n / 4) * 4;
    assert.equal(sides.length, total / 2);
    const seen = sides.flat().filter((p) => p !== null).sort((a, b) => a - b);
    assert.deepEqual(seen, Array.from({ length: n }, (_, i) => i));
    // Padding only blanks out pages past the end of the full-length order,
    // where the two pages on a side always add up to the last page number.
    const full = bookletOrder(total);
    for (const [l, r] of full) assert.equal(l + r, total - 1);
    assert.deepEqual(sides, full.map((pair) => pair.map((p) => (p < n ? p : null))));
  }
});

test('a booklet is landscape with two pages meeting at the fold', async () => {
  const src = await makePdf(Array.from({ length: 6 }, (_, i) => ({ size: [612 + i, 792] })));
  const out = await pagesOf(await bookletPdf(src, { paper: 'tabloid' }));
  assert.equal(out.length, 4);
  for (const p of out) assert.deepEqual([p.getWidth(), p.getHeight()], [1224, 792]);
  // Side 1 is [blank, page 1]: only the right half is drawn.
  const first = drawnForms(out[0]);
  assert.equal(first.length, 1);
  assert.equal(first[0].bbox[2], 612);
  assert.ok(near(footprint(first[0]).x, 612));
  // Side 3 is [page 6, page 3], meeting in the middle.
  const [left, right] = drawnForms(out[2]);
  assert.deepEqual([left.bbox[2], right.bbox[2]], [617, 614]);
  assert.ok(near(footprint(left).x + footprint(left).width, 612) && near(footprint(right).x, 612));
});

test('"Two pages wide" makes each sheet exactly two pages across', async () => {
  const src = await makePdf(Array.from({ length: 4 }, () => ({ size: [500, 700] })));
  const out = await pagesOf(await bookletPdf(src, { paper: 'double' }));
  assert.deepEqual([out[0].getWidth(), out[0].getHeight()], [1000, 700]);
  const r = drawnForms(out[0]).map(footprint);
  assert.ok(near(r[0].x, 0) && near(r[0].width, 500) && near(r[1].x, 500) && near(r[1].height, 700));
  await assert.rejects(bookletPdf(src, { paper: 'napkin' }), ToolError);
});
