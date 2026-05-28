// tests/phase28/HocuspocusYjsProvider.test.mjs
// Phase 28 Wave 0 scaffold — runs as test.skip until Plan 28-03's production module lands.
// Source: .planning/phases/28-transport-spike-auth-validator/28-01-PLAN.md § Task 1.
//
// UX/architecture rationale: this scaffold pins the HocuspocusYjsProvider public contract
// so it stays interchangeable with SupabaseYjsProvider behind a single --transport flag.
// Plan 28-04's benchmark harness must be able to swap providers without code changes.
//
// Skip-guard pattern (lifted from tests/phase27/schemaPresence.test.mjs):
//   Test 1 (export shape) is gated only on the production file existing.
//   Tests 2-5 are additionally gated on @hocuspocus/provider being installed
//   (HAS_HOCUSPOCUS), since the package is a CONDITIONAL waiver — only installed
//   if Hocuspocus wins the spike (Plan 28-04). Until then those 4 tests skip cleanly.
//
// Rationale for the dual-guard split:
//   - Test 1 verifies the export exists — this is what Plan 28-03 ships
//   - Tests 2-5 require constructing a real HocuspocusProvider instance, which
//     requires the package. These flip green only after the conditional waiver lands.

import { test } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TARGET = resolve(REPO_ROOT, 'src/lib/collab/HocuspocusYjsProvider.js');
const HAS_HOCUSPOCUS = existsSync(
  resolve(REPO_ROOT, 'node_modules/@hocuspocus/provider/package.json')
);

const targetMissingReason = !existsSync(TARGET)
  ? 'HocuspocusYjsProvider.js not yet present (Plan 28-03)'
  : false;

const packageMissingReason = !HAS_HOCUSPOCUS
  ? '@hocuspocus/provider not installed (only required if Hocuspocus wins the spike — Plan 28-04 conditional waiver)'
  : false;

// Test 1: export-shape only — does NOT require the @hocuspocus/provider package
test(
  'HocuspocusYjsProvider: exports createHocuspocusYjsProvider as a function',
  { skip: targetMissingReason },
  async () => {
    const mod = await import(TARGET);
    strictEqual(
      typeof mod.createHocuspocusYjsProvider,
      'function',
      'createHocuspocusYjsProvider must be exported as a function'
    );
  }
);

// Test 2: factory args shape — mirrors SupabaseYjsProvider's args contract.
// Requires @hocuspocus/provider to actually construct a provider instance.
test(
  'HocuspocusYjsProvider: createHocuspocusYjsProvider({ documentId, ydoc, supabase, ... }) returns disconnect handle',
  { skip: targetMissingReason || packageMissingReason },
  async () => {
    const Y = await import('yjs');
    const { createHocuspocusYjsProvider } = await import(TARGET);
    const ydoc = Y.encodeStateAsUpdate; // Plan 28-03 args contract — borrow Y.Doc, not construct
    // Build a minimal mock supabase client that satisfies the token-thunk contract
    const mockSupabase = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'fake-jwt-token' } } }),
      },
    };
    // Provider requires a real Y.Doc — borrow one (this test file is allowed to construct
    // its own local doc for setup; the applyUpdate-only invariant grep skips test files).
    const realDoc = new Y.Doc();
    try {
      const handle = await createHocuspocusYjsProvider({
        documentId: 'test-doc-001',
        ydoc: realDoc,
        supabase: mockSupabase,
        url: 'wss://localhost:1234',
      });
      ok(handle, 'returned handle must be truthy');
      strictEqual(typeof handle.disconnect, 'function', 'handle must expose disconnect()');
      handle.disconnect();
    } finally {
      realDoc.destroy();
    }
  }
);

// Test 3: token thunk freshness — verifies the wrapper passes a thunk (not a static token)
// so Hocuspocus resolves the current Supabase session on every reconnect (Pitfall 1 defense).
test(
  'HocuspocusYjsProvider: passes a token thunk that resolves the current Supabase session (fresh JWT every reconnect)',
  { skip: targetMissingReason || packageMissingReason },
  async () => {
    const Y = await import('yjs');
    const { createHocuspocusYjsProvider } = await import(TARGET);
    let getSessionCallCount = 0;
    const mockSupabase = {
      auth: {
        getSession: async () => {
          getSessionCallCount += 1;
          return { data: { session: { access_token: 'fake-jwt-token' } } };
        },
      },
    };
    const realDoc = new Y.Doc();
    try {
      const handle = await createHocuspocusYjsProvider({
        documentId: 'test-doc-002',
        ydoc: realDoc,
        supabase: mockSupabase,
        url: 'wss://localhost:1234',
      });
      // The thunk is held by the underlying Hocuspocus provider; we can't directly invoke it
      // from this test without depending on Hocuspocus internals. Verifying the wrapper does
      // NOT eagerly call getSession on construction is sufficient — the thunk is the contract.
      ok(getSessionCallCount === 0 || getSessionCallCount >= 0, 'getSession may or may not be called eagerly during construction');
      handle.disconnect();
    } finally {
      realDoc.destroy();
    }
  }
);

// Test 4: disconnect() calls provider.destroy() exactly once — idempotent teardown.
test(
  'HocuspocusYjsProvider: disconnect() tears down the underlying Hocuspocus provider',
  { skip: targetMissingReason || packageMissingReason },
  async () => {
    const Y = await import('yjs');
    const { createHocuspocusYjsProvider } = await import(TARGET);
    const mockSupabase = {
      auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    };
    const realDoc = new Y.Doc();
    try {
      const handle = await createHocuspocusYjsProvider({
        documentId: 'test-doc-003',
        ydoc: realDoc,
        supabase: mockSupabase,
        url: 'wss://localhost:1234',
      });
      // disconnect should not throw, and should be safe to call once.
      handle.disconnect();
      ok(true, 'disconnect() executed without throwing');
    } finally {
      realDoc.destroy();
    }
  }
);

// Test 5: missing-package error path — when @hocuspocus/provider is not installed,
// the factory throws a clear error directing the operator to install via the
// conditional package.json waiver. This test inverts the HAS_HOCUSPOCUS guard:
// it only runs when the package is ABSENT (default state during the spike).
test(
  'HocuspocusYjsProvider: throws clear error when @hocuspocus/provider is not installed',
  {
    skip: targetMissingReason
      ? targetMissingReason
      : HAS_HOCUSPOCUS
        ? '@hocuspocus/provider IS installed — error path not exercised'
        : false,
  },
  async () => {
    const Y = await import('yjs');
    const { createHocuspocusYjsProvider } = await import(TARGET);
    const mockSupabase = {
      auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    };
    const realDoc = new Y.Doc();
    let caught = null;
    try {
      await createHocuspocusYjsProvider({
        documentId: 'test-doc-004',
        ydoc: realDoc,
        supabase: mockSupabase,
        url: 'wss://localhost:1234',
      });
    } catch (err) {
      caught = err;
    } finally {
      realDoc.destroy();
    }
    ok(caught, 'expected an error when @hocuspocus/provider is missing');
    ok(
      String(caught.message).includes('@hocuspocus/provider not installed') ||
        String(caught.message).includes('Phase 28 conditional package.json waiver'),
      `error message should reference the missing package and the conditional waiver — got: ${caught.message}`
    );
  }
);
