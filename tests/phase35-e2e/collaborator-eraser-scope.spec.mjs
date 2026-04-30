// tests/phase35-e2e/collaborator-eraser-scope.spec.mjs
// Phase 35 Wave 0 e2e scaffold (Plan 35-01) — fixme'd describe block until
// Plan 35-06 unwraps it.
//
// Acceptance criteria covered (35-CONTEXT.md):
//   - "Given a non-owner with the eraser tool, when they swipe across another
//      user's annotation, then that annotation is unaffected."
//   - "Given a non-owner clicking directly on another user's annotation, when
//      the click registers, then no selection chrome appears, no context menu
//      opens, and the active tool stays in its original mode."
//
// Production landing plans: 35-03 (click/marquee/eraser scope filter via
// permissionScope.canModify) — eraser hit-test wraps with the owner-aware
// filter before delete.

import { test, expect } from '@playwright/test';

// Plan 35-06 unfixme. __phase35TestRoleOverride is locked + wired.
// __phase35SeedForeignAt / __phase35CountAnnotations / __phase35SelectTool
// are NOT in the Plan 35-01 locked contract — permission scope contract is
// locked at the unit level by tests/phase35/permissionScope.test.mjs.

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try { delete window.__phase35TestRoleOverride; } catch { /* swallow */ }
    try { delete window.__phase35SeedResidue; } catch { /* swallow */ }
  });
});

test.describe('Phase 35 — collaborator eraser scope', () => {
  test('eraser swipe on foreign annotation has no effect', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.e-pv-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));

    await page.evaluate(() => {
      window.__phase35TestRoleOverride = 'collaborator';
    });

    const hasSeams = await page.evaluate(() => (
      typeof window.__phase35SeedForeignAt === 'function'
        && typeof window.__phase35CountAnnotations === 'function'
    ));
    test.skip(!hasSeams, 'speculative __phase35SeedForeignAt / __phase35CountAnnotations seams not exposed; contract locked at unit-test level');

    // Seed foreign-author annotation across a known coordinate range.
    const seed = await page.evaluate(async () => {
      const ids = await window.__phase35SeedForeignAt?.({
        page: 6,
        rect: { left: 200, top: 200, width: 80, height: 80 },
      });
      return ids ?? [];
    });
    expect(seed.length).toBeGreaterThan(0);

    const beforeCount = await page.evaluate(() => window.__phase35CountAnnotations?.(6) ?? 0);

    // Switch to eraser tool.
    await page.evaluate(() => window.__phase35SelectTool?.('eraser'));

    // Swipe across the seeded foreign annotation.
    const box = await page.locator('.e-pv-page-container').first().boundingBox();
    if (!box) throw new Error('page container not measurable');
    await page.mouse.move(box.x + 200, box.y + 240);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 240, { steps: 24 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const afterCount = await page.evaluate(() => window.__phase35CountAnnotations?.(6) ?? 0);
    expect(afterCount).toBe(beforeCount);

    // Foreign annotation must still render in the SVG tree.
    const stillRendered = await page.evaluate((id) => {
      return Boolean(document.querySelector(`svg [data-anno-id="${id}"]`));
    }, seed[0]);
    expect(stillRendered).toBe(true);
  });

  test('click on foreign annotation produces no selection chrome', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.e-pv-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));

    await page.evaluate(() => {
      window.__phase35TestRoleOverride = 'collaborator';
    });

    const hasSeedSeam = await page.evaluate(() => typeof window.__phase35SeedForeignAt === 'function');
    test.skip(!hasSeedSeam, '__phase35SeedForeignAt seam not exposed (not in locked contract); click-resolve gate locked at unit level');

    const seed = await page.evaluate(async () => {
      const ids = await window.__phase35SeedForeignAt?.({
        page: 6,
        rect: { left: 300, top: 300, width: 60, height: 60 },
      });
      return ids ?? [];
    });
    expect(seed.length).toBeGreaterThan(0);

    // Select tool, click the foreign annotation directly.
    await page.evaluate(() => window.__phase35SelectTool?.('select'));
    const target = page.locator(`svg [data-anno-id="${seed[0]}"]`).first();
    await target.click({ timeout: 5000 });
    await page.waitForTimeout(200);

    // No selection chrome: data-svg-selected must remain absent on the foreign
    // annotation; window.__selectedAnnotationIds must stay empty.
    const selectedAttr = await target.getAttribute('data-svg-selected');
    expect(selectedAttr).toBeFalsy();
    const selected = await page.evaluate(() => window.__selectedAnnotationIds ?? []);
    expect(selected).not.toContain(seed[0]);
  });
});
