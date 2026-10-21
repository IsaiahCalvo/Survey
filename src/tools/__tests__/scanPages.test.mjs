import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  PDFDocument, PDFName, PDFRawStream, StandardFonts, degrees,
} from 'pdf-lib';
import { findScans, mightBeScans, scanDpi } from '../scanPages.js';

const enc = (s) => new TextEncoder().encode(s);
const jpeg = async (w, h) => new Uint8Array(await sharp({
  create: { width: w, height: h, channels: 3, background: { r: 240, g: 230, b: 200 } },
}).jpeg().toBuffer());

// A page holding one picture drawn with `content`, plus extras as asked.
async function scanPdf(pages) {
  const doc = await PDFDocument.create();
  const img = await jpeg(300, 200);
  for (const p of pages) {
    const page = doc.addPage([144, 96]);
    const dict = {
      Type: 'XObject', Subtype: 'Image', Width: 300, Height: 200, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', ...p.dict,
    };
    const ref = doc.context.register(PDFRawStream.of(doc.context.obj(dict), img));
    page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Im0: ref } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(enc(p.content || 'q 1 0 0 1 0 0 cm 144 0 0 96 0 0 cm /Im0 Do Q'))));
    if (p.rotate) page.setRotation(degrees(p.rotate));
    if (p.text) page.drawText('Hello', { x: 10, y: 10, size: 10, font: await doc.embedFont(StandardFonts.Helvetica) });
    if (p.markup) page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] })]));
  }
  const bytes = await doc.save();
  return { bytes, doc: await PDFDocument.load(bytes) };
}

test('a page that is one upright JPEG over the whole page is a scan', async () => {
  const { bytes, doc } = await scanPdf([{}, { rotate: 90 }]);
  const [a, b] = findScans(doc);
  assert.equal(a.width, 300);
  assert.equal(a.height, 200);
  assert.deepEqual(a.box, { width: 144, height: 96 });
  assert.equal(a.rotate, 0);
  assert.equal(a.gray, false);
  assert.equal(scanDpi(a), 150);
  assert.equal(a.jpeg[0], 0xff);
  assert.equal(b.rotate, 90);
  assert.ok(mightBeScans(bytes, 2));
});

test('anything more on the page leaves it to pdf.js', async () => {
  const { doc } = await scanPdf([
    { text: true },
    { markup: true },
    { content: 'q 72 0 0 96 0 0 cm /Im0 Do Q' }, // half the page
    { content: 'q -144 0 0 96 144 0 cm /Im0 Do Q' }, // mirrored
    { content: 'q 144 0 0 96 0 0 cm /Im0 Do Q q 144 0 0 96 0 0 cm /Im0 Do Q' }, // twice
    { content: 'q 0 0 1 rg 144 0 0 96 0 0 cm /Im0 Do Q' }, // a colour set: something else is drawn
    { dict: { SMask: 0 } },
    { dict: { Decode: [1, 0, 1, 0, 1, 0] } },
    { dict: { ColorSpace: 'DeviceCMYK' } },
    { dict: { Width: 301 } }, // doesn't match the JPEG
  ]);
  assert.deepEqual(findScans(doc), Array(10).fill(null));
});

test('mightBeScans wants about a JPEG a page', async () => {
  const { bytes } = await scanPdf([{}]);
  assert.ok(mightBeScans(bytes, 2));
  assert.equal(mightBeScans(bytes, 3), false);
  assert.equal(mightBeScans(enc('%PDF-1.7 nothing here'), 1), false);
});
