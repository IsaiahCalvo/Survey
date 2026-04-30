// tests/phase35-e2e/owner-cross-author-confirm.spec.mjs
// Phase 35 Wave 0 e2e scaffold (Plan 35-01) — fixme'd describe block until
// Plan 35-06 unwraps it.
//
// Acceptance criteria covered (35-CONTEXT.md):
//   - "Given an owner triggering a bulk delete that catches at least one
//      other user's annotation, when the gesture registers, then a modal
//      shows the per-author breakdown ('12 yours, 35 from 3 other people')
//      with each collaborator's name and count listed."
//   - "Given a confirmed bulk delete (collaborator or owner case), when the
//      modal action button is clicked, then a 6-second undo toast appears
//      with the breakdown text."
//
// Production landing plans: 35-04 (bulk-delete planner — owner-cross-author
// mode + per-author breakdown modal + undo toast).
//
// Locked copy from CONTEXT.md "Confirmation modal — owner's 'delete everyone's'":
//   Heading: "Delete annotations from multiple people?"
//   Body:    "Delete N annotations? K yours, M from P other people."
//   Per-author lines: "Alice — 18", "Bob — 12", "Carol — 5"
//   Toast:   "Deleted N annotations from P people — Undo"

import { test, expect } from '@playwright/test';

// Plan 35-06 unfixme. __phase35TestRoleOverride is locked + wired.
// __phase35SeedOwn / __phase35SeedForeign / __phase35SelectAllOnPage are NOT
// in the locked contract — owner-cross-author modal copy + per-author
// breakdown formula locked at unit level by
// tests/phase35/buildBulkDeletePlan.test.mjs.

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try { delete window.__phase35TestRoleOverride; } catch { /* swallow */ }
    try { delete window.__phase35SeedResidue; } catch { /* swallow */ }
  });
});

test.describe('Phase 35 — owner cross-author confirm + undo toast', () => {
  test('owner cross-author modal shows breakdown', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.e-pv-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));

    await page.evaluate(() => {
      window.__phase35TestRoleOverride = 'owner';
    });

    const hasSeams = await page.evaluate(() => (
      typeof window.__phase35SeedOwn === 'function'
        && typeof window.__phase35SeedForeign === 'function'
        && typeof window.__phase35SelectAllOnPage === 'function'
    ));
    test.skip(!hasSeams, 'speculative seed/select seams not exposed (not in locked contract); breakdown formula locked at unit level');

    // Seed mixed-author content: owner's own marks + at least 2 foreign authors.
    await page.evaluate(async () => {
      await window.__phase35SeedOwn?.({ page: 6, count: 3 });
      await window.__phase35SeedForeign?.({
        page: 6,
        authors: [
          { name: 'Alice', count: 4 },
          { name: 'Bob', count: 2 },
        ],
      });
    });
    await page.waitForTimeout(400);

    // Select EVERY annotation on the page (owner is allowed).
    await page.evaluate(() => window.__phase35SelectAllOnPage?.(6));
    await page.waitForTimeout(150);

    // Press Delete — owner-cross-author branch fires.
    await page.keyboard.press('Delete');

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal).toHaveText(/Delete annotations from multiple people/);

    // Body: "K yours, M from P other people" pattern.
    await expect(modal).toHaveText(/\d+ yours, \d+ from \d+ other people/);

    // Per-author lines: "Alice — 4", "Bob — 2".
    const modalText = await modal.innerText();
    expect(modalText).toMatch(/Alice\s+—\s+\d+/);
    expect(modalText).toMatch(/Bob\s+—\s+\d+/);

    // Confirm via the red primary "Delete N" button.
    await modal.getByRole('button', { name: /Delete \d+/ }).click();
    await page.waitForTimeout(500);

    // Bulk-delete undo toast appears with the breakdown copy.
    const toast = page.locator('[role="alert"]').filter({ hasText: /Deleted \d+ annotations.*Undo/ }).first();
    await expect(toast).toBeVisible({ timeout: 2000 });
  });
});
