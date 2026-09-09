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

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const abortError = error => error.name === 'AbortError' && error.code === 'LIBRARY_READ_ABORTED'
  && !error.message.includes('secret');
function trackedAbort() {
  const controller = new AbortController(), listeners = new Set();
  const signal = { get aborted() { return controller.signal.aborted; },
    addEventListener(type, fn, options) { listeners.add(fn); controller.signal.addEventListener(type, fn, options); },
    removeEventListener(type, fn) { listeners.delete(fn); controller.signal.removeEventListener(type, fn); } };
  return { controller, signal, listeners };
}

test('opt-in pre-abort and invalid options perform no fetch and attach no listeners', async () => {
  clearCoalescedReads(); const tracked = trackedAbort(); tracked.controller.abort(new Error('secret'));
  let calls = 0; const fetcher = () => { calls++; };
  await assert.rejects(coalesceRead('pre-abort', fetcher, { signal: tracked.signal }), abortError);
  for (const options of [null, [], { signal: {} }]) await assert.rejects(coalesceRead('pre-abort', fetcher, options), TypeError);
  assert.equal(calls, 0); assert.equal(tracked.listeners.size, 0);
});

test('opt-in callers have distinct waiters; canceling one keeps another transport alive', async () => {
  clearCoalescedReads(); const a = trackedAbort(), b = trackedAbort(), operation = deferred();
  let calls = 0, shared;
  const fetcher = signal => { calls++; shared = signal; return operation.promise; };
  const first = coalesceRead('two', fetcher, { signal: a.signal });
  const second = coalesceRead('two', fetcher, { signal: b.signal });
  assert.equal(calls, 1); assert.notEqual(first, second); assert.equal(shared.aborted, false);
  a.controller.abort('secret'); await assert.rejects(first, abortError);
  assert.equal(shared.aborted, false); assert.equal(a.listeners.size, 0); assert.equal(b.listeners.size, 1);
  operation.resolve('complete'); assert.equal(await second, 'complete'); assert.equal(b.listeners.size, 0);
  assert.equal(shared.aborted, false, 'normal settlement does not cancel the completed transport');
});

test('last opt-in cancellation settles a hung fetch and a fresh entry survives late old settlement', async () => {
  clearCoalescedReads(); const a = trackedAbort(), b = trackedAbort(), old = deferred(), fresh = deferred();
  let calls = 0, oldSignal;
  const fetcher = signal => { calls++; if (calls === 1) { oldSignal = signal; return old.promise; } return fresh.promise; };
  const first = coalesceRead('last', fetcher, { signal: a.signal });
  const second = coalesceRead('last', fetcher, { signal: b.signal });
  a.controller.abort(); await assert.rejects(first, abortError); assert.equal(oldSignal.aborted, false);
  b.controller.abort(); await assert.rejects(second, abortError); assert.equal(oldSignal.aborted, true);
  assert.equal(a.listeners.size + b.listeners.size, 0);
  const third = coalesceRead('last', fetcher, {}); assert.equal(calls, 2);
  old.resolve('discard'); await tick();
  const fourth = coalesceRead('last', fetcher, {}); assert.equal(calls, 2);
  fresh.resolve('new'); assert.deepEqual(await Promise.all([third, fourth]), ['new', 'new']);
});

test('opt-in entry registers before synchronous fetcher reentrancy', async () => {
  clearCoalescedReads(); let nested, calls = 0;
  const first = coalesceRead('reentrant', signal => {
    calls++; assert.equal(signal.aborted, false);
    nested = coalesceRead('reentrant', () => { calls++; return 'wrong'; }, {});
    return 'value';
  }, {});
  assert.equal(calls, 1, 'fetcher still starts synchronously');
  assert.deepEqual(await Promise.all([first, nested]), ['value', 'value']);
});

test('opt-in last-cancel evicts before synchronous transport abort starts another request', async () => {
  clearCoalescedReads(); const controller = new AbortController(), old = deferred(), fresh = deferred();
  let replacement, freshCalls = 0;
  const freshFetcher = () => { freshCalls++; return fresh.promise; };
  const first = coalesceRead('abort-reentrant', signal => {
    signal.addEventListener('abort', () => { replacement = coalesceRead('abort-reentrant', freshFetcher, {}); }, { once: true });
    return old.promise;
  }, { signal: controller.signal });
  controller.abort(); await assert.rejects(first, abortError); assert.equal(freshCalls, 1);
  old.reject(new Error('late rejected transport')); await tick();
  const join = coalesceRead('abort-reentrant', freshFetcher, {}); assert.equal(freshCalls, 1);
  fresh.resolve('replacement'); assert.deepEqual(await Promise.all([replacement, join]), ['replacement', 'replacement']);
});

