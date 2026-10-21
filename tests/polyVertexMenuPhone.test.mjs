import test from 'node:test';
import assert from 'node:assert/strict';

import { polyVertexMenuLayout } from '../src/utils/polyVertices.js';
import { buildCanvasPageItems } from '../src/sidebar/pageMenuItems.js';

test('a long-press Delete point menu has a 44px row and stays on a 320px phone', () => {
  const m = polyVertexMenuLayout({ x: 298, y: 397, touch: true, viewportWidth: 320, viewportHeight: 568 });
  assert.equal(m.rowHeight, 44);
  assert.ok(m.left >= 8 && m.left + m.width <= 312, `left ${m.left} width ${m.width}`);
});

test('a corner near the bottom edge keeps the menu above it', () => {
  const m = polyVertexMenuLayout({ x: 100, y: 560, touch: true, viewportWidth: 375, viewportHeight: 667 });
  assert.ok(m.top + m.rowHeight + 10 <= 667 - 8);
  const low = polyVertexMenuLayout({ x: 100, y: 660, touch: true, viewportWidth: 375, viewportHeight: 667 });
  assert.ok(low.top + low.rowHeight + 10 <= 667 - 8);
});

test('a mouse right-click keeps the compact desktop row at the pointer', () => {
  const m = polyVertexMenuLayout({ x: 200, y: 150, viewportWidth: 1440, viewportHeight: 900 });
  assert.deepEqual(m, { left: 200, top: 150, width: 140, rowHeight: 36 });
});

test('the page menu labels stay short enough for a 320px phone menu', () => {
  const labels = buildCanvasPageItems({ canPasteInPlace: true }).filter((i) => i.label).map((i) => i.label);
  assert.ok(labels.includes('Select all on page'));
  for (const label of labels) assert.ok(label.length <= 18, label);
});
