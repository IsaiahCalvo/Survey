import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldApplyDedupeResync } from '../src/utils/dedupeResyncSafety.js';

test('shouldApplyDedupeResync applies non-shrink updates', () => {
  assert.deepEqual(shouldApplyDedupeResync({
    currentCount: 3,
    resyncCount: 5,
  }), { apply: true, reason: 'not-a-shrink', shrink: -2 });
});

test('shouldApplyDedupeResync blocks startup shrinks', () => {
  assert.deepEqual(shouldApplyDedupeResync({
    currentCount: 10,
    resyncCount: 4,
    removedCount: 6,
    startupSyncInFlight: true,
    hydrated: true,
  }), { apply: false, reason: 'startup-shrink', shrink: 6 });
  assert.deepEqual(shouldApplyDedupeResync({
    currentCount: 10,
    resyncCount: 4,
    removedCount: 6,
    hydrated: false,
  }), { apply: false, reason: 'startup-shrink', shrink: 6 });
});

test('shouldApplyDedupeResync blocks shrinks larger than removedCount', () => {
  assert.deepEqual(shouldApplyDedupeResync({
    currentCount: 10,
    resyncCount: 2,
    removedCount: 3,
    hydrated: true,
  }), { apply: false, reason: 'shrink-exceeds-dedupe-removal', shrink: 8 });
});

test('shouldApplyDedupeResync allows expected dedupe shrinks', () => {
  assert.deepEqual(shouldApplyDedupeResync({
    currentCount: 10,
    resyncCount: 7,
    removedCount: 3,
    hydrated: true,
  }), { apply: true, reason: 'expected-dedupe-shrink', shrink: 3 });
});

test('shouldApplyDedupeResync coerces non-finite counts', () => {
  assert.deepEqual(shouldApplyDedupeResync({
    currentCount: Number.NaN,
    resyncCount: Number.NaN,
    removedCount: -2,
    hydrated: true,
  }), { apply: true, reason: 'not-a-shrink', shrink: 0 });
});
