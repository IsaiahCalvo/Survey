import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRawStream, degrees } from 'pdf-lib';
import {
  addHeaderFooter, organizePages, flattenPdf, mergePdfs, pickPages, deletePages, splitPdf, rotatePages, addPageNumbers, addWatermark, imagesToPdf, visualFrame, loadPdf,
} from '../ops.js';
import { ToolError } from '../errors.js';
import { compressPdf, deflate, inflate } from '../compress.js';
import { parseRangeGroups, parsePageSet, formatPageSet, everyN } from '../ranges.js';
import { makeZip, crc32 } from '../zip.js';

// A PDF whose pages say which one they are, by size: page i is (100 + i) wide.
async function samplePdf(n, rotate = 0) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) {
    const page = doc.addPage([100 + i, 200]);
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}
const widths = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

// 1x1 red PNG.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));

test('ranges: groups, sets, formatting and every-N', () => {
  assert.deepEqual(parseRangeGroups('1-3, 5, 8-', 9), [[0, 1, 2], [4], [7, 8]]);
  assert.deepEqual(parsePageSet('3, 1-2, 2', 5), [0, 1, 2]);
  assert.equal(formatPageSet([4, 0, 1, 2, 7]), '1-3, 5, 8');
  assert.deepEqual(everyN(5, 2), [[0, 1], [2, 3], [4]]);
  assert.throws(() => parsePageSet('7', 5), (e) => e instanceof ToolError && /5 pages/.test(e.message));
  assert.throws(() => parsePageSet('4-2', 5), ToolError);
  assert.throws(() => parsePageSet('a', 5), ToolError);
  assert.throws(() => parsePageSet(' ', 5), ToolError);
});

test('zip: stored entries round-trip with the right CRC', () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const a = new TextEncoder().encode('first');
  const zip = makeZip([{ name: 'a.txt', bytes: a }, { name: 'b é.txt', bytes: new Uint8Array([1, 2, 3]) }]);
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(14, true), crc32(a));
  const end = zip.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2);
  // Central directory offset points at the first central entry.
  assert.equal(v.getUint32(v.getUint32(end + 16, true), true), 0x02014b50);
});

test('merge keeps every page in file order', async () => {
  const out = await mergePdfs([await samplePdf(2), await samplePdf(3)]);
  assert.deepEqual(await widths(out), [100, 101, 100, 101, 102]);
});

test('pick, delete and split copy the right pages', async () => {
  const src = await samplePdf(5);
  assert.deepEqual(await widths(await pickPages(src, [4, 0])), [104, 100]);
  assert.deepEqual(await widths(await deletePages(src, [1, 3])), [100, 102, 104]);
  await assert.rejects(deletePages(src, [0, 1, 2, 3, 4]), ToolError);
  await assert.rejects(deletePages(src, []), ToolError);
  const parts = await splitPdf(src, [[0, 1], [2], [3, 4]]);
  assert.deepEqual(await Promise.all(parts.map(widths)), [[100, 101], [102], [103, 104]]);
});

test('rotate adds quarter turns to the existing rotation', async () => {
  const src = await samplePdf(3, 90);
  const out = await PDFDocument.load(await rotatePages(src, { 0: 1, 1: -1, 2: 4 }));
  assert.deepEqual(out.getPages().map((p) => p.getRotation().angle), [180, 0, 90]);
});

test('visualFrame maps screen corners onto the rotated page', async () => {
  const doc = await PDFDocument.create();
  const p = doc.addPage([100, 200]);
  for (const [r, w, h, topLeft] of [[0, 100, 200, { x: 0, y: 200 }], [90, 200, 100, { x: 0, y: 0 }], [180, 100, 200, { x: 100, y: 0 }], [270, 200, 100, { x: 100, y: 200 }]]) {
    p.setRotation(degrees(r));
    const f = visualFrame(p);
    assert.deepEqual([f.width, f.height], [w, h], `size at ${r}`);
    assert.deepEqual(f.toPage(0, f.height), topLeft, `top-left at ${r}`);
  }
});

test('page numbers and watermark draw on every page and still load', async () => {
  const src = await samplePdf(3, 90);
  const numbered = await loadPdf(await addPageNumbers(src, { format: 'of', skipFirst: true, position: 'top-right' }));
  assert.equal(numbered.getPageCount(), 3);
  const marked = await loadPdf(await addWatermark(src, { text: 'NOT FOR CONSTRUCTION ✓' }));
  assert.equal(marked.getPageCount(), 3);
  await assert.rejects(addWatermark(src, { text: '  ' }), ToolError);
});

test('images to PDF: one page per image, fit or fixed page size', async () => {
  const fit = await PDFDocument.load(await imagesToPdf([{ bytes: PNG, type: 'png' }, { bytes: PNG, type: 'png' }]));
  assert.equal(fit.getPageCount(), 2);
  assert.equal(fit.getPage(0).getWidth(), 0.75);
  const a4 = await PDFDocument.load(await imagesToPdf([{ bytes: PNG, type: 'png' }], { pageSize: 'a4', margin: 36 }));
  assert.equal(Math.round(a4.getPage(0).getWidth()), 595);
  await assert.rejects(imagesToPdf([]), ToolError);
});

test('locked or broken files give a plain message', async () => {
  await assert.rejects(loadPdf(new Uint8Array([1, 2, 3])), (e) => e instanceof ToolError && /could not be read/.test(e.message));
});

