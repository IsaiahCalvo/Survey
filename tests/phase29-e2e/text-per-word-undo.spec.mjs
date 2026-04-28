import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: 29-CONTEXT.md per-word undo decision
//   "Given a user has typed 'hello world' into a text annotation, when they
//    press Cmd+Z, then the text reverts to 'hello' (last whitespace boundary),
//    not 'hello worl' (per-keystroke) and not '' (whole-text wipe)."
// Unfixme target: Plan 29-05

test.fixme('Cmd+Z in text annotation reverts last word to whitespace boundary', async ({ page }) => {
  // TODO: Plan 29-05 implements this scenario
  // Steps:
  // 1. Sign in, open PDF on page 6, create a text annotation
  // 2. Type 'hello' (no trailing space) — single word, single undo step
  // 3. Press space — whitespace boundary fires undoManager.stopCapturing()
  // 4. Type 'world'
  // 5. Press Cmd+Z
  // 6. Assert: text is 'hello ' (with trailing space, OR 'hello' depending on
  //    whether the boundary is fired BEFORE or AFTER the space — Plan 29-05
  //    locks the exact rule)
  // 7. Press Cmd+Z again
  // 8. Assert: text is '' (or annotation removed)
  // Expected: per UI-SPEC §3 the text annotation surface is unchanged; only the
  // capture-window primitive in crdtUndoManager.js (covered by perWordUndo.test.mjs)
  // distinguishes word-level grouping from per-keystroke.
});
