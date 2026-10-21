import test from 'node:test';
import assert from 'node:assert/strict';
// gifenc's CommonJS build (what Node loads) only has a default export.
import gifenc from 'gifenc';
import sharp from 'sharp';
import { gifWriter } from '../gifWrite.js';

// A w x h picture: white with a black bar and a red block, like a drawing.
function picture(w, h, shift = 0) {
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      if (y === 5 + shift) rgba[o] = rgba[o + 1] = rgba[o + 2] = 0;
      if (x >= 20 && x < 30 && y >= 10 && y < 20) { rgba[o + 1] = 0; rgba[o + 2] = 0; }
    }
  }
  return rgba;
}

test('GIF: one page decodes back to the same picture', async () => {
  const gif = gifWriter(gifenc);
  gif.add(picture(40, 30), 40, 30);
  const bytes = gif.finish();
  assert.equal(String.fromCharCode(...bytes.subarray(0, 6)), 'GIF89a');
  assert.equal(bytes.at(-1), 0x3b);
  const { data, info } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 40);
  assert.equal(info.height, 30);
  const px = (x, y) => [...data.subarray((y * 40 + x) * info.channels, (y * 40 + x) * info.channels + 3)];
  assert.deepEqual(px(0, 0), [255, 255, 255]);
  assert.deepEqual(px(3, 5), [0, 0, 0]);
  assert.deepEqual(px(25, 15), [255, 0, 0]);
});

test('GIF: several pages make one moving GIF with every frame', async () => {
  const gif = gifWriter(gifenc);
  for (let n = 0; n < 3; n += 1) gif.add(picture(40, 30, n * 4), 40, 30, 2000);
  const bytes = gif.finish();
  const meta = await sharp(Buffer.from(bytes), { pages: -1 }).metadata();
  assert.equal(meta.pages, 3);
  assert.deepEqual(meta.delay, [2000, 2000, 2000]);
  // Loops for ever (NETSCAPE2.0 block, 0 repeats).
  assert.equal(meta.loop, 0);
  // The third frame has its bar 8 rows down.
  const { data, info } = await sharp(Buffer.from(bytes), { page: 2 }).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...data.subarray((13 * 40 + 3) * info.channels, (13 * 40 + 3) * info.channels + 3)], [0, 0, 0]);
  assert.deepEqual([...data.subarray((5 * 40 + 3) * info.channels, (5 * 40 + 3) * info.channels + 3)], [255, 255, 255]);
});
