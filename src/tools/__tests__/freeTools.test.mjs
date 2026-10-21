import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRawStream, degrees } from 'pdf-lib';
import {
  addHeaderFooter, organizePages, flattenPdf, cropPdf, readDetails, editDetails, removeAnnotations, textToPdf, mergePdfs, pickPages, deletePages, splitPdf, rotatePages, addPageNumbers, addWatermark, imagesToPdf, visualFrame, loadPdf, signPdf,
} from '../ops.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import UTIF from 'utif2';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { qpdfRunner, protectPdf, unlockPdf, looksEncrypted } from '../qpdf.js';
import { decodeTiff, isTiff } from '../tiff.js';
import fontkit from '@pdf-lib/fontkit';
import { readDocx, docxBlocksToPdf, inspectDocx, htmlToBlocks } from '../docx.js';
import { makeDocx, para, listItem, table, run } from './makeDocx.mjs';
import { ToolError } from '../errors.js';
import { compressPdf, deflate, inflate } from '../compress.js';
import { parseRangeGroups, parsePageSet, formatPageSet, everyN } from '../ranges.js';
import { makeZip, makeZipBlob, crc32 } from '../zip.js';

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
  assert.equal(crc32(new TextEncoder().encode('llo'), crc32(new TextEncoder().encode('he'))), 0x3610a686);
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

test('zip: a ZIP Blob made from Blob entries matches the byte one', async () => {
  const a = new TextEncoder().encode('first');
  const b = new Uint8Array([1, 2, 3]);
  const now = new Date(2026, 0, 2, 3, 4, 6);
  const bytes = makeZip([{ name: 'a.txt', bytes: a }, { name: 'b.bin', bytes: b }], now);
  const blob = makeZipBlob([
    { name: 'a.txt', blob: new Blob([a]), size: a.length, crc: crc32(a) },
    { name: 'b.bin', bytes: b },
  ], now);
  assert.equal(blob.type, 'application/zip');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
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

test('crop trims every edge by the same amount', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  const out = await PDFDocument.load(await cropPdf(await doc.save(), { trim: 50 }));
  const box = out.getPage(0).getCropBox();
  assert.deepEqual([box.x, box.y, box.width, box.height], [50, 50, 500, 700]);
  const tiny = await PDFDocument.create();
  tiny.addPage([60, 60]);
  await assert.rejects(cropPdf(await tiny.save(), { trim: 18 }), ToolError);
});

test('details round-trip; keywords split on commas', async () => {
  const out = await editDetails(await samplePdf(1), { title: ' Level 2 plan ', author: 'Isaiah', keywords: 'plan, level 2,' });
  const d = await readDetails(out);
  assert.equal(d.title, 'Level 2 plan');
  assert.equal(d.author, 'Isaiah');
  assert.equal(d.keywords, 'plan level 2');
});

test('remove markups keeps form fields and, by default, links', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  doc.getForm().createTextField('f').addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
  const ctx = doc.context;
  for (const Subtype of ['Square', 'Text', 'Link']) page.node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype, Rect: [0, 0, 5, 5] })));
  const src = await doc.save();
  const kept = await PDFDocument.load(await removeAnnotations(src));
  const subs = kept.getPage(0).node.Annots().asArray().map((r) => kept.context.lookup(r).get(PDFName.of('Subtype')).toString());
  assert.deepEqual(subs.sort(), ['/Link', '/Widget']);
  const noLinks = await PDFDocument.load(await removeAnnotations(src, { keepLinks: false }));
  assert.equal(noLinks.getPage(0).node.Annots().size(), 1);
  await assert.rejects(removeAnnotations(await samplePdf(1)), ToolError);
});

