import test from 'node:test';
import assert from 'node:assert/strict';
import { canReachServer } from '../src/utils/serverReachable.js';

test('offline browser answers no without a fetch', async () => {
  let calls = 0;
  assert.equal(await canReachServer('https://x.test', { online: false, fetchImpl: () => { calls += 1; } }), false);
  assert.equal(calls, 0);
});

test('any HTTP answer counts as reachable', async () => {
  let url = '';
  const ok = await canReachServer('https://x.test/', { online: true, fetchImpl: async (u) => { url = u; return { status: 401 }; } });
  assert.equal(ok, true);
  assert.equal(url, 'https://x.test/auth/v1/health');
});

test('a refused connection is not reachable', async () => {
  assert.equal(await canReachServer('https://x.test', { online: true, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), false);
});

test('a fetch that never answers gives up', async () => {
  assert.equal(await canReachServer('https://x.test', { online: true, timeoutMs: 20, fetchImpl: () => new Promise(() => {}) }), false);
});
