// debug/scenarios/phase27-roundtrip.spec.mjs
// Phase 27 Wave 0 scaffold — runs as test.fixme until production code lands.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Validation Architecture.
//
// Covers SC1: single-user Y.Doc round-trip. Open PDF → annotate → reload →
// state restored. Once Plan 27-05 mounts <YDocProvider docId> at the
// document-open boundary in App.jsx and y-indexeddb is wired, this scenario
// flips from fixme to runnable. The contract: a pen-stroke created before
// reload MUST still be visible after reload (state hydrates from IndexedDB).

import { test, expect } from '@playwright/test';

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173/';
const TEST_PDF = 'Package 2 - Rev 4 -- IC.pdf';

test.describe('Phase 27 — Single-user Y.Doc round-trip (SC1)', () => {
  test.fixme(true, 'YDocProvider not yet mounted at App.jsx document-open boundary (Plan 27-05)');

  test('open PDF → create annotation → reload → annotation restored from IndexedDB', async ({ page }) => {
    // STEP 1: navigate to dev server (auto-login via .env.development.local)
    await page.goto(DEV_URL);
    await expect(page.locator('[data-testid="pdf-viewer"]')).toBeVisible({ timeout: 10000 });

    // STEP 2: open Package 2 - Rev 4 -- IC.pdf and go to page 6
    // (planner stub — Plan 27-05 fills in the open-doc helper)
    await page.evaluate((pdfName) => window.__test_openPdf?.(pdfName), TEST_PDF);
    await page.evaluate(() => window.__test_goToPage?.(6));

    // STEP 3: create pen-stroke annotation (planner stub — uses existing pen tool)
    // STEP 4: reload page
    await page.reload();
    // STEP 5: assert annotation still visible
    await expect(page.locator('[data-annotation-id]').first()).toBeVisible({ timeout: 5000 });
  });
});
