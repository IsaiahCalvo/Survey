/**
 * tests/phase30/phase30-edit-during-backfill.spec.mjs
 *
 * Phase 30 Wave 0 e2e scaffold (Plan 30-01) — test.fixme'd until production
 * test seams ship in Plan 30-02 (backfill module + slowdown seam) and Plan
 * 30-06 (provider mount + ydocAnnotationCount seam).
 *
 * Covers AC-2 (edit-during-backfill silent path) from 30-CONTEXT.md:
 *   "the user can draw, drag, and edit normally while it [backfill] runs"
 *   AND
 *   "Per-annotation idempotency (keyed by client_anno_id) handles the brief
 *    race window."
 *
 * REQUIRES SEAMS:
 *   - window.__crdtBackfillDelayMs (Plan 30-02) — number, slow backfill for race window
 *   - window.__ydocAnnotationCount (Plan 30-06) — number, count of annotations in Y.Map
 *
 * Pattern: Phase 29 fixme'd e2e scaffold pattern.
 */

import { test, expect } from '@playwright/test';

test.fixme(
  'phase30-edit-during-backfill: new edit during backfill window — both backfilled + new annos land in Y.Map without collision',
  async ({ page }) => {
    // Slow backfill so the race window is observable. Plan 30-02 wires
    // window.__crdtBackfillDelayMs; per-row delay (or single-shot pre-loop
    // delay) buys ~2s for the test to draw an annotation during the import.
    await page.addInitScript(() => { window.__crdtBackfillDelayMs = 2000; });

    await page.goto('http://localhost:5173/');
    await page.waitForSelector('[data-testid="pdf-viewer-ready"]', { timeout: 5000 });

    // OPEN PDF — first v2.4 open of a doc with v2.3 annotations.
    // Backfill kicks off and runs slowly (2s delay).

    // DRAW a new annotation DURING the backfill window. Per-annotation
    // idempotency (client_anno_id keyed) means the new draw and the
    // backfilled rows do not collide — both land in Y.Map.
    // (Specific pen-tool click sequence lands when seam is live.)

    // Wait for backfill to complete.
    await page.waitForFunction(() => window.__crdtBackfillDone === true, { timeout: 15_000 });

    // Verify Y.Map has BOTH backfilled annotations AND the new one.
    // (Pre-condition: 3 v2.3 annotations on page 6; new draw adds 1 → expect >= 4.)
    const ydocCount = await page.evaluate(() => window.__ydocAnnotationCount);
    expect(ydocCount).toBeGreaterThanOrEqual(4);
  },
);
