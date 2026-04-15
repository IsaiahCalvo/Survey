import { test, expect } from '@playwright/test';

// UX-01 E2E: activating line/arrow/callout tool switches SVG layer cursor
// to 'crosshair'; deactivation reverts.
// Status: SCAFFOLD — Plan 14-02 ships the crosshair class wiring.

test.describe('UX-01 tool cursor crosshair', () => {
  test.skip(true, 'Wave 0 scaffold — implementation pending Plan 14-02');

  for (const tool of ['line', 'arrow', 'callout']) {
    test(`activating ${tool} tool sets crosshair cursor on SVG layer`, async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      // TODO 14-02: click tool picker for `tool`, then read computed cursor
      // style on the SVGAnnotationLayer root via page.evaluate(() => {
      //   const svg = document.querySelector('[data-svg-annotation-layer]');
      //   return window.getComputedStyle(svg).cursor;
      // })
      // expect(cursor).toBe('crosshair');
      expect(true).toBe(true);
    });
  }

  test('deactivating tool reverts cursor to default', async ({ page }) => {
    await page.goto('/');
    // TODO 14-02: activate line tool, assert crosshair, press V, assert default
    expect(true).toBe(true);
  });
});
