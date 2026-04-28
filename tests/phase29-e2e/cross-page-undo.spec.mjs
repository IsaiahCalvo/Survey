import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: 29-CONTEXT.md cross-page-undo decision
//   "Given a user drew on page 3 then navigated to page 6, when they press
//    Cmd+Z, then the viewer first jumps back to page 3, then the undo applies."
// Unfixme target: Plan 29-04

test.fixme('Cmd+Z of action on different page jumps view to that page first', async ({ page }) => {
  // TODO: Plan 29-04 implements this scenario
  // Steps:
  // 1. Sign in, open PDF, navigate to page 3
  // 2. Draw a stroke on page 3
  // 3. Navigate to page 6 (scroll or page-jump UI)
  // 4. Press Cmd+Z
  // 5. Assert: viewer first navigates back to page 3 (visible page changes)
  // 6. Assert: stroke on page 3 is removed
  // Expected: per UI-SPEC §3 cross-page undo is a navigation-then-undo sequence;
  // useAnnotationsCRDT exposes the affected page from the undone transaction
  // and the App-level Cmd+Z handler does the page-jump before applying.
});
