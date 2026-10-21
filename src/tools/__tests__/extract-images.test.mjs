import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import UTIF from 'utif2';
import { extractImages } from '../extractImages.js';
import { unpredict, decodePixels } from '../pdfImages.js';
import { encodePng, encodeGrayJpeg } from '../imageWriters.js';
import { ToolError } from '../errors.js';

const inflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());

// Enough of a PNG reader to check what the tool wrote (8-bit only).
async function readPng(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(v.getUint32(0), 0x89504e47);
  let p = 8;
  let head;
  const idat = [];
  while (p < bytes.length) {
    const len = v.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') head = { width: v.getUint32(p + 8), height: v.getUint32(p + 12), bits: body[8], colorType: body[9] };
    if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const channels = { 0: 1, 4: 2, 2: 3, 6: 4 }[head.colorType];
  const raw = await inflate(Uint8Array.from(idat.flatMap((c) => [...c])));
  if (head.bits === 1) return { ...head, channels, data: raw };
  const data = unpredict(raw, { predictor: 15, colors: channels, bpc: 8, columns: head.width });
  return { ...head, channels, data };
}

// An image XObject made by hand: dict entries plus raw (unfiltered) samples.
function rawImage(doc, entries, samples) {
  return doc.context.register(doc.context.flateStream(samples, { Type: 'XObject', Subtype: 'Image', ...entries }));
}

function drawOn(page, ref, name = 'Im1') {
  const res = page.node.Resources();
  let xo = res.lookup(PDFName.of('XObject'));
  if (!xo) { xo = page.doc.context.obj({}); res.set(PDFName.of('XObject'), xo); }
  xo.set(PDFName.of(name), ref);
}

const gradient = (w, h) => {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) g[y * w + x] = (x * 4 + y * 2) & 0xff;
  return g;
};

test('png writer round-trips grey, RGB and alpha pixels', async () => {
  const rgba = Uint8Array.from({ length: 5 * 3 * 4 }, (_, i) => (i * 37) & 0xff);
  const png = await encodePng({ width: 5, height: 3, channels: 4, data: rgba });
  const back = await readPng(png);
  assert.deepEqual([back.width, back.height, back.channels], [5, 3, 4]);
  assert.deepEqual([...back.data], [...rgba]);
});

