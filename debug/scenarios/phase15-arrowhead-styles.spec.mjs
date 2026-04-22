// UX: Phase 15 smoke test for 6-style arrowhead render via direct annotation JSON manipulation.
// Validates ARROW-04: renderer dispatches correct SVG primitive for each style.
// Uses programmatic JSON edit (no picker UI in Phase 15 — picker is Phase 16).
//
// Plan 15-02 status: the spec-level contract is fully locked by the 14 unit
// tests in tests/svgLineRenderer.test.mjs + tests/renderArrowhead.test.mjs —
// buildLineRenderSpec and buildArrowheadRenderSpec both ship and pass green.
// This E2E scaffold remains fixme pending a programmatic annotation-injection
// harness (no window.__test_injectAnnotation hook exists in src/ today —
// verified via grep). Plan 15-03 owns midpoint-handle drag + endpoint-drag
// interactions and will need an annotation state-mutation harness for its
// own scaffolds; that harness is the natural carrier for un-fixme-ing this
// scenario too. See 15-02-SUMMARY.md for the deferral rationale.
import { test, expect } from '@playwright/test';

const STYLES = ['none', 'solidTriangle', 'vShape', 'openCircle', 'openTriangle', 'horizontalLine'];

test.describe('Phase 15 — six arrowhead styles render correctly', () => {
  for (const style of STYLES) {
    test.fixme(`arrowheadStyle="${style}" renders correct SVG primitive`, async ({ page }) => {
      // TODO Plan 15-03: wire annotation injection test harness, then for
      // each style inject one line/arrow annotation with
      //   data: { midpoint: {...}, arrowheadStyle: '<style>' }
      // and assert DOM contains:
      //   none → no arrowhead element
      //   solidTriangle → <polygon> with fill attribute set (not "none")
      //   vShape → <polyline> with fill="none" + stroke
      //   openCircle → <circle> with fill="none" + stroke
      //   openTriangle → <polygon> with fill="none" + stroke
      //   horizontalLine → <line> perpendicular to arrow direction
      // Spec-level contract already locked by tests/renderArrowhead.test.mjs.
      await page.goto('/');
    });
  }

  test.fixme('fallback: missing arrowheadStyle on tool=arrow → solidTriangle; tool=line → none', async ({ page }) => {
    // TODO Plan 15-03: wire annotation injection test harness, then inject
    // one legacy arrow with NO data.arrowheadStyle and assert <polygon>
    // (default SOLID_TRIANGLE); inject one legacy line and assert no
    // arrowhead elements. Spec-level contract already locked by
    // tests/svgLineRenderer.test.mjs #2 + #6.
    await page.goto('/');
  });
});