test('text to PDF wraps long lines and breaks pages', async () => {
  const long = 'word '.repeat(400);
  const lines = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}`).join('\n');
  const out = await PDFDocument.load(await textToPdf(`${long}\n${lines}\fNew page ✓ café`, { pageSize: 'a4', font: 'mono' }));
  assert.ok(out.getPageCount() >= 4, `pages: ${out.getPageCount()}`);
  assert.equal(Math.round(out.getPage(0).getWidth()), 595);
  await assert.rejects(textToPdf('  \n '), ToolError);
});

const wasmPath = createRequire(import.meta.url).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm');
const runQpdf = qpdfRunner(() => createQpdf({ wasmBinary: readFileSync(wasmPath), noInitialRun: true }));

test('protect then unlock round-trips; a wrong password says so', async () => {
  const plain = await samplePdf(3);
  assert.equal(looksEncrypted(plain), false);
  const locked = await protectPdf(runQpdf, plain, { password: '-pässword 1' });
  assert.equal(looksEncrypted(locked), true);
  await assert.rejects(loadPdf(locked), /password/);
  await assert.rejects(unlockPdf(runQpdf, locked, { password: 'nope' }), (e) => e instanceof ToolError && /isn't right/.test(e.message));
  await assert.rejects(unlockPdf(runQpdf, locked), (e) => e instanceof ToolError && /needs its password/.test(e.message));
  await assert.rejects(protectPdf(runQpdf, locked, { password: 'x' }), /already has a password/);
  const open = await unlockPdf(runQpdf, locked, { password: '-pässword 1' });
  assert.deepEqual(await widths(open), [100, 101, 102]);
  await assert.rejects(protectPdf(runQpdf, plain, { password: '' }), ToolError);
  await assert.rejects(unlockPdf(runQpdf, new TextEncoder().encode('not a pdf')), /damaged/);
});

test('print/copy limits use a separate owner password; empty-password unlock lifts them', async () => {
  const limited = await protectPdf(runQpdf, await samplePdf(1), { password: 'abc', allowPrint: false, allowCopy: false });
  // Print and copy limits are advisory in PDF: the open password still unlocks.
  assert.equal(looksEncrypted(limited), true);
  assert.ok((await unlockPdf(runQpdf, limited, { password: 'abc' })).length > 0);
  const openOnly = await runQpdf(await samplePdf(2), ['--encrypt', '', 'owner', '256', '--print=none', '--']);
  const freed = await unlockPdf(runQpdf, openOnly.out);
  assert.equal(looksEncrypted(freed), false);
  assert.deepEqual(await widths(freed), [100, 101]);
});

test('TIFF: every page decodes, DPI comes from the resolution tags', () => {
  const page = (w, h, v) => new Uint8Array(UTIF.encodeImage(new Uint8Array(w * h * 4).fill(v), w, h, { t282: [[300, 1]], t283: [[300, 1]], t296: [2] }));
  const one = page(4, 3, 200);
  assert.ok(isTiff(one));
  const [p] = decodeTiff(one);
  assert.deepEqual([p.width, p.height, p.dpi, p.rgba.length], [4, 3, 300, 48]);
  assert.throws(() => decodeTiff(PNG), ToolError);
});

test('images to PDF uses the image DPI for "same as image"', async () => {
  const at300 = await imagesToPdf([{ bytes: PNG, type: 'png', dpi: 300 }], { pageSize: 'fit' });
  const at96 = await imagesToPdf([{ bytes: PNG, type: 'png' }], { pageSize: 'fit' });
  assert.equal((await PDFDocument.load(at300)).getPage(0).getWidth(), 72 / 300);
  assert.equal((await PDFDocument.load(at96)).getPage(0).getWidth(), 0.75);
});

test('sign draws the image on the chosen page, upright on rotated pages', async () => {
  for (const rot of [0, 90]) {
    const out = await signPdf(await samplePdf(2, rot), { page: 1, image: PNG, box: { x: 0.5, y: 0.5, w: 0.25, h: 0.1 }, date: '2026-10-21' });
    const doc = await PDFDocument.load(out);
    const res = doc.getPage(1).node.Resources();
    const xobj = res.lookup(PDFName.of('XObject'));
    assert.ok(xobj && xobj.keys().length === 1, `rotation ${rot}: one image on page 2`);
    assert.ok(!doc.getPage(0).node.Resources()?.lookup(PDFName.of('XObject')), 'page 1 untouched');
  }
  await assert.rejects(signPdf(await samplePdf(1), { image: null, box: {} }), ToolError);
});

test('word: HTML becomes headings, styled runs, lists, tables and images', () => {
  const blocks = htmlToBlocks('<h1>Title &amp; more</h1><p><strong>B</strong> <em>I</em> <a href="https://x.test">link</a></p><ul><li>One<ul><li>Inner</li></ul></li><li>Two</li></ul><table><tr><th>H</th><td colspan="2">wide</td></tr></table><p><img src="data:image/png;base64,AAAA" /></p>');
  assert.deepEqual(blocks.map((b) => b.kind), ['para', 'para', 'para', 'para', 'para', 'table', 'image']);
  assert.equal(blocks[0].style, 'h1');
  assert.equal(blocks[0].runs[0].text, 'Title & more');
  assert.equal(blocks[1].runs.find((r) => r.text === 'link').href, 'https://x.test');
  assert.deepEqual(blocks.slice(2, 5).map((b) => [b.list.depth, b.list.n]), [[0, 1], [1, 1], [0, 2]]);
  assert.equal(blocks[5].rows[0][1].span, 2);
  assert.equal(blocks[5].rows[0][0].blocks[0].runs[0].b, true);
});

test('word to PDF: a real .docx lays out over pages with links', async () => {
  const body = para('Report', 'Heading1') + para([run('Bold ', { b: true }), run('text', { i: true })]) + listItem('First') + listItem('Second')
    + table([['A', 'B'], ['1', '2']]) + para('Word '.repeat(2000));
  const blocks = await readDocx(await makeDocx(body));
  assert.equal(blocks[0].style, 'h1');
  assert.ok(blocks.some((b) => b.list?.ordered));
  const { bytes } = await docxBlocksToPdf(blocks, { pageSize: 'a4' });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3, `pages ${doc.getPageCount()}`);
  assert.equal(Math.round(doc.getPage(0).getWidth()), 595);
  const linked = await docxBlocksToPdf(htmlToBlocks('<p><a href="https://surveytool.app">site</a></p>'));
  assert.ok((await PDFDocument.load(linked.bytes)).getPage(0).node.Annots());
});

test('word to PDF: other alphabets embed a font only when needed', async () => {
  const fontsDir = new URL('../../assets/fonts/', import.meta.url);
  let loads = 0;
  const loadFont = async (kind) => { loads += 1; return readFileSync(new URL(kind === 'cjk' ? 'DroidSansFallback.ttf' : 'NotoSans-Regular.ttf', fontsDir)); };
  const loadFontkit = async () => fontkit;
  await docxBlocksToPdf(htmlToBlocks('<p>Café – “quotes” €5</p>'), { loadFont, loadFontkit });
  assert.equal(loads, 0);
  const { bytes } = await docxBlocksToPdf(htmlToBlocks('<p>Привет 你好 <strong>Γειά</strong></p>'), { loadFont, loadFontkit });
  assert.equal(loads, 2);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() === 1);
  await assert.rejects(docxBlocksToPdf(htmlToBlocks('<p>Привет</p>')), ToolError);
});

test('word: complex parts are listed; non-docx and empty files are refused', async () => {
  const boxed = await makeDocx(`${para('x')}<w:p><w:r><w:txbxContent><w:p/></w:txbxContent></w:r></w:p><w:sectPr><w:cols w:num="2"/></w:sectPr>`, { extra: { 'word/footer1.xml': '<x/>' } });
  assert.deepEqual(await inspectDocx(boxed), ['text boxes', 'columns', 'headers or footers']);
  assert.deepEqual(await inspectDocx(await makeDocx(para('plain'))), []);
  await assert.rejects(readDocx(new TextEncoder().encode('{\\rtf1 old doc')), /\.docx/);
  await assert.rejects(readDocx(await makeDocx('')), /empty/);
});
