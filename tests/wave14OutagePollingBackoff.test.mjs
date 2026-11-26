// Regression tests for #1773 / #1775 client-side outage polling/retry storms:
// 1. pollingBackoff.js exponential curves, caps, blocking window, and resets.
// 2. featureFlags.js refreshFeatureFlags in-flight deduplication + error backoff.
// 3. DocumentVersionsButton.jsx useDocumentVersions behavioral verification:
//    in-flight dedupe, focus/visibility cooldown, hidden-tab pause, exponential
//    error backoff (30s -> 60s -> 120s -> 240s -> 300s), online & event resets.
// 4. AuthContext.jsx & YDocProvider.jsx polling/retry backoff contracts.
import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { computeBackoffDelay, createBackoffState } from '../src/utils/pollingBackoff.js';
import { refreshFeatureFlags } from '../src/featureFlags.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
};

test('computeBackoffDelay & createBackoffState enforce exponential caps and reset cleanly', () => {
  // DocumentVersions / YDocProvider curve: 30s -> 60s -> 120s -> 240s -> 300s max
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => computeBackoffDelay(n, { baseMs: 30_000, maxMs: 300_000 })),
    [30_000, 60_000, 120_000, 240_000, 300_000, 300_000],
  );
  // AuthContext curve: 5s -> 10s -> 20s -> 40s -> 60s max
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => computeBackoffDelay(n, { baseMs: 5_000, maxMs: 60_000 })),
    [5_000, 10_000, 20_000, 40_000, 60_000, 60_000],
  );

  let clock = 1_000;
  const backoff = createBackoffState({ baseMs: 5_000, maxMs: 60_000, now: () => clock });
  assert.equal(backoff.isBlocked(), false);
  assert.equal(backoff.remainingMs(), 0);

  assert.equal(backoff.recordFailure(), 5_000);
  assert.equal(backoff.isBlocked(), true);
  assert.equal(backoff.remainingMs(), 5_000);

  clock += 3_000;
  assert.equal(backoff.isBlocked(), true);
  assert.equal(backoff.remainingMs(), 2_000);

  clock += 2_000;
  assert.equal(backoff.isBlocked(), false);
  assert.equal(backoff.recordFailure(), 10_000);
  assert.equal(backoff.failures, 2);

  backoff.recordSuccess();
  assert.equal(backoff.failures, 0);
  assert.equal(backoff.isBlocked(), false);
  assert.equal(backoff.remainingMs(), 0);
});

test('#1775: refreshFeatureFlags deduplicates in-flight RPCs and backs off after errors', async () => {
  const storage = memoryStorage();
  let clock = 10_000;
  let calls = 0;
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });

  const client = {
    rpc: async () => {
      calls += 1;
      if (calls === 1) {
        await firstPending;
        return { data: null, error: { status: 503, message: 'PGRST002' } };
      }
      return { data: { 'pro-lock': true }, error: null };
    },
  };

  // Two concurrent calls share one in-flight RPC.
  const p1 = refreshFeatureFlags(client, { storage, now: () => clock });
  const p2 = refreshFeatureFlags(client, { storage, now: () => clock });
  assert.equal(calls, 1, 'concurrent calls share one RPC');
  releaseFirst();
  assert.deepEqual(await Promise.all([p1, p2]), [false, false]);

  // Immediately after a 503 error, a non-forced refresh is skipped during backoff.
  clock += 5_000;
  assert.equal(await refreshFeatureFlags(client, { storage, now: () => clock }), false);
  assert.equal(calls, 1, 'blocked during error backoff window');

  // Once the 15s backoff window elapses, the next call runs and succeeds.
  clock += 10_000;
  assert.equal(await refreshFeatureFlags(client, { storage, now: () => clock }), true);
  assert.equal(calls, 2, 'runs after backoff expires');

  // Force bypasses any backoff (manual /flags save).
  let forceCalls = 0;
  const failingThenOk = {
    rpc: async () => {
      forceCalls += 1;
      return forceCalls === 1
        ? { data: null, error: { status: 503 } }
        : { data: { 'pro-lock': false }, error: null };
    },
  };
  assert.equal(await refreshFeatureFlags(failingThenOk, { storage, now: () => clock }), false);
  assert.equal(await refreshFeatureFlags(failingThenOk, { storage, now: () => clock }), false);
  assert.equal(forceCalls, 1, 'second non-forced call throttled');
  assert.equal(await refreshFeatureFlags(failingThenOk, { storage, force: true, now: () => clock }), true);
  assert.equal(forceCalls, 2, 'forced call bypasses backoff');
});

