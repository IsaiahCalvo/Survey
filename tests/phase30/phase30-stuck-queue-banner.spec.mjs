/**
 * tests/phase30/phase30-stuck-queue-banner.spec.mjs
 *
 * Phase 30 Wave 0 e2e scaffold (Plan 30-01) — test.fixme'd until production
 * test seams ship in Plan 30-04 (dual-write fan-out + failure injection seam)
 * and Plan 30-05 (StorageFailureBanner sync_queue_stuck variant).
 *
 * Covers AC-8 + AC-9 from 30-CONTEXT.md:
 *   "Given a v2.4 user creates an annotation, when the legacy write succeeds
 *    but the CRDT write fails (or vice versa), then the annotation is still
 *    visible locally with no error UI, the failed-side write enters a silent
 *    retry queue, and the queue continues retrying until success."
 *
 *   "Given the silent retry queue is still stuck after roughly 30 seconds,
 *    when the threshold is crossed, then a banner appears at the top of the
 *    document matching the existing storage-failure banner shape (sticky,
 *    role=alert, locked CSS variables, 2 type weights), reading approximately
 *    'Some changes haven't saved yet — try refreshing or check your connection.'"
 *
 * REQUIRES SEAMS:
 *   - window.__crdtForceLegacyFail (Plan 30-04) — boolean test-only failure injection
 *   - StorageFailureBanner with code='sync_queue_stuck' rendered (Plan 30-05)
 *
 * Pattern: Phase 29 fixme'd e2e scaffold pattern.
 */

import { test, expect } from '@playwright/test';

test.fixme(
  "phase30-stuck-queue-banner: forced legacy write fail + 30s wait → banner 'Some changes haven't saved yet'",
  async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForSelector('[data-testid="pdf-viewer-ready"]', { timeout: 5000 });

    // INJECT FAILURE — test seam set on window before any draws happen.
    // Plan 30-04 wires window.__crdtForceLegacyFail; when truthy, every legacy
    // upsert in dualWriteFabricCommit throws (so the entry enqueues to the
    // retry queue with side: 'legacy' and never drains).
    await page.evaluate(() => { window.__crdtForceLegacyFail = true; });

    // DRAW an annotation — picks up failure on the legacy side, queues for retry.
    // The exact pen-tool steps land when Plan 30-04 wires the test seam
    // (the click sequence is documented in CLAUDE.md test setup notes).

    // Wait > 30s for the stuck-queue threshold to fire (CONTEXT.md AC-9).
    // We give it a buffer (35s) to account for poll-interval misalignment.
    await page.waitForTimeout(35_000);

    // Banner asserts: heading + role=alert + 'Retry now' action.
    await expect(
      page.locator("[role=\"alert\"]:has-text(\"Some changes haven't saved yet\")")
    ).toBeVisible({ timeout: 5_000 });

    // Action link 'Retry now' present.
    await expect(
      page.locator('[role="alert"] button:has-text("Retry now"), [role="alert"] a:has-text("Retry now")')
    ).toBeVisible();

    // User can still draw new annotations during banner — editing stays unblocked
    // per CONTEXT.md "Editing stays fully unblocked." Draws here go into the
    // same queue and ride along.
    // (Specific draw flow lands when Plan 30-04 seam is live.)
  },
);
