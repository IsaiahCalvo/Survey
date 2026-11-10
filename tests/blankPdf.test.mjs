import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  blankPageBox, buildBlankPdf, clampBlankPages, paperMarks, paperSpacing, uniqueDocumentName,
} from '../src/utils/blankPdf.js';

test('page boxes turn with orientation and fall back to Letter', () => {
  assert.deepEqual(blankPageBox('letter'), { width: 612, height: 792 });
  assert.deepEqual(blankPageBox('letter', 'landscape'), { width: 792, height: 612 });
  assert.deepEqual(blankPageBox('nope'), { width: 612, height: 792 });
  const a4 = blankPageBox('a4');
  assert.ok(Math.abs(a4.width - 595.28) < 0.01 && Math.abs(a4.height - 841.89) < 0.01);
});

test('page count stays between 1 and 100', () => {
  assert.equal(clampBlankPages('3'), 3);
  assert.equal(clampBlankPages(0), 1);
  assert.equal(clampBlankPages('x'), 1);
  assert.equal(clampBlankPages(500), 100);
});

test('papers draw inside the page', () => {
  const box = { width: 612, height: 792 };
  assert.equal(paperMarks('blank', box).length, 0);
  for (const paper of ['lined', 'grid', 'dots']) {
    const marks = paperMarks(paper, box);
    assert.ok(marks.length > 10, paper);
    for (const m of marks) {
      const xs = m.kind === 'line' ? [m.x1, m.x2] : [m.x];
      const ys = m.kind === 'line' ? [m.y1, m.y2] : [m.y];
      assert.ok(xs.every((x) => x >= 0 && x <= box.width) && ys.every((y) => y >= 0 && y <= box.height), paper);
    }
  }
  // Big sheets get a wider step so the grid stays readable.
  assert.equal(paperSpacing(blankPageBox('arch-d')), 36);
  assert.equal(paperSpacing(box), 18);
});

test('a taken name gets the next free number', () => {
  assert.equal(uniqueDocumentName('Blank document', []), 'Blank document');
  assert.equal(uniqueDocumentName('Blank document', ['blank document.pdf', 'Blank document 2']), 'Blank document 3');
  assert.equal(uniqueDocumentName('  ', []), 'Blank document');
});

test('the PDF has the pages, size and title asked for, and stays small', async () => {
  const bytes = await buildBlankPdf({ title: 'Site walk', sizeId: 'tabloid', orientation: 'landscape', pages: 4, paper: 'grid' });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 4);
  const { width, height } = doc.getPage(3).getSize();
  assert.equal(Math.round(width), 1224);
  assert.equal(Math.round(height), 792);
  assert.equal(doc.getTitle(), 'Site walk');
  const big = await buildBlankPdf({ sizeId: 'arch-d', pages: 100, paper: 'dots' });
  assert.ok(big.length < 400_000, `100 dotted ARCH D pages came to ${big.length} bytes`);
});
