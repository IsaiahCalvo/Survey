import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDFDocument, PDFName, PDFRawStream, StandardFonts, cmyk, rgb,
} from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { grayContent, grayscalePdf, pagesToGrayPdf } from '../grayscale.js';
import { encodeGrayJpeg, encodePng } from '../imageWriters.js';

const text = (b) => new TextDecoder('latin1').decode(b);
const enc = (s) => new TextEncoder().encode(s);
const OPS = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));

// Every colour pdf.js would paint with, and every picture's pixels, per page.
async function paint(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const list = await page.getOperatorList();
    const colors = [];
    const images = [];
    const shadings = [];
    // Colours sit in strings like "#ff0000", also inside tiling patterns'
    // own operator lists; gradients are fetched by id.
    const walk = (v) => {
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v)) colors.push(v);
      else if (typeof v === 'string' && v.startsWith('pattern_')) shadings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) Object.values(v).forEach(walk);
    };
    for (let k = 0; k < list.fnArray.length; k += 1) {
      const name = OPS[list.fnArray[k]];
      const args = list.argsArray[k];
      if (/Color|shadingFill/.test(name)) walk(args);
      if (name === 'paintImageXObject') images.push(await new Promise((r) => (args[0].startsWith('g_') ? page.commonObjs : page.objs).get(args[0], r)));
      if (name === 'paintInlineImageXObject') images.push(args[0]);
    }
    for (const id of shadings) walk(await new Promise((r) => page.objs.get(id, r)));
    const words = (await page.getTextContent()).items.map((t) => t.str).join('');
    pages.push({ colors, images, words });
  }
  await task.destroy();
  return pages;
}

const isGrayHex = (c) => c.slice(1, 3) === c.slice(3, 5) && c.slice(3, 5) === c.slice(5, 7);
function grayImage(img) {
  const ch = img.data.length / (img.width * img.height);
  if (ch === 1 || ch < 1) return true; // 1 = grey, < 1 = packed black and white
  for (let i = 0; i < img.width * img.height; i += 1) {
    const o = Math.floor(i * ch);
    if (Math.abs(img.data[o] - img.data[o + 1]) > 1 || Math.abs(img.data[o] - img.data[o + 2]) > 1) return false;
  }
  return true;
}

test('content: colour commands become grey ones, the rest is untouched', () => {
  const src = enc('q 1 0 0 rg 0 0 1 RG 0 0 10 10 re B Q\n0 0 0 1 k (keep 1 0 0 rg) Tj\n/CS0 cs 0.2 0.4 0.6 sc\n[1 2] 0 d\n/P1 cs 1 0 0 /Pat scn');
  const space = (n) => (n === 'CS0' ? { kind: 'rgb' } : n === 'P1' ? { kind: 'pattern', base: { kind: 'rgb' } } : { kind: 'keep' });
  const out = text(grayContent(src, { space }));
  assert.equal(out, 'q 0.299 g 0.114 G 0 0 10 10 re B Q\n0 g (keep 1 0 0 rg) Tj\n/DeviceGray cs 0.363 sc\n[1 2] 0 d\n/P1 cs 0.299 /Pat scn');
  assert.equal(grayContent(enc('0.5 g 0 0 m 10 10 l S')), null);
});

test('content: q/Q restores which colour space sc talks about', () => {
  const space = (n) => (n === 'Sep' ? { kind: 'separation' } : { kind: 'rgb' });
  const out = text(grayContent(enc('/Sep cs q /RGB cs 1 1 1 sc Q 0.5 sc'), { space }));
  assert.equal(out, '/Sep cs q /DeviceGray cs 1 sc Q 0.5 sc');
});

test('content: strings, comments and inline pictures with odd bytes pass through', () => {
  const src = enc('(a \\) 1 0 0 rg) Tj % 1 0 0 rg\nBI /W 1 /H 1 /CS /G /BPC 8 ID \x00 EI 1 0 0 rg');
  assert.equal(text(grayContent(src)), '(a \\) 1 0 0 rg) Tj % 1 0 0 rg\nBI /W 1 /H 1 /CS /G /BPC 8 ID \x00 EI 0.299 g');
});

