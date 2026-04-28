// debug/scenarios/phase28-revoke-flow.spec.mjs
// Phase 28 Wave 0 scaffold — runs as test.fixme until Plan 28-06 wires the production code.
// Source: .planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md § Acceptance Criterion 9 (kick UX).
//
// Covers requirements: AUTH-01 (user attribution at transaction origin), AUTH-02 (device
// attribution), and the kicked-out collaborator UX:
//   - banner appears within a few seconds of the owner clicking remove
//   - in-flight edit dropped with explicit reason
//   - document stays open in read-only mode (NOT auto-bounced to dashboard)
//   - within ~3s end-to-end after the owner click
//
// Plan 28-06 (UAT scenarios + final wiring) will flip this fixme → live test by:
//   - opening doc as collaborator B in one browser context
//   - opening same doc as owner A in a second context
//   - having owner A click "Revoke" in the sharing UI
//   - asserting collaborator B's banner appears within 3000ms
//   - asserting the document is now read-only (no edits accepted)
//   - asserting collaborator B is NOT redirected away from the document

import { test, expect } from '@playwright/test';

test.describe('Phase 28 — Owner-revokes-collaborator flow (AUTH-01 / AUTH-02 / kick UX)', () => {
  test.fixme('owner-revokes-collaborator-flow', async ({ page, context }) => {
    // TODO Plan 28-06: 2-context Playwright flow
    //
    // Step 1: open browser context A (owner) — auto-login as the document owner
    //         via .env.development.local
    // Step 2: open browser context B (collaborator B) — sign in as a separate
    //         test bot account that is currently a collaborator on the doc
    //         (per 28-CONTEXT.md "test bot account" decision)
    // Step 3: in context B, open the test PDF and start an in-flight edit
    //         (e.g. begin a pen stroke, do not commit yet)
    // Step 4: in context A, click the sharing UI's "Revoke" button for user B
    // Step 5: assert in context B:
    //         5a. banner with role=alert appears within 3000ms
    //         5b. banner copy includes "access has been removed" (per 27-UI-SPEC pattern)
    //         5c. in-flight edit's commit-attempt is rejected with explicit reason
    //         5d. document is read-only (subsequent pen-tool clicks do nothing)
    //         5e. context B was NOT redirected (URL still on the document page)
    //
    // Speed bar: end-to-end revoke → banner-shown <= 3s on shared wifi (28-CONTEXT.md)
    await page.goto('/');
    expect(true).toBe(true); // placeholder — Plan 28-06 fills in the real assertions
  });
});
