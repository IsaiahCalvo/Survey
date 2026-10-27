// Open speed on slow devices: supabase-js reads the session under the auth
// lock before every request. Each navigator.locks grant is its own main-thread
// task, handed out one at a time, so the ~30 requests queued during an open
// waited for a lock that was held for ~0 ms each: 0.3-0.6 s on a desktop, and
// 1.3-2.9 s at CPU x4, where auth-js then "recovered" by stealing the lock 5-10
// times per open. createTabBatchedLock lets calls that ask while this tab
// already has a request queued or held run in that request's turn: one grant,
// same order, same exclusion. See /mnt/project-files/perf/speed-round-3.md,
// Round 16.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createTabBatchedLock, createSafeNavigatorLock } from '../src/utils/safeNavigatorLock.js';

// A stand-in for navigator.locks: exclusive per name, FIFO, and every grant
// costs one macrotask (as a browser grant costs one main-thread task).
function fakeLocks() {
  const state = { grants: 0, held: new Map(), queues: new Map() };
  const pump = (name) => {
    if (state.held.get(name)) return;
    const queue = state.queues.get(name) || [];
    const next = queue.shift();
    if (!next) return;
    state.held.set(name, true);
    setTimeout(async () => {
      state.grants += 1;
      try { next.resolve(await next.fn()); } catch (error) { next.reject(error); } finally {
        state.held.set(name, false);
        pump(name);
      }
    }, 0);
  };
  const lock = (name, _timeout, fn) => new Promise((resolve, reject) => {
    if (!state.queues.has(name)) state.queues.set(name, []);
    state.queues.get(name).push({ fn, resolve, reject });
    pump(name);
  });
  return { state, lock };
}

test('calls queued together share one grant and run one at a time, in order', async () => {
  const { state, lock } = fakeLocks();
  const batched = createTabBatchedLock(lock);
  const order = [];
  let inside = 0;
  let maxInside = 0;
  const call = (i) => batched('auth', -1, async () => {
    inside += 1; maxInside = Math.max(maxInside, inside);
    order.push(i);
    await Promise.resolve();
    inside -= 1;
    return i * 10;
  });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => call(i)));
  assert.deepEqual(results, Array.from({ length: 30 }, (_, i) => i * 10));
  assert.deepEqual(order, Array.from({ length: 30 }, (_, i) => i));
  assert.equal(maxInside, 1, 'never two at once');
  assert.equal(state.grants, 1, 'one grant for the whole queue (was 30)');
});

test('without batching the same queue needs a grant per call (the old cost)', async () => {
  const { state, lock } = fakeLocks();
  await Promise.all(Array.from({ length: 30 }, () => lock('auth', -1, async () => {})));
  assert.equal(state.grants, 30);
});

test('a call after the turn ends asks for its own grant', async () => {
  const { state, lock } = fakeLocks();
  const batched = createTabBatchedLock(lock);
  await batched('auth', -1, async () => 1);
  await batched('auth', -1, async () => 2);
  assert.equal(state.grants, 2);
});

test('another holder (another tab) still excludes the whole turn', async () => {
  const { lock } = fakeLocks();
  const batched = createTabBatchedLock(lock);
  const events = [];
  let release;
  const otherTab = lock('auth', -1, () => new Promise((resolve) => {
    events.push('other-start');
    release = () => { events.push('other-end'); resolve(); };
  }));
  await new Promise((r) => setTimeout(r, 5));
  const mine = Promise.all([1, 2, 3].map((i) => batched('auth', -1, async () => { events.push(`mine-${i}`); })));
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(events, ['other-start'], 'nothing of mine runs while the other holder has the lock');
  release();
  await Promise.all([otherTab, mine]);
  assert.deepEqual(events, ['other-start', 'other-end', 'mine-1', 'mine-2', 'mine-3']);
});

