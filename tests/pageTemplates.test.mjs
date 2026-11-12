// Nightly 'page-templates' (Drawboard PDF Pro push 2026-11-12, row C18): the
// page menu's "Template page below" adds a page drawn with a paper template.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { availableActions, buildPageMenuItems, runPageMenuAction } from '../src/sidebar/pageMenuItems.js';
import { composeTransforms, drawPaperOnCanvas, pagePaper, pagePaperMarks } from '../src/utils/blankPagePaper.js';
import { applyPageViewOperation, createPageView, pageViewEntry, pageViewKey } from '../src/utils/pageViewDocument.js';
import { mutatePdfPages } from '../src/utils/pdfPageMutation.js';

const oneLetterPage = () => createPageView(
  { numPages: 1, getPage: async () => ({ view: [0, 0, 612, 792], rotate: 0 }) },
  { sizesByPage: { 1: { width: 612, height: 792 } }, pagesByNumber: { 1: { view: [0, 0, 612, 792], rotate: 0 } } },
);

const noop = () => {};
const keys = (items) => items.filter((i) => !i.separator && !i.header).map((i) => i.key);

test('the row shows only when the host passes its handler, and runs with the page', () => {
  const base = { insertBlank: noop };
  assert.ok(!keys(buildPageMenuItems({ pageNumber: 2, pageCount: 3, available: availableActions(base) })).includes('insertTemplate'));
  const items = keys(buildPageMenuItems({ pageNumber: 2, pageCount: 3, available: availableActions({ ...base, insertTemplate: noop }) }));
  assert.equal(items[items.indexOf('insertBelow') + 1], 'insertTemplate');
  const calls = [];
  assert.equal(runPageMenuAction('insertTemplate', 2, { insertTemplate: (p) => calls.push(p) }), true);
  assert.deepEqual(calls, [2]);
});

test('pagePaper takes only real templates', () => {
  assert.equal(pagePaper('cornell'), 'cornell');
  assert.equal(pagePaper('blank'), null);
  assert.equal(pagePaper('nope'), null);
  assert.equal(pagePaper(undefined), null);
  assert.equal(pagePaper({ type: 'click' }), null);
  assert.ok(pagePaperMarks('notebook', { width: 612, height: 792 }).length > 10);
  assert.deepEqual(pagePaperMarks('blank', { width: 612, height: 792 }), []);
});

test('the page view keeps the paper on the new blank page, its key and its copies', () => {
  const view = applyPageViewOperation(oneLetterPage(), { type: 'insert', afterPage: 1, paper: 'isometric' });
  const entry = pageViewEntry(view, 2);
  assert.equal(entry.blank.paper, 'isometric');
  assert.match(pageViewKey(view, 1), /:isometric$/);
  const plain = applyPageViewOperation(oneLetterPage(), { type: 'insert', afterPage: 1, paper: 'blank' });
  assert.equal(pageViewEntry(plain, 2).blank.paper, undefined);
  const dup = applyPageViewOperation(view, { type: 'duplicate', page: 2 });
  assert.equal(pageViewEntry(dup, 3).blank.paper, 'isometric');
});

test('the stand-in page paints the paper lines', async () => {
  const view = applyPageViewOperation(oneLetterPage(), { type: 'insert', afterPage: 1, paper: 'notebook' });
  const page = await view.getPage(2);
  const strokes = [];
  const ctx = {
    canvas: { width: 612, height: 792 },
    save: noop, restore: noop, setTransform: noop, fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke() { strokes.push(this.strokeStyle); },
  };
  const viewport = page.getViewport({ scale: 1 });
  await page.render({ canvasContext: ctx, viewport }).promise;
  assert.ok(strokes.length > 10);
});

test('drawPaperOnCanvas and composeTransforms', () => {
  assert.deepEqual(composeTransforms([2, 0, 0, 2, 0, 0], [1, 0, 0, -1, 0, 792]), [2, 0, 0, -2, 0, 1584]);
  let widths = [];
  const ctx = { save: noop, restore: noop, setTransform: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke() { widths.push(this.lineWidth); } };
  drawPaperOnCanvas(ctx, [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, tone: 'rule' }], [0.25, 0, 0, -0.25, 0, 100]);
  // Drawn small, a 0.5 pt rule stays about one pixel wide.
  assert.equal(widths[0], 3);
  widths = [];
  drawPaperOnCanvas(ctx, [], [1, 0, 0, 1, 0, 0]);
  assert.equal(widths.length, 0);
});

test('the PDF rewrite draws the paper on the inserted page', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  const plainBytes = await mutatePdfPages(bytes, { type: 'insert', afterPage: 1 });
  const paperBytes = await mutatePdfPages(bytes, { type: 'insert', afterPage: 1, paper: 'engineering' });
  const plain = await PDFDocument.load(plainBytes);
  const paper = await PDFDocument.load(paperBytes);
  assert.equal(paper.getPageCount(), 2);
  const contentSize = (pdf) => {
    const contents = pdf.getPage(1).node.Contents();
    return contents ? String(pdf.context.lookup(contents)?.toString?.() || '').length + 1 : 0;
  };
  assert.ok(contentSize(paper) > contentSize(plain));
});

test('the viewer wires the picker behind the flag', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /const \[pageTemplatesEnabled\] = useState\(\(\) => isFeatureOn\('page-templates'\)\);/);
  assert.match(src, /\.\.\.\(pageTemplatesEnabled \? \{ insertTemplate: \(page\) => setPageTemplatePicker\(\{ afterPage: page \}\) \} : \{\}\),/);
  assert.match(src, /onPick=\{\(afterPage, paper\) => handleInsertBlankPage\(afterPage, paper\)\}/);
  const mig = readFileSync(new URL('../supabase/migrations/20261112095000_page_templates_flag.sql', import.meta.url), 'utf8');
  assert.match(mig, /'page-templates', 'off'/);
});
