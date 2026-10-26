// A counter's "Resize and rotate" frame shows corner grabbers that resize the
// pin uniformly. Every counter is drawn with lockScalingX/Y (its round body
// must not stretch), so that default must not lock the corner grabbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAnnotationTransformHandleLocked } from '../src/utils/annotationSelectionEligibility.js';

const counter = {
  type: 'circle', left: 102.28, top: 374.08, radius: 14,
  lockScalingX: true, lockScalingY: true, lockRotation: true,
  data: { type: 'counter', pointerAngle: 225, displayNumber: 1 },
};

test('a counter drawn with lockScaling can still be resized from its corners', () => {
  for (const handle of ['tl', 'tr', 'bl', 'br']) {
    assert.equal(isAnnotationTransformHandleLocked(counter, handle), false, handle);
  }
});

test('lockScaling still locks the corner grabbers on every other mark', () => {
  const rect = { type: 'Rect', lockScalingX: true, lockScalingY: true, data: {} };
  for (const handle of ['tl', 'tr', 'bl', 'br']) {
    assert.equal(isAnnotationTransformHandleLocked(rect, handle), true, handle);
  }
});
