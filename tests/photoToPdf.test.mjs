import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { fitPhotoSize, isPhotoFile, photoDpi, photoPdfName, photoToPdfFile, photosAsPdfs } from '../src/home/photoToPdf.js';

// Smallest JPEG pdf-lib will embed: start, a size header, end.
function tinyJpeg(width, height) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

const at = new Date(2026, 10, 10, 21, 5);

test('photos are spotted by type, or by name when the type is missing', () => {
  assert.equal(isPhotoFile({ name: 'a.jpg', type: 'image/jpeg' }), true);
  assert.equal(isPhotoFile({ name: 'IMG_1.HEIC', type: '' }), true);
  assert.equal(isPhotoFile({ name: 'plan.pdf', type: 'application/pdf' }), false);
  assert.equal(isPhotoFile({ name: 'notes.txt', type: 'text/plain' }), false);
  assert.equal(isPhotoFile(null), false);
});

test('the PDF keeps the photo name; a bare camera name gets the date and time', () => {
  assert.equal(photoPdfName('IMG_2041.jpg', at), 'IMG_2041.pdf');
  assert.equal(photoPdfName('Panel 3 / west.png', at), 'Panel 3 - west.pdf');
  assert.equal(photoPdfName('image.jpg', at), 'Photo 2026-11-10 21.05.pdf');
  assert.equal(photoPdfName('', at), 'Photo 2026-11-10 21.05.pdf');
});

test('big photos are cut to 4000 px; the page long side is 11 inches', () => {
  assert.deepEqual(fitPhotoSize(8000, 6000), { width: 4000, height: 3000 });
  assert.deepEqual(fitPhotoSize(1200, 900), { width: 1200, height: 900 });
  assert.equal(photoDpi(4000, 3000), 4000 / 11);
});

test('a photo becomes a one-page PDF sized to its shape', async () => {
  const redraw = async () => ({ bytes: tinyJpeg(400, 300), width: 400, height: 300 });
  const file = await photoToPdfFile({ name: 'IMG_7.jpg', type: 'image/jpeg' }, { now: at, redraw });
  assert.equal(file.name, 'IMG_7.pdf');
  assert.equal(file.type, 'application/pdf');
  const pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
  assert.equal(pdf.getPageCount(), 1);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 792) < 0.01, `long side ${width}`);
  assert.ok(Math.abs(height - 594) < 0.01, `short side ${height}`);
});

test('a mixed drop swaps photos for PDFs and reports the unreadable ones', async () => {
  const pdf = { name: 'plan.pdf', type: 'application/pdf' };
  const redraw = async (f) => {
    if (f.name === 'bad.heic') throw new Error('Survey can\'t read “bad.heic”. Try a JPG or PNG.');
    return { bytes: tinyJpeg(30, 40), width: 30, height: 40 };
  };
  const { files, failed } = await photosAsPdfs([pdf, { name: 'a.png', type: 'image/png' }, { name: 'bad.heic', type: 'image/heic' }], { now: at, redraw });
  assert.deepEqual(files.map((f) => f.name), ['plan.pdf', 'a.pdf']);
  assert.deepEqual(failed, ['Survey can\'t read “bad.heic”. Try a JPG or PNG.']);
});

test('the Upload picker takes photos only with the flag on', () => {
  const src = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(src, /accept=\{photoUploadOn \? PHOTO_ACCEPT : 'application\/pdf'\}/);
  assert.match(src, /isFeatureOn\('photo-upload'\)/);
});