test('opt-in failure reaches all live callers, cleans listeners and permits fresh retry', async () => {
  clearCoalescedReads(); const a = trackedAbort(), b = trackedAbort(), operation = deferred();
  const first = coalesceRead('failure', () => operation.promise, { signal: a.signal });
  const second = coalesceRead('failure', () => assert.fail('must share'), { signal: b.signal });
  const failed = Promise.all([assert.rejects(first, /failed/), assert.rejects(second, /failed/)]);
  operation.reject(new Error('failed')); await failed;
  assert.equal(a.listeners.size + b.listeners.size, 0);
  assert.equal(await coalesceRead('failure', () => 'retry', {}), 'retry');
  const tracked = trackedAbort();
  await assert.rejects(coalesceRead('throw', () => { throw new Error('sync'); }, { signal: tracked.signal }), /sync/);
  assert.equal(tracked.listeners.size, 0);
  assert.equal(await coalesceRead('throw', () => 'recovered', {}), 'recovered');
});

for (const invalidate of [key => invalidateCoalescedRead(key), () => clearCoalescedReads()]) {
  test(`opt-in ${invalidate.toString().includes('clear') ? 'clear' : 'invalidate'} detaches without canceling live waiters`, async () => {
    clearCoalescedReads(); const old = deferred(), fresh = deferred(), a = trackedAbort(), b = trackedAbort();
    let oldSignal, freshSignal, calls = 0;
    const fetcher = signal => { calls++; if (calls === 1) { oldSignal = signal; return old.promise; } freshSignal = signal; return fresh.promise; };
    const first = coalesceRead('invalidate-opt', fetcher, { signal: a.signal });
    invalidate('invalidate-opt'); assert.equal(oldSignal.aborted, false);
    const second = coalesceRead('invalidate-opt', fetcher, { signal: b.signal }); assert.equal(calls, 2);
    old.resolve('old still allowed'); assert.equal(await first, 'old still allowed');
    const third = coalesceRead('invalidate-opt', fetcher, {}); assert.equal(calls, 2);
    assert.equal(freshSignal.aborted, false); fresh.resolve('fresh');
    assert.deepEqual(await Promise.all([second, third]), ['fresh', 'fresh']);
    assert.equal(a.listeners.size + b.listeners.size, 0);
  });
}

test('last subscriber can cancel a detached entry without touching its replacement', async () => {
  clearCoalescedReads(); const tracked = trackedAbort(), fresh = deferred(); let oldSignal, freshSignal;
  const first = coalesceRead('detached', signal => { oldSignal = signal; return new Promise(() => {}); }, { signal: tracked.signal });
  invalidateCoalescedRead('detached');
  const second = coalesceRead('detached', signal => { freshSignal = signal; return fresh.promise; }, {});
  tracked.controller.abort(); await assert.rejects(first, abortError);
  assert.equal(oldSignal.aborted, true); assert.equal(freshSignal.aborted, false);
  fresh.resolve('new'); assert.equal(await second, 'new'); assert.equal(tracked.listeners.size, 0);
});

test('two-argument and opt-in maps do not change each other promise or cancellation semantics', async () => {
  clearCoalescedReads(); const legacy = deferred(), owned = deferred(), controller = new AbortController();
  let legacyCalls = 0, ownedCalls = 0;
  const legacyFetcher = function () { legacyCalls++; assert.equal(arguments.length, 0); return legacy.promise; };
  const first = coalesceRead('separate', legacyFetcher);
  const second = coalesceRead('separate', legacyFetcher);
  const third = coalesceRead('separate', signal => { ownedCalls++; assert.equal(signal.aborted, false); return owned.promise; }, { signal: controller.signal });
  assert.equal(first, second); assert.equal(legacyCalls, 1); assert.equal(ownedCalls, 1);
  controller.abort(); await assert.rejects(third, abortError);
  legacy.resolve('legacy'); assert.equal(await first, 'legacy'); owned.reject(new Error('late')); await tick();
});
