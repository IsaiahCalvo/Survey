import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, degrees, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  addPageNumbers, addHeaderFooter, addWatermark, numberText, formatDate, stampPages, hexColor, ToolError,
} from '../ops.js';

// Pages with a filled box over most of them, so "behind" has something to hide under.
async function samplePdf(sizes, rotate = 0) {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) {
    const page = doc.addPage([w, h]);
    page.drawRectangle({ x: 10, y: 10, width: w - 20, height: h - 20, color: rgb(0.9, 0.9, 0.9) });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}

// Each page's text, with where it sits as people see the page (y from the top).
async function texts(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    pages.push({
      width: vp.width,
      height: vp.height,
      items: items.filter((it) => it.str.trim()).map((it) => {
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        return { str: it.str, x, y, width: it.width };
      }),
    });
  }
  await task.destroy();
  return pages;
}

test('number styles: roman, letters and Bates', () => {
  assert.deepEqual([1, 4, 9, 14, 40, 1994].map((n) => numberText(n, { style: 'i' })), ['i', 'iv', 'ix', 'xiv', 'xl', 'mcmxciv']);
  assert.equal(numberText(12, { style: 'I' }), 'XII');
  assert.deepEqual([1, 26, 27, 52, 703].map((n) => numberText(n, { style: 'a' })), ['a', 'z', 'aa', 'az', 'aaa']);
  assert.equal(numberText(28, { style: 'A' }), 'AB');
  assert.equal(numberText(42, { style: 'bates', prefix: 'ABC-', suffix: '-X' }), 'ABC-000042-X');
  assert.equal(numberText(0, { style: 'i' }), '0');
});

test('dates, colors and page ranges', () => {
  const d = new Date(2026, 9, 7);
  assert.equal(formatDate(d, 'mdy'), '10/07/2026');
  assert.equal(formatDate(d, 'dmy'), '07/10/2026');
  assert.equal(formatDate(d, 'ymd'), '2026-10-07');
  assert.equal(formatDate(d, 'long'), 'Oct 07, 2026');
  assert.deepEqual(hexColor('#ff8000'), rgb(1, 128 / 255, 0));
  assert.deepEqual(stampPages('', 3), [0, 1, 2]);
  assert.deepEqual(stampPages('All', 3), [0, 1, 2]);
  assert.deepEqual(stampPages('2-3, 1', 5, { skipFirst: true }), [1, 2]);
  assert.throws(() => stampPages('1', 3, { skipFirst: true }), ToolError);
  assert.throws(() => stampPages('9', 3), ToolError);
});

test('page numbers: Bates on a page range, in the corner asked for', async () => {
  const src = await samplePdf([[612, 792], [612, 792], [612, 792], [612, 792]]);
  const out = await texts(await addPageNumbers(src, {
    style: 'bates', prefix: 'JOB-', pages: '2-3', start: 7, position: 'top-right', margin: '36', size: 10,
  }));
  assert.deepEqual(out.map((p) => p.items.map((it) => it.str)), [[], ['JOB-000007'], ['JOB-000008'], []]);
  const it = out[1].items[0];
  assert.ok(it.x > 612 - 36 - 80 && it.x < 612 - 36, `right edge, got x ${it.x}`);
  assert.ok(it.y > 36 && it.y < 36 + 14, `top edge, got y ${it.y}`);
});

test('page numbers: formats and custom words, level on turned pages', async () => {
  const src = await samplePdf([[400, 300], [400, 300]], 90);
  const of = await texts(await addPageNumbers(src, { format: 'nof', style: 'I' }));
  assert.deepEqual(of.map((p) => p.items[0].str), ['I of II', 'II of II']);
  const custom = await texts(await addPageNumbers(src, { format: 'custom', custom: 'Sheet {n} / {p}', position: 'bottom-center' }));
  const p = custom[0];
  assert.equal(p.items[0].str, 'Sheet 1 / 2');
  // Turned 90 degrees: people see a 300 x 400 page, and the number sits at its bottom.
  assert.deepEqual([p.width, p.height], [300, 400]);
  assert.ok(p.items[0].y > 350, `bottom, got y ${p.items[0].y}`);
  await assert.rejects(addPageNumbers(src, { format: 'custom', custom: ' ' }), ToolError);
});

