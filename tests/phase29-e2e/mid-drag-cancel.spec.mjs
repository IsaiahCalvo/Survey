import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: 29-CONTEXT.md mid-drag decision
//   "Given a user is mid-drag on a shape, when they press Cmd+Z, then the
//    drag is cancelled, the shape snaps back to its pre-drag position, and
//    no Y.Map write occurs (the partial drag never reaches Y.Doc)."
// Unfixme target: Plan 29-05

test.fixme('Cmd+Z mid-drag cancels the drag and snaps shape back; no Y.Doc write', async ({ page }) => {
  // TODO: Plan 29-05 implements this scenario
  // Steps:
  // 1. Sign in, open PDF on page 6, pre-seed a rectangle
  // 2. Press mouse down on the rectangle, move 100px (still down — mid-drag)
  // 3. Press Cmd+Z while still mid-drag
  // 4. Release mouse
  // 5. Assert: rectangle is back at original position
  // 6. Assert: doc_yjs_updates table grew by ZERO rows for this drag (verify via
  //    Supabase admin client query in the test fixture)
  // Expected: per UI-SPEC §3 mid-drag is a UI-only operation until pointerup;
  // Cmd+Z mid-drag flips fabricObject.__dragCancelled = true, bridge short-circuits
  // before the transact (covered by midDragCancel.test.mjs unit).
});
