import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { exportFileName, pagesWithMarks, parsePageList, pickExportPages } from '../src/utils/exportPdfModes.js';
import { keepOnlyPages, stripMarkupAnnotations } from '../src/utils/exportPdfBytes.js';

test('page lists: ranges, single pages, reversed ranges, duplicates', () => {
  assert.deepEqual(parsePageList('1-3, 6, 9-7, 2', 10).pages, [1, 2, 3, 6, 7, 8, 9]);
  assert.deepEqual(parsePageList('4', 4).pages, [4]);
  assert.match(parsePageList('', 4).error, /Type the pages/);
  assert.match(parsePageList('0-2', 4).error, /pages 1 to 4/);
  assert.match(parsePageList('5', 4).error, /pages 1 to 4/);
  assert.match(parsePageList('a', 4).error, /not a page/);
});

test('page choice: all, this page, pages with marks, typed', () => {
  const base = { numPages: 5, currentPage: 3, marked: [2, 5] };
  assert.deepEqual(pickExportPages({ ...base, choice: 'all' }), { pages: null });
  assert.deepEqual(pickExportPages({ ...base, choice: 'current' }), { pages: [3] });
  assert.deepEqual(pickExportPages({ ...base, choice: 'marked' }), { pages: [2, 5] });
  assert.match(pickExportPages({ ...base, marked: [], choice: 'marked' }).error, /No page has marks/);
  assert.deepEqual(pickExportPages({ ...base, choice: 'custom', custom: '1,4' }), { pages: [1, 4] });
});

test('pages with marks counts shapes and Survey Markers, not empty pages', () => {
  const marked = pagesWithMarks({
    annotationsByPage: { 1: { objects: [] }, 2: { objects: [{ id: 'a' }] }, 4: { objects: [{ id: 'b' }] } },
    surveyMarkers: { m1: { pageNumber: 3 }, m2: { pageNumber: 2 } },
  });
  assert.deepEqual(marked, [2, 3, 4]);
});

test('file names say the kind of export and the pages', () => {
  assert.equal(exportFileName('Plan A.pdf', 'flattened'), 'Plan A-flattened.pdf');
  assert.equal(exportFileName('Plan A.pdf', 'plain', [3]), 'Plan A-plain-p3.pdf');
  assert.equal(exportFileName('Plan A', 'annotated', [2, 3, 7]), 'Plan A-annotated-p2-7.pdf');
});

async function pdfWithAnnots() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) doc.addPage([200, 200]);
  const page = doc.getPage(0);
  const mk = (subtype) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: subtype, Rect: [10, 10, 50, 50] }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([mk('Ink'), mk('Link'), mk('Square'), mk('Widget')]));
  return doc.save();
}

test('plain takes off markups but keeps links and form fields', async () => {
  const out = await PDFDocument.load(await stripMarkupAnnotations(await pdfWithAnnots()));
  const annots = out.getPage(0).node.Annots().asArray().map((ref) => out.context.lookup(ref).get(PDFName.of('Subtype')).toString());
  assert.deepEqual(annots.sort(), ['/Link', '/Widget']);
  assert.equal(out.getPageCount(), 3);
});

test('keepOnlyPages keeps the chosen pages in order', async () => {
  const src = await PDFDocument.create();
  [100, 200, 300].forEach((w) => src.addPage([w, 100]));
  const out = await PDFDocument.load(await keepOnlyPages(await src.save(), [1, 3]));
  assert.deepEqual(out.getPages().map((p) => p.getWidth()), [100, 300]);
});
