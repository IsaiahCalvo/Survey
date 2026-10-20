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
