import test from 'node:test';
import assert from 'node:assert/strict';
import UTIF from 'utif2';
import { rgbaToTiffPage, writeTiff, grayToBits } from '../imageWriters.js';
import { decodeTiff } from '../tiff.js';

// A small "rendered page": a red band, a black line and white elsewhere.
function pageRgba(w, h) {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (y < 4) { px[i] = 220; px[i + 1] = 30; px[i + 2] = 30; }
      if (x === 5) { px[i] = px[i + 1] = px[i + 2] = 0; }
    }
  }
  return px;
}

const decode = (bytes) => {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ifds = UTIF.decode(buf);
  return ifds.map((ifd) => { UTIF.decodeImage(buf, ifd); return { ifd, rgba: UTIF.toRGBA8(ifd) }; });
};

test('one multi-page TIFF with a page per input, readable by utif2', async () => {
  const pages = [
    await rgbaToTiffPage(pageRgba(30, 20), 30, 20, { color: 'color', dpi: 150 }),
    await rgbaToTiffPage(pageRgba(31, 21), 31, 21, { color: 'gray', dpi: 300 }),
    await rgbaToTiffPage(pageRgba(33, 22), 33, 22, { color: 'bw', dpi: 300 }),
  ];
  const tif = writeTiff(pages);
  const out = decode(tif);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((p) => [p.ifd.width, p.ifd.height]), [[30, 20], [31, 21], [33, 22]]);
  assert.deepEqual(out.map((p) => p.ifd.t259[0]), [8, 8, 8]);
  assert.deepEqual(out.map((p) => p.ifd.t262[0]), [2, 1, 0]);
  assert.deepEqual(out.map((p) => p.ifd.t297), [[0, 3], [1, 3], [2, 3]]);

  const [color, gray, bw] = out.map((p) => p.rgba);
  assert.deepEqual([...color.subarray(0, 4)], [220, 30, 30, 255]);
  assert.deepEqual([...color.subarray((10 * 30 + 5) * 4, (10 * 30 + 5) * 4 + 3)], [0, 0, 0]);
  // Red becomes a mid grey; white stays white.
  assert.equal(gray[0], 87);
  assert.equal(gray[(15 * 31 + 20) * 4], 255);
  // Black and white: the dark red band and the line turn black.
  assert.equal(bw[0], 0);
  assert.equal(bw[(10 * 33 + 5) * 4], 0);
  assert.equal(bw[(10 * 33 + 6) * 4], 255);
});

test('the TIFF to PDF reader takes our TIFFs back, with their DPI', async () => {
  const tif = writeTiff([await rgbaToTiffPage(pageRgba(40, 40), 40, 40, { color: 'color', dpi: 300 })]);
  const [p] = decodeTiff(tif);
  assert.equal(p.dpi, 300);
  assert.equal(p.width, 40);
});

test('tall pages are split into several strips', async () => {
  const w = 1000;
  const h = 400; // 1000 * 3 bytes a row -> 87 rows a strip
  const page = await rgbaToTiffPage(new Uint8ClampedArray(w * h * 4).fill(255), w, h, { color: 'color' });
  assert.ok(page.strips.length > 1);
  const [only] = decode(writeTiff([page]));
  assert.equal(only.rgba.length, w * h * 4);
  assert.ok(only.rgba.every((v) => v === 255));
});

test('black and white packs eight pixels a byte, 1 for dark', () => {
  const g = Uint8Array.of(0, 255, 0, 255, 0, 255, 0, 255, 0);
  assert.deepEqual([...grayToBits(g, 9, 1)], [0b10101010, 0b10000000]);
});
