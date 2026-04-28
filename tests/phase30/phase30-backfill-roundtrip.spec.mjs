/**
 * tests/phase30/phase30-backfill-roundtrip.spec.mjs
 *
 * Phase 30 Wave 0 e2e scaffold (Plan 30-01) — test.fixme'd until production
 * test seams ship in Plan 30-02 (backfill module) and Plan 30-06 (provider
 * mount + seam exposure).
 *
 * Covers AC-2 + AC-3 from 30-CONTEXT.md:
 *   "Given a document contains pre-existing v2.3 annotations, when a v2.4
 *    user opens the document for the first time, then the page renders
 *    immediately with the existing annotations visible, the backfill from
 *    legacy → CRDT runs silently in the background with no banner / spinner
 *    / completion toast, and the user can draw, drag, and edit normally."
 *
 *   "Given the per-document backfill has run once on a v2.4 client, when
 *    the same backfill is run again (re-open, second collaborator's first
 *    open, or test-driven re-run), then zero duplicate annotations are
 *    created and no existing CRDT data is overwritten — verified in Playwright."
 *
 * REQUIRES SEAMS:
 *   - window.__crdtBackfillDone (Plan 30-06) — boolean, set true after backfill resolves
 *   - window.__ydocAnnotationCount (Plan 30-06) — number, count of annotations in Y.Map
 *
 * Pattern: tests/phase29-e2e/two-clients-same-anno.spec.mjs (Phase 29 fixme'd
 * scaffold pattern). Bodies document the full e2e flow inline — bodies are the
 * contract; runtime-skip happens via missing test seams once Plan 30-06 lands.
 */

import { test, expect } from '@playwright/test';

test.fixme(
  'phase30-backfill-roundtrip: v2.3 doc opens silently on v2.4 + persists via Y.Doc on reload',
  async ({ page }) => {
    // Pre-condition: PDF "Package 2 - Rev 4 -- IC.pdf" loaded with at least 3 v2.3
    // annotations on page 6 (per memory/architecture_annotation_system.md test setup).
    await page.goto('http://localhost:5173/');

    // Auth: dev server auto-login per memory/feedback_dev_auto_login.md.
    // .env.development.local drives the auto sign-in so no manual login step.
    await page.waitForSelector('[data-testid="pdf-viewer-ready"]', { timeout: 5000 });

    // OPEN PDF — first v2.4 open of a doc with v2.3 annotations.
    // Specific selectors land when the dashboard tile interaction is wired
    // (Plan 30-06 owns the document-tile / first-open hook). For now, the test
    // body documents the contract; the seam check below short-circuits.

    // BANNER ASSERTION — silent migration: NO banner should appear during backfill.
    await expect(page.locator('[role="alert"]:has-text("Migrating")')).toHaveCount(0);
    await expect(page.locator('[role="alert"]:has-text("moving your work")')).toHaveCount(0);

    // Wait for backfill to settle via test seam window.__crdtBackfillDone.
    await page.waitForFunction(() => window.__crdtBackfillDone === true, { timeout: 10_000 });

    // RELOAD — annotations should now come from Y.Doc, not the legacy column.
    await page.reload();
    await page.waitForSelector('[data-testid="pdf-viewer-ready"]', { timeout: 5000 });

    // After reload, annotations visible from Y.Doc (test seam window.__ydocAnnotationCount > 0).
    const ydocCount = await page.evaluate(() => window.__ydocAnnotationCount);
    expect(ydocCount).toBeGreaterThan(0);
  },
);
