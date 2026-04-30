// tests/phase35-e2e/collaborator-marquee-scope.spec.mjs
// Phase 35 Wave 0 e2e scaffold (Plan 35-01) — landed inside a fixme'd
// describe block, so every test inside is skipped with a fixme reason until
// Plan 35-06 unwraps it. Production seams referenced below
// (window.__phase35TestRoleOverride, window.__selectedAnnotationIds) are
// wired by Plan 35-03 / 35-04 / 35-05; Plan 35-06 then runs this spec for
// real against the assembled feature.
//
// Acceptance criteria covered (35-CONTEXT.md):
//   - "Given a non-owner viewing a document with their own annotations and
//      another user's annotations, when they drag the marquee tool across
//      both, then only their own annotations enter the selection."
//
// Production landing plan: 35-03 (per-user click/marquee scope filter).
// This spec stays test.fixme until Plan 35-06 un-fixmes it during the green
// integration sweep.

import { test, expect } from '@playwright/test';

test.describe.fixme('Phase 35 — collaborator marquee scope', () => {
  test('marquee across mixed-author content selects only own annotations', async ({ page }) => {
    // Open the test document on page 6.
    await page.goto('http://localhost:5173/');
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.e-pv-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));

    // Force collaborator role (test seam landed in Plan 35-06).
    await page.evaluate(() => {
      window.__phase35TestRoleOverride = 'collaborator';
    });

    // Seed mixed-author content: at least one viewer-authored annotation and
    // at least one foreign-author annotation. Plan 35-06's harness exposes
    // window.__phase35SeedMixedAuthor() to inject the foreign mark via Y.Doc
    // bridge using a different authorId than the viewer.
    await page.evaluate(async () => {
      await window.__phase35SeedMixedAuthor?.({
        ownCount: 2,
        foreignCount: 2,
        page: 6,
      });
    });
    await page.waitForTimeout(500);

    // Switch to marquee/select tool.
    await page.evaluate(() => window.__phase35SelectTool?.('select'));

    // Drag marquee across the seeded region (covers both own and foreign marks).
    const box = await page.locator('.e-pv-page-container').first().boundingBox();
    if (!box) throw new Error('page container not measurable');
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 400, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Read the mirror: window.__selectedAnnotationIds is a string[] mirror
    // updated whenever useSVGInteraction's selectedIds changes (per
    // 35-01-PLAN.md frontmatter contract).
    const selectedIds = await page.evaluate(() => window.__selectedAnnotationIds ?? []);
    expect(Array.isArray(selectedIds)).toBe(true);
    expect(selectedIds.length).toBeGreaterThan(0);

    // None of the selected ids may belong to a foreign author. The harness
    // exposes a read seam to introspect annotation authorship.
    const foreignSelected = await page.evaluate((ids) => {
      const viewerId = window.__phase35GetViewerId?.();
      const allAnnos = window.__phase35GetAllAnnotations?.() ?? [];
      const byId = new Map(allAnnos.map((a) => [a.id, a]));
      return ids.filter((id) => {
        const anno = byId.get(id);
        if (!anno) return false;
        return (anno.authorId ?? anno?.data?.authorId) !== viewerId;
      });
    }, selectedIds);
    expect(foreignSelected).toEqual([]);
  });
});
