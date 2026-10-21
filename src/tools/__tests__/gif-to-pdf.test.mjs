import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GifWriter } from 'omggif';
import { decodeGifFrames } from '../gif.js';
import { ToolError } from '../errors.js';
import gifPage from '../../../scripts/free-tools-catalog/gif-to-pdf.mjs';

// 4x2 GIF, palette: 0 white, 1 red, 2 green, 3 blue.
const PALETTE = [0xffffff, 0xff0000, 0x00ff00, 0x0000ff];
function makeGif(frames) {
  const buf = new Uint8Array(4096);
  const w = new GifWriter(buf, 4, 2, { palette: PALETTE, loop: 0 });
  for (const f of frames) w.addFrame(f.x || 0, f.y || 0, f.w || 4, f.h || 2, f.pixels, { delay: 10, disposal: f.disposal || 0, transparent: f.transparent });
  return buf.slice(0, w.end());
}
const px = (frame, x, y) => {
  const i = (y * frame.width + x) * 4;
  return [...frame.rgba.slice(i, i + 4)];
};
const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

test('gif: every frame is drawn over the last, then cleared or restored as the GIF says', () => {
  const gif = makeGif([
    { pixels: new Uint8Array(8).fill(1) }, // all red, kept
    { x: 1, y: 0, w: 1, h: 1, pixels: [2], disposal: 2 }, // one green dot, then cleared
    { x: 2, y: 1, w: 1, h: 1, pixels: [3], disposal: 3 }, // one blue dot, then undone
    { x: 3, y: 0, w: 1, h: 1, pixels: [0], transparent: 0 }, // see-through: changes nothing
  ]);
  const seen = [];
  const frames = [...decodeGifFrames(gif, (i, total) => seen.push(`${i}/${total}`))];
  assert.deepEqual(seen, ['0/4', '1/4', '2/4', '3/4']);
  assert.equal(frames.length, 4);
  assert.deepEqual([frames[0].width, frames[0].height], [4, 2]);
  assert.deepEqual(px(frames[0], 1, 0), RED);
  assert.deepEqual(px(frames[1], 1, 0), GREEN);
  assert.deepEqual(px(frames[2], 1, 0), CLEAR, 'frame 2 cleared its area');
  assert.deepEqual(px(frames[2], 2, 1), BLUE);
  assert.deepEqual(px(frames[3], 2, 1), RED, 'frame 3 was undone');
  assert.deepEqual(px(frames[3], 3, 0), RED, 'see-through pixels keep what was under them');
});

test('gif: a damaged file asks for the first frame instead; junk is refused', () => {
  const gif = makeGif([{ pixels: new Uint8Array(8).fill(1) }, { pixels: new Uint8Array(8).fill(2) }]);
  assert.throws(() => [...decodeGifFrames(gif.slice(0, gif.length - 6))], (e) => e instanceof ToolError && /First frame/.test(e.message));
  assert.throws(() => [...decodeGifFrames(new Uint8Array([1, 2, 3, 4]))], ToolError);
});

test('gif to PDF page: shares Image to PDF and offers first frame or every frame', () => {
  assert.equal(gifPage.accept, 'image');
  assert.ok(gifPage.title.length <= 60 && gifPage.desc.length <= 160);
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /TOOLS\['gif-to-pdf'\] = \{\s*\.\.\.TOOLS\['image-to-pdf'\]/);
  assert.match(app, /key: 'frames'.*def: 'first'/);
});
