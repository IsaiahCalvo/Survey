// tests/phase31/legacyBulkUpsertGate.test.mjs
// Phase 31 Wave 0 scaffold (Plan 31-01) — runs as test.skip until Plans 31-02 / 31-03 land
// the LEGACY_BULK_UPSERT_ENABLED feature flag and the gated call site.
//
// Defends Phase 31 lean-variant Acceptance Criterion #5 — "the legacy bulk-upsert
// kill switch is off, when the user performs any annotation save, then zero calls
// fire to upsertAnnotationsByPage AND the [CloudSync][push] log line is absent."
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
  it('hook source gates upsertAnnotationsByPage call behind LEGACY_BULK_UPSERT_ENABLED', { skip: HOOK_SKIP }, () => {
    const source = readFileSync(HOOK_PATH, 'utf8');
    // Two-part assertion:
    //   1. The flag reader is referenced (import or call). Either name shape is
    //      accepted so Plan 31-03 can choose the import surface.
    //   2. Every upsertAnnotationsByPage call site is INSIDE an `if` gated on
    //      isLegacyBulkUpsertEnabled. The 0..400 char fence accommodates
    //      reasonable ergonomic refactors (logging, early-returns) between the
    //      gate and the call.
    const callCount = (source.match(/upsertAnnotationsByPage\(/g) || []).length;
    if (callCount === 0) {
      // Acceptable: Plan 31-03 deleted the call entirely.
      assert.ok(true, 'no upsertAnnotationsByPage call sites remain — kill switch satisfied by deletion');
      return;
    }
    // Otherwise every call site must be gated. Use a single-pattern regex that
    // requires `isLegacyBulkUpsertEnabled` to appear before the call within
    // 400 chars (inside the same `if` block ergonomically).
    const gatedPattern = /isLegacyBulkUpsertEnabled\b[\s\S]{0,400}?upsertAnnotationsByPage\(/g;
    const gatedMatches = (source.match(gatedPattern) || []).length;
    assert.ok(
      gatedMatches >= callCount,
      `expected every upsertAnnotationsByPage call (${callCount}) to be gated behind isLegacyBulkUpsertEnabled within 400 chars, found only ${gatedMatches} gated`,
    );
  });

  it('default-off path produces zero upsertAnnotationsByPage calls (grep contract)', { skip: HOOK_SKIP }, () => {
    const source = readFileSync(HOOK_PATH, 'utf8');
    // The contract is satisfied by EITHER:
    //   - zero remaining call sites, OR
    //   - every call site preceded within 400 chars by isLegacyBulkUpsertEnabled.
    // Same logic as the previous test, repeated here as an explicit zero/gated
    // contract so the executor of Plan 31-03 has TWO grep targets pointing at
    // the same invariant.
    const calls = source.match(/upsertAnnotationsByPage\(/g) || [];
    if (calls.length === 0) {
      assert.ok(true, 'zero upsertAnnotationsByPage calls (kill switch satisfied by deletion)');
      return;
    }
    const gated = source.match(/isLegacyBulkUpsertEnabled\b[\s\S]{0,400}?upsertAnnotationsByPage\(/g) || [];
    assert.equal(
      gated.length,
      calls.length,
      `kill-switch contract: every upsertAnnotationsByPage call must be gated. ${calls.length} total calls, ${gated.length} gated.`,
    );
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
