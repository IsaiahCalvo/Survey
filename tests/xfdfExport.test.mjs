// KAL-393 (F11): XFDF sidecar export. Every kind of mark the app draws must
// reach the .xfdf with its page, box, colour and text; marks already inside
// the source PDF must not be copied; the source PDF bytes must not change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  buildXfdfFromAnnotatedPdf,
  exportAnnotationsAsXfdf,
  withUniformHighlightsAsAnnotations,
  xfdfFileNameForPdf,
} from '../src/utils/xfdfExport/index.js';
import { formValuesToXfdf } from '../src/utils/xfdfExport/formFields.js';
import { escapeXml, formatNumber, pdfColorToHex, pdfFlagsToXfdf } from '../src/utils/xfdfExport/xfdfXml.js';
import { xfdfResultMessage } from '../src/utils/xfdfExport/runXfdfExport.js';
import { EXPECTED, PAGE_SIZES, fileFrom, makeAnnotationsByPage, makeSourcePdf, sha256 } from './helpers/xfdfFixtures.mjs';

const parseXml = (text) => {
  const { DOMParser } = new JSDOM('').window;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  assert.equal(doc.getElementsByTagName('parsererror').length, 0, 'XFDF must be well-formed XML');
  return doc;
};

const annotElements = (doc) => [...doc.getElementsByTagName('annots')[0].children];

test('XFDF carries every app mark with page, box, colour and text, and leaves the source PDF untouched', async () => {
  const sourceBytes = await makeSourcePdf();
  const hashBefore = sha256(sourceBytes);
  const model = makeAnnotationsByPage();
  const modelBefore = JSON.stringify(model);

  const result = await exportAnnotationsAsXfdf(fileFrom(sourceBytes), model, PAGE_SIZES, {});

  assert.equal(sha256(sourceBytes), hashBefore, 'source PDF bytes must not change');
  assert.equal(JSON.stringify(model), modelBefore, 'the app model must not change');
  const doc = parseXml(result.xfdf);
  const root = doc.documentElement;
  assert.equal(root.localName, 'xfdf');
  assert.equal(root.namespaceURI, 'http://ns.adobe.com/xfdf/');
  assert.equal(doc.getElementsByTagName('f')[0].getAttribute('href'), 'Level 2 plan.pdf');
  const ids = doc.getElementsByTagName('ids')[0];
  assert.equal(ids.getAttribute('original'), 'A1B2C3');
  assert.equal(ids.getAttribute('modified'), 'D4E5F6');

  const byName = new Map(annotElements(doc).map((el) => [el.getAttribute('name'), el]));
  assert.equal(byName.has('already-in-source'), false, 'a mark already in the source PDF is not copied');
  assert.deepEqual([...byName.keys()].sort(), Object.keys(EXPECTED).sort());
  assert.equal(result.summary.written, Object.keys(EXPECTED).length);
  assert.equal(result.summary.skipped, 0);

  for (const [id, want] of Object.entries(EXPECTED)) {
    const el = byName.get(id);
    assert.equal(el.localName, want.element, `${id} element`);
    assert.equal(el.getAttribute('page'), String(want.page), `${id} page`);
    const rect = el.getAttribute('rect').split(',').map(Number);
    assert.equal(rect.length, 4, `${id} rect has four numbers`);
    assert.ok(rect[2] > rect[0] && rect[3] > rect[1], `${id} rect is a real box`);
    if (want.color) assert.equal(el.getAttribute('color'), want.color, `${id} colour`);
    if (want.interior) assert.equal(el.getAttribute('interior-color'), want.interior, `${id} fill`);
    if (want.tail) assert.equal(el.getAttribute('tail'), want.tail, `${id} arrow end`);
    if (want.contents) {
      assert.equal(el.getElementsByTagName('contents')[0]?.textContent, want.contents, `${id} text`);
    }
  }

  // Geometry the other tools need to redraw each kind.
  assert.equal(byName.get('arrow-1').getAttribute('start'), '20,300');
  assert.equal(byName.get('arrow-1').getAttribute('end'), '150,240');
  assert.equal(byName.get('hl-1').getAttribute('coords'), '20,100,100,100,20,90,100,90');
  assert.equal(byName.get('ink-1').getElementsByTagName('gesture')[0].textContent, '200,200;240,170;300,180');
  assert.equal(byName.get('polyline-1').getElementsByTagName('vertices')[0].textContent, '50,250;100,240;150,250');
  assert.equal(byName.get('text-1').getElementsByTagName('defaultappearance')[0].textContent, '1 0 0 rg /Helv 12 Tf');
});

