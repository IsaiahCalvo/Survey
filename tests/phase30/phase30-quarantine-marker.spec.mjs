/**
 * tests/phase30/phase30-quarantine-marker.spec.mjs
 *
 * Phase 30 Wave 0 e2e scaffold (Plan 30-01) — test.fixme'd until production
 * test seams ship in Plan 30-04 (per-annotation failure injection seam) and
 * Plan 30-05 (QuarantineMarkerOverlay component + marker rendering hook).
 *
 * Covers AC-12 from 30-CONTEXT.md:
 *   "Given a specific annotation cannot sync after roughly 10 retry attempts,
 *    when the quarantine threshold is reached, then that annotation gets an
 *    inline marker reading 'didn't save, please try redrawing', retries stop
 *    for that annotation only, and the rest of the queue continues processing
 *    other items."
 *
 * REQUIRES SEAMS:
 *   - window.__crdtForceFailAnnoId (Plan 30-04) — string, forces 100% failure for one annoId
 *   - QuarantineMarkerOverlay component rendered next to annotations (Plan 30-05)
 *
 * Pattern: Phase 29 fixme'd e2e scaffold pattern.
 */

import { test, expect } from '@playwright/test';

test.fixme(
  "phase30-quarantine-marker: 10 retry failures on one annoId → inline marker 'didn't save, please try redrawing'",
  async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForSelector('[data-testid="pdf-viewer-ready"]', { timeout: 5000 });

    // INJECT per-annotation failure. Plan 30-04 wires window.__crdtForceFailAnnoId;
    // when set to an annoId string, every retry attempt for that annoId throws.
    // We set it AFTER drawing so the annoId is known.
    // (Specific draw + read-back-id flow lands when Plan 30-04 seam is live.)
    const FAIL_ANNO_ID = 'phase30-quarantine-test-anno-id';
    await page.evaluate((id) => { window.__crdtForceFailAnnoId = id; }, FAIL_ANNO_ID);

    // Wait long enough for the queue to drain ~10 attempts. Backoff curve:
    // [1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, 30s, 30s] — total ~3.5 min worst case.
    // For the test we wait the bound; the marker rendering should appear once
    // the entry's attempts === QUARANTINE_THRESHOLD (10).
    await page.waitForTimeout(60_000);

    // Inline marker copy (CONTEXT.md "Specific Ideas" — exact user-refined wording).
    await expect(
      page.locator(`:text("didn't save, please try redrawing")`)
    ).toBeVisible({ timeout: 10_000 });

    // Other annotations continue draining (queue stays moving — Pitfall 30-5
    // mitigation). We assert the queue size is not unbounded; for the e2e
    // surface, just confirm at least one other annotation was successfully
    // synced AFTER the quarantine event (test seam reads queue length post-drain).
    // (Specific assertion lands when Plan 30-05 surfaces the queue-size signal.)
  },
);