test('one failing call rejects only itself; the turn goes on', async () => {
  const { lock } = fakeLocks();
  const batched = createTabBatchedLock(lock);
  const results = await Promise.allSettled([
    batched('auth', -1, async () => 'a'),
    batched('auth', -1, async () => { throw new Error('boom'); }),
    batched('auth', -1, async () => 'c'),
  ]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(results[1].reason.message, 'boom');
  assert.equal(results[2].value, 'c');
});

test('"only if free now" (timeout 0) never joins a turn', async () => {
  const calls = [];
  const lock = (name, timeout, fn) => { calls.push(timeout); return fn(); };
  const batched = createTabBatchedLock(lock);
  await Promise.all([batched('auth', -1, async () => {}), batched('auth', 0, async () => {})]);
  assert.deepEqual(calls.sort(), [-1, 0], 'the timeout-0 call goes straight to the lock');
});

test('a lock that is never granted rejects every call in the turn with its error', async () => {
  const lock = () => Promise.reject(new Error('denied'));
  const batched = createTabBatchedLock(lock);
  const results = await Promise.allSettled([1, 2].map(() => batched('auth', -1, async () => 'x')));
  assert.deepEqual(results.map((r) => r.reason?.message), ['denied', 'denied']);
});

test('a turn whose lock is taken away mid-run: the running call gets the steal error, the rest ask again and run', async () => {
  let attempt = 0;
  const lock = (name, timeout, fn) => {
    attempt += 1;
    if (attempt === 1) {
      // Granted, then stolen while the first call runs.
      return new Promise((resolve, reject) => { fn(); setTimeout(() => reject(new Error('stolen')), 0); });
    }
    return fn();
  };
  const batched = createTabBatchedLock(lock);
  const ran = [];
  const results = await Promise.allSettled([1, 2, 3].map((i) => batched('auth', -1, async () => {
    ran.push(i);
    await new Promise((r) => setTimeout(r, 2));
    return i;
  })));
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.message, 'stolen');
  assert.deepEqual(results.slice(1).map((r) => r.value), [2, 3]);
  assert.deepEqual(ran.sort(), [1, 2, 3]);
});

test('a running call that never finishes still rejects at once when its lock is stolen', async () => {
  let steal;
  const lock = (name, timeout, fn) => new Promise((resolve, reject) => {
    steal = () => { const e = new Error('Lock broken by another request with the \'steal\' option.'); e.name = 'AbortError'; reject(e); };
    fn().then(resolve, reject);
  });
  const batched = createTabBatchedLock(lock);
  const stuck = batched('auth', -1, () => new Promise(() => {})); // a refresh that hangs
  await new Promise((r) => setTimeout(r, 5));
  steal();
  await assert.rejects(stuck, { name: 'AbortError' });
});

test('without navigator.locks the calls just run (unchanged fallback)', async () => {
  const batched = createTabBatchedLock(createSafeNavigatorLock(() => { throw new Error('unused'); }, {}));
  assert.deepEqual(await Promise.all([batched('a', -1, () => 1), batched('a', -1, () => 2)]), [1, 2]);
});

test('wiring: the supabase client uses the batched lock over the safe navigator lock', () => {
  const source = readFileSync(new URL('../src/supabaseClient.js', import.meta.url), 'utf8');
  assert.match(source, /const clampedAuthLock = createTabBatchedLock\(createSafeNavigatorLock\(navigatorLock\)\);/);
  assert.match(source, /lock: clampedAuthLock,/);
});

test('a call stuck behind one that never finishes leaves the turn after its timeout and asks the lock itself', async () => {
  const direct = [];
  let first = true;
  const lock = (name, timeout, fn) => {
    if (first) { first = false; return fn(); }
    direct.push(timeout);
    return fn();
  };
  const batched = createTabBatchedLock(lock);
  void batched('auth', 50, () => new Promise(() => {})); // never settles
  const value = await batched('auth', 50, async () => 'recovered');
  assert.equal(value, 'recovered');
  assert.deepEqual(direct, [50], 'it went to the lock directly, where auth-js can steal on timeout');
});

test('a queue that keeps moving never leaves the turn, even when the whole queue takes longer than one timeout', async () => {
  const direct = [];
  let first = true;
  const lock = (name, timeout, fn) => {
    if (first) { first = false; return fn(); }
    direct.push(timeout);
    return fn();
  };
  const batched = createTabBatchedLock(lock);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Five calls of 25 ms each behind one another: the last waits ~100 ms in
  // all, twice its 50 ms timeout, yet every call ahead of it finished in time.
  const order = [];
  await Promise.all(Array.from({ length: 5 }, (_, i) => batched('auth', 50, async () => {
    await wait(25);
    order.push(i);
  })));
  assert.deepEqual(order, [0, 1, 2, 3, 4], 'all ran in the turn, in order');
  assert.deepEqual(direct, [], 'none asked the lock itself (that would steal it from this tab)');
});

test('a call with no timeout (-1) waits in the turn, as it would wait for the lock', async () => {
  const lock = (name, timeout, fn) => fn();
  const batched = createTabBatchedLock(lock);
  let release;
  const holder = batched('auth', -1, () => new Promise((resolve) => { release = resolve; }));
  let done = false;
  const waiter = batched('auth', -1, async () => { done = true; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(done, false);
  release();
  await Promise.all([holder, waiter]);
  assert.equal(done, true);
});