test('a colourful pdf-lib file comes out all grey, with its text still there', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  page.drawText('Red words', { x: 10, y: 10, size: 14, font, color: rgb(0.9, 0.1, 0.1) });
  page.drawRectangle({ x: 50, y: 50, width: 60, height: 40, color: cmyk(0, 1, 0, 0), borderColor: rgb(0, 0, 1), borderWidth: 3 });
  const rgbPx = new Uint8Array(40 * 40 * 3);
  for (let i = 0; i < 40 * 40; i += 1) { rgbPx[i * 3] = 250; rgbPx[i * 3 + 1] = (i * 7) & 0xff; rgbPx[i * 3 + 2] = 20; }
  page.drawImage(await doc.embedPng(await encodePng({ width: 40, height: 40, channels: 3, data: rgbPx })), { x: 150, y: 150 });
  // A second page reusing the same picture.
  const p2 = doc.addPage([300, 300]);
  p2.drawText('Blue', { x: 10, y: 10, size: 14, font, color: rgb(0, 0, 1) });

  const before = await paint(await doc.save());
  assert.ok(before[0].colors.some((c) => !isGrayHex(c)));
  const { bytes, kept } = await grayscalePdf(await doc.save());
  const after = await paint(bytes);
  for (const p of after) {
    assert.ok(p.colors.length);
    assert.deepEqual(p.colors.filter((c) => !isGrayHex(c)), []);
    assert.ok(p.images.every(grayImage));
  }
  assert.equal(after[0].words, 'Red words');
  assert.equal(after[1].words, 'Blue');
  assert.deepEqual(kept, { pictures: 0, shades: 0, inline: 0, other: 0 });
});

// Content and resources written by hand, for the colour kinds pdf-lib's own
// drawing never makes.
async function handMade() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([300, 300]);
  const fnRgb = ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 });
  const ps = ctx.register(ctx.flateStream(enc('{ dup 0 exch }'), { FunctionType: 4, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1] }));
  const sampled = ctx.register(ctx.flateStream(Uint8Array.of(255, 0, 0, 0, 255, 0), { FunctionType: 0, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1], Size: [2], BitsPerSample: 8 }));
  const stitch = ctx.obj({ FunctionType: 3, Domain: [0, 1], Functions: [fnRgb, sampled], Bounds: [0.5], Encode: [0, 1, 0, 1] });
  const axial = (fn) => ctx.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 100, 0], Function: fn, Extend: [true, true] });
  const sep = ctx.obj([PDFName.of('Separation'), PDFName.of('Spot'), PDFName.of('DeviceCMYK'), ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0.8, 1, 0], N: 1 })]);
  const indexed = ctx.obj([PDFName.of('Indexed'), PDFName.of('DeviceRGB'), 1, ctx.flateStream(Uint8Array.of(255, 0, 0, 0, 255, 0))]);
  const icc = ctx.register(ctx.flateStream(new Uint8Array(4), { N: 3, Alternate: 'DeviceRGB' }));
  const tile = ctx.register(ctx.flateStream(enc('0 1 0 rg 0 0 5 5 re f'), { PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {} }));
  const formXo = ctx.register(ctx.flateStream(enc('1 0 1 rg 0 0 20 20 re f /Im Do'), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300],
    Resources: { XObject: { Im: ctx.register(ctx.flateStream(Uint8Array.of(0, 1, 1, 0), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, BitsPerComponent: 8, ColorSpace: indexed })) } },
  }));
  page.node.set(PDFName.of('Resources'), ctx.obj({
    ColorSpace: { Sp: sep, Ix: indexed, Icc: ctx.obj([PDFName.of('ICCBased'), icc]), Lab: ctx.obj([PDFName.of('Lab'), { WhitePoint: [0.9505, 1, 1.089] }]) },
    Shading: { Sh1: axial(fnRgb), Sh2: axial(ps), Sh3: axial(stitch) },
    Pattern: { T: tile, S: ctx.obj({ PatternType: 2, Shading: axial(fnRgb) }) },
    XObject: { F: formXo },
  }));
  const content = [
    '/Sp cs 1 sc 0 0 10 10 re f',
    '/Ix cs 1 sc 10 0 10 10 re f',
    '/Icc cs 0.1 0.9 0.2 sc 20 0 10 10 re f',
    '/Lab cs 60 70 20 sc 30 0 10 10 re f',
    '/Pattern cs /T scn 40 0 10 10 re f',
    '/Pattern cs /S scn 50 0 10 10 re f',
    'q 0 0 100 20 re W n /Sh1 sh Q q 0 30 100 20 re W n /Sh2 sh Q q 0 60 100 20 re W n /Sh3 sh Q',
    '/F Do',
    'q 20 0 0 20 200 200 cm BI /W 2 /H 1 /CS /RGB /BPC 8 ID \xff\x00\x00\x00\x00\xff EI Q',
  ].join('\n');
  page.node.set(PDFName.of('Contents'), ctx.register(PDFRawStream.of(ctx.obj({}), Uint8Array.from(content, (c) => c.charCodeAt(0)))));
  // A highlight note with a coloured look.
  const ap = ctx.register(ctx.flateStream(enc('1 1 0 rg 0 0 50 10 re f'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 10] }));
  page.node.set(PDFName.of('Annots'), ctx.obj([ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 250, 150, 260], C: [1, 0, 0], IC: [0, 1, 0], AP: { N: ap } })]));
  return doc.save();
}

