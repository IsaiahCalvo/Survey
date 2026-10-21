import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import viewer, { nextZoom, drawScale } from '../defs/pdf-viewer.js';

test('viewer: zoom steps go to the next stop and stop at the ends', () => {
  assert.equal(nextZoom(1, 1), 1.25);
  assert.equal(nextZoom(1, -1), 0.75);
  // From a fit-width zoom between stops, the next stop either way.
  assert.equal(nextZoom(0.3, 1), 0.33);
  assert.equal(nextZoom(0.3, -1), 0.25);
  assert.equal(nextZoom(4, 1), 4);
  assert.equal(nextZoom(0.1, -1), 0.1);
});

test('viewer: a big sheet is drawn sharp but capped in pixels', () => {
  const letter = { width: 612, height: 792 };
  assert.equal(drawScale(letter, 1, 2), 2);
  assert.equal(drawScale(letter, 1, 3), 2); // screens past 2x don't add more
  const archD = { width: 2592, height: 1728 };
  const s = drawScale(archD, 2, 2);
  assert.ok(s < 4);
  assert.ok(archD.width * archD.height * s * s <= 12_000_001);
});

test('viewer: every page size is read up front, turned pages turned', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([2592, 1728]);
  doc.addPage([612, 792]).setRotation(degrees(90));
  const bytes = await doc.save();
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const item = { pdfjs: () => task.promise };
  await viewer.prepare(item, () => {});
  assert.deepEqual(item.sizes, [{ width: 2592, height: 1728 }, { width: 792, height: 612 }]);
  await task.destroy();
});

test('viewer: the main button opens the file in Survey', async () => {
  const file = { name: 'set.pdf', bytes: new Uint8Array([1]) };
  let opened = null;
  await viewer.act(file, { openInSurvey: (f) => { opened = f; } });
  assert.equal(opened, file);
});
