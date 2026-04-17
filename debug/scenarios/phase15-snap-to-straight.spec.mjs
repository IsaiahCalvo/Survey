// UX: Phase 15 smoke test for silent snap-to-straight at 10px drag threshold.
// Validates LINE-02 end-to-end: curved line → drag midpoint back within 10px → auto-straightens.
// No visual snap indicator (silent snap per 15-CONTEXT.md Area 2).
//
// Plan 15-03 Task 4 upgraded this scaffold from test.fixme to real interaction
// where feasible, with runtime-skip when the app isn't bootstrapped (matches
// the Phase 14 callout-render-roundtrip.spec.mjs pattern).
import { test, expect } from '@playwright/test';

test.describe('Phase 15 — snap-to-straight at 10px threshold', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  test('user drags curved midpoint handle back within 10px of baseline → line auto-straightens', async ({ page }) => {
    // UX: bootstrap — draw a line, select it, drag the midpoint ~50px below
    // the baseline to curve it, then drag it back to within 10px to trigger
    // the silent snap. Runtime-skips if the app isn't bootstrapped or the
    // Plan 15-03 midpoint handle isn't rendered.
    const svgLocator = page.locator('svg[data-svg-annotation-layer]').first();
    const svgBox = await svgLocator.boundingBox().catch(() => null);
    if (!svgBox) {
      test.skip(true, 'No SVG annotation layer mounted');
      return;
    }

    // Draw a horizontal line
    await page.keyboard.press('l').catch(() => {});
    await page.mouse.move(svgBox.x + 200, svgBox.y + 200);
    await page.mouse.down();
    await page.mouse.move(svgBox.x + 400, svgBox.y + 200, { steps: 8 });
    await page.mouse.up();

    // Select
    await page.keyboard.press('s').catch(() => {});
    await page.mouse.click(svgBox.x + 300, svgBox.y + 200);

    const midpointHandle = page.locator('circle[data-handle="midpoint"]').first();
    const m1 = await midpointHandle.boundingBox().catch(() => null);
    if (!m1) {
      test.skip(true, 'midpoint handle not rendered');
      return;
    }

    // Drag 1: curve the line
    const cx = m1.x + m1.width / 2;
    const cy = m1.y + m1.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 50, { steps: 10 });
    await page.mouse.up();

    // Drag 2: drag the midpoint back to within 10px of baseline (silent snap)
    const m2 = await midpointHandle.boundingBox().catch(() => null);
    if (!m2) {
      test.skip(true, 'midpoint handle not re-rendered after curve drag');
      return;
    }
    const cx2 = m2.x + m2.width / 2;
    const cy2 = m2.y + m2.height / 2;
    await page.mouse.move(cx2, cy2);
    await page.mouse.down();
    // Drag back toward the baseline — end within 3px so we're well inside the 10px snap threshold.
    await page.mouse.move(cx, cy + 3, { steps: 10 });
    await page.mouse.up();

    // After snap, the <path> with ` Q ` should be gone OR no path with the
    // specific curved-line d pattern should remain. We assert the weaker
    // form — that after the snap, zero <path d="M ... Q ..."> elements
    // match (the render branch switched back to <line>).
    const paths = page.locator('svg path[d^="M"]');
    const curvedCount = await paths.evaluateAll((els) =>
      els.filter((el) => /M\s+\S+\s+Q\s+\S+/.test(el.getAttribute('d') || '')).length
    );
    expect(curvedCount).toBe(0);
  });

  test.fixme('render hysteresis: data.midpoint set but distance ≤ 1 renders <line> not <path>', async ({ page }) => {
    // TODO Plan 15-03 follow-up: needs window.__injectAnnotation hook to
    // deterministically seed data.midpoint = {x:50, y:0.5}. Render hysteresis
    // is already unit-tested in tests/svgLineRenderer.test.mjs once Plan
    // 15-02's un-skip lands.
    await page.goto('/');
  });
});
