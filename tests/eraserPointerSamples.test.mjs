import test from 'node:test';
import assert from 'node:assert/strict';

import { getCoalescedOrCurrentEvents } from '../src/utils/eraserPointerSamples.js';

test('getCoalescedOrCurrentEvents prefers coalesced events when present', () => {
  const coalesced = [{ id: 1 }, { id: 2 }];
  const nativeEvent = { getCoalescedEvents: () => coalesced };
  assert.equal(getCoalescedOrCurrentEvents(nativeEvent), coalesced);
});

test('getCoalescedOrCurrentEvents falls back to a single-event array', () => {
  const nativeEvent = { id: 'solo', getCoalescedEvents: () => [] };
  assert.deepEqual(getCoalescedOrCurrentEvents(nativeEvent), [nativeEvent]);
  assert.deepEqual(getCoalescedOrCurrentEvents(null), [null]);
  assert.deepEqual(getCoalescedOrCurrentEvents({}), [{}]);
});
