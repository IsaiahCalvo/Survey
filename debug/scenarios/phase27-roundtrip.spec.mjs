// debug/scenarios/phase27-roundtrip.spec.mjs
// Phase 27 Wave 0 scaffold — STILL test.fixme, but for an accurate reason now
// (KAL-257, 2026-06-10). The original reason ("YDocProvider not yet mounted at
// the App document-open boundary") is STALE: YDocProvider has been mounted
// per-tab in AppShell.jsx since Phase 27/28 landed. What actually blocks this
// spec today:
//   1. The dev server this Playwright config boots points at the PRODUCTION
//      Supabase project — a real-UI draw test would write production rows,
//      which automated runs must never do.
//   2. The no-cloud route (?testPdf=) bypasses Supabase AND auth, and ink/pen
//      hydration still reads the flat document_annotations table (the durable
//      Y.Doc is the hydration source for survey highlights only, until KAL-270
//      inverts write ordering) — so a testPdf rewrite would assert local
//      persistence, not the SC1 Y.Doc round-trip this spec exists to pin.
//   3. The window.__test_openPdf / __test_goToPage seams it referenced were
//      never built (dead steps removed from this file).
// Unblock path: boot the app against the survey-test cloud project (schema via
// scripts/bootstrap-test-db.mjs) with a seeded user + document, then drive the
// real Dashboard UI here with zero production risk.
// The cloud roundtrip contract is meanwhile covered by
// agent-cli/roundtrip-save-reopen.mjs (KAL-255) — production-backed, run only
// with Isaiah's say-so, never in overnight automation.
//
// Covers SC1: single-user Y.Doc round-trip. Open PDF → annotate → reload →
// state restored. The contract: a pen-stroke created before reload MUST still
// be visible after reload.

import { test, expect } from '@playwright/test';

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173/';

test.describe('Phase 27 — Single-user Y.Doc round-trip (SC1)', () => {
  test.fixme(true, 'Needs a survey-test-backed app environment: the dev server points at production Supabase, and ink hydration is flat-table until KAL-270 — see file header (KAL-257).');

  test('open PDF → create annotation → reload → annotation restored', async ({ page }) => {
    // STEP 1: navigate to dev server (auto-login via .env.development.local)
    await page.goto(DEV_URL);
    await expect(page.locator('[data-testid="pdf-viewer"]')).toBeVisible({ timeout: 10000 });

    // STEP 2: open the test document via the real Dashboard UI (survey-test env)
    // STEP 3: create a pen-stroke annotation with the real pen tool
    // STEP 4: reload page
    await page.reload();
    // STEP 5: assert the annotation is still visible after reload
    await expect(page.locator('[data-annotation-id]').first()).toBeVisible({ timeout: 5000 });
  });
});