let dom;
let vite;
let React;
let act;
let createRoot;
let useDocumentVersions;
let DOCUMENT_VERSIONS_CHANGED_EVENT;
let supabase;
let mounted = null;
let originalRpc = null;
let realSetTimeout;
let realClearTimeout;
let realDateNow;

before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    writable: true,
    value: 'visible',
  });
  React = (await import('react')).default;
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const { createServer } = await import('vite');
  const stubSupabase = { rpc: async () => ({ data: [], error: null }) };
  globalThis.__wave14StubSupabase = stubSupabase;
  vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    ssr: { external: ['@survey/shared'] },
    plugins: [{
      name: 'stub-supabase-client',
      enforce: 'pre',
      resolveId(id) {
        if (id.endsWith('/supabaseClient') || id.endsWith('/supabaseClient.js') || id === '../supabaseClient') {
          return '\0virtual:stub-supabase-client';
        }
        return null;
      },
      load(id) {
        if (id === '\0virtual:stub-supabase-client') {
          return 'export const supabase = globalThis.__wave14StubSupabase;';
        }
        return null;
      },
    }],
  });
  ({ useDocumentVersions } = await vite.ssrLoadModule('/src/components/DocumentVersionsButton.jsx'));
  ({ DOCUMENT_VERSIONS_CHANGED_EVENT } = await vite.ssrLoadModule('/src/services/documentVersionService.js'));
  supabase = stubSupabase;
  originalRpc = supabase.rpc;
  realSetTimeout = window.setTimeout.bind(window);
  realClearTimeout = window.clearTimeout.bind(window);
  realDateNow = Date.now;
});

after(async () => {
  if (supabase && originalRpc) supabase.rpc = originalRpc;
  delete globalThis.__wave14StubSupabase;
  await vite?.close();
  dom?.window.close();
});

afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
  window.setTimeout = realSetTimeout;
  window.clearTimeout = realClearTimeout;
  Date.now = realDateNow;
  document.visibilityState = 'visible';
  if (supabase && originalRpc) supabase.rpc = originalRpc;
});

