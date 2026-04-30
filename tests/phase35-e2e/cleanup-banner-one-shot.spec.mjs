// tests/phase35-e2e/cleanup-banner-one-shot.spec.mjs
// Phase 35 Wave 0 e2e scaffold (Plan 35-01) — fixme'd describe block until
// Plan 35-06 unwraps it.
//
// Acceptance criteria covered (35-CONTEXT.md):
//   - "Given an owner opening a document for the first time after this phase
//      ships AND that document has annotations the wipe brake suppressed in
//      earlier sessions, when the document loads, then a one-shot cleanup
//      banner appears with 'Review' and 'Clean up' actions; dismiss is
//      sticky per document."
//   - Negative: "The banner only appears for the document owner. Collaborators
//      don't see it — they don't have authority to act on residue from other
//      users."
//
// Production landing plans: 35-05 (auditResidue helper + StorageFailureBanner
// new code = 'sync_residue_cleanup' + sticky-per-document dismissal).
//
// Test seam: window.__phase35SeedResidue (boolean | string[]) — true tells
// the audit useEffect to auto-pick the first 3 viewer-authored cloud
// annotations as residueCandidateIds. Array form locks an explicit set.

import { test, expect } from '@playwright/test';

test.describe.fixme('Phase 35 — cleanup-residue banner one-shot per document', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__phase35SeedResidue = true;
    });
  });

  test('owner sees cleanup banner exactly once per document', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
      window.__phase35TestRoleOverride = 'owner';
    });

    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.e-pv-page-container', { timeout: 20000 });

    // Banner must surface with the new sync_residue_cleanup code.
    const banner = page
      .locator('[role="alert"]')
      .filter({ hasText: /sync_residue_cleanup|leftover from an earlier sync issue/i })
      .first();
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner.getByRole('button', { name: /Review/i })).toBeVisible();
    await expect(banner.getByRole('button', { name: /Clean up/i })).toBeVisible();

    // Dismiss.
    await banner.getByRole('button', { name: /Dismiss|×|✕/i }).first().click();
    await expect(banner).toBeHidden({ timeout: 2000 });

    // Reload — banner must NOT reappear (sticky-per-document dismissal).
    await page.reload();
    await page.waitForSelector('.e-pv-page-container', { timeout: 20000 });
    await page.waitForTimeout(2000);
    await expect(
      page
        .locator('[role="alert"]')
        .filter({ hasText: /sync_residue_cleanup|leftover from an earlier sync issue/i })
        .first(),
    ).toBeHidden();
  });

  test('collaborator never sees the cleanup banner even with seeded residue', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
      window.__phase35TestRoleOverride = 'collaborator';
    });

    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.e-pv-page-container', { timeout: 20000 });
    await page.waitForTimeout(2000);

    await expect(
      page
        .locator('[role="alert"]')
        .filter({ hasText: /sync_residue_cleanup|leftover from an earlier sync issue/i })
        .first(),
    ).toBeHidden();
  });
});
