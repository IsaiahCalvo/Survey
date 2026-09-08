/**
 * usageMeterStorageGroundTruthMounted.test.mjs — KAL-390 regression guard.
 *
 * Proves, by actually MOUNTING useSubscriptionLimits inside React, that the
 * storage figure the usage meter renders is GROUND TRUTH: it comes from the
 * get_actual_storage_usage() RPC (real bytes in the user's storage folder) and
 * NOT from user_subscriptions.storage_used_bytes (a trigger-maintained counter
 * that drifts — measured 38.6% low on production, 2026-08-19).
 *
 * A source-text assertion would not catch a regression where someone re-adds a
 * `user_subscriptions` read as a "fallback", so this mounts the real hook
 * against a fake Supabase that records every table read and every RPC call, and
 * deliberately serves a WRONG value from user_subscriptions. If the wrong value
 * ever reaches `usage.storage`, or the table is touched at all, these fail.
 *
 * Module stubbing follows the repo's existing mounted-test idiom (see
 * syncStatusChipMounted / unsupportedAnnotationNoticeMounted): read the real
 * source, rewrite its import specifiers to absolute file URLs / a generated
 * stub module, write it to a temp dir, and import that. No loader flags, no
 * node:test module mocks — the repo runner invokes a bare `node --test <file>`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const HOOK_PATH = path.join(repoRoot, 'src/hooks/useSubscriptionLimits.js');

let harnessCounter = 0;

/**
 * Replace `needle` in `source`, asserting the needle was actually present.
 * If the hook's import lines are ever reworded, this fails loudly rather than
 * silently importing the real Supabase client.
 */
function replaceOrThrow(source, needle, replacement) {
  if (!source.includes(needle)) {
    throw new Error(`useSubscriptionLimits.js no longer contains: ${needle}`);
  }
  return source.replace(needle, replacement);
}

/**
 * Load the REAL hook with its three external modules stubbed:
 *   ../supabaseClient      -> fake { supabase, isSupabaseAvailable }
 *   ../contexts/AuthContext -> fake useAuth()
 *   ./requestCoalescer.js  -> the real one (pure, no React/Supabase)
 */
