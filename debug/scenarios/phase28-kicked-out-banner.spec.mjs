// debug/scenarios/phase28-kicked-out-banner.spec.mjs
// Phase 28 Wave 0 scaffold — runs as test.fixme until Plan 28-06 wires the production code.
// Source: .planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md § Acceptance Criterion 9
//        + 27-UI-SPEC.md (banner pattern).
//
// Verifies banner copy variant `permission_revoked`:
//   - role=alert (assistive-tech announces immediately, not aria-live=polite)
//   - "Your access was removed by the owner" copy (matches Phase 27 banner shape)
//   - dismiss button present BUT onDismiss is no-op for this code per 27-UI-SPEC
//     (kick is a permanent state; dismissing the banner cannot un-kick the user)
//   - in-flight edit dropped with EXPLICIT reason (never silent — Phase 27 honesty principle)
//
// Plan 28-06 wires the production banner mount. This scaffold pins the contract.

import { test, expect } from '@playwright/test';

test.describe('Phase 28 — kicked-out banner UX (permission_revoked code)', () => {
  test.fixme('kicked-out-banner-mounts-with-role-alert', async ({ page }) => {
    // TODO Plan 28-06: simulate a permission_revoked event from the live channel
    //
    // Step 1: open the doc as a collaborator
    // Step 2: simulate `update_rejected` event from the Realtime channel by
    //         calling the test seam: window.__test_emitTransportState({
    //           code: 'permission_revoked', detail: 'owner removed your access'
    //         })
    // Step 3: assert the banner mounts within 1000ms with:
    //         - role=alert (NOT aria-live=polite — kick is urgent)
    //         - heading text matches the locked Phase 27 pattern (font-weight 600)
    //         - body copy explains "your access was removed by the owner"
    //         - dismiss button present (visually) but onDismiss is no-op
    // Step 4: simulate an in-flight edit attempt
    // Step 5: assert the in-flight edit is dropped with explicit user-facing reason
    //         (e.g. "This change wasn't saved because your access was removed.")
    //         — NEVER silently dropped (Phase 27 honesty-over-silent-fallback principle)
    await page.goto('/');
    expect(true).toBe(true); // placeholder — Plan 28-06 fills in
  });
});
