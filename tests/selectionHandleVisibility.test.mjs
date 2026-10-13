import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_RESIZE_HANDLES,
  CORNER_RESIZE_HANDLES,
  getAdaptiveSelectionHandleSpec,
  getHandleZoomScale,
  getSelectionHandleVisualMetrics,
} from '../src/utils/selectionHandleVisibility.js';

test('tiny selection boxes show only the bottom-right resize handle', () => {
  const spec = getAdaptiveSelectionHandleSpec({
    bboxWidth: 4,
    bboxHeight: 4,
    inverseScale: 1,
    padding: 2,
  });

  assert.equal(spec.tier, 'single');
  assert.deepEqual(spec.resizeHandles, ['br']);
});

test('medium selection boxes show corners before side handles', () => {
  const spec = getAdaptiveSelectionHandleSpec({
    bboxWidth: 28,
    bboxHeight: 28,
    inverseScale: 1,
    padding: 2,
  });

  assert.equal(spec.tier, 'corners');
  assert.deepEqual(spec.resizeHandles, CORNER_RESIZE_HANDLES);
});

test('large selection boxes show all resize handles', () => {
  const spec = getAdaptiveSelectionHandleSpec({
    bboxWidth: 80,
    bboxHeight: 80,
    inverseScale: 1,
    padding: 2,
  });

  assert.equal(spec.tier, 'all');
  assert.deepEqual(spec.resizeHandles, ALL_RESIZE_HANDLES);
});

test('zoomed-out boxes require more page-space before handles are added', () => {
  const normalZoom = getAdaptiveSelectionHandleSpec({
    bboxWidth: 24,
    bboxHeight: 24,
    inverseScale: 1,
    padding: 2,
  });
  const zoomedOut = getAdaptiveSelectionHandleSpec({
    bboxWidth: 24,
    bboxHeight: 24,
    inverseScale: 4,
    padding: 2,
  });

  assert.equal(normalZoom.tier, 'corners');
  assert.equal(zoomedOut.tier, 'single');
});

test('rotation handle offset grows when handle visuals would otherwise collide', () => {
  const normal = getAdaptiveSelectionHandleSpec({
    bboxWidth: 80,
    bboxHeight: 80,
    inverseScale: 1,
    padding: 2,
  });
  const extremeZoomedOut = getAdaptiveSelectionHandleSpec({
    bboxWidth: 80,
    bboxHeight: 80,
    inverseScale: 9,
    padding: 2,
  });

  assert.equal(normal.rotationOffset, 36);
  assert.ok(extremeZoomedOut.rotationOffset > 40);
});

// Drawboard canvas audit 2026-10-13 (chunk 5): handles are ONE size on screen
// at every zoom. A size in page units times screen-px-per-unit (1 / inverseScale)
// must not change with zoom (it used to grow with sqrt(zoom)).
test('handles keep one on-screen size at 50 %, 100 %, 200 % and 400 % zoom', () => {
  const onScreen = (inverseScale) => {
    const m = getSelectionHandleVisualMetrics(inverseScale);
    const px = (units) => +(units / inverseScale).toFixed(6);
    return { corner: px(m.cornerR * 2), pillW: px(m.hPillW), pillH: px(m.hPillH), rotate: px(m.rotationR * 2) };
  };
  const at100 = onScreen(1);
  assert.deepEqual(at100, { corner: 11, pillW: 28, pillH: 8, rotate: 20 });
  for (const inverseScale of [2, 0.5, 0.25]) {
    assert.deepEqual(onScreen(inverseScale), at100, `inverseScale ${inverseScale}`);
  }
});

test('the rotate grabber sits the same 36 screen px above the frame at every zoom', () => {
  for (const inverseScale of [2, 1, 0.5, 0.25]) {
    const spec = getAdaptiveSelectionHandleSpec({ bboxWidth: 400, bboxHeight: 400, inverseScale, padding: 2 });
    assert.equal(+(spec.rotationOffset / inverseScale).toFixed(6), 36, `inverseScale ${inverseScale}`);
  }
});

test('getHandleZoomScale is linear and keeps the zoom-out cap', () => {
  assert.equal(getHandleZoomScale(0.5), 0.5);
  assert.equal(getHandleZoomScale(2), 2);
  assert.equal(getHandleZoomScale(40), 3);
  assert.equal(getHandleZoomScale(NaN), 1);
});
