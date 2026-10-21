import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { reversePdf } from '../reorder.js';
import { ToolError } from '../errors.js';
import { makePdf } from './imposeHelpers.mjs';

test('reverse puts the last page first and keeps markups', async () => {
  const src = await makePdf([{ size: [100, 200] }, { size: [101, 200], rotate: 90 }, { size: [102, 200], markup: true }]);
  const out = await PDFDocument.load(await reversePdf(src));
  const pages = out.getPages();
  assert.deepEqual(pages.map((p) => p.getWidth()), [102, 101, 100]);
  assert.equal(pages[1].getRotation().angle, 90);
  assert.equal(pages[0].node.lookup(PDFName.of('Annots')).size(), 1);
});

test('a one-page PDF has nothing to reverse', async () => {
  await assert.rejects(reversePdf(await makePdf([{ size: [100, 100] }])), ToolError);
});