test('compress: packs loose streams, re-encodes images through the codec, never grows the file', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const img = await doc.embedPng(PNG);
  page.drawImage(img, { x: 0, y: 0, width: 200, height: 200 });
  // A big uncompressed stream, the kind some apps write.
  const loose = doc.context.stream('0 0 m 10 10 l S\n'.repeat(400));
  doc.context.register(loose);
  const src = await doc.save({ useObjectStreams: false });

  const calls = [];
  const codec = { async reencode(input, o) { calls.push([input.kind, o.maxSide]); return null; } };
  const out = await compressPdf(src, 'medium', codec);
  assert.ok(out.length < src.length, `${out.length} < ${src.length}`);
  const reloaded = await PDFDocument.load(out);
  assert.equal(reloaded.getPageCount(), 1);
  // The 1x1 PNG is below the size worth touching, so the codec isn't called.
  assert.deepEqual(calls, []);

  const tiny = await samplePdf(1);
  const again = await compressPdf(tiny, 'light', codec);
  assert.ok(again.length <= tiny.length);
});

test('compress swaps in the smaller JPEG the codec returns', async () => {
  const doc = await PDFDocument.create();
  const w = 200;
  const h = 200;
  const raw = new Uint8Array(w * h * 3).map((_, i) => (i * 7) % 256);
  const stream = doc.context.flateStream(raw, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
  const ref = doc.context.register(stream);
  doc.addPage([100, 100]);
  const src = await doc.save();
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const out = await compressPdf(src, 'strong', {
    async reencode(input, o) {
      assert.equal(input.kind, 'raw');
      assert.equal(input.pixels.length, w * h * 3);
      assert.equal(o.maxSide, 1400);
      return { bytes: fakeJpeg, width: 100, height: 100 };
    },
  });
  const re = await PDFDocument.load(out);
  const obj = re.context.lookup(ref);
  assert.ok(obj instanceof PDFRawStream);
  assert.equal(obj.dict.get(PDFName.of('Filter')), PDFName.of('DCTDecode'));
  assert.equal(obj.dict.get(PDFName.of('Width')).asNumber(), 100);
  assert.deepEqual([...obj.contents], [...fakeJpeg]);
});

test('compress leaves a parent image with a soft mask alone', async () => {
  const doc = await PDFDocument.create();
  const w = 200;
  const h = 200;
  const raw = new Uint8Array(w * h * 3).map((_, i) => (i * 7) % 256);
  const mask = doc.context.flateStream(new Uint8Array(w * h).fill(200), {
    Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
  });
  const stream = doc.context.flateStream(raw, {
    Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    SMask: doc.context.register(mask),
  });
  const ref = doc.context.register(stream);
  doc.addPage([100, 100]);
  const src = await doc.save();
  let calls = 0;
  const out = await compressPdf(src, 'strong', {
    async reencode() {
      calls += 1;
      return { bytes: new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]), width: 100, height: 100 };
    },
  });
  assert.equal(calls, 0);
  const obj = (await PDFDocument.load(out)).context.lookup(ref);
  assert.ok(obj instanceof PDFRawStream);
  assert.equal(obj.dict.get(PDFName.of('Width')).asNumber(), w);
  assert.equal(obj.dict.get(PDFName.of('Height')).asNumber(), h);
  assert.ok(obj.dict.get(PDFName.of('SMask')));
});

test('deflate and inflate round-trip', async () => {
  const data = new TextEncoder().encode('abc'.repeat(100));
  assert.deepEqual(await inflate(await deflate(data)), data);
});

test('header and footer fill in page numbers; empty text is refused', async () => {
  const src = await samplePdf(2, 270);
  const out = await loadPdf(await addHeaderFooter(src, { header: '{file}', footer: 'Page {page} of {total} · {date}', align: 'right', fileName: 'set.pdf' }));
  assert.equal(out.getPageCount(), 2);
  await assert.rejects(addHeaderFooter(src, { header: ' ', footer: '' }), ToolError);
});

test('organize reorders, turns, drops and repeats pages', async () => {
  const src = await samplePdf(3);
  const out = await PDFDocument.load(await organizePages(src, [{ index: 2, turns: 1 }, { index: 0 }, { index: 2 }]));
  assert.deepEqual(out.getPages().map((p) => p.getWidth()), [102, 100, 102]);
  assert.deepEqual(out.getPages().map((p) => p.getRotation().angle), [90, 0, 0]);
  await assert.rejects(organizePages(src, []), ToolError);
});

test('flatten draws form fields and markups into the page and keeps links', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const field = doc.getForm().createTextField('name');
  field.setText('Isaiah');
  field.addToPage(page, { x: 20, y: 20, width: 120, height: 24 });
  const ctx = doc.context;
  const ap = ctx.register(ctx.stream('1 0 0 RG 2 w 1 1 48 48 re S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 50] }));
  const square = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 100, 200, 200], AP: { N: ap } }));
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] }));
  page.node.addAnnot(square);
  page.node.addAnnot(link);
  const src = await doc.save();

  const out = await PDFDocument.load(await flattenPdf(src));
  const annots = out.getPage(0).node.Annots();
  assert.equal(annots.size(), 1);
  assert.equal(out.context.lookup(annots.get(0)).get(PDFName.of('Subtype')), PDFName.of('Link'));
  assert.equal(out.getForm().getFields().length, 0);
  // Both the field and the square are now drawn by the page itself.
  const xobjects = out.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
  assert.ok(xobjects.keys().length >= 2, `xobjects: ${xobjects.keys().length}`);

  await assert.rejects(flattenPdf(await samplePdf(1)), (e) => e instanceof ToolError && /nothing|no form/i.test(e.message));
});
