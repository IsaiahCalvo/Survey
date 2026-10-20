// Owner 2026-10-20: Smart fill beta engine — tap inside a tag, fill its whole
// outer outline (border, dividers and text included); refuse open areas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTagOutline, traceOuterLoop } from '../src/survey/smartFillEngine.js';

function canvas(w, h) {
  const mask = new Uint8Array(w * h);
  const ink = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1; };
  const rect = (x0, y0, x1, y1) => {
    for (let x = x0; x <= x1; x += 1) { ink(x, y0); ink(x, y1); }
    for (let y = y0; y <= y1; y += 1) { ink(x0, y); ink(x1, y); }
  };
  return { mask, ink, rect };
}

test('fills a boxed tag with a divider as one region, text included', () => {
  const { mask, ink, rect } = canvas(100, 100);
  rect(30, 40, 70, 60);
  for (let x = 30; x <= 70; x += 1) ink(x, 50); // divider
  ink(40, 45); ink(41, 45); ink(60, 55); // "text"
  const found = findTagOutline(mask, 100, 100, 35, 44);
  assert.equal(found.ok, true);
  const xs = found.ring.map((p) => p[0]);
  const ys = found.ring.map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [30, 71, 40, 61]);
  assert.equal(found.area, 41 * 21);
});

test('refuses a tap with no closed outline around it', () => {
  const { mask, ink } = canvas(100, 100);
  for (let x = 10; x < 90; x += 1) ink(x, 50);
  assert.deepEqual(findTagOutline(mask, 100, 100, 50, 40), { ok: false, reason: 'open' });
});

test('refuses an enclosure too big to be a tag', () => {
  const { mask, rect } = canvas(100, 100);
  rect(2, 2, 97, 97);
  assert.equal(findTagOutline(mask, 100, 100, 50, 50).reason, 'too-large');
});

test('a tap on the line itself still finds the tag', () => {
  const { mask, rect } = canvas(100, 100);
  rect(30, 30, 60, 60);
  assert.equal(findTagOutline(mask, 100, 100, 30, 45).ok, true);
});

test('traces a single pixel as a unit square', () => {
  const ring = traceOuterLoop(new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]), 3, 3);
  assert.equal(ring.length, 4);
});

test('refuses an outline that runs off the window it looked at', () => {
  const { mask, ink } = canvas(100, 100);
  for (let x = 0; x < 100; x += 1) { ink(x, 40); ink(x, 60); } // a corridor
  for (let y = 40; y <= 60; y += 1) ink(30, y);
  assert.equal(findTagOutline(mask, 100, 100, 50, 50).ok, false);
});

import { adaptiveInkMaskFromRgba, dilateMask, findTagOutlineTolerant } from '../src/survey/smartFillEngine.js';

function rgbaPage(w, h, paper, drawInk) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p += 1) data.set([paper, paper, paper, 255], p * 4);
  drawInk((x, y, v) => { if (x >= 0 && y >= 0 && x < w && y < h) data.set([v, v, v, 255], (y * w + x) * 4); });
  return data;
}
const box = (put, x0, y0, x1, y1, v, skip = () => false) => {
  for (let x = x0; x <= x1; x += 1) { if (!skip(x, y0)) put(x, y0, v); if (!skip(x, y1)) put(x, y1, v); }
  for (let y = y0; y <= y1; y += 1) { if (!skip(x0, y)) put(x0, y, v); if (!skip(x1, y)) put(x1, y, v); }
};

test('faint border (light grey line on white) still reads as an outline', () => {
  const data = rgbaPage(120, 120, 255, (put) => box(put, 40, 40, 80, 70, 238));
  const mask = adaptiveInkMaskFromRgba(data, 120, 120);
  const found = findTagOutlineTolerant(mask, 120, 120, 60, 55);
  assert.equal(found.ok, true);
});

test('scanned grey paper does not read as ink; the darker outline does', () => {
  const data = rgbaPage(120, 120, 205, (put) => box(put, 40, 40, 80, 70, 120));
  const mask = adaptiveInkMaskFromRgba(data, 120, 120);
  assert.equal(mask[10 * 120 + 10], 0);
  assert.equal(findTagOutlineTolerant(mask, 120, 120, 60, 55).ok, true);
});

test('a broken outline (2 px gap, like a scan) closes and keeps its size', () => {
  const data = rgbaPage(120, 120, 255, (put) => box(put, 40, 40, 80, 70, 0, (x, y) => y === 40 && (x === 60 || x === 61)));
  const mask = adaptiveInkMaskFromRgba(data, 120, 120);
  const found = findTagOutlineTolerant(mask, 120, 120, 60, 55);
  assert.equal(found.ok, true);
  assert.ok(found.closedGaps >= 1);
  const xs = found.ring.map((p) => p[0]);
  assert.ok(Math.abs(Math.min(...xs) - 40) <= 1 && Math.abs(Math.max(...xs) - 81) <= 1);
});

test('dilateMask grows one pixel into its 8 neighbours', () => {
  const m = new Uint8Array(9); m[4] = 1;
  assert.equal(dilateMask(m, 3, 3, 1).reduce((a, b) => a + b, 0), 9);
});

import { findSimilarTags, outlineSignature, signaturesMatch } from '../src/survey/smartFillEngine.js';

test('find more like this: same-size boxes match, a different shape does not', () => {
  const { mask, rect } = canvas(300, 200);
  rect(20, 20, 50, 40);   // sample
  rect(120, 30, 150, 50); // same kind
  rect(200, 120, 230, 140); // same kind
  rect(60, 120, 140, 180); // much bigger: not a match
  const sample = outlineSignature([[20, 20], [51, 20], [51, 41], [20, 41]]);
  const rings = findSimilarTags(mask, 300, 200, sample);
  assert.equal(rings.length, 3);
});

test('signatures: a circle does not match a square of the same size', () => {
  const square = outlineSignature([[0, 0], [20, 0], [20, 20], [0, 20]]);
  const circle = outlineSignature(Array.from({ length: 40 }, (_, i) => [10 + 10 * Math.cos(i / 40 * 2 * Math.PI), 10 + 10 * Math.sin(i / 40 * 2 * Math.PI)]));
  assert.equal(signaturesMatch(square, square), true);
  assert.equal(signaturesMatch(square, circle), false);
});
