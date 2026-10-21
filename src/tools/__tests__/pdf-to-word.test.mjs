import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFDocument } from 'pdf-lib';
import {
  toDocx, placeItems, linesFromItems, paragraphsFromLines, NO_TEXT,
} from '../pdfParagraphs.js';
import { ToolError } from '../errors.js';
import { specPdf, readPages } from './pdfParagraphsHelpers.mjs';

const item = (str, x, y, { size = 11, width = str.length * size * 0.5, fontName = 'f1' } = {}) => ({
  str, transform: [size, 0, 0, size, x, y], width, fontName,
});

test('docx: a real Word reader finds the text, headings, lists and bold', { timeout: 60_000 }, async () => {
  const docx = toDocx(await readPages(await specPdf()));
  const buffer = Buffer.from(docx);
  const { value: html } = await mammoth.convertToHtml({ buffer });
  assert.match(html, /<h1>(<strong>)?Section 09 91 23 Painting(<\/strong>)?<\/h1>/);
  assert.match(html, /<h2>(<strong>)?Part 1 General(<\/strong>)?<\/h2>/);
  assert.match(html, /<h2>(<strong>)?Part 2 Products(<\/strong>)?<\/h2>/);
  assert.match(html, /<p>The contractor shall supply all <strong>labor <\/strong>and materials for the work\.<\/p>/);
  assert.match(html, /<p>Submit product data before any work starts\.<\/p>/);
  assert.match(html, /<p>•\s*Primer for steel<\/p>/);
  assert.match(html, /<p>1\.\s*Paint shall be low VOC\.<\/p>/);
  assert.match(html, /NOT FOR CONSTRUCTION/);
});

test('docx: one page break per PDF page, page size from the PDF, valid parts', { timeout: 60_000 }, async () => {
  const zip = await JSZip.loadAsync(toDocx(await readPages(await specPdf())));
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) {
    assert.ok(zip.file(name), `${name} is in the package`);
  }
  const doc = await zip.file('word/document.xml').async('string');
  // Three pages (the last one blank): two breaks.
  assert.equal(doc.match(/<w:pageBreakBefore\/>/g).length, 2);
  assert.match(doc, /<w:pgSz w:w="12240" w:h="15840"\/>/);
  const opens = (doc.match(/<w:p>|<w:p /g) || []).length;
  assert.equal(opens, (doc.match(/<\/w:p>/g) || []).length);
});

test('docx: text with XML characters and control codes stays well formed', async () => {
  const words = placeItems([item('A < B & C > D \u0001', 72, 700)], [1, 0, 0, -1, 0, 792]);
  const paras = linesFromItems(words).flatMap(paragraphsFromLines);
  const docx = toDocx([{ width: 612, height: 792, paras }]);
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(docx) });
  assert.equal(value.trim(), 'A < B & C > D');
});

test('lines: words on one baseline join, wide gaps become tabs, fake bold is dropped', () => {
  const vt = [1, 0, 0, -1, 0, 792];
  const words = placeItems([
    item('Door', 72, 700, { width: 22 }),
    item('Door', 72.3, 700, { width: 22 }), // drawn twice to look bold
    item('schedule', 100, 700.5, { width: 40 }),
    item('3070', 300, 700, { width: 22 }),
    item('Next', 72, 686, { width: 22 }),
  ], vt);
  const [lines] = linesFromItems(words);
  assert.deepEqual(lines.map((l) => l.text), ['Door schedule\t3070', 'Next']);
});

test('paragraphs: a hyphen at a line end joins the word without a space', () => {
  const vt = [1, 0, 0, -1, 0, 792];
  const words = placeItems([item('Seal all pene-', 72, 700), item('trations and joints.', 72, 686)], vt);
  const paras = linesFromItems(words).flatMap(paragraphsFromLines);
  assert.equal(paras.length, 1);
  assert.equal(paras[0].runs.map((r) => r.text).join(''), 'Seal all pene-trations and joints.');
});

test('a PDF with no text says to run OCR first', { timeout: 60_000 }, async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await assert.rejects(readPages(await doc.save()), (e) => e instanceof ToolError && e.message === NO_TEXT);
});
