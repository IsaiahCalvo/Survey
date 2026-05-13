// tests/phase31/legacyBulkUpsertGate.test.mjs
// Phase 31 Wave 0 scaffold (Plan 31-01) — runs as test.skip until Plans 31-02 / 31-03 land
// the LEGACY_BULK_UPSERT_ENABLED feature flag and the gated call site.
//
// Superseded 2026-05-10 by the annotation source-of-truth contract:
// Supabase is durable storage for reload/cross-device and Y.Doc is the fast
// live collaboration cache. The old Phase 31 "CRDT-only" gate is retained only
// as a diagnostic/rollback flag; normal saves must still call
// upsertAnnotationsByPage so Supabase remains durable.
//
// The kill switch is the entire mechanism that lets the CRDT path become the sole
// authoritative writer. Without this contract locked, an executor could "satisfy"
// Plan 31-03 by adding the gate but leaving an ungated call site, and the bulk
// path would still fire on every save.
//
// Skip-guard pattern: per-test existsSync (Phase 27/28/29/30 precedent). The flag
// module gates the dynamic-import tests. The readFileSync grep tests gate on the
// flag's presence too — once Plan 31-02 has shipped featureFlags.js, the
// hook/service grep tests auto-flip skip→run and stay RED until Plan 31-03
// gates the upsertAnnotationsByPage call site. Same red→green pattern Phase 30
// used (the test ships RED, the executor of the next plan greens it).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FEATURE_FLAGS_PATH = path.resolve(__dirname, '../../src/lib/collab/featureFlags.js');
const HOOK_PATH = path.resolve(__dirname, '../../src/hooks/useAnnotationCloudSync.js');
const SERVICE_PATH = path.resolve(__dirname, '../../src/services/annotationCloudSync.js');

// FLAG_SKIP: gates the dynamic-import tests (the flag module itself).
// HOOK_SKIP: gates the grep tests on the hook. The hook FILE exists today, but
//   the gate it asserts (isLegacyBulkUpsertEnabled wrapping the call) cannot
//   be added until featureFlags.js ships (Plan 31-02). So we skip the grep
//   tests on the flag's presence — they auto-flip skip→run when Plan 31-02
//   lands, and Plan 31-03 must then satisfy the gate-grep contract.
// SERVICE_SKIP: same logic — gate on the flag's presence so the service-side
//   log-line invariant test only runs once Plan 31-02 has shipped.
const FLAG_SKIP = !existsSync(FEATURE_FLAGS_PATH)
  ? 'src/lib/collab/featureFlags.js not yet present (Plan 31-02)'
  : false;
const HOOK_SKIP = !existsSync(FEATURE_FLAGS_PATH) || !existsSync(HOOK_PATH)
  ? 'gate cannot land until Plan 31-02 ships featureFlags.js (then Plan 31-03 gates the hook)'
  : false;
const SERVICE_SKIP = !existsSync(FEATURE_FLAGS_PATH) || !existsSync(SERVICE_PATH)
  ? 'gate cannot land until Plan 31-02 ships featureFlags.js (Plan 31-03 preserves the service)'
  : false;

// Scoped window/localStorage mock helper (lifted from tests/phase28/deviceId.test.mjs).
// Restores previous globals AFTER fn() fully resolves (await is required because
// fn() may be async).
async function withMockWindow(mockWindow, fn) {
  const savedWindow = globalThis.window;
  const savedLocalStorage = globalThis.localStorage;
  globalThis.window = mockWindow;
  globalThis.localStorage = mockWindow?.localStorage;
  try {
    return await fn();
  } finally {
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
    if (savedLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedLocalStorage;
  }
}

function buildLocalStorageMock(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
  };
}

