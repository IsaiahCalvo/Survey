import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import * as docx from '../docx.js';
import * as layout from '../docLayout.js';
import { makeDocx, para, listItem, table } from './makeDocx.mjs';
import docxPage from '../../../scripts/free-tools-catalog/docx-to-pdf.mjs';

test('docx to PDF page: the same tool as Word to PDF, on its own page', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /TOOLS\['docx-to-pdf'\] = TOOLS\['word-to-pdf'\];/);
  assert.equal(docxPage.accept, 'docx');
  assert.ok(docxPage.title.length <= 60 && docxPage.desc.length <= 160);
});

test('docx to PDF: layout moved to docLayout.js; docx.js still offers it', async () => {
  assert.equal(docx.htmlToBlocks, layout.htmlToBlocks);
  assert.equal(docx.docxBlocksToPdf, layout.docxBlocksToPdf);
  const body = para('Minutes', 'Heading1') + listItem('One') + table([['A', 'B']]) + para('Word '.repeat(3000));
  const { bytes } = await layout.docxBlocksToPdf(await docx.readDocx(await makeDocx(body)));
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 4);
});

test('docLayout: link addresses with &amp; are decoded', () => {
  const [block] = layout.htmlToBlocks('<p><a href="https://x.test/?a=1&amp;b=2">x</a></p>');
  assert.equal(block.runs[0].href, 'https://x.test/?a=1&b=2');
});
