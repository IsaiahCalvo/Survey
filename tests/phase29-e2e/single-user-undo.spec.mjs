import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: UNDO-01 + 29-CONTEXT.md acceptance criterion
//   "Given a single user has just committed an annotation, when they press
//    Cmd+Z, then their most recent annotation is removed."
// Unfixme target: Plan 29-04 (useAnnotationsCRDT + Cmd+Z keybind wiring)

test.fixme('Cmd+Z undoes the local user\'s most recent action', async ({ page }) => {
  // TODO: Plan 29-04 implements this scenario
  // Steps:
  // 1. Sign in, open the test PDF on page 6
  // 2. Draw a freehand stroke
  // 3. Wait for the stroke to appear in the SVG layer
  // 4. Press Cmd+Z
  // 5. Assert: the stroke is removed; the SVG layer no longer renders it
  // Expected: per UI-SPEC §3 keybind contract — Cmd+Z is the only surface;
  // no extra toast, no flash, no animation. Silent-on-empty-stack guarantee
  // covered separately in empty-undo-silent.spec.mjs.
});
