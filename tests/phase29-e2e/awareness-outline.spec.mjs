import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: UI-SPEC §2 outline contract (per-user awareness outline)
// 29-CONTEXT.md acceptance criterion:
//   "Given a remote collaborator opens the edit canvas on annotation Y, when
//    the local user looks at the SVG layer, then a 2px solid outline at 0.7
//    opacity in the remote user's stable color appears around Y."
//
// Unfixme target: Plan 29-06 (awareness wiring + outline overlay)

test.fixme('remote collaborator opens edit canvas → local screen shows per-user-color outline 2px solid 0.7 opacity', async ({ page }) => {
  // TODO: Plan 29-06 implements this scenario
  // Steps:
  // 1. Two browser contexts: bot1 = local user, bot2 = remote
  // 2. Both open the same PDF on page 6 with a pre-seeded annotation annoY
  // 3. bot2 double-clicks annoY to enter edit canvas mode
  // 4. Wait for awareness state propagation (< 200ms)
  // 5. On bot1's screen: assert an outline overlay surrounds annoY's bounding box
  //    - stroke color === bot2's stable per-user color (computed from userId hash)
  //    - stroke-width === 2px
  //    - opacity === 0.7
  //    - stroke-dasharray === 'none' (solid, not dashed)
  // 6. bot2 closes edit canvas (clicks outside)
  // 7. Assert: outline disappears from bot1's screen
  // Expected: per UI-SPEC §2 the outline is the only awareness affordance shipping
  // in this phase. It must NOT modify SVGAnnotationLayer.jsx (Always-Protected) —
  // a wrapper component or overlay <svg> renders on top.
});