async function loadHook({ userId, tier = 'pro', rpcResult, counts = { projects: 2, documents: 3 } }) {
  const harnessKey = `__kal390Harness${harnessCounter += 1}__`;

  // Everything the fake Supabase records, read back by the assertions.
  const recorded = { fromTables: [], rpcCalls: [], filters: [] };
  const config = { userId, tier, rpcResult, counts, recorded };
  globalThis[harnessKey] = config;

  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const coalescerUrl = pathToFileURL(path.join(repoRoot, 'src/hooks/requestCoalescer.js')).href;

  const tempDir = await mkdtemp(path.join(tmpdir(), 'usage-meter-ground-truth-'));

  // Fake supabase / auth. Reads its config off globalThis so the generated
  // module needs no build-time interpolation of test values.
  await writeFile(path.join(tempDir, 'stubs.mjs'), `
const h = globalThis[${JSON.stringify(harnessKey)}];

export const isSupabaseAvailable = () => true;

export const useAuth = () => ({ user: h.userId ? { id: h.userId } : null, tier: h.tier });

// Anything that is NOT get_actual_storage_usage resolves a DELIBERATELY WRONG
// storage figure, so a regression that reads the counter shows 999 not the RPC.
function tableResult(table) {
  if (table === 'projects') return { data: null, count: h.counts.projects, error: null };
  if (table === 'documents') return { data: null, count: h.counts.documents, error: null };
  if (table === 'user_subscriptions') {
    return { data: { storage_used_bytes: 999 }, count: null, error: null };
  }
  return { data: null, count: 0, error: null };
}

export const supabase = {
  from(table) {
    h.recorded.fromTables.push(table);
    const result = tableResult(table);
    const settle = () => Promise.resolve(result);
    const builder = {
      select: () => builder,
      eq: (key, value) => { h.recorded.filters.push({ table, key, value }); return builder; },
      maybeSingle: settle,
      single: settle,
      then: (onFulfilled, onRejected) => settle().then(onFulfilled, onRejected),
    };
    return builder;
  },
  rpc(name, args) {
    h.recorded.rpcCalls.push({ name, args });
    if (name === 'get_actual_storage_usage') return Promise.resolve(h.rpcResult);
    return Promise.resolve({ data: null, error: { message: 'unexpected rpc: ' + name } });
  },
};
`);

  let source = await readFile(HOOK_PATH, 'utf8');
  source = replaceOrThrow(
    source,
    "from 'react';",
    `from ${JSON.stringify(reactUrl)};`,
  );
  source = replaceOrThrow(
    source,
    "import { supabase, isSupabaseAvailable } from '../supabaseClient';",
    "import { supabase, isSupabaseAvailable } from './stubs.mjs';",
  );
  source = replaceOrThrow(
    source,
    "import { useAuth } from '../contexts/AuthContext';",
    "import { useAuth } from './stubs.mjs';",
  );
  source = replaceOrThrow(
    source,
    "from './requestCoalescer.js';",
    `from ${JSON.stringify(coalescerUrl)};`,
  );

  const modulePath = path.join(tempDir, 'useSubscriptionLimits.mjs');
  await writeFile(modulePath, source);
  const mod = await import(pathToFileURL(modulePath).href);

  return {
    useSubscriptionLimits: mod.useSubscriptionLimits,
    recorded,
    config,
    cleanup: async () => {
      delete globalThis[harnessKey];
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

/** Mount the hook in a probe component and return its latest return value. */
async function mountHook(t, options) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { useSubscriptionLimits, recorded, config, cleanup } = await loadHook(options);

  const renders = [];
  const Probe = () => {
    renders.push(useSubscriptionLimits());
    return null;
  };

  const root = createRoot(document.getElementById('root'));
  const tree = () => React.createElement(options.strict ? React.StrictMode : React.Fragment, null,
    Array.from({ length: options.consumers ?? 1 }, (_, index) => React.createElement(Probe, { key: index })));
  let unmounted = false;
  const unmount = async () => {
    if (!unmounted) await act(async () => root.unmount());
    unmounted = true;
  };
  await act(async () => root.render(tree()));
  // Second empty act flushes the async fetchUsage continuations (the awaited
  // Promise.all settles after the initial effect returns).
  await act(async () => {});

  t.after(async () => {
    await unmount();
    await cleanup();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  return {
    latest: () => renders[renders.length - 1], renders, recorded, config, unmount,
    rerender: async (changes = {}) => {
      Object.assign(config, changes);
      await act(async () => root.render(tree()));
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('the mounted usage meter takes storage from the get_actual_storage_usage RPC, not the counter column', async (t) => {
  const userId = 'kal390-user-rpc-wins';
  const { latest, recorded } = await mountHook(t, {
    userId,
    rpcResult: { data: 12345678, error: null },
  });

  const hook = latest();
  assert.equal(hook.loading, false, 'the initial fetch should have settled');
  assert.equal(hook.error, null, 'a healthy RPC must not set an error');

  // 1. The RPC value wins; the wrong counter value (999) never appears.
  assert.equal(hook.usage.storage, 12345678);
  assert.notEqual(hook.usage.storage, 999);

  // The other two usage figures still come from the count queries.
  assert.equal(hook.usage.projects, 2);
  assert.equal(hook.usage.documents, 3);

  // 2. The RPC was called by name, self-scoped to this user.
  const groundTruthCalls = recorded.rpcCalls.filter((c) => c.name === 'get_actual_storage_usage');
  assert.equal(groundTruthCalls.length, 1, 'exactly one ground-truth storage RPC per mount');
  assert.deepEqual(groundTruthCalls[0].args, { p_user_id: userId });

  // 3. user_subscriptions was never queried at all — no counter read, not even
  //    as a "fallback". Regressing to the drifting column fails here.
  assert.ok(
    !recorded.fromTables.includes('user_subscriptions'),
    `expected no user_subscriptions read, saw tables: ${recorded.fromTables.join(', ')}`,
  );
  assert.deepEqual([...recorded.fromTables].sort(), ['documents', 'projects']);
});

test('a bigint-as-string RPC payload reaches the meter as a number', async (t) => {
  // PostgREST serializes bigint as a JSON string once it exceeds 2^53; the hook
  // coerces with Number() so the meter never does string math ('5' + 1 = '51').
  const { latest } = await mountHook(t, {
    userId: 'kal390-user-bigint-string',
    rpcResult: { data: '536536186', error: null },
  });

  const hook = latest();
  assert.equal(hook.usage.storage, 536536186);
  assert.equal(typeof hook.usage.storage, 'number');
  assert.equal(hook.error, null);
});

test('an RPC failure surfaces an error instead of silently falling back to the counter', async (t) => {
  // Expected — the hook logs the failure. Restored automatically by node:test.
  t.mock.method(console, 'error', () => {});

  const { latest, recorded } = await mountHook(t, {
    userId: 'kal390-user-rpc-error',
    rpcResult: { data: null, error: { message: 'boom' } },
  });

  const hook = latest();
  assert.equal(hook.loading, false);
  assert.equal(hook.error, 'boom', 'the RPC failure must be surfaced to the UI');

  // Stays at the zero default. Showing the known-wrong counter would be worse
  // than showing an error: the user cannot tell a stale meter from a broken one.
  assert.equal(hook.usage.storage, 0);
  assert.notEqual(hook.usage.storage, 999);
  assert.ok(
    !recorded.fromTables.includes('user_subscriptions'),
    'a failed RPC must not trigger a counter-column fallback read',
  );
});

test('switching accounts masks old usage immediately and ignores the retired account request', async (t) => {
  const h = await mountHook(t, { userId: 'race-a', rpcResult: { data: 100, error: null } });
  const oldRefetch = h.latest().refetch;
  const oldRequest = deferred();
  h.config.rpcResult = oldRequest.promise;
  let pending;
  await act(async () => { pending = h.latest().refetch(); });
  const nextRequest = deferred();
  const renderStart = h.renders.length;
  await h.rerender({ userId: 'race-b', rpcResult: nextRequest.promise, counts: { projects: 7, documents: 8 } });
  assert.deepEqual(h.renders[renderStart].usage, { projects: 0, documents: 0, storage: 0 });
  assert.equal(h.renders[renderStart].loading, true);
  await act(async () => { nextRequest.resolve({ data: 200, error: null }); });
  await act(async () => { oldRequest.resolve({ data: 900, error: null }); await pending; });
  assert.deepEqual(h.latest().usage, { projects: 7, documents: 8, storage: 200 });
  const before = h.recorded.rpcCalls.length;
  await act(async () => { await oldRefetch(); });
  assert.equal(h.recorded.rpcCalls.length, before, 'retired callbacks must not issue requests');
  const signoutStart = h.renders.length;
  await h.rerender({ userId: null });
  assert.deepEqual(h.renders[signoutStart].usage, { projects: 0, documents: 0, storage: 0 });
  assert.equal(h.renders[signoutStart].loading, false);
});

test('finite storage quota reports half used and half remaining on the free tier', async (t) => {
  const h = await mountHook(t, { userId: 'free-storage', tier: 'free', rpcResult: { data: 50 * 1024 * 1024, error: null } });
  assert.equal(h.latest().getUsagePercentage('storage'), 50);
  assert.equal(h.latest().getRemainingQuota('storage'), 50 * 1024 * 1024);
});

test('count queries match archived=false insert quotas without hiding user-archived rows or stored bytes', async (t) => {
  const h = await mountHook(t, { userId: 'archive-rules', rpcResult: { data: 123, error: null } });
  assert.deepEqual(h.recorded.filters, [
    { table: 'projects', key: 'user_id', value: 'archive-rules' },
    { table: 'projects', key: 'archived', value: false },
    { table: 'documents', key: 'user_id', value: 'archive-rules' },
    { table: 'documents', key: 'archived', value: false },
  ]);
  assert.equal(h.latest().usage.storage, 123, 'storage remains the entire live RPC total');
});

test('a malformed successful usage payload is an error, not an invented zero', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = await mountHook(t, { userId: 'bad-payload', rpcResult: { data: null, error: null } });
  assert.match(h.latest().error, /storage/i);
  assert.equal(h.latest().loading, false);
});

test('overlapping refreshes publish only the latest request, including loading and errors', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const h = await mountHook(t, { userId: 'overlap', rpcResult: { data: 10, error: null } });
  const older = deferred();
  const newer = deferred();
  let p1, p2;
  h.config.rpcResult = older.promise;
  await act(async () => { p1 = h.latest().refetch(); });
  h.config.rpcResult = newer.promise;
  await act(async () => { p2 = h.latest().refetch(); });
  await act(async () => { older.resolve({ data: null, error: { message: 'stale failure' } }); await p1; });
  assert.equal(h.latest().loading, true, 'old finally must not settle a newer request');
  assert.equal(h.latest().error, null);
  assert.equal(log.mock.callCount(), 0, 'stale failures must not be logged as current failures');
  await act(async () => { newer.resolve({ data: 30, error: null }); await p2; });
  assert.equal(h.latest().usage.storage, 30);
  assert.equal(h.latest().loading, false);
  assert.equal(h.recorded.rpcCalls.length, 3, 'each explicit refresh still bypasses boot sharing');

  const successOld = deferred();
  h.config.rpcResult = successOld.promise;
  await act(async () => { p1 = h.latest().refetch(); });
  h.config.rpcResult = { data: null, error: { message: 'latest failure' } };
  await act(async () => { await h.latest().refetch(); });
  await act(async () => { successOld.resolve({ data: 90, error: null }); await p1; });
  assert.equal(h.latest().usage.storage, 30, 'current failures retain same-actor last good usage');
  assert.equal(h.latest().error, 'latest failure', 'old success must not clear the latest error');
});

test('A to B to A does not rejoin the retired A boot request', async (t) => {
  const retired = deferred();
  const h = await mountHook(t, { userId: 'aba-a', rpcResult: retired.promise });
  const oldRefetch = h.latest().refetch;
  await h.rerender({ userId: 'aba-b', rpcResult: { data: 20, error: null } });
  await h.rerender({ userId: 'aba-a', rpcResult: { data: 30, error: null } });
  assert.equal(h.latest().usage.storage, 30);
  await act(async () => { retired.resolve({ data: 10, error: null }); });
  assert.equal(h.latest().usage.storage, 30);
  const before = h.recorded.rpcCalls.length;
  await act(async () => { await oldRefetch(); });
  assert.equal(h.recorded.rpcCalls.length, before);
  assert.equal(before, 3);
});

test('signout masks errors before effects and blocks late requests and callbacks', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const h = await mountHook(t, { userId: 'signout', rpcResult: { data: null, error: { message: 'old error' } } });
  const delayed = deferred();
  const oldRefetch = h.latest().refetch;
  let pending;
  h.config.rpcResult = delayed.promise;
  await act(async () => { pending = h.latest().refetch(); });
  const beforeRender = h.renders.length;
  await h.rerender({ userId: null });
  assert.equal(h.renders[beforeRender].error, null);
  assert.equal(h.renders[beforeRender].loading, false);
  await act(async () => { delayed.resolve({ data: null, error: { message: 'late error' } }); await pending; await oldRefetch(); });
  assert.equal(h.latest().error, null);
  assert.deepEqual(h.latest().usage, { projects: 0, documents: 0, storage: 0 });
  assert.equal(h.recorded.rpcCalls.length, 2);
  assert.equal(log.mock.callCount(), 1);
});

test('unmount retires requests and retained refresh callbacks', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const delayed = deferred();
  const h = await mountHook(t, { userId: 'unmount', rpcResult: delayed.promise });
  const oldRefetch = h.latest().refetch;
  await h.unmount();
  const before = h.renders.length;
  await act(async () => { delayed.resolve({ data: null, error: { message: 'late' } }); await oldRefetch(); });
  assert.equal(h.renders.length, before);
  assert.equal(h.recorded.rpcCalls.length, 1);
  assert.equal(log.mock.callCount(), 0);
});

test('peer hooks and Strict Mode share one in-flight boot trio without refiring on equal actor renders', async (t) => {
  const delayed = deferred();
  const h = await mountHook(t, { userId: 'coalesce', rpcResult: delayed.promise, consumers: 2, strict: true });
  assert.equal(h.recorded.rpcCalls.length, 1);
  assert.deepEqual(h.recorded.fromTables, ['projects', 'documents']);
  await act(async () => { delayed.resolve({ data: 100, error: null }); });
  assert.equal(h.latest().usage.storage, 100);
  await h.rerender({ tier: 'free' });
  assert.equal(h.recorded.rpcCalls.length, 1);
  assert.equal(h.latest().tier, 'free');
});

test('invalid counts or bytes preserve last good same-actor usage and report an error', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = await mountHook(t, { userId: 'invalid-values', rpcResult: { data: 10, error: null } });
  for (const invalid of [null, undefined, NaN, -1, 1.5, '3', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const metric of ['projects', 'documents']) {
      h.config.counts = { projects: 2, documents: 3, [metric]: invalid };
      await act(async () => { await h.latest().refetch(); });
      assert.match(h.latest().error, new RegExp(metric.slice(0, -1)));
      assert.deepEqual(h.latest().usage, { projects: 2, documents: 3, storage: 10 });
    }
  }
  h.config.counts = { projects: 2, documents: 3 };
  for (const invalid of [null, undefined, NaN, -1, 0.5, Infinity, '', ' ', 'nope', {}, false, '1e999', '-1']) {
    h.config.rpcResult = { data: invalid, error: null };
    await act(async () => { await h.latest().refetch(); });
    assert.match(h.latest().error, /storage/);
    assert.equal(h.latest().usage.storage, 10);
  }
  h.config.counts = { projects: 0, documents: 0 };
  h.config.rpcResult = { data: '0', error: null };
  await act(async () => { await h.latest().refetch(); });
  assert.deepEqual(h.latest().usage, { projects: 0, documents: 0, storage: 0 });
  assert.equal(h.latest().error, null);
});

test('pro count sentinels remain unlimited while enterprise storage stays finite', async (t) => {
  const h = await mountHook(t, { userId: 'finite-enterprise', tier: 'enterprise', rpcResult: { data: 512 * 1024 ** 3, error: null } });
  assert.equal(h.latest().getUsagePercentage('projects'), 0);
  assert.equal(h.latest().getRemainingQuota('documents'), 999999);
  assert.equal(h.latest().getUsagePercentage('storage'), 50);
  assert.equal(h.latest().getRemainingQuota('storage'), 512 * 1024 ** 3);
});
