import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: COLLAB-03 + 29-CONTEXT.md acceptance criterion
//   "Given two clients editing different properties of the same shape, when
//    both commit, then per-property LWW merges cleanly (both properties survive)."
// Unfixme target: Plan 29-05 (PAL/Fabric* event surface wiring)

test.fixme('two clients edit different properties of same shape — per-property LWW merge', async ({ page }) => {
  // TODO: Plan 29-05 implements this scenario
  // Steps:
  // 1. Pre-seed: a rectangle annotation 'annoX' exists on page 6 (synced to both clients)
  // 2. bot1 changes annoX.fill to red; bot2 changes annoX.left by 100px in parallel
  // 3. Wait for Realtime sync
  // 4. Assert: both fill=red AND left+100 visible on BOTH clients
  // Expected: per UI-SPEC §3 the SVG re-renders both property changes; no flicker,
  // no toast (this is the silent-success path).
});
