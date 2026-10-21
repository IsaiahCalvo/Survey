import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { nUpPdf, nUpLayout, cellOrigin, SHEETS } from '../impose.js';
import { ToolError } from '../errors.js';
import { makePdf, drawnForms, footprint, contentOf, near } from './imposeHelpers.mjs';

const pagesOf = async (bytes) => (await PDFDocument.load(bytes)).getPages();
const letter = [612, 792];

test('layout picks the grid and sheet turn that show pages biggest', () => {
  const pick = (per) => {
    const l = nUpLayout(per, SHEETS.letter, letter);
    return `${l.cols}x${l.rows} ${l.width > l.height ? 'landscape' : 'portrait'}`;
  };
  assert.equal(pick(2), '2x1 landscape');
  assert.equal(pick(4), '2x2 portrait');
  assert.equal(pick(6), '3x2 landscape');
  assert.equal(pick(9), '3x3 portrait');
  // Wide drawings go two to a portrait sheet, one above the other.
  const wide = nUpLayout(2, SHEETS.letter, [1224, 792]);
  assert.deepEqual([wide.cols, wide.rows, wide.width < wide.height], [1, 2, true]);
  assert.throws(() => nUpLayout(3, SHEETS.letter, letter), ToolError);
});

test('cells fill across, then down, from the top-left', () => {
  const l = nUpLayout(4, SHEETS.letter, letter);
  const c = [0, 1, 2, 3].map((k) => cellOrigin(l, k));
  assert.ok(c[0].x < c[1].x && near(c[0].y, c[1].y));
  assert.ok(near(c[2].x, c[0].x) && c[2].y < c[0].y);
  assert.ok(near(c[0].y + l.cellHeight, 792 - 18));
});

test('pages land in reading order, each fitted in its own cell', async () => {
  // Widths tell the pages apart: page i is 400 + 10i wide.
  const src = await makePdf([0, 1, 2, 3, 4].map((i) => ({ size: [400 + 10 * i, 600] })));
  const out = await pagesOf(await nUpPdf(src, { per: 4, sheet: 'letter' }));
  assert.equal(out.length, 2);
  const forms = drawnForms(out[0]);
  assert.deepEqual(forms.map((f) => f.bbox[2]), [400, 410, 420, 430]);
  const r = forms.map(footprint);
  assert.ok(r[0].x < r[1].x && r[0].y > r[2].y && r[2].x < r[3].x, 'across then down');
  for (const f of r) assert.ok(f.x >= 17.99 && f.y >= 17.99 && f.x + f.width <= 594.01 && f.y + f.height <= 774.01);
  assert.equal(drawnForms(out[1]).length, 1);
});

test('the sheet can match the first page, and borders are optional', async () => {
  const src = await makePdf([{ size: [1000, 700], rotate: 90 }, { size: [700, 1000] }]);
  const [sheet] = await pagesOf(await nUpPdf(src, { per: 2, sheet: 'first' }));
  // The first page is seen as 700 x 1000; two fit best side by side on it turned.
  assert.deepEqual([sheet.getWidth(), sheet.getHeight()], [1000, 700]);
  const lines = (s) => (contentOf(s).match(/^S$/gm) || []).length;
  assert.equal(lines(sheet), 0);
  const [bordered] = await pagesOf(await nUpPdf(src, { per: 2, sheet: 'first', border: true }));
  assert.equal(lines(bordered), 2);
});

test('a long PDF reports progress per sheet', async () => {
  const src = await makePdf(Array.from({ length: 250 }, () => ({ size: letter })));
  const seen = [];
  const out = await pagesOf(await nUpPdf(src, { per: 9, sheet: 'a4' }, (i, n) => seen.push([i, n])));
  assert.equal(out.length, 28);
  assert.equal(seen.length, 28);
  assert.deepEqual(seen.at(-1), [27, 28]);
  assert.equal(drawnForms(out[27]).length, 250 - 27 * 9);
});