test('#1773: useDocumentVersions deduplicates in-flight calls, pauses when hidden, cools down focus/visibility, and backs off exponentially on errors', async () => {
  if (!supabase) return; // Offline build with null client

  // Controlled fake clock & window timers for deterministic backoff verification.
  let nowMs = 1_000_000;
  Date.now = () => nowMs;
  let nextTimerId = 1;
  const timers = new Map();
  window.setTimeout = (fn, delay) => {
    const id = nextTimerId++;
    timers.set(id, { fn, delay, runAt: nowMs + delay });
    return id;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };
  const flushTimers = async () => {
    const due = [...timers.entries()].filter(([, t]) => t.runAt <= nowMs);
    for (const [id, t] of due) {
      timers.delete(id);
      await act(async () => {
        t.fn();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
  };
  const scheduledDelays = () => [...timers.values()].map((t) => t.delay);

  let rpcCalls = 0;
  let mode = 'hang';
  let releaseHang;
  supabase.rpc = async (name) => {
    assert.equal(name, 'document_versions');
    rpcCalls += 1;
    if (mode === 'hang') {
      await new Promise((resolve) => { releaseHang = resolve; });
      return { data: null, error: { status: 504, message: 'Gateway Timeout' } };
    }
    if (mode === 'fail') {
      return { data: null, error: { status: 503, message: 'PGRST002' } };
    }
    return {
      data: [{ id: 'doc-1', name: 'Plan.pdf', is_current: true, version_number: 1 }],
      error: null,
    };
  };

  function Harness({ docId }) {
    useDocumentVersions(docId, () => {});
    return null;
  }

  const root = createRoot(document.getElementById('root'));
  mounted = root;

  // 1. Mount starts 1 request; focus + visibilitychange while in flight do NOT overlap.
  await act(async () => root.render(React.createElement(Harness, { docId: 'doc-1' })));
  assert.equal(rpcCalls, 1, 'initial load fires once');

  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(rpcCalls, 1, 'in-flight dedupe blocks focus/visibilitychange overlap');

  // 2. First failure schedules 30s backoff (NOT 20s).
  await act(async () => {
    releaseHang();
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.deepEqual(scheduledDelays(), [30_000], '1st error backs off to 30s');

  // Focus/visibility during backoff does NOT bypass the backoff window.
  nowMs += 15_000;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(rpcCalls, 1, 'focus/visibilitychange respects active error backoff');

  // 3. Second failure -> 60s, third -> 120s, fourth -> 240s, fifth -> 300s cap.
  mode = 'fail';
  const expectedBackoffs = [60_000, 120_000, 240_000, 300_000, 300_000];
  let waitMs = 30_000;
  for (const nextExpected of expectedBackoffs) {
    nowMs += waitMs;
    await flushTimers();
    assert.deepEqual(scheduledDelays(), [nextExpected], `backoff progresses to ${nextExpected}ms`);
    waitMs = nextExpected;
  }
  const callsAfterFailures = rpcCalls;

  // 4. Hidden tab skips polling altogether.
  document.visibilityState = 'hidden';
  nowMs += 300_000;
  await flushTimers();
  assert.equal(rpcCalls, callsAfterFailures, 'hidden tab makes zero RPC calls');

  // 5. Online event while visible resets backoff and recovers to 20s happy-path cadence.
  document.visibilityState = 'visible';
  mode = 'ok';
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(rpcCalls, callsAfterFailures + 1, 'online event resets backoff and refreshes');
  assert.deepEqual(scheduledDelays(), [20_000], 'success restores normal 20s recheck interval');

  // 6. Focus + visibilitychange right after a successful check respects 10s cooldown.
  nowMs += 2_000;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(rpcCalls, callsAfterFailures + 1, 'focus/visibility within 10s cooldown does not duplicate');

  // 7. DOCUMENT_VERSIONS_CHANGED_EVENT always refreshes immediately (even inside cooldown).
  await act(async () => {
    window.dispatchEvent(new CustomEvent(DOCUMENT_VERSIONS_CHANGED_EVENT, {
      detail: { oldDocumentId: 'doc-1', newDocumentId: 'doc-2' },
    }));
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(rpcCalls, callsAfterFailures + 2, 'version-change event bypasses cooldown');
});

test('#1773: AuthContext and YDocProvider enforce backoff, dedupe, and visibility/offline guards', () => {
  const authSrc = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(authSrc, /setInterval\(readBootSession,\s*5_000\)/, 'flat 5s auth boot interval removed');
  assert.match(authSrc, /AUTH_BOOT_RETRY_BASE_MS = 5_000/);
  assert.match(authSrc, /AUTH_BOOT_RETRY_MAX_MS = 60_000/);
  assert.match(authSrc, /bootBackoff\.recordFailure\(\)/);
  assert.match(authSrc, /window\.addEventListener\('online', readBootSession\)/);
  assert.match(authSrc, /trigger\?\.type === 'online'/);
  assert.match(authSrc, /isTabVisible\(\) \|\| !isDeviceOnline\(\)/);

  const ydocSrc = readFileSync(new URL('../src/components/collab/YDocProvider.jsx', import.meta.url), 'utf8');
  assert.match(ydocSrc, /roleChecks >= 100/, 'roleInterval bounded');
  assert.match(ydocSrc, /let retryInFlight = false;/, 'drainQueue tick deduplicated');
  assert.match(ydocSrc, /const scheduledRetry = \(\) => \{[\s\S]{0,200}visibilityState === 'hidden'[\s\S]{0,120}navigator\.onLine === false/);
  assert.match(ydocSrc, /const sharedBackoff = createBackoffState\(\{ baseMs: 30_000, maxMs: 300_000 \}\)/);
  assert.match(ydocSrc, /if \(inFlight\) return;/);
  assert.match(ydocSrc, /if \(!options\?\.force && sharedBackoff\.isBlocked\(\)\) return;/);
  assert.match(ydocSrc, /sharedBackoff\.recordFailure\(\)/);
  assert.match(ydocSrc, /sharedBackoff\.recordSuccess\(\)/);
});
