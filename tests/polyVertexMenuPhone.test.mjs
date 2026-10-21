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

test('a long-press Add point here menu on a side keeps a 44px row on every phone size', async () => {
  const { readFileSync } = await import('node:fs');
  for (const [w, h] of [[320, 568], [375, 667], [390, 844]]) {
    const m = polyVertexMenuLayout({ x: w - 4, y: h - 4, touch: true, viewportWidth: w, viewportHeight: h });
    assert.equal(m.rowHeight, 44);
    assert.ok(m.left >= 8 && m.left + m.width <= w - 8);
    assert.ok(m.top >= 8 && m.top + m.rowHeight + 10 <= h - 8);
  }
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  // The side's touch long-press opens the edge menu, and its row uses the layout height.
  assert.match(src, /startPolyLongPress\(e, \{ edge: \{ segmentIndex: hit\.segmentIndex, t: hit\.t \} \}\)/);
  assert.match(src, /data-poly-vertex-insert="true"[\s\S]{0,400}minHeight: menuLayout\.rowHeight/);
  // The page/mark long-press menu stays off a selected poly's side.
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /const onHandle = [^\n]*\[data-poly-edge-hit\]/);
});

test('a pen / touch side long-press band covers a cloud polygon\'s crowns, mouse keeps the plain band', async () => {
  const { cloudPolyEdgeReach } = await import('../src/utils/polyVertices.js');
  const pts = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }];
  // Crowns reach 18 units above the top side (frame from cloudSelectionChrome).
  assert.equal(cloudPolyEdgeReach(pts, { left: 92, top: 82, width: 216, height: 126 }), 18);
  // Frame inside the corners (or none): no extra reach.
  assert.equal(cloudPolyEdgeReach(pts, { left: 100, top: 100, width: 200, height: 100 }), 0);
  assert.equal(cloudPolyEdgeReach(pts, null), 0);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  // Reach only on a coarse pointer; band width and the long-press hit test share one tolerance.
  assert.match(src, /const polyEdgeReach = polyCloudChrome && isCoarsePointer/);
  assert.match(src, /insertVertexOnNearestEdge\(worldPoints, pt, polyEdgeTolerance,/);
  assert.match(src, /data-poly-edge-hit="true"[\s\S]{0,400}strokeWidth=\{polyEdgeTolerance \* 2\}/);
});
