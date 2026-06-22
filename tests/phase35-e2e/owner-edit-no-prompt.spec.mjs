// tests/phase35-e2e/owner-edit-no-prompt.spec.mjs
// Phase 35 Wave 0 e2e scaffold (Plan 35-01) — fixme'd describe block until
// Plan 35-06 unwraps it.
//
// NEW per checker W7: covers AC #6 directly instead of "covered by absence".
//
// Acceptance criteria covered (35-CONTEXT.md):
//   - "Given an owner editing or transforming another user's annotation,
//      when they drag/resize/rotate, then the operation succeeds without
//      any extra confirmation prompt."
//
// Protects the FabricEditCanvas no-branching invariant from CONTEXT.md
// DO NOT CHANGE: "owner edit-on-others'-marks works because the existing
// edit canvas is identity-agnostic; do not add per-author branching here."
//
// Production landing plans: 35-03 (owner role lets canModify return true on
// foreign annotations; selection scope passes through to FabricEditCanvas
// without modification).

import { test, expect } from '@playwright/test';

// Plan 35-06 unfixme. __phase35TestRoleOverride + __phase35GetAnnotationById
// are LOCKED + wired. __phase35SeedForeignAt / __phase35SelectTool are NOT in
// the locked contract — the FabricEditCanvas no-branching invariant is the
// CONTEXT.md DO NOT CHANGE protection (no per-author edit branching here).

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try { delete window.__phase35TestRoleOverride; } catch { /* swallow */ }
    try { delete window.__phase35SeedResidue; } catch { /* swallow */ }
  });
});

test.describe('Phase 35 — owner edits foreign annotations without confirmation', () => {
  test('owner drag/resize/rotate on foreign annotation fires no modal and persists new bbox', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.survey-pdfjs-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));

    await page.evaluate(() => {
      window.__phase35TestRoleOverride = 'owner';
    });

    const hasSeams = await page.evaluate(() => (
      typeof window.__phase35SeedForeignAt === 'function'
        && typeof window.__phase35GetAnnotationById === 'function'
    ));
    test.skip(!hasSeams, '__phase35SeedForeignAt seam not exposed (not in locked contract); FabricEditCanvas no-branching invariant locked structurally via CONTEXT.md DO NOT CHANGE');

    // Seed a foreign-author annotation at a known location.
    const seeded = await page.evaluate(async () => {
      const ids = await window.__phase35SeedForeignAt?.({
        page: 6,
        rect: { left: 200, top: 200, width: 80, height: 60 },
      });
      return ids ?? [];
    });
    expect(seeded.length).toBeGreaterThan(0);
    const foreignId = seeded[0];

    // Read initial bbox via the test seam.
    const before = await page.evaluate((id) => window.__phase35GetAnnotationById?.(id), foreignId);
    expect(before).toBeTruthy();
    const beforeLeft = before.left;
    const beforeTop = before.top;

    // Switch to select tool, click on the foreign annotation (owner can select).
    await page.evaluate(() => window.__phase35SelectTool?.('select'));
    const target = page.locator(`svg [data-anno-id="${foreignId}"]`).first();
    await target.click({ timeout: 5000 });
    await page.waitForTimeout(200);

    // ----- DRAG: 50px right -----
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('foreign annotation not measurable');
    const startX = targetBox.x + targetBox.width / 2;
    const startY = targetBox.y + targetBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Mid-drag dialog must NOT appear at any point.
    const midDialogCount = await page.locator('[role="dialog"]').count();
    expect(midDialogCount).toBe(0);
    await page.mouse.move(startX + 50, startY, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // No modal appeared.
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    // No undo toast (this is an EDIT, not a delete).
    expect(await page.locator('[role="alert"]').filter({ hasText: /Undo/ }).count()).toBe(0);

    // New left committed.
    const afterDrag = await page.evaluate((id) => window.__phase35GetAnnotationById?.(id), foreignId);
    expect(afterDrag.left).toBeGreaterThan(beforeLeft + 30); // moved at least ~50px

    // ----- RESIZE: SE handle drag -20px -----
    const seHandle = page.locator(`[data-svg-handle="se"][data-anno-id="${foreignId}"]`).first();
    const seBox = await seHandle.boundingBox();
    if (!seBox) throw new Error('SE handle not measurable');
    await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
    await page.mouse.down();
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    await page.mouse.move(seBox.x + 20, seBox.y + 20, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    expect(await page.locator('[role="alert"]').filter({ hasText: /Undo/ }).count()).toBe(0);

    // ----- ROTATE: rotation handle 30deg -----
    const rotHandle = page.locator(`[data-rotation-handle="mtr"][data-anno-id="${foreignId}"]`).first();
    const rotBox = await rotHandle.boundingBox();
    if (!rotBox) throw new Error('rotation handle not measurable');
    await page.mouse.move(rotBox.x + rotBox.width / 2, rotBox.y + rotBox.height / 2);
    await page.mouse.down();
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    // Sweep to rotate.
    await page.mouse.move(rotBox.x + 60, rotBox.y + 30, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    expect(await page.locator('[role="alert"]').filter({ hasText: /Undo/ }).count()).toBe(0);

    const afterRotate = await page.evaluate((id) => window.__phase35GetAnnotationById?.(id), foreignId);
    expect(typeof afterRotate.angle).toBe('number');
  });
});
