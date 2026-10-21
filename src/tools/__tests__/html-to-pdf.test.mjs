import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { pageToSimpleHtml, decodeHtml } from '../html.js';
import { htmlToBlocks, docxBlocksToPdf } from '../docLayout.js';

// The browser tool parses with DOMParser; jsdom stands in for it here and,
// like DOMParser, runs no scripts.
const parse = (html) => new JSDOM(html).window.document;
const text = (b) => b.runs.map((r) => (r.br ? '\n' : r.text)).join('');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const PAGE = `<!doctype html><html><head><title>Not body</title><style>p { color: red }</style>
<script>document.title = 'ran'</script></head><body>
<nav><a href="/home">Home</a></nav>
<h1>Inspection   report</h1>
<p>Found <strong>two issues</strong> and <em>one note</em>. See
  <a href="https://example.com/a?x=1&amp;y=2">the portal</a>.</p>
<div>Loose text <span style="font-weight: 700">bold span</span><div>Inner block</div>after</div>
<ul><li>Firestop</li><li>Handrail<ul><li>Level 2</li></ul></li></ul>
<ol><li>Fix</li><li>Check</li></ol>
<table><caption>Status</caption><thead><tr><th>Item</th><th>State</th></tr></thead>
<tbody><tr><td>Firestop</td><td>Open</td></tr><tr><td colspan="2">Both <table><tr><td>nested</td></tr></table></td></tr></tbody></table>
<img src="data:image/png;base64,${PNG}"><img src="photo.jpg"><img src="https://example.com/x.png">
<p hidden>hidden one</p><p style="display:none">hidden two</p>
<pre>line one
  line two</pre>
<form><input value="typed"><button>Send</button></form>
<script>document.write('<p>INJECTED</p>')</script><noscript>no script</noscript>
</body></html>`;

test('html: a page becomes headings, styled text, lists, a table and pictures; scripts and styling are dropped', () => {
  const { html, linkedImages } = pageToSimpleHtml(parse(PAGE));
  assert.equal(linkedImages, 2);
  for (const gone of ['Not body', 'color: red', 'ran', 'INJECTED', 'document.write', 'hidden one', 'hidden two', 'typed', 'Send', 'no script', 'photo.jpg']) {
    assert.ok(!html.includes(gone), gone);
  }
  const blocks = htmlToBlocks(html);
  const paras = blocks.filter((b) => b.kind === 'para');
  assert.equal(paras[0].runs[0].text, 'Home', 'a local link keeps its text');
  assert.ok(!paras[0].runs[0].href);
  assert.equal(paras[1].style, 'h1');
  assert.equal(text(paras[1]), 'Inspection report');
  assert.equal(text(paras[2]), 'Found two issues and one note. See the portal.');
  assert.ok(paras[2].runs.find((r) => r.text === 'two issues').b);
  assert.ok(paras[2].runs.find((r) => r.text === 'one note').i);
  assert.equal(paras[2].runs.find((r) => r.href).href, 'https://example.com/a?x=1&y=2');
  assert.deepEqual(paras.slice(3, 6).map(text), ['Loose text bold span', 'Inner block', 'after']);
  assert.ok(paras[3].runs.find((r) => r.text === 'bold span').b);
  const items = paras.filter((b) => b.list);
  assert.deepEqual(items.map((b) => [text(b), b.list.depth, b.list.ordered]), [
    ['Firestop', 0, false], ['Handrail', 0, false], ['Level 2', 1, false], ['Fix', 0, true], ['Check', 0, true],
  ]);
  const table = blocks.find((b) => b.kind === 'table');
  assert.deepEqual(table.rows.map((r) => r.map((c) => [c.span, c.blocks.map(text).join('/')])), [
    [[1, 'Item'], [1, 'State']], [[1, 'Firestop'], [1, 'Open']], [[2, 'Both/nested']],
  ]);
  assert.ok(table.rows[0][0].blocks[0].runs[0].b, 'header cells are bold');
  assert.ok(paras.some((b) => text(b) === 'Status'), 'caption kept');
  assert.equal(blocks.filter((b) => b.kind === 'image').length, 1);
  assert.equal(text(paras.find((b) => text(b).startsWith('line one'))), 'line one\n  line two');
});

test('html to PDF: real text over several pages', async () => {
  const body = `<h1>Long</h1>${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>'.repeat(200)}`;
  const { html } = pageToSimpleHtml(parse(`<html><body>${body}<img src="data:image/png;base64,${PNG}"></body></html>`));
  const { bytes, skippedImages } = await docxBlocksToPdf(htmlToBlocks(html), { pageSize: 'letter' });
  assert.equal(skippedImages, 0);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 4, `pages ${doc.getPageCount()}`);
});

test('html: the page\'s own charset is used', () => {
  const latin = Uint8Array.from([...new TextEncoder().encode('<meta charset="windows-1252"><p>Caf'), 0xe9]);
  assert.equal(decodeHtml(latin).slice(-4), 'Café');
  assert.equal(decodeHtml(new TextEncoder().encode('<p>Café</p>')), '<p>Café</p>');
  assert.equal(decodeHtml(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), 'A');
});
