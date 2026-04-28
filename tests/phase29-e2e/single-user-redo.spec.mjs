import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: UNDO-04 + 29-CONTEXT.md acceptance criterion
//   "Given a user has just pressed Cmd+Z, when they press Cmd+Shift+Z, then
//    the undone change is reapplied."
// Unfixme target: Plan 29-04

test.fixme('Cmd+Shift+Z redoes the most recently undone action', async ({ page }) => {
  // TODO: Plan 29-04 implements this scenario
  // Steps:
  // 1. Sign in, open PDF on page 6, draw a stroke
  // 2. Press Cmd+Z — stroke disappears
  // 3. Press Cmd+Shift+Z
  // 4. Assert: stroke reappears in SVG layer
  // Expected: per UI-SPEC §3 keybind contract — Cmd+Shift+Z is the only redo
  // surface; the Home-tab Redo button hits the same hook (no separate wiring).
});