describe('LEGACY_BULK_UPSERT_ENABLED feature flag (Plan 31-02)', () => {
  it('exports isLegacyBulkUpsertEnabled reader function', { skip: FLAG_SKIP }, async () => {
    const mod = await import(FEATURE_FLAGS_PATH);
    assert.equal(
      typeof mod.isLegacyBulkUpsertEnabled,
      'function',
      'featureFlags.js must export isLegacyBulkUpsertEnabled() reader',
    );
  });

  it('defaults to false (kill switch off)', { skip: FLAG_SKIP }, async () => {
    const mod = await import(FEATURE_FLAGS_PATH);
    const fakeWindow = { localStorage: buildLocalStorageMock() };
    await withMockWindow(fakeWindow, async () => {
      const result = mod.isLegacyBulkUpsertEnabled();
      assert.equal(result, false, 'kill switch must default to false (legacy path off)');
    });
  });

  it('returns true when localStorage key pdf_app_legacy_bulk_upsert is "true"', { skip: FLAG_SKIP }, async () => {
    const mod = await import(FEATURE_FLAGS_PATH);
    const ls = buildLocalStorageMock({ pdf_app_legacy_bulk_upsert: 'true' });
    const fakeWindow = { localStorage: ls };
    await withMockWindow(fakeWindow, async () => {
      const result = mod.isLegacyBulkUpsertEnabled();
      assert.equal(result, true, 'localStorage override must re-enable the legacy path (emergency rollback)');
    });
  });
});

describe('useAnnotationCloudSync legacy bypass (Plan 31-03)', () => {
  it('hook source keeps Supabase durable writes outside the legacy flag gate', { skip: HOOK_SKIP }, () => {
    const source = readFileSync(HOOK_PATH, 'utf8');
    const callCount = (source.match(/upsertAnnotationsByPage\(/g) || []).length;
    assert.ok(
      callCount > 0,
      'Supabase durable path must still call upsertAnnotationsByPage',
    );
    assert.match(source, /route: 'supabase-durable-then-crdt'/);
    assert.match(source, /Supabase is the durable\s+source/s);
  });

  it('cutover hydrate explicitly selects Supabase durable snapshot before marking ready', { skip: HOOK_SKIP }, () => {
    const source = readFileSync(HOOK_PATH, 'utf8');
    assert.match(source, /contextLabel: 'cutover-source-of-truth'/);
    assert.match(source, /source: 'supabase-durable-snapshot'/);
    assert.match(source, /Y\.Doc is reshaped for live collaboration/);
  });

  it('callout save path persists Supabase before Y.Doc fan-out', { skip: HOOK_SKIP }, () => {
    const source = readFileSync(HOOK_PATH, 'utf8');
    const start = source.indexOf("console.log('[CloudSync][hook] callout Supabase upsert start");
    const upsert = source.indexOf('result = await upsertCallouts', start);
    const success = source.indexOf("console.log('[CloudSync][hook] callout Supabase upsert ok", upsert);
    const fanout = source.indexOf("console.log('[CloudSync][hook] callout Y.Doc fan-out start after Supabase success", success);
    const fanoutCall = source.indexOf('await fanOutCrdtForCallouts', fanout);

    assert.ok(start > 0, 'callout Supabase upsert start log must exist');
    assert.ok(upsert > start, 'callout upsertCallouts must run after Supabase start log');
    assert.ok(success > upsert, 'callout Supabase success log must run after upsertCallouts');
    assert.ok(fanout > success, 'callout Y.Doc fan-out start must run after Supabase success');
    assert.ok(fanoutCall > fanout, 'callout Y.Doc fan-out call must run after the post-Supabase fan-out log');
    assert.match(source, /callout Supabase push failed → queued before Y\.Doc fan-out/);
    assert.match(source, /callout Y\.Doc fan-out failed after Supabase success → queued repair/);
  });
});

describe('annotationCloudSync.js log-line invariant (Plan 31-03)', () => {
  it('legacy log line "[CloudSync][push] upsertAnnotationsByPage start" still exists in service (legacy code preserved for rollback)', { skip: SERVICE_SKIP }, () => {
    const source = readFileSync(SERVICE_PATH, 'utf8');
    // The Plan 31-03 gate lives in the HOOK (the caller). The SERVICE function
    // body stays — including the log line — so flipping the kill switch back
    // on (localStorage emergency rollback) re-engages the bulk path verbatim.
    // This guards against a well-meaning executor deleting the legacy
    // implementation while the kill switch is the only operational rollback.
    assert.ok(
      source.includes('[CloudSync][push] upsertAnnotationsByPage start'),
      'service must preserve the legacy log line so the rollback path stays intact',
    );
  });
});
