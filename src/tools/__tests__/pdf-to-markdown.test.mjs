import test from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, placeItems, linesFromItems, paragraphsFromLines, listMarker } from '../pdfParagraphs.js';
import { specPdf, readPages } from './pdfParagraphsHelpers.mjs';

const EXPECTED = `<!-- Page 1 -->

# Section 09 91 23 Painting

## Part 1 General

The contractor shall supply all **labor** and materials for the work.

Submit product data before any work starts.

- Primer for steel
- Finish coats

---

<!-- Page 2 -->

## Part 2 Products

1. Paint shall be low VOC.
2. Use one maker for each system.

NOT FOR CONSTRUCTION

---

<!-- Page 3 -->
`;

test('markdown: headings by size, paragraphs, lists, bold and page breaks', { timeout: 60_000 }, async () => {
  assert.equal(toMarkdown(await readPages(await specPdf())), EXPECTED);
});

test('markdown: a turned page reads the same; text in the main direction comes first', { timeout: 60_000 }, async () => {
  const md = toMarkdown(await readPages(await specPdf({ rotatePage2: 90 })));
  assert.match(md, /<!-- Page 2 -->\n\n## Part 2 Products\n\n1\. Paint shall be low VOC\.\n2\. Use one maker for each system\.\n\nNOT FOR CONSTRUCTION\n/);
});

test('markdown: characters that would format are escaped', () => {
  const item = (str, y) => ({ str, transform: [11, 0, 0, 11, 72, y], width: str.length * 5.5, fontName: 'f' });
  const words = placeItems([item('# 4 bars @ 12" o.c., *typ*', 700), item('Base_plate [A]', 670)], [1, 0, 0, -1, 0, 792]);
  const paras = linesFromItems(words).flatMap(paragraphsFromLines);
  assert.equal(toMarkdown([{ width: 612, height: 792, paras }]), '\\# 4 bars @ 12" o.c., \\*typ\\*\n\nBase\\_plate \\[A\\]\n');
});

test('list markers: bullets and numbers, not section numbers', () => {
  assert.deepEqual(listMarker('• Primer'), { kind: 'bullet', len: 2 });
  assert.deepEqual(listMarker(' Primer'), { kind: 'bullet', len: 2 });
  assert.deepEqual(listMarker('12) Remove'), { kind: 'number', n: 12, len: 4 });
  assert.equal(listMarker('1.01 SUMMARY'), null);
  assert.equal(listMarker('2024 schedule'), null);
});

test('markdown: HTML-looking text stays text', () => {
  const item = (str, y) => ({ str, transform: [11, 0, 0, 11, 72, y], width: str.length * 5.5, fontName: 'f' });
  const words = placeItems([item('Use <component> & <!-- note --> literally.', 700)], [1, 0, 0, -1, 0, 792]);
  const paras = linesFromItems(words).flatMap(paragraphsFromLines);
  assert.equal(toMarkdown([{ width: 612, height: 792, paras }]), 'Use &lt;component> &amp; &lt;!-- note --> literally.\n');
});
