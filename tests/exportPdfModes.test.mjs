import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { exportFileName, pagesWithMarks, parsePageList, pickExportPages } from '../src/utils/exportPdfModes.js';
import { keepOnlyPages, remapLayerStateToPages, stripMarkupAnnotations } from '../src/utils/exportPdfBytes.js';

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

// Codex review on #1206: Survey keeps a hidden copy of its marks in the
// catalog (SurveyAppLayerState); Plain must drop it and a page pick must
// renumber it, or reopening the file in Survey shows the wrong marks.
const layerState = () => ({
  app: 'SurveyApp', kind: 'SurveyAppLayerState', version: 1,
  layers: {
    scopedAnnotationsByPage: { 1: { objects: [{ id: 'a' }] }, 3: { objects: [{ id: 'c' }] } },
    callouts: [{ id: 'k1', pageNumber: 3 }, { id: 'k2', pageNumber: 2 }],
    surveyMarkers: { m1: { pageNumber: 3 }, m2: { pageNumber: 1 } },
    spaces: [{ id: 's', assignedPages: [{ pageId: 1 }, { pageId: 3, regions: [] }] }],
  },
});
const withCatalog = async (entries) => {
  const doc = await PDFDocument.load(await pdfWithAnnots());
  for (const [key, value] of Object.entries(entries)) doc.catalog.set(PDFName.of(key), PDFString.of(JSON.stringify(value)));
  return doc.save();
};
const catalogJson = (doc, key) => {
  const raw = doc.catalog.lookup(PDFName.of(key));
  return raw ? JSON.parse(raw.decodeText()) : null;
};

test('plain drops Survey\'s hidden copy of its marks', async () => {
  const out = await PDFDocument.load(await stripMarkupAnnotations(await withCatalog({ SurveyAppLayerState: layerState() })));
  assert.equal(catalogJson(out, 'SurveyAppLayerState'), null);
});

test('plain keeps a mirrored page mirrored', async () => {
  const out = await PDFDocument.load(await stripMarkupAnnotations(await pdfWithAnnots(), { pageTransformations: { 2: { mirrorH: true } } }));
  assert.deepEqual(catalogJson(out, 'SurveyPagePresentation'), { 2: { rotation: 0, mirrorH: true, mirrorV: false } });
  const plain = await PDFDocument.load(await stripMarkupAnnotations(await pdfWithAnnots()));
  assert.equal(catalogJson(plain, 'SurveyPagePresentation'), null);
});

test('a page pick renumbers Survey\'s hidden marks and drops the rest', () => {
  const { layers } = remapLayerStateToPages(layerState(), [3]);
  assert.deepEqual(layers.scopedAnnotationsByPage, { 1: { objects: [{ id: 'c' }] } });
  assert.deepEqual(layers.callouts, [{ id: 'k1', pageNumber: 1 }]);
  assert.deepEqual(layers.surveyMarkers, { m1: { pageNumber: 1 } });
  assert.deepEqual(layers.spaces[0].assignedPages, [{ pageId: 1, regions: [] }]);
});

test('keepOnlyPages carries the hidden marks and page mirrors to the new page numbers', async () => {
  const src = await withCatalog({ SurveyAppLayerState: layerState(), SurveyPagePresentation: { 3: { mirrorV: true } } });
  const out = await PDFDocument.load(await keepOnlyPages(src, [1, 3]));
  const state = catalogJson(out, 'SurveyAppLayerState');
  assert.deepEqual(Object.keys(state.layers.scopedAnnotationsByPage), ['1', '2']);
  assert.deepEqual(state.layers.surveyMarkers, { m1: { pageNumber: 2 }, m2: { pageNumber: 1 } });
  assert.deepEqual(catalogJson(out, 'SurveyPagePresentation'), { 2: { mirrorV: true } });
});
