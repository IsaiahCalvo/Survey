// debug/scenarios/phase27-leader-handoff.spec.mjs
// Phase 27 Wave 0 scaffold — runs as test.fixme until production code lands.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Validation Architecture.
//
// Covers Web Locks leader handoff: when the leader tab closes, a loser tab
// must promote within ~2s so local persistence keeps flowing without manual
// reload. Failure mode if this regresses: the user closes tab A, tab B keeps
// editing in-memory but never writes to IndexedDB → on reload the work is
// gone. Plan 27-04 owns the Web Locks election + the
// `window.__test_getLockRole` test hook this scenario reads.

import { test, expect } from '@playwright/test';

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173/';
const TEST_PDF = 'Package 2 - Rev 4 -- IC.pdf';

test.describe('Phase 27 — Web Locks leader handoff', () => {
  test.fixme(true, 'Web Locks election not yet wired (Plan 27-04)');

  test('leader tab closes → loser tab promotes within 2s', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await pageA.goto(DEV_URL);
    await pageB.goto(DEV_URL);
    await pageA.evaluate((p) => window.__test_openPdf?.(p), TEST_PDF);
    await pageB.evaluate((p) => window.__test_openPdf?.(p), TEST_PDF);

    // Identify leader via the test hook (ydocLifecycle exposes role on lock acquire)
    const roleA = await pageA.evaluate(() => window.__test_getLockRole?.());
    const roleB = await pageB.evaluate(() => window.__test_getLockRole?.());
    const leaderCtx = roleA === 'leader' ? ctxA : ctxB;
    const loserCtx = roleA === 'leader' ? ctxB : ctxA;
    const loserPage = roleA === 'leader' ? pageB : pageA;

    // Sanity: exactly one leader at start
    expect([roleA, roleB].filter((r) => r === 'leader')).toHaveLength(1);

    // Close leader
    await leaderCtx.close();

    // Assert loser promotes within 2s
    await expect
      .poll(async () => loserPage.evaluate(() => window.__test_getLockRole?.()), { timeout: 2000 })
      .toBe('leader');

    await loserCtx.close();
  });
});
