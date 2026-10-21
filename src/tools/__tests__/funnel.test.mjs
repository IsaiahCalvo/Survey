import test from 'node:test';
import assert from 'node:assert/strict';
import { noteFreeToolStep, takeFreeToolFunnel } from '../funnel.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const T0 = Date.parse('2026-10-21T10:00:00Z');

test('a free-tool visit that ends in a new account is a signup for that tool', () => {
  const s = memoryStorage();
  noteFreeToolStep('result', 'compress-pdf', s, T0);
  noteFreeToolStep('opened', 'compress-pdf', s, T0 + 60_000);
  const out = takeFreeToolFunnel({ id: 'u1', created_at: new Date(T0 + 10 * 60_000).toISOString() }, s, T0 + 11 * 60_000);
  assert.deepEqual(out, { event: 'free_tool_signup', properties: { tool: 'compress-pdf', madeFile: true, openedInSurvey: true, minutesToSignup: 10 } });
  assert.equal(takeFreeToolFunnel({ id: 'u1', created_at: new Date(T0).toISOString() }, s, T0), null, 'counted once');
});

test('an older account is a signed-in use, not a signup; nothing about the file is kept', () => {
  const s = memoryStorage();
  noteFreeToolStep('result', 'merge-pdf', s, T0);
  assert.doesNotMatch([...s.m.values()].join(''), /\.pdf|name/i);
  const out = takeFreeToolFunnel({ id: 'u1', created_at: '2025-01-01T00:00:00Z' }, s, T0 + 1000);
  assert.deepEqual(out, { event: 'free_tool_used_signed_in', properties: { tool: 'merge-pdf', madeFile: true, openedInSurvey: false } });
});

test('a new tool starts a new visit; old visits and signed-out reads are ignored', () => {
  const s = memoryStorage();
  noteFreeToolStep('opened', 'split-pdf', s, T0);
  noteFreeToolStep('result', 'rotate-pdf', s, T0 + 1000);
  assert.equal(takeFreeToolFunnel(null, s, T0 + 2000), null);
  assert.equal(takeFreeToolFunnel({ id: 'u', created_at: '2026-01-01T00:00:00Z' }, s, T0 + 2000).properties.openedInSurvey, false);
  noteFreeToolStep('result', 'rotate-pdf', s, T0);
  assert.equal(takeFreeToolFunnel({ id: 'u', created_at: '2026-01-01T00:00:00Z' }, s, T0 + 31 * 24 * 3600 * 1000), null);
});
