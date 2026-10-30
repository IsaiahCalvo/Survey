// Select tool drag box over Spaces areas (owner 2026-10-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  regionMarqueeDirection,
  regionMarqueeRect,
  resolveRegionMarqueeHits,
  doesOutlineTouchRect,
  isOutlineInsideRect,
} from '../src/utils/regionMarquee.js';

const square = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s];

const areas = [
  { id: 'a', coordinates: square(10, 10, 20) },
  { id: 'b', coordinates: square(100, 10, 20) },
  // A big area the box sits wholly inside.
  { id: 'c', coordinates: square(0, 200, 300) },
];

test('left-to-right is window, right-to-left is crossing', () => {
  assert.equal(regionMarqueeDirection(10, 50), 'window');
  assert.equal(regionMarqueeDirection(50, 10), 'crossing');
});

test('the box is the same whichever corner it starts from', () => {
  assert.deepEqual(regionMarqueeRect({ x: 50, y: 60 }, { x: 10, y: 5 }), { left: 10, top: 5, right: 50, bottom: 60 });
});

test('window picks only areas wholly inside the box', () => {
  const rect = regionMarqueeRect({ x: 0, y: 0 }, { x: 110, y: 40 });
  assert.deepEqual(resolveRegionMarqueeHits(areas, rect, 'window'), ['a']);
});

test('crossing picks every area the box touches', () => {
  const rect = regionMarqueeRect({ x: 0, y: 0 }, { x: 110, y: 40 });
  assert.deepEqual(resolveRegionMarqueeHits(areas, rect, 'crossing'), ['a', 'b']);
});

test('crossing picks an area when the box sits inside it', () => {
  const rect = regionMarqueeRect({ x: 100, y: 300 }, { x: 120, y: 320 });
  assert.deepEqual(resolveRegionMarqueeHits(areas, rect, 'crossing'), ['c']);
  assert.deepEqual(resolveRegionMarqueeHits(areas, rect, 'window'), []);
});

test('crossing picks an area whose edge runs through the box with no corner inside', () => {
  const thin = [0, 50, 200, 50, 200, 52, 0, 52];
  assert.equal(doesOutlineTouchRect(thin, { left: 90, top: 40, right: 110, bottom: 60 }), true);
  assert.equal(isOutlineInsideRect(thin, { left: 90, top: 40, right: 110, bottom: 60 }), false);
});

test('a box over empty page picks nothing', () => {
  const rect = regionMarqueeRect({ x: 40, y: 40 }, { x: 90, y: 90 });
  assert.deepEqual(resolveRegionMarqueeHits(areas, rect, 'crossing'), []);
});
