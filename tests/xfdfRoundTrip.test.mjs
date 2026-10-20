// KAL-393 round trip: the .xfdf alone must rebuild what pdf.js sees in the
// app's own "Export annotated PDF" output. The XFDF is read by a real XML
// parser (jsdom), stamped onto a clean copy of the source PDF by a small
// importer written here (what Acrobat's "Import comments" does), and both
// PDFs are then read by pdf.js. Every mark must match: kind, page, box,
// colour, text and geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportAnnotationsAsXfdf, withUniformHighlightsAsAnnotations } from '../src/utils/xfdfExport/index.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { PAGE_SIZES, fileFrom, makeAnnotationsByPage, makeSourcePdf } from './helpers/xfdfFixtures.mjs';

const SUBTYPE = {
  square: 'Square', circle: 'Circle', line: 'Line', polygon: 'Polygon', polyline: 'PolyLine',
  ink: 'Ink', freetext: 'FreeText', highlight: 'Highlight', underline: 'Underline',
  squiggly: 'Squiggly', strikeout: 'StrikeOut', text: 'Text', stamp: 'Stamp',
};
const nums = (text) => String(text || '').split(/[,;\s]+/).filter(Boolean).map(Number);
const hexToRgb = (hex) => (hex ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) : null);

async function importXfdf(sourceBytes, xfdfText) {
  const { DOMParser } = new JSDOM('').window;
  const xml = new DOMParser().parseFromString(xfdfText, 'application/xml');
  const pdf = await PDFDocument.load(sourceBytes);
  for (const el of [...xml.getElementsByTagName('annots')[0].children]) {
    const page = pdf.getPage(Number(el.getAttribute('page')));
    const attr = (name) => el.getAttribute(name);
    const child = (name) => el.getElementsByTagName(name)[0]?.textContent ?? null;
    const dict = { Type: 'Annot', Subtype: SUBTYPE[el.localName], Rect: nums(attr('rect')), P: page.ref };
    if (attr('color')) dict.C = hexToRgb(attr('color'));
    if (attr('interior-color')) dict.IC = hexToRgb(attr('interior-color'));
    if (attr('opacity')) dict.CA = Number(attr('opacity'));
    if (attr('width')) dict.Border = [0, 0, Number(attr('width'))];
    if (attr('name')) dict.NM = PDFHexString.fromText(attr('name'));
    if (child('contents') != null) dict.Contents = PDFHexString.fromText(child('contents'));
    if (child('defaultappearance')) dict.DA = PDFHexString.fromText(child('defaultappearance'));
    if (attr('coords')) dict.QuadPoints = nums(attr('coords'));
    if (attr('start')) dict.L = [...nums(attr('start')), ...nums(attr('end'))];
    if (attr('head') || attr('tail')) dict.LE = [PDFName.of(attr('head') || 'None'), PDFName.of(attr('tail') || 'None')];
    if (child('vertices')) dict.Vertices = nums(child('vertices'));
    const gestures = [...el.getElementsByTagName('gesture')].map((g) => nums(g.textContent));
    if (gestures.length) dict.InkList = gestures;
    // An empty appearance, so pdf.js keeps the box as written instead of
    // drawing its own (it pads lines and snaps markup boxes when none exists).
    const rect = dict.Rect;
    dict.AP = { N: pdf.context.register(pdf.context.stream('', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, rect[2] - rect[0], rect[3] - rect[1]],
    })) };
    const ref = pdf.context.register(pdf.context.obj(dict));
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots) annots.push(ref);
    else page.node.set(PDFName.of('Annots'), pdf.context.obj([ref]));
  }
  return pdf.save();
}

const flat = (value) => (value == null ? null : Array.from(value, (v) => (
  typeof v === 'object' && v !== null ? ('x' in v ? [v.x, v.y] : Array.from(v)) : v
)).flat(2).map((n) => Math.round(n * 100) / 100));

async function pdfjsMarks(bytes) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true, verbosity: 0 });
  const doc = await task.promise;
  const marks = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    for (const a of await page.getAnnotations()) {
      if (a.subtype === 'Popup') continue;
      // The comment that was already inside the source PDF.
      if (p === 1 && a.subtype === 'Square' && flat(a.rect).join() === '200,20,260,60') continue;
      marks.push({
        page: p,
        subtype: a.subtype,
        rect: flat(a.rect),
        color: a.color ? Array.from(a.color) : null,
        contents: a.contentsObj?.str || '',
        geometry: flat(a.quadPoints) || flat(a.lineCoordinates) || flat(a.vertices)
          || (a.inkLists ? a.inkLists.map(flat) : null),
      });
    }
  }
  await task.destroy();
  const key = (m) => `${m.page}|${m.subtype}|${m.rect.join()}`;
  return marks.sort((x, y) => key(x).localeCompare(key(y)));
}

test('the XFDF alone rebuilds every mark pdf.js sees in the annotated PDF export', async () => {
  const sourceBytes = await makeSourcePdf();
  const model = makeAnnotationsByPage();

  const { xfdf } = await exportAnnotationsAsXfdf(fileFrom(sourceBytes), model, PAGE_SIZES, {});
  const annotatedPdf = await savePDFWithAnnotationsPdfLib(
    fileFrom(sourceBytes), withUniformHighlightsAsAnnotations(model), PAGE_SIZES, null, { returnBytes: true },
  );
  const rebuiltPdf = await importXfdf(sourceBytes, xfdf);

  const expected = await pdfjsMarks(annotatedPdf);
  const rebuilt = await pdfjsMarks(rebuiltPdf);
  assert.equal(expected.length, 11, 'pdf.js sees all eleven app marks in the annotated PDF');
  assert.equal(rebuilt.length, expected.length, 'the XFDF rebuilds the same number of marks');
  const kinds = new Set(rebuilt.map((m) => m.subtype));
  for (const kind of ['Square', 'Circle', 'Line', 'FreeText', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'PolyLine', 'Ink']) {
    assert.ok(kinds.has(kind), `${kind} comes through`);
  }
  rebuilt.forEach((mark, index) => {
    const want = expected[index];
    const label = `${want.subtype} on page ${want.page}`;
    assert.equal(mark.page, want.page, `${label}: page`);
    assert.equal(mark.subtype, want.subtype, `${label}: kind`);
    assert.deepEqual(mark.rect, want.rect, `${label}: box`);
    assert.deepEqual(mark.color, want.color, `${label}: colour`);
    assert.equal(mark.contents, want.contents, `${label}: text`);
    assert.deepEqual(mark.geometry, want.geometry, `${label}: geometry`);
  });
});
