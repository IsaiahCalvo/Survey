// debug/scenarios/phase28-login-expired.spec.mjs
// Phase 28 Wave 0 scaffold — runs as test.fixme until Plan 28-06 wires the production code.
// Source: .planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md § Login expiry / token refresh UX.
//
// Verifies the `login_expiry_failure` banner code path:
//   - silent refresh succeeds → user sees no UI change at all (no banner, no chip, no flicker)
//   - silent refresh FAILS → top banner appears: "Your sign-in expired — click here to sign in again"
//   - clicking the action link mounts <ReSignInModal> on the document page
//   - re-sign-in keeps the user on the same document page (NO redirect to dashboard or login screen)
//
// Pattern: matches Linear / Notion / Figma silent-refresh UX (28-CONTEXT.md user reference).
// Honesty principle: visible only on FAILURE, never on success.

import { test, expect } from '@playwright/test';

test.describe('Phase 28 — login-expired banner + inline re-sign-in', () => {
  test.fixme('login-expired-banner-and-resignin-modal', async ({ page }) => {
    // TODO Plan 28-06: simulate token refresh failure
    //
    // Step 1: open the doc as a signed-in user
    // Step 2: simulate refresh-token failure by calling the test seam:
    //         window.__test_emitTransportState({
    //           code: 'login_expiry_failure', detail: 'refresh-token revoked'
    //         })
    // Step 3: assert the banner mounts within 1000ms with:
    //         - body text "Your sign-in expired"
    //         - action link "click here to sign in again" (underlined, accent color)
    // Step 4: click the action link
    // Step 5: assert <ReSignInModal> mounts on the SAME document page:
    //         - URL must NOT have changed (no redirect)
    //         - PDF viewer must STILL be visible behind the modal
    //         - modal contains email + password fields + sign-in button
    // Step 6: simulate successful re-sign-in (fill form, submit)
    // Step 7: assert:
    //         - banner disappears
    //         - modal closes
    //         - URL is unchanged (still on the same document)
    //         - edits resume working (no further banner)
    //
    // Anti-pattern check: even if the user dismisses the modal, do NOT bounce them
    // to the main login screen — they keep their place on the document page.
    await page.goto('/');
    expect(true).toBe(true); // placeholder — Plan 28-06 fills in
  });
});
