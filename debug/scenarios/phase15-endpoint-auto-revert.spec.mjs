// UX: Phase 15 smoke test for endpoint-drag preserving midpoint, and auto-revert-on-collinear.
// Validates LINE-03: drag endpoint of curved line, midpoint stays fixed in absolute coords.
// If dragging makes geometry naturally collinear within 10px, auto-revert to straight.
// SKIP until Plan 15-03 ships the endpoint midpoint-preserve + auto-revert.
import { test, expect } from '@playwright/test';

test.describe('Phase 15 — endpoint drag preserves midpoint + auto-revert', () => {
  test.fixme('dragging endpoint reshapes curve, midpoint stays at absolute position', async ({ page }) => {
    // TODO Plan 15-03: curved line with midpoint (50, 50), start (0, 0), end (100, 0).
    // Drag end from (100, 0) to (200, 0). Assert midpoint in JSON still (50, 50).
    // Path's d recomputed with new end but same midpoint.
    await page.goto('/');
  });

  test.fixme('endpoint drag producing collinear geometry (within 10px) auto-reverts to straight', async ({ page }) => {
    // TODO Plan 15-03: curved line (0,0)-(100,0) with midpoint (50, 3).
    // Drag end to (200, 0). Now shouldSnapToLinear(mid=(50,3), start=(0,0), end=(200,0)) is
    // true (distance 3 ≤ 10). Assert: on pointerup, data.midpoint cleared; <line> renders.
    await page.goto('/');
  });
});
