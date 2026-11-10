// Drawboard PDF Pro trial bugs (t2-tools-deep.md, 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrowheadBounds, keepArrowheadOnPage, keepDrawnArrowOnPage } from '../src/utils/arrowheadEdge.js';
import { DUPLICATE_OFFSET_PAGE_UNITS, duplicateOffsetOnPage } from '../src/utils/familyClipboard.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = { pageWidth: 612, pageHeight: 792 };
const inside = (b) => b.minX >= -0.01 && b.minY >= -0.01 && b.maxX <= 612.01 && b.maxY <= 792.01;
const headAt = (style, start, end, sw = 2) => arrowheadBounds(style, end.x, end.y, (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI, sw);

test('the solid head reaches 2/3 of its size past the tip, which is how far it poked off the page', () => {
  const b = arrowheadBounds('solidTriangle', 612, 300, 0, 2);
  assert.ok(Math.abs(b.maxX - (612 + 16 / 3)) < 1e-9);
  assert.equal(arrowheadBounds('none', 0, 0, 0, 2), null);
});

test('an arrow end at the page edge comes in until its head fits, for every ending', () => {
  for (const style of ['solidTriangle', 'openTriangle', 'openCircle', 'vShape', 'horizontalLine', 'square', 'diamond', 'slash']) {
    for (const [start, end] of [
      [{ x: 306, y: 300 }, { x: 612, y: 300 }],
      [{ x: 500, y: 680 }, { x: 612, y: 792 }],
      [{ x: 300, y: 300 }, { x: 0, y: 0 }],
      [{ x: 611, y: 100 }, { x: 611, y: 300 }],
    ]) {
      const kept = keepArrowheadOnPage(start, end, { style, strokeWidth: 4, ...page });
      assert.ok(inside(headAt(style, start, kept, 4)), `${style} ${JSON.stringify(end)} -> ${JSON.stringify(kept)}`);
    }
  }
});

test('a head that fits is left alone, and a snapped slope is kept', () => {
  const end = { x: 500, y: 300 };
  assert.equal(keepArrowheadOnPage({ x: 306, y: 300 }, end, { style: 'solidTriangle', strokeWidth: 2, ...page }), end);
  const start = { x: 500, y: 680 };
  const kept = keepArrowheadOnPage(start, { x: 612, y: 792 }, { style: 'solidTriangle', strokeWidth: 2, ...page });
  assert.ok(Math.abs((kept.y - start.y) / (kept.x - start.x) - 1) < 1e-9, '45 degrees stays 45 degrees');
});

test('only the Arrow tool is held in, with its picked head or the solid default', () => {
  const end = { x: 612, y: 300 };
  assert.equal(keepDrawnArrowOnPage('line', { x: 306, y: 300 }, end, page), end);
  assert.ok(keepDrawnArrowOnPage('arrow', { x: 306, y: 300 }, end, page).x < 612);
  assert.equal(keepDrawnArrowOnPage('arrow', { x: 306, y: 300 }, end, { arrowheadStyle: 'none', ...page }), end);
});

test('a duplicate steps 16 pt, the other way where there is no room, and never off the page', () => {
  assert.deepEqual(duplicateOffsetOnPage({ left: 100, top: 100, width: 50, height: 50 }, 612, 792), { dx: 16, dy: 16 });
  assert.deepEqual(duplicateOffsetOnPage({ left: 550, top: 750, width: 56, height: 36 }, 612, 792), { dx: -16, dy: -16 });
  assert.deepEqual(duplicateOffsetOnPage({ left: 100, top: 750, width: 50, height: 36 }, 612, 792), { dx: 16, dy: -16 });
  assert.deepEqual(duplicateOffsetOnPage({ left: 0, top: 0, width: 610, height: 100 }, 612, 792), { dx: 2, dy: 16 }, 'no room either way: as far as fits');
  assert.deepEqual(duplicateOffsetOnPage(null, 612, 792), { dx: DUPLICATE_OFFSET_PAGE_UNITS, dy: DUPLICATE_OFFSET_PAGE_UNITS });
});

test('wired in: Ctrl+D, the arrow preview and commit, the callout box, drag highlights and two Nightly flags', () => {
  assert.match(read('src/PDFViewer.jsx'), /const onPage = duplicateOffsetOnPage\(clipboard\.extent, width, height\);/);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.equal((layer.match(/keepDrawnArrowOnPage\(/g) || []).length, 3);
  assert.match(layer, /x = Math\.max\(0, Math\.min\(width - tbW, x\)\);/);
  assert.match(layer, /press\.click === 'deselect' && !\(isPolyCreationTool && polyClickStartsOn\(\)\)/);
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.equal((hook.match(/clearDragTextSelection\(\);/g) || []).length, 4);
  for (const [key, file] of [['text-fit-height', '20261110146000_text_fit_height_flag.sql'], ['poly-click-starts', '20261110147000_poly_click_starts_flag.sql']]) {
    assert.equal(FEATURE_FLAGS[key]?.stage, 'beta');
    assert.match(read(`supabase/migrations/${file}`), new RegExp(`\\('${key}', 'off'`));
  }
});
