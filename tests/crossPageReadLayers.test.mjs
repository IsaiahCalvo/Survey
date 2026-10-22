// Owner report 2026-10-22 (marks vanished while moved, two drawings open):
// a hidden tab's page layer (display:none, no client rects) must never be
// read as a page on screen, or its matrix makes the move think the mark left
// its page and hides it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPageLayers } from '../src/utils/crossPageMove.js';

const layer = (pageNumber, shown) => ({
  getAttribute: () => String(pageNumber),
  viewBox: { baseVal: { width: 612, height: 792 } },
  getClientRects: () => (shown ? [{}] : []),
  getScreenCTM: () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: shown ? 0 : 999, f: 0 }) }),
});

test('a hidden tab\'s page layers are skipped', () => {
  const root = { querySelectorAll: () => [layer(1, false), layer(1, true), layer(2, true)] };
  const pages = readPageLayers(root);
  assert.deepEqual(pages.map((p) => p.pageNumber), [1, 2]);
  assert.equal(pages[0].matrix[4], 0, 'page 1 is the shown tab\'s page');
});
