import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: UNDO-02 (CANONICAL Pitfall 7 test)
// 29-CONTEXT.md acceptance criterion:
//   "Given user A and user B have each drawn one stroke, when A presses Cmd+Z,
//    then A's stroke is removed AND B's stroke is preserved."
// Unfixme target:
//   • Plan 29-04 (validates undoManager wiring picks up the right trackedOrigins)
//   • Plan 29-05 (validates bridge writes the correct origin per user)

test.fixme('user A\'s undo never reverts user B\'s stroke (UNDO-02 canonical)', async ({ page }) => {
  // TODO: Plans 29-04 + 29-05 jointly implement this scenario
  // Steps:
  // 1. Two browser contexts: bot1 = userA, bot2 = userB
  // 2. Both open the same PDF on page 6
  // 3. userA draws stroke A; userB draws stroke B (in either order, sync between)
  // 4. userA presses Cmd+Z
  // 5. Assert: userA's screen — stroke A gone, stroke B still visible
  // 6. Assert: userB's screen — stroke A gone (Realtime sync), stroke B still visible
  // 7. Negative case: userA presses Cmd+Z again — no-op (canUndo === false from
  //    userA's perspective; userB's stroke stays untouched)
  // Expected: per UI-SPEC §3 the undo stack is per-user; the canonical Pitfall 7
  // bug ("A's undo erases B's stroke") must be impossible because trackedOrigins
  // reference equality is the gate.
});