test('XFDF of a document with no app marks has an empty annots list', async () => {
  const sourceBytes = await makeSourcePdf();
  const result = await exportAnnotationsAsXfdf(fileFrom(sourceBytes), {}, PAGE_SIZES, {});
  const doc = parseXml(result.xfdf);
  assert.equal(annotElements(doc).length, 0);
  assert.equal(result.summary.written, 0);
  assert.deepEqual(xfdfResultMessage({ status: 'empty' }), { text: 'No markup to export yet.', kind: 'warn' });
});

test('building from identical source and annotated bytes yields nothing new', async () => {
  const sourceBytes = await makeSourcePdf();
  const { summary } = await buildXfdfFromAnnotatedPdf({ sourceBytes, annotatedBytes: sourceBytes });
  assert.equal(summary.written, 0);
});

test('uniform highlights become real highlight annotations without touching the app objects', () => {
  const model = makeAnnotationsByPage();
  const out = withUniformHighlightsAsAnnotations(model);
  const uniform = out[1].objects.find((o) => o.id === 'hl-uniform');
  assert.equal(uniform.data.overlapMode, 'layered');
  assert.equal(model[1].objects.find((o) => o.id === 'hl-uniform').data.overlapMode, 'uniform');
});

test('format helpers', () => {
  assert.equal(xfdfFileNameForPdf('Level 2 plan.PDF'), 'Level 2 plan.xfdf');
  assert.equal(xfdfFileNameForPdf(''), 'document.xfdf');
  assert.equal(escapeXml('a<b>&"c\'\u0001'), 'a&lt;b&gt;&amp;&quot;c&apos;');
  assert.equal(formatNumber(-0.00001), '0');
  assert.equal(formatNumber(1.234567), '1.2346');
  assert.equal(pdfColorToHex([1, 0, 0]), '#FF0000');
  assert.equal(pdfColorToHex([0.5]), '#808080');
  assert.equal(pdfColorToHex([0, 0, 0, 1]), '#000000');
  assert.equal(pdfColorToHex([]), null);
  assert.equal(pdfFlagsToXfdf(4), 'print');
  assert.equal(pdfFlagsToXfdf(4 | 128), 'print,locked');
  assert.equal(pdfFlagsToXfdf(0), null);
  assert.deepEqual(
    xfdfResultMessage({ status: 'saved', fileName: 'a.xfdf', summary: { written: 1, skipped: 2 } }),
    { text: 'Saved 1 mark to a.xfdf. 2 marks could not go in this file type.', kind: 'info' },
  );
});

test('changed form values nest by partial name', () => {
  const xml = formValuesToXfdf([
    { name: 'Inspector.Name', value: ['Ana & Bo'] },
    { name: 'Inspector.Passed', value: ['Yes'] },
    { name: 'Notes', value: ['ok'] },
  ]);
  const doc = parseXml(`<xfdf>${xml}</xfdf>`);
  const top = [...doc.getElementsByTagName('fields')[0].children].map((el) => el.getAttribute('name'));
  assert.deepEqual(top, ['Inspector', 'Notes']);
  const values = [...doc.getElementsByTagName('value')].map((el) => el.textContent);
  assert.deepEqual(values, ['Ana & Bo', 'Yes', 'ok']);
  assert.equal(formValuesToXfdf([]), null);
});

test('XFDF export is reachable from the desktop export menu, the phone More menu and the File menu', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(read('src/AppShell.jsx'), /label: 'Export markup \(XFDF\)'[\s\S]{0,200}onSelect: bottomToolbarApi\.exportXfdf/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /bottomToolbarApi\?\.exportXfdf\?\.\(\);[\s\S]{0,250}Export markup \(XFDF\)/);
  assert.match(read('src/electron-main.js'), /label: 'Export markup \(XFDF\)…'[\s\S]{0,250}menu:export-xfdf/);
  assert.match(read('src/preload.js'), /onExportXfdfMenu[\s\S]{0,120}menu:export-xfdf/);
  assert.match(read('src/PDFViewer.jsx'), /exportXfdf: handleExportXfdf/);
});

test('a custom picture stamp is reported as skipped, a standard named stamp is kept', async () => {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const { annotDictToXfdf } = await import('../src/utils/xfdfExport/annotToXfdf.js');
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const custom = ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 10, 10], AP: ctx.obj({}) });
  assert.deepEqual(annotDictToXfdf(ctx, custom, 0), { skipped: 'custom-appearance', subtype: 'Stamp' });
  const named = ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 10, 10], Name: PDFName.of('Approved') });
  const out = annotDictToXfdf(ctx, named, 0);
  assert.equal(out.element, 'stamp');
  assert.match(out.xml, /icon="Approved"/);
});
