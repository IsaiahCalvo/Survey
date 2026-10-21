import test from 'node:test';
import assert from 'node:assert/strict';
import { markBox, visiblePageBox } from '../src/agent/planView.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

function fakeScreen({ page, scroller, inner = { width: 1200, height: 900 } }) {
  const scrollEl = { parentElement: null, getBoundingClientRect: () => scroller, overflow: 'auto' };
  const plain = { parentElement: scrollEl, getBoundingClientRect: () => rect(0, 0, 0, 0), overflow: 'visible' };
  const pageEl = { parentElement: plain, getBoundingClientRect: () => page };
  return {
    doc: { querySelector: (sel) => (sel.includes('data-page-number="2"') ? pageEl : null) },
    win: { innerWidth: inner.width, innerHeight: inner.height, getComputedStyle: (el) => ({ overflow: el.overflow, overflowX: '', overflowY: '' }) },
  };
}

test('the part of a page on screen, in page points, measured from the page element', () => {
  // A 612 x 792 page drawn at 1224 x 1584 px (2x), scrolled so its top-left
  // quarter fills an 600 x 800 viewer at (100, 50).
  const screen = fakeScreen({ page: rect(100, 50, 1224, 1584), scroller: rect(100, 50, 600, 800) });
  assert.deepEqual(visiblePageBox(2, { width: 612, height: 792 }, screen), { x: 0, y: 0, width: 300, height: 400 });
  // Scrolled down 400 px: the band below.
  const lower = fakeScreen({ page: rect(100, -350, 1224, 1584), scroller: rect(100, 50, 600, 800) });
  assert.deepEqual(visiblePageBox(2, { width: 612, height: 792 }, lower), { x: 0, y: 200, width: 300, height: 400 });
  // Off screen, not found, or turned sideways: nothing.
  assert.equal(visiblePageBox(2, { width: 612, height: 792 }, fakeScreen({ page: rect(100, 900, 1224, 1584), scroller: rect(100, 50, 600, 800) })), null);
  assert.equal(visiblePageBox(3, { width: 612, height: 792 }, screen), null);
  assert.equal(visiblePageBox(2, { width: 792, height: 612 }, screen), null);
});

test('a mark has room around its item, a circle more, and stays on the page', () => {
  const size = { width: 612, height: 792 };
  assert.deepEqual(markBox({ x: 100, y: 100, width: 40, height: 20 }, size), { x: 94, y: 94, width: 52, height: 32 });
  const circle = markBox({ x: 100, y: 100, width: 40, height: 20 }, size, { shape: 'circle' });
  assert.ok(circle.width > 70 && circle.height > 44);
  assert.deepEqual(markBox({ x: 2, y: 2, width: 10, height: 10 }, size), { x: 0, y: 0, width: 18, height: 18 });
  // On screen: shrunk so the whole cloud shows.
  assert.deepEqual(markBox({ x: 0, y: 0, width: 300, height: 400 }, size, { inset: true }), { x: 36, y: 48, width: 228, height: 304 });
});

test('visiblePageBox: a hidden PDF tab\'s page of the same number is skipped', () => {
  const rect = (w, h) => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h });
  const hidden = { getBoundingClientRect: () => rect(0, 0), parentElement: null };
  const shown = { getBoundingClientRect: () => rect(612, 792), parentElement: null };
  const box = visiblePageBox(1, { width: 612, height: 792 }, {
    doc: { querySelector: () => hidden, querySelectorAll: (sel) => (sel.startsWith('.survey') ? [hidden, shown] : []) },
    win: { innerWidth: 2000, innerHeight: 2000, getComputedStyle: () => ({}) },
  });
  assert.deepEqual(box, { x: 0, y: 0, width: 612, height: 792 });
});
