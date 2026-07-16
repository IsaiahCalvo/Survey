import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateAnnotationDetailTile } from '../src/utils/annotationDetailTile.js';

test('deep zoom detail tile keeps two backing pixels per visible CSS pixel', () => {
  const tile = calculateAnnotationDetailTile({
    pageWidth: 612,
    pageHeight: 792,
    pageRect: { left: -900, top: -350, right: 2160, bottom: 3610, width: 3060, height: 3960 },
    viewportRect: { left: 0, top: 0, right: 1212, bottom: 646, width: 1212, height: 646 },
    devicePixelRatio: 2,
  });

  assert.ok(tile);
  // drawScale is pageScale * dpr re-derived from the integer (ceil'd) backing
  // dims, so it can exceed 10 by the ceil fraction — what must hold EXACTLY is
  // that the painted page span fills the backing store (parity: any mismatch
  // stretches all geometry when CSS maps the backing to the tile box).
  assert.ok(Math.abs(tile.drawScale - 10) < 0.01);
  assert.ok(Math.abs(tile.drawScaleY - 10) < 0.01);
  assert.ok(Math.abs((tile.width / tile.pageScale) * tile.drawScale - tile.backingWidth) < 1e-9);
  assert.ok(Math.abs((tile.height / tile.pageScaleY) * tile.drawScaleY - tile.backingHeight) < 1e-9);
  assert.equal(tile.backingWidth, Math.ceil(tile.width * 2));
  assert.equal(tile.backingHeight, Math.ceil(tile.height * 2));
  // Integer CSS box — a fractional tile box would compositor-snap-stretch the
  // bitmap exactly like the pre-fix base canvas.
  assert.ok(Number.isInteger(tile.left));
  assert.ok(Number.isInteger(tile.top));
  assert.ok(Number.isInteger(tile.width));
  assert.ok(Number.isInteger(tile.height));
  assert.equal(tile.pageOffsetX, tile.left / 5);
  assert.equal(tile.pageOffsetY, tile.top / 5);
  assert.ok(tile.width < 3060, 'deep zoom paints a bounded viewport tile, not the full page');
  assert.ok(tile.height < 3960, 'deep zoom paints a bounded viewport tile, not the full page');
});

test('detail tile is reused while the viewport remains inside its buffered bounds', () => {
  const inputs = {
    pageWidth: 612,
    pageHeight: 792,
    pageRect: { left: -900, top: -350, right: 2160, bottom: 3610, width: 3060, height: 3960 },
    viewportRect: { left: 0, top: 0, right: 1212, bottom: 646, width: 1212, height: 646 },
    devicePixelRatio: 2,
  };
  const previousTile = calculateAnnotationDetailTile(inputs);
  const reused = calculateAnnotationDetailTile({
    ...inputs,
    pageRect: { ...inputs.pageRect, left: -920, right: 2140 },
    previousTile,
  });

  assert.equal(reused, previousTile);
});
