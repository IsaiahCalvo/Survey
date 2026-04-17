// UX: Phase 15 smoke test for midpoint-drag-creates-curve. Validates LINE-01 end-to-end:
// select a line → drag midpoint handle 30px off baseline → SVG shows <path d="M...Q..."> not <line>.
// SKIP until Plan 15-03 ships the midpoint handle + 'midpoint' drag mode.
import { test, expect } from '@playwright/test';

test.describe('Phase 15 — line curvature via midpoint handle', () => {
  test.fixme('user drags midpoint handle → line becomes curved (path, not line)', async ({ page }) => {
    // TODO Plan 15-03: navigate to dev server, load Package 2 - Rev 4 -- IC.pdf, Page 6,
    // create a line via the line tool, click to select it, drag the new midpoint handle
    // (r=5, fill='#ffffff', stroke='#4a90e2') ~50px perpendicular to the baseline, then
    // assert: page.locator('svg path[d^="M"]').count() >= 1 AND the path's d attribute
    // contains ' Q '.
    await page.goto('/');
  });

  test.fixme('curved arrow arrowhead rotates to curve tangent (not start→end angle)', async ({ page }) => {
    // TODO Plan 15-03: programmatically set data.midpoint on an arrow, verify the arrowhead
    // <polygon>'s transform matches getCurveEndAngle(start, end, midpoint) not Math.atan2(dy, dx).
    await page.goto('/');
  });
});
