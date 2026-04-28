import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: 29-CONTEXT.md silent-empty-stack decision
//   "Given the local undo stack is empty, when the user presses Cmd+Z, then
//    NO toast, NO flash, NO UI change — total silence."
// Unfixme target: Plan 29-04

test.fixme('Cmd+Z on empty stack produces zero UI change', async ({ page }) => {
  // TODO: Plan 29-04 implements this scenario
  // Assertion strategy — capture page.screenshot() before + after Cmd+Z, assert
  // pixel-identical (or DOM diff returns no nodes added).
  // Steps:
  // 1. Sign in, open PDF on page 6 — DO NOT draw anything
  // 2. Capture screenshot A
  // 3. Press Cmd+Z
  // 4. Capture screenshot B
  // 5. Assert: image diff between A and B is empty (toBeEmptyDiff or pixel match)
  // 6. Assert: console emits zero error / warn messages
  // 7. Assert: no toast element present in DOM
  // Expected: per UI-SPEC §3 silent on empty is the contract — feels like the
  // app is broken if there's a "Nothing to undo" toast every time.
});
