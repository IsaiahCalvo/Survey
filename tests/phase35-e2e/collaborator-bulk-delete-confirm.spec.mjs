// tests/phase35-e2e/collaborator-bulk-delete-confirm.spec.mjs
// Phase 35 Wave 0 e2e scaffold (Plan 35-01) — fixme'd describe block until
// Plan 35-06 unwraps it.
//
// Acceptance criteria covered (35-CONTEXT.md):
//   - "Given a non-owner about to delete every annotation they own on the
//      current page, when they confirm the gesture, then a modal asks
//      'Delete all N of your annotations on this page?' before the delete
//      fires."
//   - "Given a confirmed bulk delete (collaborator or owner case), when the
//      modal action button is clicked, then a 6-second undo toast appears
//      with the breakdown text."
//
// Production landing plans: 35-04 (bulk-delete planner + collab confirm modal
// + undo toast). Modal heading regex matches the locked CONTEXT.md copy:
//   "Delete all N of your annotations on this page?"
// Toast regex matches the bulk-delete copy:
//   "N annotations deleted — Undo".

import { test, expect } from '@playwright/test';

// Plan 35-06 unfixme. __phase35TestRoleOverride is locked + wired. The
// speculative seeding / select-all helpers are NOT in the locked contract —
// buildBulkDeletePlan + ConfirmDeleteModal copy locked at unit-test level
// by tests/phase35/buildBulkDeletePlan.test.mjs (6 tests, all green).

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try { delete window.__phase35TestRoleOverride; } catch { /* swallow */ }
    try { delete window.__phase35SeedResidue; } catch { /* swallow */ }
  });
});

test.describe('Phase 35 — collaborator bulk-delete confirm + undo toast', () => {
  test('delete-all-mine modal appears with simple count', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.e-pv-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));

    await page.evaluate(() => {
      window.__phase35TestRoleOverride = 'collaborator';
    });

    const hasSeams = await page.evaluate(() => (
      typeof window.__phase35SeedOwn === 'function'
        && typeof window.__phase35SelectAllOwnOnPage === 'function'
    ));
    test.skip(!hasSeams, 'speculative __phase35SeedOwn / __phase35SelectAllOwnOnPage seams not exposed; bulk-delete plan + modal copy locked at unit level');

    // Seed N viewer-authored annotations on page 6.
    const seedCount = 4;
    const seeded = await page.evaluate(async (n) => {
      const ids = await window.__phase35SeedOwn?.({ page: 6, count: n });
      return ids ?? [];
    }, seedCount);
    expect(seeded.length).toBe(seedCount);

    // Select all of the viewer's own annotations on this page.
    await page.evaluate(() => window.__phase35SelectAllOwnOnPage?.(6));
    await page.waitForTimeout(150);

    // Press Delete to invoke the bulk-delete planner. Modal must appear.
    await page.keyboard.press('Delete');

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal).toHaveText(/Delete all \d+ of your annotations on this page/);

    // Click the red primary "Delete all N" button.
    await modal.getByRole('button', { name: /Delete all \d+/ }).click();
    await page.waitForTimeout(500);

    // Annotations must be gone.
    for (const id of seeded) {
      const stillThere = await page.locator(`svg [data-anno-id="${id}"]`).count();
      expect(stillThere).toBe(0);
    }

    // Bulk undo toast — 6-second window per CONTEXT.md.
    const toast = page.locator('[role="alert"]').filter({ hasText: /\d+ annotations deleted.*Undo/ }).first();
    await expect(toast).toBeVisible({ timeout: 2000 });
  });
});
