import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { jpegInfo, jpegToGray, isYcc } from '../jpeg.js';

// A colourful test picture: soft gradients plus a few hard-edged blocks.
async function colourJpeg(width, height, options = {}) {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3;
      const block = ((x >> 4) + (y >> 4)) % 3;
      px[o] = block === 0 ? 200 : (x * 255) / width;
      px[o + 1] = block === 1 ? 180 : (y * 255) / height;
      px[o + 2] = block === 2 ? 90 : 128;
    }
  }
  return new Uint8Array(await sharp(px, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85, ...options }).toBuffer());
}

// Grey as JPEG brightness counts it (the same weights as YCbCr's Y).
async function grey(jpeg) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 1) return new Uint8Array(data);
  const out = new Uint8Array(info.width * info.height);
  for (let i = 0, j = 0; i < out.length; i += 1, j += info.channels) out[i] = Math.round(data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114);
  return out;
}

async function sameGrey(src, out) {
  const [a, b] = await Promise.all([grey(src), grey(out)]);
  assert.equal(a.length, b.length);
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  // The original's grey goes through RGB and back, so a level or so of
  // rounding is expected; anything wrong with the blocks would be far off.
  assert.ok(total / a.length < 1.5, `mean difference ${total / a.length}`);
}

test('jpegInfo reads size, parts and sampling', async () => {
  const info = jpegInfo(await colourJpeg(33, 17));
  assert.equal(info.width, 33);
  assert.equal(info.height, 17);
  assert.equal(info.components, 3);
  assert.equal(info.sof, 0xc0);
  assert.equal(info.orientation, 1);
  assert.ok(isYcc(info));
  assert.equal(jpegInfo(new Uint8Array([1, 2, 3])), null);
});

for (const [name, opts, w, h] of [
  ['4:2:0, odd size', {}, 101, 67],
  ['4:4:4', { chromaSubsampling: '4:4:4' }, 64, 40],
  ['tiny', {}, 7, 5],
  ['optimised tables', { optimiseCoding: true }, 120, 90],
]) {
  test(`jpegToGray keeps the brightness exactly (${name})`, async () => {
    const src = await colourJpeg(w, h, opts);
    const out = jpegToGray(src);
    assert.ok(out);
    const info = jpegInfo(out);
    assert.deepEqual([info.width, info.height, info.components], [w, h, 1]);
    const meta = await sharp(out).metadata();
    assert.equal(meta.channels, 1);
    await sameGrey(src, out);
  });
}

test('jpegToGray leaves kinds it does not take', async () => {
  const prog = await colourJpeg(40, 40, { progressive: true });
  assert.equal(jpegInfo(prog).sof, 0xc2);
  assert.equal(jpegToGray(prog), null);
  // Already grey: nothing to do.
  assert.equal(jpegToGray(jpegToGray(await colourJpeg(16, 16))), null);
  assert.equal(jpegToGray(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
});