test('header and footer: six boxes, tokens, date style and margins', async () => {
  const src = await samplePdf([[792, 612], [792, 612], [792, 612]]);
  const bytes = await addHeaderFooter(src, {
    boxes: { tl: 'Riverside', tc: '', tr: '{date}', bl: '{file}', bc: 'Page {page} of {total}', br: 'Rev B' },
    pages: '2-3', fileName: 'set.pdf', date: new Date(2026, 0, 5), dateFormat: 'ymd', size: 12,
  });
  const out = await texts(bytes);
  assert.deepEqual(out[0].items, []);
  const by = Object.fromEntries(out[1].items.map((it) => [it.str, it]));
  assert.deepEqual(Object.keys(by).sort(), ['2026-01-05', 'Page 2 of 3', 'Rev B', 'Riverside', 'set.pdf']);
  assert.ok(Math.abs(by.Riverside.x - 72) < 1, `left margin, got ${by.Riverside.x}`);
  assert.ok(by.Riverside.y > 36 && by.Riverside.y < 36 + 13, `top margin, got ${by.Riverside.y}`);
  // Text sits on its baseline, 36 pt up from the bottom edge.
  assert.ok(Math.abs(by['set.pdf'].y - (612 - 36)) < 1, `bottom margin, got ${by['set.pdf'].y}`);
  const mid = by['Page 2 of 3'];
  assert.ok(Math.abs(mid.x + mid.width / 2 - 396) < 1, `middle, got ${mid.x}`);
  assert.ok(by['Rev B'].x > 792 - 72 - 40 && by['Rev B'].x < 792 - 72, `right margin, got ${by['Rev B'].x}`);
  // The old one-line form still works.
  const old = await texts(await addHeaderFooter(src, { header: 'H', footer: 'F', align: 'left' }));
  assert.deepEqual(old[0].items.map((it) => it.str).sort(), ['F', 'H']);
});

// Where text is first drawn, and where the grey box is filled, in page order.
async function paintOrder(bytes, pageNo) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  const { fnArray } = await (await pdf.getPage(pageNo)).getOperatorList();
  await task.destroy();
  return { text: fnArray.indexOf(pdfjs.OPS.showText), fill: fnArray.indexOf(pdfjs.OPS.constructPath) };
}

test('watermark: behind is drawn before the page, on the pages asked for', async () => {
  const src = await samplePdf([[612, 792], [612, 792], [612, 792]]);
  const behind = await addWatermark(src, { text: 'VOID', behind: true, pages: '1, 3', angle: 45, position: 'top-left', size: 0.35 });
  const under = await paintOrder(behind, 1);
  assert.ok(under.text >= 0 && under.text < under.fill, JSON.stringify(under));
  const over = await paintOrder(await addWatermark(src, { text: 'VOID' }), 1);
  assert.ok(over.text > over.fill, JSON.stringify(over));
  const out = await texts(behind);
  assert.deepEqual(out.map((p) => p.items.map((it) => it.str)), [['VOID'], [], ['VOID']]);
  // Top left: the middle of the word (drawn at 45 degrees) is up and to the left.
  const { x, y, width } = out[0].items[0];
  const [cx, cy] = [x + (width / 2) * Math.SQRT1_2, y - (width / 2) * Math.SQRT1_2];
  assert.ok(cx < 250 && cy < 250, `centre at ${cx}, ${cy}`);
});

test('watermark: tiles repeat across the page; images and colors work', async () => {
  const src = await samplePdf([[612, 792]], 270);
  const tiled = await texts(await addWatermark(src, { text: 'COPY', tile: true, angle: 0, size: 0.35 }));
  assert.ok(tiled[0].items.length > 10, `tiles: ${tiled[0].items.length}`);
  const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));
  const withImage = await PDFDocument.load(await addWatermark(src, { image: { bytes: PNG, type: 'png' }, opacity: 0.5, position: 'bottom-right' }));
  const xobjects = withImage.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
  assert.equal(xobjects.keys().length, 1);
  await addWatermark(src, { text: 'X', color: '#00ff00', angle: 'diag' });
  await assert.rejects(addWatermark(src, { text: ' ' }), ToolError);
});