test('spot colours, palettes, ICC, Lab, patterns, gradients, forms, inline pictures and notes turn grey', async () => {
  const src = await handMade();
  const before = await paint(src);
  assert.ok(before[0].colors.some((c) => !isGrayHex(c)));
  const { bytes, kept } = await grayscalePdf(src);
  const [after] = await paint(bytes);
  assert.deepEqual(after.colors.filter((c) => !isGrayHex(c)), []);
  assert.ok(after.colors.length > 10);
  assert.ok(after.images.length >= 2);
  assert.ok(after.images.every(grayImage));
  assert.deepEqual(kept, { pictures: 0, shades: 0, inline: 0, other: 0 });

  const doc = await PDFDocument.load(bytes);
  const annot = doc.getPage(0).node.lookup(PDFName.of('Annots')).lookup(0);
  assert.equal(annot.lookup(PDFName.of('C')).size(), 1);
});

test('JPEG photos are re-saved as one-channel JPEGs through the decoder passed in', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  const w = 16;
  const h = 8;
  // Not a real colour JPEG: the fake decoder below supplies its pixels.
  const fakeJpeg = encodeGrayJpeg(new Uint8Array(w * h), w, h);
  const ref = doc.context.register(PDFRawStream.of(doc.context.obj({
    Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode',
  }), fakeJpeg));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { J: ref } }));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(enc('q 100 0 0 100 0 0 cm /J Do Q'))));
  const src = await doc.save();

  const noDecoder = await grayscalePdf(src);
  assert.equal(noDecoder.kept.pictures, 1);

  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) { rgba[i * 4] = 255; rgba[i * 4 + 3] = 255; } // pure red
  const { bytes, kept } = await grayscalePdf(src, { decodeJpeg: async () => ({ width: w, height: h, data: rgba }) });
  assert.equal(kept.pictures, 0);
  const out = await PDFDocument.load(bytes);
  const img = out.getPage(0).node.Resources().lookup(PDFName.of('XObject')).lookup(PDFName.of('J'));
  assert.equal(img.dict.get(PDFName.of('ColorSpace')).decodeText(), 'DeviceGray');
  const [p] = await paint(bytes);
  // Red is 30% bright as grey.
  assert.ok(Math.abs(p.images[0].data[0] - 76) <= 3);
});

test('the picture way makes one page per grey picture at the original size', async () => {
  const jpeg = encodeGrayJpeg(new Uint8Array(20 * 10).fill(128), 20, 10);
  const bytes = await pagesToGrayPdf([{ jpeg, width: 612, height: 792 }, { jpeg, width: 200, height: 100 }]);
  const doc = await PDFDocument.load(bytes);
  assert.deepEqual(doc.getPages().map((p) => [p.getWidth(), p.getHeight()]), [[612, 792], [200, 100]]);
});
