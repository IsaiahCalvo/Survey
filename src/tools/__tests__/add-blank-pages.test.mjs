import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { addBlankPages, blankPlan } from '../reorder.js';
import { ToolError } from '../errors.js';
import { makePdf, contentOf } from './imposeHelpers.mjs';

const show = (plan) => plan.map((s) => (s.page !== undefined ? `${s.page + 1}` : 'b')).join(' ');

test('blank plan: after every page, after some pages, start and end', () => {
  assert.equal(show(blankPlan(3)), '1 b 2 b 3 b');
  assert.equal(show(blankPlan(4, { where: 'after', after: [1, 3] })), '1 2 b 3 4 b');
  assert.equal(show(blankPlan(2, { where: 'start', count: 2 })), 'b b 1 2');
  assert.equal(show(blankPlan(2, { where: 'end', count: '3' })), '1 2 b b b');
});

test('blank plan: blanks copy the size of the page before them', () => {
  assert.deepEqual(blankPlan(2, { where: 'after', after: [1] }).at(-1), { blank: 1 });
  assert.deepEqual(blankPlan(2, { where: 'start' })[0], { blank: 0 });
});

test('blank plan refuses odd counts and an empty page list', () => {
  for (const count of [0, -1, 51, 'x']) assert.throws(() => blankPlan(3, { count }), ToolError);
  assert.throws(() => blankPlan(3, { where: 'after', after: [] }), ToolError);
});

test('blank pages match the page they follow, as people see it', async () => {
  const src = await makePdf([{ size: [300, 500], rotate: 90 }, { size: [400, 600], crop: [0, 0, 200, 250] }]);
  const out = await PDFDocument.load(await addBlankPages(src, { where: 'each' }));
  const pages = out.getPages();
  assert.equal(pages.length, 4);
  // Page 1 is turned, so it looks 500 x 300; its blank is too, with no turn.
  assert.deepEqual([pages[1].getWidth(), pages[1].getHeight(), pages[1].getRotation().angle], [500, 300, 0]);
  assert.deepEqual([pages[3].getWidth(), pages[3].getHeight()], [200, 250]);
  assert.equal(contentOf(pages[1]).trim(), '');
  assert.equal(pages[0].getRotation().angle, 90);
});
