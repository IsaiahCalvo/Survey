import test from 'node:test';
import assert from 'node:assert/strict';

import { createAnalyticsRateLimiter } from '../src/utils/analyticsRateLimiter.js';

test('analytics limiter hard-stops a per-minute event storm', () => {
  let now = 0;
  const limiter = createAnalyticsRateLimiter({
    maxEventsPerMinute: 2,
    maxEventsPerSession: 10,
    now: () => now,
  });
  assert.equal(limiter.allow(), true);
  assert.equal(limiter.allow(), true);
  assert.equal(limiter.allow(), false);
  now = 60_000;
  assert.equal(limiter.allow(), true);
});

test('analytics limiter hard-stops total session volume', () => {
  let now = 0;
  const limiter = createAnalyticsRateLimiter({
    maxEventsPerMinute: 10,
    maxEventsPerSession: 2,
    now: () => now++,
  });
  assert.equal(limiter.allow(), true);
  assert.equal(limiter.allow(), true);
  assert.equal(limiter.allow(), false);
  assert.deepEqual(limiter.snapshot(), { recentCount: 2, sessionCount: 2 });
});
