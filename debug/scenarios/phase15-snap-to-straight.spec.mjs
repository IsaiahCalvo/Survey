// UX: Phase 15 smoke test for silent snap-to-straight at 10px drag threshold.
// Validates LINE-02 end-to-end: curved line → drag midpoint back within 10px → auto-straightens.
// No visual snap indicator (silent snap per CONTEXT.md Area 2).
// SKIP until Plan 15-03 ships the snap logic.
import { test, expect } from '@playwright/test';

test.describe('Phase 15 — snap-to-straight at 10px threshold', () => {
  test.fixme('user drags curved midpoint handle back within 10px of baseline → line auto-straightens', async ({ page }) => {
    // TODO Plan 15-03: start with curved line (data.midpoint = {x:50, y:50}),
    // drag midpoint to (50, 3) (3px from baseline, within 10px threshold),
    // release pointer, assert: SVG <path> removed, SVG <line> present, and
    // data.midpoint in annotation JSON is undefined (cleared on snap).
    await page.goto('/');
  });

  test.fixme('render hysteresis: data.midpoint set but distance ≤ 1 renders <line> not <path>', async ({ page }) => {
    // TODO Plan 15-03: programmatically set data.midpoint = {x:50, y:0.5},
    // assert no <path> element renders for this line; <line> present instead.
    await page.goto('/');
  });
});