test('png predictor and TIFF predictor are undone', () => {
  // Two rows of 3 RGB pixels with the Up filter on row 2.
  const rows = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1);
  assert.deepEqual([...unpredict(rows, { predictor: 12, colors: 3, columns: 3 })], [1, 2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const tiff = Uint8Array.of(10, 1, 1, 1);
  assert.deepEqual([...unpredict(tiff, { predictor: 2, colors: 1, columns: 4 })], [10, 11, 12, 13]);
});

test('extracts a JPEG as is, a PNG with see-through and skips icons', async () => {
  const doc = await PDFDocument.create();
  const jpeg = encodeGrayJpeg(gradient(64, 48), 64, 48, 90);
  const png = await encodePng({ width: 40, height: 40, channels: 4, data: Uint8Array.from({ length: 40 * 40 * 4 }, (_, i) => (i % 4 === 3 ? (i >> 4) & 0xff : i % 4 === 0 ? 200 : 50)) });
  const icon = await encodePng({ width: 16, height: 16, channels: 3, data: new Uint8Array(16 * 16 * 3).fill(9) });
  const [j, p, ic] = [await doc.embedJpg(jpeg), await doc.embedPng(png), await doc.embedPng(icon)];
  const page = doc.addPage([300, 300]);
  page.drawImage(j, { x: 0, y: 0 });
  page.drawImage(p, { x: 100, y: 100 });
  page.drawImage(ic, { x: 200, y: 200 });
  // The same JPEG again on page 2 comes out only once.
  doc.addPage([300, 300]).drawImage(j, { x: 0, y: 0 });
  const bytes = await doc.save();

  const { files, small } = await extractImages(bytes, { prefix: 'plan' });
  assert.equal(small, 1);
  assert.deepEqual(files.map((f) => f.name), ['plan-page-1-1.jpg', 'plan-page-1-2.png']);
  assert.deepEqual([...files[0].bytes], [...jpeg]);
  const back = await readPng(files[1].bytes);
  assert.equal(back.channels, 4);
  assert.equal(back.data[3 + 4 * 39], ((39 * 4 + 3) >> 4) & 0xff);

  const all = await extractImages(bytes, { skipSmall: false });
  assert.equal(all.files.length, 3);
});

test('decodes CMYK, indexed, 1-bit, predicted and nested-form pictures', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const ctx = doc.context;
  // 40x40 CMYK, pure cyan.
  const cmyk = new Uint8Array(40 * 40 * 4);
  for (let i = 0; i < 40 * 40; i += 1) cmyk[i * 4] = 255;
  drawOn(page, rawImage(doc, { Width: 40, Height: 40, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }, cmyk), 'C');
  // 40x40 indexed with a 2-colour palette (red, blue), 4 bits a sample.
  const idx = new Uint8Array(20 * 40);
  for (let i = 0; i < idx.length; i += 1) idx[i] = 0x01;
  drawOn(page, rawImage(doc, {
    Width: 40, Height: 40, BitsPerComponent: 4,
    ColorSpace: ctx.obj([PDFName.of('Indexed'), PDFName.of('DeviceRGB'), 1, ctx.flateStream(Uint8Array.of(255, 0, 0, 0, 0, 255))]),
  }, idx), 'I');
  // 40x40 one-bit grey, left half black.
  const bits = new Uint8Array(5 * 40);
  for (let y = 0; y < 40; y += 1) { bits[y * 5] = 0; bits[y * 5 + 1] = 0; bits[y * 5 + 2] = 0x0f; bits[y * 5 + 3] = 0xff; bits[y * 5 + 4] = 0xff; }
  drawOn(page, rawImage(doc, { Width: 40, Height: 40, ColorSpace: 'DeviceGray', BitsPerComponent: 1 }, bits), 'B');
  // 40x40 RGB stored with the PNG Sub predictor, inside a form.
  const rowLen = 40 * 3;
  const pred = new Uint8Array((rowLen + 1) * 40);
  for (let y = 0; y < 40; y += 1) {
    pred[y * (rowLen + 1)] = 1;
    for (let x = 0; x < 40; x += 1) pred[y * (rowLen + 1) + 1 + x * 3 + 1] = 100;
  }
  const predicted = rawImage(doc, { Width: 40, Height: 40, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, DecodeParms: { Predictor: 15, Colors: 3, Columns: 40 } }, pred);
  const form = ctx.flateStream(new TextEncoder().encode('/P Do'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { P: predicted } } });
  drawOn(page, ctx.register(form), 'F');

  const { files } = await extractImages(await doc.save());
  assert.equal(files.length, 4);
  const [c, i, b, p] = await Promise.all(files.map((f) => readPng(f.bytes)));
  assert.deepEqual([...c.data.subarray(0, 3)], [0, 255, 255]);
  assert.deepEqual([...i.data.subarray(0, 6)], [255, 0, 0, 0, 0, 255]);
  assert.equal(b.bits, 1);
  // Green climbs by 100 per pixel (mod 256) because of the Sub predictor.
  assert.deepEqual([...p.data.subarray(0, 9)], [0, 100, 0, 0, 200, 0, 0, 44, 0]);
});

test('a fax-coded scan comes out as a TIFF', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  // An all-white 64x2 group 4 strip: each row is one "vertical 0" code per
  // changing element; we only check that the wrapper is a valid TIFF.
  const fake = Uint8Array.of(0xff, 0xff, 0, 0);
  const ref = doc.context.register(PDFRawStream.of(doc.context.obj({
    Type: 'XObject', Subtype: 'Image', Width: 64, Height: 2, BitsPerComponent: 1, ColorSpace: 'DeviceGray', Filter: 'CCITTFaxDecode', DecodeParms: { K: -1, Columns: 64 },
  }), fake));
  drawOn(page, ref);
  const { files } = await extractImages(await doc.save(), { skipSmall: false });
  assert.equal(files[0].name.endsWith('.tif'), true);
  const ifds = UTIF.decode(files[0].bytes.buffer.slice(files[0].bytes.byteOffset));
  assert.equal(ifds[0].t259[0], 4);
  assert.equal(ifds[0].t256[0], 64);
});

test('plain-language errors when there is nothing to save', async () => {
  const empty = await (await PDFDocument.create()).save();
  await assert.rejects(extractImages(empty), (e) => e instanceof ToolError && /No pictures/.test(e.message));
  const doc = await PDFDocument.create();
  doc.addPage().drawImage(await doc.embedPng(await encodePng({ width: 8, height: 8, channels: 1, data: new Uint8Array(64) })), { x: 0, y: 0 });
  await assert.rejects(extractImages(await doc.save()), (e) => e instanceof ToolError && /Skip small/.test(e.message));
});

test('decodePixels turns Lab and Decode arrays into the right greys', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const lab = ctx.obj({ Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: [PDFName.of('Lab'), { WhitePoint: [0.9505, 1, 1.089] }] });
  // L = 100, a = b = 0 is white.
  const white = decodePixels(ctx, lab, Uint8Array.of(255, 128, 128), { gray: true });
  assert.ok(white.data[0] >= 253);
  const inv = ctx.obj({ Width: 2, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Decode: [1, 0] });
  assert.deepEqual([...decodePixels(ctx, inv, Uint8Array.of(0, 255), { gray: true }).data], [255, 0]);
});
