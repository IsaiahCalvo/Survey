import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_RESIZE_HANDLES,
  CORNER_RESIZE_HANDLES,
  getAdaptiveSelectionHandleSpec,
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
