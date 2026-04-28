import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: 29-CONTEXT.md eraser-swipe decision
//   "Given a user has performed one eraser swipe wiping 5 strokes, when they
//    press Cmd+Z, then ALL 5 strokes are restored in one undo step."
// Unfixme target: Plan 29-05

test.fixme('one eraser swipe wiping 5 strokes restores all 5 in one Cmd+Z', async ({ page }) => {
  // TODO: Plan 29-05 implements this scenario
  // Steps:
  // 1. Sign in, open PDF on page 6, pre-seed 5 strokes in a row
  // 2. Switch to eraser tool
  // 3. Press mouse down at the start of the row, drag across all 5 strokes,
  //    release mouse — all 5 wiped in ONE pointerdown→pointerup eraser session
  // 4. Press Cmd+Z
  // 5. Assert: all 5 strokes are visible again, in their original positions
  // Expected: per UI-SPEC §3 the eraser is unchanged; the Plan 29-05 wiring
  // wraps every eraser session in ONE ydoc.transact() so Y.UndoManager treats
  // it as one undo step (covered by eraserSwipeUndo.test.mjs unit).
});
