import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HANDLE_FILL,
  HANDLE_RING,
  HANDLE_RING_INVALID,
  HANDLE_RING_WIDTH,
  HANDLE_RADIUS,
  HANDLE_RADIUS_SECONDARY,
} from '../src/utils/handleStyle.js';

test('handleStyle exports the unified white-fill blue-ring constants', () => {
  assert.equal(HANDLE_FILL, '#ffffff');
  assert.equal(HANDLE_RING, '#4a90e2');
  assert.equal(HANDLE_RING_INVALID, '#ef4444');
  assert.equal(HANDLE_RING_WIDTH, 1.5);
  assert.equal(HANDLE_RADIUS, 5.5);
  assert.equal(HANDLE_RADIUS_SECONDARY, 4);
});
