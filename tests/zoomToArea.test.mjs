import test from 'node:test';
import assert from 'node:assert/strict';
import { boxBetween, isZoomToAreaStart, zoomToAreaPlan } from '../src/utils/zoomToArea.js';

const ev = (over = {}) => ({ button: 0, pointerType: 'mouse', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, target: { closest: () => null }, ...over });

test('only Ctrl/⌘+Shift with the main button off a mark starts a zoom box', () => {
  assert.equal(isZoomToAreaStart(ev()), true);
  assert.equal(isZoomToAreaStart(ev({ ctrlKey: false, metaKey: true })), true);
  assert.equal(isZoomToAreaStart(ev({ shiftKey: false })), false);
  assert.equal(isZoomToAreaStart(ev({ ctrlKey: false })), false);
  assert.equal(isZoomToAreaStart(ev({ altKey: true })), false);
  assert.equal(isZoomToAreaStart(ev({ button: 2 })), false);
  assert.equal(isZoomToAreaStart(ev({ pointerType: 'touch' })), false);
  assert.equal(isZoomToAreaStart(ev({ target: { closest: () => ({}) } })), false);
});

test('a box fills the view and its centre goes to the middle', () => {
  const plan = zoomToAreaPlan({
    box: boxBetween({ x: 300, y: 200 }, { x: 100, y: 100 }),
    view: { left: 0, top: 50, width: 800, height: 600 },
    scale: 1,
  });
  // 200 x 100 box into 800 x 600: width limits, x4.
  assert.equal(plan.scale, 4);
  assert.deepEqual(plan.anchor, { x: 200, y: 150 });
  assert.deepEqual(plan.shift, { dx: -200, dy: -200 });
});

test('a slip (tiny box) does nothing', () => {
  assert.equal(zoomToAreaPlan({ box: { left: 0, top: 0, width: 4, height: 40 }, view: { left: 0, top: 0, width: 800, height: 600 }, scale: 1 }), null);
});
