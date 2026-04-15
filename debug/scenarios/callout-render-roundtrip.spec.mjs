import { test, expect } from '@playwright/test';

// CALL-10 E2E: legacy callouts load + render through unified SVG path;
// save→reload→save produces byte-identical Fabric.js JSON fields.
// Status: SCAFFOLD — Plan 14-03 wires up the unified render path and
// verifies this end-to-end. For Wave 0, this test asserts only that
// the app boots and the selectors this test WILL use later are reachable.

test.describe('CALL-10 callout render roundtrip', () => {
  test.skip(true, 'Wave 0 scaffold — implementation pending Plan 14-03');

  test('unified renderCallout outputs data-callout-id on every rendered callout', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // TODO 14-03: open Package 2 PDF, navigate to Page 6 (has legacy callouts),
    // wait for SVGAnnotationLayer to mount, assert every rendered <g> with data-callout-id
    // matches one entry in window.__debugCallouts__ (if wired).
    const hasCalloutRoot = await page.locator('[data-callout-id]').count();
    expect(hasCalloutRoot).toBeGreaterThanOrEqual(0);
  });

  test('save+reload preserves Fabric.js JSON byte-identical for legacy callouts', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: load legacy PDF, capture callout JSON via
    // window.__getCalloutsJson__() (debug helper), reload, re-capture,
    // assert JSON.stringify(before) === JSON.stringify(after).
    expect(true).toBe(true);
  });
});
