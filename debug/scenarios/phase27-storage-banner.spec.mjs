// debug/scenarios/phase27-storage-banner.spec.mjs
// Phase 27 Wave 0 scaffold — runs as test.fixme until production code lands.
// Source: .planning/phases/27-crdt-foundation/27-UI-SPEC.md + 27-RESEARCH.md.
//
// Covers the storage-failure UX contract from 27-CONTEXT.md:
//   - The document still opens (never block).
//   - A visible banner appears at the top explaining what's broken,
//     what's at risk, and how to fix it.
//   - Annotations continue syncing to the cloud only until local storage
//     is restored.
//   - Anti-pattern explicitly rejected: silent fallback.
//
// This scenario stubs indexedDB.open to throw QuotaExceededError, then asserts
// (a) the banner mounts within 1s with the quota_exceeded copy from
// 27-UI-SPEC.md ("Local saving is offline" + "Your browser's storage is full"),
// and (b) the PDF viewer still renders. Plan 27-05 builds the
// StorageFailureBanner component that flips this from fixme to runnable.

import { test, expect } from '@playwright/test';

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173/';
const TEST_PDF = 'Package 2 - Rev 4 -- IC.pdf';

test.describe('Phase 27 — Storage failure banner UX', () => {
  test.fixme(true, 'StorageFailureBanner not yet built (Plan 27-05)');

  test('IDB unavailable → banner mounts, document still opens', async ({ page }) => {
    // Stub indexedDB.open to throw QuotaExceededError before page navigation.
    // addInitScript runs before any page script so the detector sees the
    // failure on first IndexeddbPersistence init attempt.
    await page.addInitScript(() => {
      const originalOpen = window.indexedDB.open;
      window.indexedDB.open = function () {
        const req = originalOpen.apply(window.indexedDB, arguments);
        setTimeout(() => {
          const evt = new Event('error');
          Object.defineProperty(req, 'error', { value: { name: 'QuotaExceededError' } });
          req.onerror?.(evt);
        }, 50);
        return req;
      };
    });

    await page.goto(DEV_URL);
    await page.evaluate((p) => window.__test_openPdf?.(p), TEST_PDF);

    // Banner should appear within 1s with the quota_exceeded copy
    await expect(
      page.locator('[role="alert"]', { hasText: 'Local saving is offline' })
    ).toBeVisible({ timeout: 1000 });
    await expect(page.locator('[role="alert"]')).toContainText("Your browser's storage is full");

    // PDF still rendered (document didn't block)
    await expect(page.locator('[data-testid="pdf-viewer"]')).toBeVisible();
  });
});
