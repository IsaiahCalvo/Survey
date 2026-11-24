import test from 'node:test';
import assert from 'node:assert/strict';
import { readLastKnownTier, tierAfterFailedRead, writeLastKnownTier } from '../src/services/lastKnownTier.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('a failed tier read keeps the plan already on screen for that person', () => {
  assert.equal(tierAfterFailedRead({ userId: 'u1', shownTier: 'pro', shownUserId: 'u1' }, memory()), 'pro');
});

test('a failed read with nothing on screen uses the last plan this device saw for them', () => {
  const store = memory();
  writeLastKnownTier('u1', 'enterprise', store);
  assert.equal(readLastKnownTier('u1', store), 'enterprise');
  assert.equal(tierAfterFailedRead({ userId: 'u1', shownTier: null, shownUserId: null }, store), 'enterprise');
});

test("another person's saved plan is never used", () => {
  const store = memory();
  writeLastKnownTier('u1', 'pro', store);
  assert.equal(tierAfterFailedRead({ userId: 'u2', shownTier: 'pro', shownUserId: 'u1' }, store), 'free');
});

test('broken storage falls back to Free', () => {
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  writeLastKnownTier('u1', 'pro', bad);
  assert.equal(tierAfterFailedRead({ userId: 'u1' }, bad), 'free');
});
