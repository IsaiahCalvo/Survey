// Owner 2026-11-02: a picked shape's rotate grabber was cut off by the page
// edge. Copy Drawboard (src/utils/pageEdgeRules.js): grabbers draw past the
// edge, a drawn shape and a resized side stop at it. The browser check is
// tests/e2e-signed-in/page-edge-grabbers.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { clampPointToPage, clampResizeEdge } from '../src/utils/pageEdgeRules.js';

test('a drawn end past the page is held on the page edge', () => {
  assert.deepEqual(clampPointToPage({ x: -20, y: 900 }, 612, 792), { x: 0, y: 792 });
  assert.deepEqual(clampPointToPage({ x: 700, y: -5 }, 612, 792), { x: 612, y: 0 });
  const inside = { x: 30, y: 40 };
  assert.equal(clampPointToPage(inside, 612, 792), inside, 'a point on the page is left alone');
  assert.equal(clampPointToPage(null, 612, 792), null);
  assert.deepEqual(clampPointToPage({ x: -3, y: 4 }, 0, 0), { x: -3, y: 4 }, 'no page size: unchanged');
});

test('a resized side stops at the page edge', () => {
  assert.equal(clampResizeEdge(-40, { pageSize: 792, startLow: 50, startHigh: 150 }), 0);
  assert.equal(clampResizeEdge(900, { pageSize: 792, startLow: 50, startHigh: 150 }), 792);
  assert.equal(clampResizeEdge(300, { pageSize: 792, startLow: 50, startHigh: 150 }), 300);
});

test('a side that already hung past the edge is never yanked back in', () => {
  // The box started 30 units over the top: its side may stay there, not go further.
  assert.equal(clampResizeEdge(-30, { pageSize: 792, startLow: -30, startHigh: 100 }), -30);
  assert.equal(clampResizeEdge(-80, { pageSize: 792, startLow: -30, startHigh: 100 }), -30);
});

test('growing from the centre keeps the mirrored side on the page too', () => {
  // Centre 100: the opposite side is 200 - edge, so the edge may not pass 200 - 0.
  assert.equal(clampResizeEdge(-50, { pageSize: 792, startLow: 80, startHigh: 120, centre: 100 }), 0);
  assert.equal(clampResizeEdge(260, { pageSize: 792, startLow: 80, startHigh: 120, centre: 100 }), 200);
});

test('the layer clips marks to the page but never the grabbers', () => {
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(src, /<g data-page-clip="marks" clipPath=\{marksClipPath\}>/);
  assert.match(src, /data-page-has-selection=/);
  // The root <svg> must not clip: it would cut the grabbers off again.
  const root = src.slice(src.indexOf('data-svg-annotation-layer={pageNumber}'), src.indexOf('preserveAspectRatio="none"', src.indexOf('data-svg-annotation-layer={pageNumber}')));
  assert.doesNotMatch(root, /overflow: 'hidden'/);
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.survey-pdfjs-page-div:has\(svg\[data-page-has-selection="true"\]\)/);
});
