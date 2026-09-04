import test from 'node:test';
import assert from 'node:assert/strict';

import { getViewportScrollbarAxis } from '../src/utils/pdfViewportScrollbar.js';

test('scrollbar thumb reflects the visible share and current scroll position', () => {
  const axis = getViewportScrollbarAxis({
    viewportSize: 500,
    contentSize: 1000,
    scrollOffset: 250,
    trackSize: 100,
  });

  assert.deepEqual(axis, {
    start: 28,
    size: 44,
    travel: 44,
    maxScroll: 500,
  });
});

test('scrollbar fills its inset track and centers when content fits', () => {
  const axis = getViewportScrollbarAxis({
    viewportSize: 800,
    contentSize: 640,
    scrollOffset: 300,
    trackSize: 120,
  });

  assert.deepEqual(axis, {
    start: 6,
    size: 108,
    travel: 0,
    maxScroll: 0,
  });
});

test('scrollbar clamps preview offsets while zoom geometry is between frames', () => {
  const beforeStart = getViewportScrollbarAxis({
    viewportSize: 400,
    contentSize: 1600,
    scrollOffset: -80,
    trackSize: 80,
  });
  const afterEnd = getViewportScrollbarAxis({
    viewportSize: 400,
    contentSize: 1600,
    scrollOffset: 5000,
    trackSize: 80,
  });

  assert.equal(beforeStart.start, 6);
  assert.equal(afterEnd.start + afterEnd.size, 74);
});
