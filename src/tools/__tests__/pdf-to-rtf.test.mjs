import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textLines, textParagraphs, markHeadings, bodySize,
} from '../pdfText.js';
import { rtfEscape, writeRtf } from '../rtfWrite.js';
import { letterPdf, pagesOf } from './textPdfHelpers.mjs';

test('pdfText: lines join into paragraphs; the big title is a heading', async () => {
  const [p1, p2] = await pagesOf(await letterPdf());
  const lines = textLines(p1.items);
  assert.deepEqual(lines.map((l) => l.text), [
    'Site Safety Notice', 'All visitors must sign in at the', 'gate and wear a hard hat and a high-', 'visibility vest at all times.', 'Deliveries arrive before 7 am.',
  ]);
  const paras = textParagraphs(lines);
  assert.deepEqual(paras.map((p) => p.text), [
    'Site Safety Notice',
    'All visitors must sign in at the gate and wear a hard hat and a high-visibility vest at all times.',
    'Deliveries arrive before 7 am.',
  ]);
  const second = textParagraphs(textLines(p2.items));
  assert.deepEqual(second.map((p) => p.text), ['Level 2 slab pour Second line here.']);
  const all = [...paras, ...second];
  assert.equal(bodySize(all), 11);
  assert.deepEqual(markHeadings(all).map((p) => p.heading), [1, 0, 0, 0]);
});

test('pdfText: two columns side by side stay apart', () => {
  const item = (str, x, y) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10 });
  const lines = textLines([item('left one', 50, 700), item('right one', 300, 700), item('left two', 50, 688), item('right two', 300, 688)]);
  assert.deepEqual(lines.map((l) => l.text), ['left one right one', 'left two right two']);
  // Upright text isn't merged into lines of level text.
  const up = { str: 'UP', transform: [0, 10, -10, 0, 40, 700], width: 10, height: 10 };
  assert.equal(textLines([item('a', 50, 700), up]).length, 2);
});

test('RTF: special characters and letters past ASCII are escaped', () => {
  assert.equal(rtfEscape('a\\b{c}'), 'a\\\\b\\{c\\}');
  assert.equal(rtfEscape('café'), "caf\\u233\\'3f");
  assert.equal(rtfEscape('–'), "\\u8211\\'3f");
  // Past U+FFFF: two halves, each a signed 16-bit number.
  assert.equal(rtfEscape('😀'), "\\u-10179\\'3f\\u-8704\\'3f");
  assert.equal(rtfEscape('a\tb'), 'a\\tab b');
});

test('RTF: a valid document with headings, paragraphs and page breaks', async () => {
  const pages = (await pagesOf(await letterPdf())).map((p) => textParagraphs(textLines(p.items)));
  const body = bodySize(pages.flat());
  const rtf = new TextDecoder().decode(writeRtf(pages.map((p) => markHeadings(p, body)), { title: 'Notice {1}' }));
  assert.ok(rtf.startsWith('{\\rtf1\\ansi'));
  assert.ok(rtf.endsWith('}'));
  // Braces balance once escaped ones are left out.
  let depth = 0;
  for (const m of rtf.replace(/\\[\\{}]/g, '').matchAll(/[{}]/g)) {
    depth += m[0] === '{' ? 1 : -1;
    assert.ok(depth >= 0);
  }
  assert.equal(depth, 0);
  assert.match(rtf, /\{\\title Notice \\\{1\\\}\}/);
  assert.match(rtf, /\\fs48 \\b Site Safety Notice\\b0\\par/);
  assert.match(rtf, /\\fs22 All visitors must sign in at the gate and wear a hard hat and a high-visibility vest at all times\.\\par/);
  assert.equal(rtf.match(/\\page\b/g).length, 1);
  assert.equal(rtf.match(/\\par\b/g).length, 4);
  const plain = new TextDecoder().decode(writeRtf(pages, { pageBreaks: false }));
  assert.equal(plain.match(/\\page\b/g), null);
});
