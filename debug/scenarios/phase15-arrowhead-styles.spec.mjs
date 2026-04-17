// UX: Phase 15 smoke test for 6-style arrowhead render via direct annotation JSON manipulation.
// Validates ARROW-04: renderer dispatches correct SVG primitive for each style.
// Uses programmatic JSON edit (no picker UI in Phase 15 — picker is Phase 16).
// SKIP until Plan 15-02 ships renderArrowhead helper.
import { test, expect } from '@playwright/test';

const STYLES = ['none', 'solidTriangle', 'vShape', 'openCircle', 'openTriangle', 'horizontalLine'];

test.describe('Phase 15 — six arrowhead styles render correctly', () => {
  for (const style of STYLES) {
    test.fixme(`arrowheadStyle="${style}" renders correct SVG primitive`, async ({ page }) => {
      // TODO Plan 15-02: write 6 test annotations to page state (one per style),
      // assert DOM contains:
      //   none → no arrowhead element
      //   solidTriangle → <polygon> with fill attribute set (not "none")
      //   vShape → <polyline> with fill="none" + stroke
      //   openCircle → <circle> with fill="none" + stroke
      //   openTriangle → <polygon> with fill="none" + stroke
      //   horizontalLine → <line> perpendicular to arrow direction
      await page.goto('/');
    });
  }

  test.fixme('fallback: missing arrowheadStyle on tool=arrow → solidTriangle; tool=line → none', async ({ page }) => {
    // TODO Plan 15-02: legacy arrow with no data.arrowheadStyle renders <polygon> (default SOLID_TRIANGLE).
    // Legacy line with no data.arrowheadStyle renders no arrowhead.
    await page.goto('/');
  });
});
