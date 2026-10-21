import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDFDocument, PDFName, PDFRawStream, StandardFonts, degrees,
} from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { startPdfA, pdfjsWords, mulMatrix, pdfaXmp } from '../pdfa.js';

// Smallest baseline JPEG: one white pixel.
const JPEG = Uint8Array.from(Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
));

const text = (b) => new TextDecoder('latin1').decode(b);

async function source() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 400]).drawText('Sheet A-101 Floor plan', { x: 50, y: 300, size: 20, font });
  const turned = doc.addPage([400, 600]);
  turned.setRotation(degrees(90));
  turned.drawText('Turned page', { x: 40, y: 500, size: 14, font });
  return doc.save();
}

async function open(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  return { task, pdf: await task.promise };
}

async function pageText(pdf, n) {
  const page = await pdf.getPage(n);
  const content = await page.getTextContent();
  return { page, items: content.items.filter((i) => i.str.trim()) };
}

test('pdfa: matrices compose like pdf.js transforms', () => {
  const flip = [1, 0, 0, -1, 0, 100];
  assert.deepEqual(mulMatrix(flip, [1, 0, 0, -1, 0, 100]), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(mulMatrix([2, 0, 0, 2, 10, 20], [1, 0, 0, 1, 5, 5]), [2, 0, 0, 2, 20, 30]);
});

test('pdfa: words land where they were, also on turned pages', async () => {
  const { task, pdf } = await open(await source());
  const writer = await startPdfA({ title: 'Plans' });
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1, rotation: page.rotate });
    const content = await page.getTextContent();
    await writer.addPage({ jpeg: JPEG, width: vp.width, height: vp.height, words: pdfjsWords(content.items, vp.transform, vp.height) });
  }
  const bytes = await writer.finish();
  assert.deepEqual(writer.stats, { pages: 2, textPages: 2, ocrPages: 0, searchable: 2, words: 2 });

  const out = await open(bytes);
  for (let n = 1; n <= 2; n += 1) {
    const before = await pageText(pdf, n);
    const after = await pageText(out.pdf, n);
    assert.equal(after.items[0].str.trim(), before.items[0].str);
    // Same spot and size on the page as seen.
    const vb = before.page.getViewport({ scale: 1, rotation: before.page.rotate });
    const va = after.page.getViewport({ scale: 1 });
    assert.equal(after.page.rotate, 0);
    assert.deepEqual([va.width, va.height], [vb.width, vb.height]);
    const seen = (vp, item) => pdfjs.Util.transform(vp.transform, item.transform).map((v) => Math.round(v));
    assert.deepEqual(seen(va, after.items[0]), seen(vb, before.items[0]));
  }
  await out.task.destroy();
  await task.destroy();
});

test('pdfa: the file carries PDF/A-2b metadata, an sRGB output intent and an ID', async () => {
  const writer = await startPdfA({ title: 'Plans & specs', date: new Date('2026-10-21T08:05:09.123Z') });
  await writer.addPage({ jpeg: JPEG, width: 200, height: 100 });
  const bytes = await writer.finish();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const meta = doc.catalog.lookup(PDFName.of('Metadata'));
  assert.ok(meta instanceof PDFRawStream);
  assert.equal(meta.dict.get(PDFName.of('Filter')), undefined);
  const xmp = new TextDecoder().decode(meta.contents);
  assert.match(xmp, /<pdfaid:part>2<\/pdfaid:part>/);
  assert.match(xmp, /<pdfaid:conformance>B<\/pdfaid:conformance>/);
  assert.match(xmp, /Plans &amp; specs/);
  assert.match(xmp, /<xmp:CreateDate>2026-10-21T08:05:09Z<\/xmp:CreateDate>/);
  assert.equal(doc.getTitle(), 'Plans & specs');
  assert.equal(doc.getCreationDate().toISOString(), '2026-10-21T08:05:09.000Z');

  const intent = doc.catalog.lookup(PDFName.of('OutputIntents')).lookup(0);
  assert.equal(intent.get(PDFName.of('S')).toString(), '/GTS_PDFA1');
  const icc = intent.lookup(PDFName.of('DestOutputProfile'));
  assert.equal(icc.dict.get(PDFName.of('N')).asNumber(), 3);

  const raw = text(bytes);
  assert.match(raw, /\/ID \[ <([0-9A-F]{32})> <\1> \]/i);
  assert.ok(!/\/Encrypt|\/JavaScript|\/SMask|\/AcroForm|\/Annots/.test(raw));
});

test('pdfa: OCR lines go on as hidden text too', async () => {
  const writer = await startPdfA({ title: 'Scan' });
  const lines = [{ words: [{ text: 'ROOM', box: { x0: 100, y0: 100, x1: 200, y1: 130 } }, { text: '204', box: { x0: 210, y0: 100, x1: 260, y1: 130 } }], box: { x0: 100, y0: 100, x1: 260, y1: 130 } }];
  await writer.addPage({ jpeg: JPEG, width: 612, height: 792, ocr: { lines, image: { width: 1275, height: 1650 } } });
  const bytes = await writer.finish();
  assert.equal(writer.stats.ocrPages, 1);
  const { task, pdf } = await open(bytes);
  const { items } = await pageText(pdf, 1);
  assert.equal(items.map((i) => i.str.trim()).join(' '), 'ROOM 204');
  await task.destroy();
});

test('pdfa: XMP escapes the title', () => {
  const xmp = pdfaXmp({ title: '<A&B>', date: new Date(0), documentId: 'x', instanceId: 'y' });
  assert.match(xmp, /&lt;A&amp;B&gt;/);
});

test('pdfa: letters Helvetica lacks keep their real text', async () => {
  const { readFileSync } = await import('node:fs');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const fonts = { noto: 'NotoSans-Regular.ttf', cjk: 'DroidSansFallback.ttf' };
  const writer = await startPdfA({
    title: 'Plans',
    loadFont: async (kind) => readFileSync(new URL(`../../assets/fonts/${fonts[kind]}`, import.meta.url)),
    loadFontkit: async () => fontkit,
  });
  const word = (text, y) => ({ text, m: [12, 0, 0, 12, 72, y], width: text.length * 0.6, eol: false });
  await writer.addPage({ jpeg: JPEG, width: 612, height: 792, words: [word('Привет', 700), word('Ωμέγα', 650)] });
  await writer.addPage({ jpeg: JPEG, width: 612, height: 792, words: [word('Plain', 700)] });
  const out = await open(await writer.finish());
  const text = async (n) => (await (await out.pdf.getPage(n)).getTextContent()).items.map((i) => i.str).join(' ');
  assert.match(await text(1), /Привет/);
  assert.match(await text(1), /Ωμέγα/);
  assert.match(await text(2), /Plain/);
  await out.task.destroy();
});
