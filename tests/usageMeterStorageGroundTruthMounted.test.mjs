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
  const recorded = { fromTables: [], rpcCalls: [] };
  globalThis[harnessKey] = { userId, tier, rpcResult, counts, recorded };

  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const coalescerUrl = pathToFileURL(path.join(repoRoot, 'src/hooks/requestCoalescer.js')).href;

  const tempDir = await mkdtemp(path.join(tmpdir(), 'usage-meter-ground-truth-'));

  // Fake supabase / auth. Reads its config off globalThis so the generated
  // module needs no build-time interpolation of test values.
  await writeFile(path.join(tempDir, 'stubs.mjs'), `
const h = globalThis[${JSON.stringify(harnessKey)}];

export const isSupabaseAvailable = () => true;

export const useAuth = () => ({ user: { id: h.userId }, tier: h.tier });

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
    const settle = () => Promise.resolve(tableResult(table));
    const builder = {
      select: () => builder,
      eq: () => builder,
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
    "import { coalesceRead } from './requestCoalescer.js';",
    `import { coalesceRead } from ${JSON.stringify(coalescerUrl)};`,
  );

  const modulePath = path.join(tempDir, 'useSubscriptionLimits.mjs');
  await writeFile(modulePath, source);
  const mod = await import(pathToFileURL(modulePath).href);

  return {
    useSubscriptionLimits: mod.useSubscriptionLimits,
    recorded,
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

  const { useSubscriptionLimits, recorded, cleanup } = await loadHook(options);

  const renders = [];
  const Probe = () => {
    renders.push(useSubscriptionLimits());
    return null;
  };

  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Probe)));
  // Second empty act flushes the async fetchUsage continuations (the awaited
  // Promise.all settles after the initial effect returns).
  await act(async () => {});

  t.after(async () => {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  return { latest: () => renders[renders.length - 1], renders, recorded };
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
