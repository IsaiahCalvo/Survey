import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: COLLAB-02 + 29-CONTEXT.md acceptance criterion
//   "Given two clients editing different shapes on the same page, when both
//    commit, then both edits appear on both clients without collision."
// Unfixme target: Plan 29-05 (PAL/Fabric* event surface wiring)

test.fixme('two clients edit different shapes on same page — both edits land', async ({ page }) => {
  // TODO: Plan 29-05 implements this scenario
  // Steps:
  // 1. Boot two browser contexts, sign in as bot1 and bot2 (Phase 28 bots)
  // 2. Open the same PDF document in both
  // 3. bot1 draws a rectangle on page 6; bot2 draws a circle on page 6 in parallel
  // 4. Wait for Realtime sync (< 500ms)
  // 5. Assert: bot1's screen has rectangle + circle; bot2's screen has rectangle + circle
  // Expected: per UI-SPEC §3 the only visible UI affordance is the live render of
  // the remote annotation in the SVG layer; no toast, no outline (outline only fires
  // when remote opens edit canvas).
});
