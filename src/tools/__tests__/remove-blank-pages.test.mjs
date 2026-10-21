import test from 'node:test';
import assert from 'node:assert/strict';
import { inkShare, isBlank, measure, blankIndexes, LEVELS } from '../blankPages.js';

const W = 200;
const H = 260;

function page(fill = 255) {
  return new Uint8ClampedArray(W * H * 4).fill(fill);
}

function dot(px, x, y, rgb = [0, 0, 0], size = 1) {
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      const i = ((y + dy) * W + x + dx) * 4;
      [px[i], px[i + 1], px[i + 2]] = rgb;
    }
  }
}

// Random light speckle like a scanned sheet of plain paper.
function speckled(seed = 7) {
  const px = page();
  let s = seed;
  for (let i = 0; i < W * H; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = 255 - (s % 30);
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
  }
  return px;
}

test('a white page is blank at every level', () => {
  const px = page();
  for (const level of Object.keys(LEVELS)) assert.equal(isBlank(px, W, H, level), true, level);
  assert.equal(inkShare(px, W, H, LEVELS.strict), 0);
});

test('a page of text is never blank', () => {
  const px = page();
  for (let y = 20; y < 240; y += 8) for (let x = 20; x < 180; x += 3) dot(px, x, y);
  for (const level of Object.keys(LEVELS)) assert.equal(isBlank(px, W, H, level), false, level);
});

test('strict keeps a page with a single page number; loose drops it', () => {
  const px = page();
  dot(px, 98, 240, [40, 40, 40], 3);
  assert.equal(isBlank(px, W, H, 'strict'), false);
  assert.equal(isBlank(px, W, H, 'loose'), true);
});

test('scanner speckle and an edge shadow only pass as blank when not strict', () => {
  const px = speckled();
  for (let y = 0; y < H; y += 1) dot(px, 0, y, [30, 30, 30], 3);
  assert.equal(isBlank(px, W, H, 'strict'), false);
  assert.equal(isBlank(px, W, H, 'normal'), true);
  assert.equal(isBlank(px, W, H, 'loose'), true);
});

test('light colour, like a yellow highlight, counts as a mark', () => {
  const px = page();
  for (let y = 100; y < 110; y += 1) for (let x = 40; x < 160; x += 1) dot(px, x, y, [255, 240, 60]);
  assert.equal(isBlank(px, W, H, 'loose'), false);
});

test('blankIndexes picks pages per level from one measurement each', () => {
  const white = measure(page(), W, H);
  const num = page();
  dot(num, 98, 240, [40, 40, 40], 3);
  const text = page();
  for (let y = 20; y < 240; y += 8) for (let x = 20; x < 180; x += 3) dot(text, x, y);
  const results = [white, measure(num, W, H), measure(text, W, H), null];
  assert.deepEqual(blankIndexes(results, 'strict'), [0]);
  assert.deepEqual(blankIndexes(results, 'loose'), [0, 1]);
});
