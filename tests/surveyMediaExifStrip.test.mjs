import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  __setSurveyMediaImageToolsForTests,
  imageHasEmbeddedMetadata,
  preparePhotoForUpload,
  stripJpegMetadata,
} from '../src/services/surveyMediaService.js';

const seg = (marker, payload) => {
  const len = payload.length + 2;
  return [0xFF, marker, len >> 8, len & 0xFF, ...payload];
};
const text = (s) => [...s].map((c) => c.charCodeAt(0));

// SOI, APP0 JFIF, APP1 Exif (with a fake GPS IFD tag), APP13 IPTC, DQT, SOS..EOI
const exifPayload = [...text('Exif\0\0'), ...text('MM\0*'), 0x88, 0x25, ...text('GPS-37.7749,-122.4194')];
const jpegWithGps = new Uint8Array([
  0xFF, 0xD8,
  ...seg(0xE0, text('JFIF\0\x01\x01')),
  ...seg(0xE1, exifPayload),
  ...seg(0xED, text('Photoshop 3.0\0location')),
  ...seg(0xDB, [0, 1, 2, 3]),
  0xFF, 0xDA, 0x00, 0x02, 0x11, 0x22, 0xFF, 0xD9,
]);
const has = (bytes, s) => Buffer.from(bytes).includes(Buffer.from(s, 'latin1'));

const tools = (encoded) => ({
  decode: async () => ({ width: 1200, height: 900 }),
  encodeJpeg: async (_img, width, height, quality) => {
    encoded.push({ width, height, quality });
    return new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])], { type: 'image/jpeg' });
  },
});

describe('survey photo EXIF/GPS stripping', () => {
  afterEach(() => __setSurveyMediaImageToolsForTests(null));

  it('detects metadata in JPEG, PNG and WebP', () => {
    assert.equal(imageHasEmbeddedMetadata(jpegWithGps, 'image/jpeg'), true);
    assert.equal(imageHasEmbeddedMetadata(stripJpegMetadata(jpegWithGps), 'image/jpeg'), false);
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 2, ...text('eXIf'), 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, ...text('IEND'), 0, 0, 0, 0]);
    assert.equal(imageHasEmbeddedMetadata(png, 'image/png'), true);
    const webp = new Uint8Array([...text('RIFF'), 0, 0, 0, 0, ...text('WEBP'), ...text('EXIF'), 2, 0, 0, 0, 9, 9]);
    assert.equal(imageHasEmbeddedMetadata(webp, 'image/webp'), true);
    assert.equal(imageHasEmbeddedMetadata(new Uint8Array(300), 'image/jpeg'), false);
  });

  it('byte-strips APP1/APP13 but keeps the rest of the JPEG', () => {
    const out = stripJpegMetadata(jpegWithGps);
    assert.equal(has(out, 'GPS-37.7749'), false);
    assert.equal(has(out, 'Photoshop'), false);
    assert.equal(has(out, 'JFIF'), true);
    assert.deepEqual([...out.subarray(-2)], [0xFF, 0xD9]);
  });

  it('re-encodes a small (<=2560px) JPEG that carries EXIF instead of keeping it as-is', async () => {
    const encoded = [];
    __setSurveyMediaImageToolsForTests(tools(encoded));
    const file = new File([jpegWithGps], 'IMG_0001.jpg', { type: 'image/jpeg' });
    const out = await preparePhotoForUpload(file, 'image/jpeg');
    assert.deepEqual(encoded, [{ width: 1200, height: 900, quality: 0.85 }]);
    assert.notEqual(out.blob, file);
    assert.equal(has(new Uint8Array(await out.blob.arrayBuffer()), 'GPS-37.7749'), false);
  });

  it('falls back to a byte strip when the device cannot re-encode', async () => {
    __setSurveyMediaImageToolsForTests({ decode: async () => ({ width: 1200, height: 900 }), encodeJpeg: async () => null });
    const out = await preparePhotoForUpload(new File([jpegWithGps], 'a.jpg', { type: 'image/jpeg' }), 'image/jpeg');
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    assert.equal(has(bytes, 'GPS-37.7749'), false);
    assert.equal(out.mime, 'image/jpeg');
  });

  it('still keeps a small clean JPEG untouched', async () => {
    const encoded = [];
    __setSurveyMediaImageToolsForTests(tools(encoded));
    const clean = new File([stripJpegMetadata(jpegWithGps)], 'c.jpg', { type: 'image/jpeg' });
    const out = await preparePhotoForUpload(clean, 'image/jpeg');
    assert.equal(out.blob, clean);
    assert.equal(encoded.length, 0);
  });
});
