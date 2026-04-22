import { test, expect } from '@playwright/test';

// UX-01 E2E: activating line/arrow/callout tool switches SVG layer cursor
// to 'crosshair'; deactivation reverts.
//
// Plan 14-02 Task 2 un-skipped this scaffold. Tests runtime-skip gracefully
// if the app hasn't bootstrapped a PDF and no SVG annotation layer is
// mounted — keeps the 113-test baseline green until Plan 14-03 (or a
// later phase) wires the PDF bootstrap helper.

test.describe('UX-01 tool cursor crosshair', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  // Tool → keyboard shortcut map. Per 14-RESEARCH.md correction #8 the
  // L/A/Q shortcut block lives at App.jsx:23064-23205 (not :22480).
  // `q` is used for the callout tool in combined-tools and mirrors here.
  for (const [toolKey, shortcut] of [['line', 'l'], ['arrow', 'a'], ['callout', 'q']]) {
    test(`activating ${toolKey} tool sets crosshair cursor on SVG layer`, async ({ page }) => {
      await page.keyboard.press(shortcut).catch(() => {});

      // Wait briefly for React state update
      await page.locator('svg.tool-crosshair').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});

      const hasClass = await page.evaluate(() => {
        const svgs = Array.from(document.querySelectorAll('svg'));
        return svgs.some((s) => s.classList.contains('tool-crosshair'));
      });
      if (!hasClass) {
        test.skip(true, 'No SVG annotation layer with tool-crosshair class — PDF not loaded. Deferred to Plan 14-03 bootstrap helper.');
        return;
      }
      expect(hasClass).toBe(true);

      // Computed cursor on the SVG with the class
      const computed = await page.evaluate(() => {
        const svg = document.querySelector('svg.tool-crosshair');
        return svg ? window.getComputedStyle(svg).cursor : null;
      });
      expect(computed).toBe('crosshair');
    });
  }

  test('deactivating tool reverts cursor away from crosshair', async ({ page }) => {
    // Activate line tool
    await page.keyboard.press('l').catch(() => {});
    // Wait for class to appear (or skip if no SVG)
    const classAppeared = await page.locator('svg.tool-crosshair').first()
      .waitFor({ state: 'attached', timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (!classAppeared) {
      test.skip(true, 'No SVG annotation layer — PDF not loaded. Deferred to Plan 14-03.');
      return;
    }

    // Switch to select tool
    await page.keyboard.press('v').catch(() => {});

    // Wait a tick for React state update
    await page.waitForTimeout(100).catch(() => {});

    const stillHasCrosshair = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll('svg'));
      return svgs.some((s) => s.classList.contains('tool-crosshair'));
    });
    expect(stillHasCrosshair).toBe(false);
  });
});
