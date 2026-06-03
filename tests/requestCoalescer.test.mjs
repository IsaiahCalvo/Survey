import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coalesceRead,
  invalidateCoalescedRead,
  clearCoalescedReads,
} from '../src/hooks/requestCoalescer.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

test('concurrent identical keys share ONE fetcher invocation', async () => {
  clearCoalescedReads();
  let calls = 0;
  let resolveFetch;
  const fetcher = () => {
    calls += 1;
    return new Promise((res) => { resolveFetch = res; });
  };

  const p1 = coalesceRead('k:1', fetcher);
  const p2 = coalesceRead('k:1', fetcher);
  const p3 = coalesceRead('k:1', fetcher);

  assert.equal(calls, 1, 'fetcher should run exactly once for 3 concurrent callers');
  assert.equal(p1, p2, 'callers receive the same promise instance');
  assert.equal(p2, p3);

  resolveFetch('value');
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.deepEqual([r1, r2, r3], ['value', 'value', 'value'], 'all callers get the shared result');
});

test('key is freed after the promise settles so the next call refetches', async () => {
  clearCoalescedReads();
  let calls = 0;
  const fetcher = () => { calls += 1; return Promise.resolve(calls); };

  const first = await coalesceRead('k:2', fetcher);
  await tick(); // allow the .finally() cleanup to run
  const second = await coalesceRead('k:2', fetcher);

  assert.equal(first, 1, 'first call runs the fetcher');
  assert.equal(second, 2, 'second call after settle runs a FRESH fetcher (no stale cache)');
  assert.equal(calls, 2);
});

test('different keys do not share (no cross-contamination)', async () => {
  clearCoalescedReads();
  const calls = [];
  const make = (label) => () => { calls.push(label); return Promise.resolve(label); };

  const [a, b] = await Promise.all([
    coalesceRead('docs:userA', make('A')),
    coalesceRead('docs:userB', make('B')),
  ]);

  assert.equal(a, 'A');
  assert.equal(b, 'B');
  assert.deepEqual(calls.sort(), ['A', 'B'], 'both fetchers ran — distinct keys are independent');
});

test('a rejected shared promise propagates to every awaiting caller', async () => {
  clearCoalescedReads();
  let calls = 0;
  const fetcher = () => { calls += 1; return Promise.reject(new Error('boom')); };

  const p1 = coalesceRead('k:err', fetcher);
  const p2 = coalesceRead('k:err', fetcher);
  assert.equal(calls, 1, 'still only one fetcher invocation on the error path');

  await assert.rejects(p1, /boom/);
  await assert.rejects(p2, /boom/);

  await tick();
  // After settle (rejection) the key is freed: a retry runs a fresh fetcher.
  const retry = coalesceRead('k:err', () => Promise.resolve('ok'));
  assert.equal(await retry, 'ok');
});

test('invalidateCoalescedRead drops an in-flight promise so the next caller refetches', async () => {
  clearCoalescedReads();
  let calls = 0;
  let resolvers = [];
  const fetcher = () => { calls += 1; return new Promise((res) => resolvers.push(res)); };

  const p1 = coalesceRead('k:inv', fetcher);
  invalidateCoalescedRead('k:inv');
  const p2 = coalesceRead('k:inv', fetcher);

  assert.notEqual(p1, p2, 'after invalidation the second caller gets a new promise');
  assert.equal(calls, 2, 'fetcher ran again post-invalidation');

  resolvers.forEach((res) => res('done'));
  assert.equal(await p1, 'done');
  assert.equal(await p2, 'done');
});

test('a synchronous throw in the fetcher rejects without poisoning the key', async () => {
  clearCoalescedReads();
  const p = coalesceRead('k:sync', () => { throw new Error('sync-throw'); });
  await assert.rejects(p, /sync-throw/);
  // The key was never registered, so a subsequent good call works immediately.
  const ok = await coalesceRead('k:sync', () => Promise.resolve('recovered'));
  assert.equal(ok, 'recovered');
});
