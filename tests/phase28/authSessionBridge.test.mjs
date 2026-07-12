// tests/phase28/authSessionBridge.test.mjs
// Phase 28 Wave 0 scaffold — runs as test.skip until Plan 28-02 lands authSessionBridge.js.
// Source: .planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md § Pattern 4 (token refresh).
//
// UX/architecture rationale: Supabase issues short-lived JWTs (~1h). When a token is
// refreshed mid-session, the Realtime channel must NOT close — instead, we call
// `realtime.setAuth(newToken)` so the existing socket continues with the new credentials.
// 28-CONTEXT.md locks the UX: refresh is fully invisible (no banner, no chip, no UI).
// Pitfall 1 defense: never schedule app-level setInterval/setTimeout for refresh — the
// Supabase client owns that timer; an app-level timer drifts and double-fires.
//
// Skip condition: src/lib/collab/authSessionBridge.js has not been created yet
// (Plan 28-02 owns it). Once landed, this scaffold flips automatically from skip → green.

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, throws } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { attachAuthSessionBridge } from '../../src/lib/collab/authSessionBridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TARGET = resolve(REPO_ROOT, 'src/lib/collab/authSessionBridge.js');

// Each test inlines the skip-guard pattern verbatim so the acceptance-criteria
// grep matches every invocation. Pattern lifted from tests/phase27/schemaPresence.test.mjs.

// Build a fake Supabase client that records every realtime.setAuth call and lets
// the test fire synthetic onAuthStateChange events on demand. node:test has no
// vitest-style spies, so we use plain arrays as call-recorders.
function buildFakeSupabase() {
  const setAuthCalls = [];
  const unsubscribeCalls = [];
  let registeredCallback = null;
  return {
    setAuthCalls,
    unsubscribeCalls,
    fire(event, session) {
      if (registeredCallback) registeredCallback(event, session);
    },
    auth: {
      onAuthStateChange: (cb) => {
        registeredCallback = cb;
        return {
          data: {
            subscription: {
              unsubscribe: () => unsubscribeCalls.push(true),
            },
          },
        };
      },
    },
    realtime: {
      setAuth: (token) => setAuthCalls.push(token),
    },
  };
}

test(
  'authSessionBridge: TOKEN_REFRESHED with valid session calls realtime.setAuth(token) exactly once',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/authSessionBridge.js not yet present (Plan 28-02)' : false },
  async () => {
    const supabase = buildFakeSupabase();
    const { detach } = attachAuthSessionBridge({ supabase, onSignedOut: () => {} });
    supabase.fire('TOKEN_REFRESHED', { access_token: 'new-jwt-abc123' });
    strictEqual(supabase.setAuthCalls.length, 1, 'realtime.setAuth must be called exactly once on TOKEN_REFRESHED');
    strictEqual(supabase.setAuthCalls[0], 'new-jwt-abc123', 'token passed to setAuth must match session.access_token');
    detach();
  }
);

test(
  'authSessionBridge: SIGNED_OUT event calls onSignedOut callback exactly once',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/authSessionBridge.js not yet present (Plan 28-02)' : false },
  async () => {
    const supabase = buildFakeSupabase();
    const signedOutCalls = [];
    const { detach } = attachAuthSessionBridge({
      supabase,
      onSignedOut: () => signedOutCalls.push(true),
    });
    supabase.fire('SIGNED_OUT', null);
    strictEqual(signedOutCalls.length, 1, 'onSignedOut must be called exactly once on SIGNED_OUT');
    detach();
  }
);

test(
  'authSessionBridge: INITIAL_SESSION and SIGNED_IN do NOT call realtime.setAuth',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/authSessionBridge.js not yet present (Plan 28-02)' : false },
  async () => {
    const supabase = buildFakeSupabase();
    const { detach } = attachAuthSessionBridge({ supabase, onSignedOut: () => {} });
    supabase.fire('INITIAL_SESSION', { access_token: 'initial-jwt' });
    supabase.fire('SIGNED_IN', { access_token: 'signin-jwt' });
    strictEqual(
      supabase.setAuthCalls.length,
      0,
      'only TOKEN_REFRESHED triggers realtime.setAuth — initial/signin tokens are already on the channel'
    );
    detach();
  }
);

test(
  'authSessionBridge: returned { detach } unsubscribes the auth listener',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/authSessionBridge.js not yet present (Plan 28-02)' : false },
  async () => {
    const supabase = buildFakeSupabase();
    const { detach } = attachAuthSessionBridge({ supabase, onSignedOut: () => {} });
    strictEqual(supabase.unsubscribeCalls.length, 0, 'pre-detach: unsubscribe must not have been called');
    detach();
    strictEqual(supabase.unsubscribeCalls.length, 1, 'detach must call subscription.unsubscribe exactly once');
  }
);

test(
  'authSessionBridge: rejects missing auth/realtime hooks; detach swallows unsubscribe errors',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/authSessionBridge.js not yet present (Plan 28-02)' : false },
  () => {
    throws(() => attachAuthSessionBridge({}), /onAuthStateChange unavailable/);
    throws(
      () => attachAuthSessionBridge({ supabase: { auth: { onAuthStateChange() {} } } }),
      /setAuth method unavailable/,
    );

    const supabase = buildFakeSupabase();
    supabase.auth.onAuthStateChange = (cb) => {
      supabase.fire = (event, session) => cb(event, session);
      return {
        data: {
          subscription: {
            unsubscribe: () => { throw new Error('unsubscribe boom'); },
          },
        },
      };
    };
    const { detach } = attachAuthSessionBridge({ supabase });
    detach(); // must not throw
  },
);

test(
  'authSessionBridge: does NOT install any app-level setInterval/setTimeout for refresh (Pitfall 1)',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/authSessionBridge.js not yet present (Plan 28-02)' : false },
  async () => {
    const supabase = buildFakeSupabase();
    const intervalCalls = [];
    const timeoutCalls = [];
    const savedSetInterval = globalThis.setInterval;
    const savedSetTimeout = globalThis.setTimeout;
    // Replace the global timers with counter stubs so we can detect any app-level scheduling.
    // We restore them in finally so subsequent tests are unaffected.
    globalThis.setInterval = (...args) => {
      intervalCalls.push(args);
      return 0;
    };
    globalThis.setTimeout = (...args) => {
      timeoutCalls.push(args);
      return 0;
    };
    try {
      const { detach } = attachAuthSessionBridge({ supabase, onSignedOut: () => {} });
      detach();
    } finally {
      globalThis.setInterval = savedSetInterval;
      globalThis.setTimeout = savedSetTimeout;
    }
    deepStrictEqual(
      intervalCalls,
      [],
      'authSessionBridge must NOT schedule any setInterval (Supabase client owns the refresh timer — Pitfall 1)'
    );
    deepStrictEqual(
      timeoutCalls,
      [],
      'authSessionBridge must NOT schedule any setTimeout for refresh — Supabase client owns the timer'
    );
  }
);
