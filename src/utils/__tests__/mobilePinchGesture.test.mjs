import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePinchCommitCursor,
  resolvePinchEndTransition,
} from '../mobilePinchGesture.js';

test('pinch commit follows the latest two-finger centroid', () => {
  assert.deepEqual(resolvePinchCommitCursor({
    originCursorX: 80,
    originCursorY: 120,
    currentCursorX: 143,
    currentCursorY: 211,
  }), { x: 143, y: 211 });
});

test('staggered finger release commits once and suppresses the remaining finger', () => {
  assert.deepEqual(resolvePinchEndTransition('pinch', 1), {
    commit: true,
    nextMode: 'pinch-release',
  });
  assert.deepEqual(resolvePinchEndTransition('pinch-release', 0), {
    commit: false,
    nextMode: null,
  });
});
