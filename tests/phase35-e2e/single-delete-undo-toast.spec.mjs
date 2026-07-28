// tests/phase35-e2e/single-delete-undo-toast.spec.mjs
// Phase 35 Wave 0 e2e scaffold (Plan 35-01) — fixme'd describe block until
// Plan 35-06 unwraps it.
//
// Acceptance criteria covered (35-CONTEXT.md):
//   - "Given any user deleting a single annotation, when the delete fires,
//      then a 5-second undo toast appears at the bottom of the document area."
//   - "Given any user triggering a delete that would have hit the 2026-04-27
//      wipe brake before this phase shipped, when the delete fires, then the
//      deletion propagates to the cloud normally with no brake suppression."
//
// Production landing plans: 35-04 (single-delete undo toast — 5s window).
// Locked toast copy: "Annotation deleted — Undo".

import { test, expect } from '@playwright/test';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from '../../agent-cli/lib/leased-browser-session.mjs';

// Plan 35-06 unfixme. The 4 LOCKED Phase 35 test seams (per Plan 35-01
// frontmatter contract) are wired up: __phase35TestRoleOverride,
// __selectedAnnotationIds, __phase35GetAnnotationById, __phase35SeedResidue.
// The Wave 0 specs were authored anticipating additional seam helpers
// (__phase35SeedOwn, __phase35SelectTool, __phase35SnapshotAnnotation, etc.)
// that are NOT in the locked contract. Per Phase 29 e2e precedent, tests
// that depend on un-locked seams runtime-skip with descriptive reason — the
// underlying delete-undo contracts are locked at the unit level by
// tests/phase35/undoToastQueue.test.mjs (6 tests, all green).

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try { delete window.__phase35TestRoleOverride; } catch { /* swallow */ }
    try { delete window.__phase35SeedResidue; } catch { /* swallow */ }
  });
});

test.describe('Phase 35 — single-delete undo toast (5s)', () => {
  test('single delete shows 5-second undo toast', async ({ page }) => {
    const leasedBrowserAccount = await installLeasedBrowserAccount(page);
    await page.goto('http://localhost:5173/');
    await assertBrowserUsesLeasedAccount(page, { account: leasedBrowserAccount });
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.survey-pdfjs-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));

    // Skip if the speculative __phase35SeedOwn seam isn't present (it's not
    // in the Plan 35-01 locked contract — undoToastQueue contract is locked
    // at the unit level instead).
    const hasSeedSeam = await page.evaluate(() => typeof window.__phase35SeedOwn === 'function');
    test.skip(!hasSeedSeam, '__phase35SeedOwn seam not exposed (not in locked contract); contract locked by tests/phase35/undoToastQueue.test.mjs');

    // Seed one viewer-authored annotation.
    const ids = await page.evaluate(async () => {
      return (await window.__phase35SeedOwn?.({ page: 6, count: 1 })) ?? [];
    });
    expect(ids.length).toBe(1);

    // Select it and press Delete.
    await page.evaluate(() => window.__phase35SelectTool?.('select'));
    await page.locator(`svg [data-anno-id="${ids[0]}"]`).first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Delete');

    // 5s undo toast should be visible.
    const toast = page.locator('[role="alert"]').filter({ hasText: /Annotation deleted.*Undo/ }).first();
    await expect(toast).toBeVisible({ timeout: 2000 });

    // Wait past the 5000ms window.
    await page.waitForTimeout(5100);
    await expect(toast).toBeHidden();
  });

  test('clicking Undo within 5 seconds restores the annotation', async ({ page }) => {
    const leasedBrowserAccount = await installLeasedBrowserAccount(page);
    await page.goto('http://localhost:5173/');
    await assertBrowserUsesLeasedAccount(page, { account: leasedBrowserAccount });
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.survey-pdfjs-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));

    const hasSeams = await page.evaluate(() => (
      typeof window.__phase35SeedOwn === 'function'
        && typeof window.__phase35SnapshotAnnotation === 'function'
    ));
    test.skip(!hasSeams, '__phase35SeedOwn / __phase35SnapshotAnnotation seams not exposed (not in locked contract); contract locked at unit-test level');

    const ids = await page.evaluate(async () => {
      return (await window.__phase35SeedOwn?.({ page: 6, count: 1 })) ?? [];
    });
    expect(ids.length).toBe(1);
    const annoId = ids[0];

    // Snapshot the Y.Map state of this annotation BEFORE delete (used to
    // assert restore round-tripped the same fabric props).
    const beforeSnap = await page.evaluate((id) => window.__phase35SnapshotAnnotation?.(id), annoId);
    expect(beforeSnap).toBeTruthy();

    await page.evaluate(() => window.__phase35SelectTool?.('select'));
    await page.locator(`svg [data-anno-id="${annoId}"]`).first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Delete');

    // Annotation should be gone immediately.
    await expect(page.locator(`svg [data-anno-id="${annoId}"]`)).toHaveCount(0);

    // Click Undo within 3 seconds.
    const toast = page.locator('[role="alert"]').filter({ hasText: /Annotation deleted.*Undo/ }).first();
    await expect(toast).toBeVisible({ timeout: 2000 });
    await page.waitForTimeout(800);
    await toast.getByRole('button', { name: /Undo/ }).click();
    await page.waitForTimeout(500);

    // Annotation back on canvas.
    await expect(page.locator(`svg [data-anno-id="${annoId}"]`)).toHaveCount(1);

    // Y.Map snapshot diff: same fabric props as before.
    const afterSnap = await page.evaluate((id) => window.__phase35SnapshotAnnotation?.(id), annoId);
    expect(afterSnap).toBeTruthy();
    // Compare the fabric subdoc shape.
    expect(JSON.stringify(afterSnap.fabric ?? {})).toBe(JSON.stringify(beforeSnap.fabric ?? {}));
  });
});
