// debug/scenarios/phase27-two-tab-no-dup.spec.mjs
// Phase 27 Wave 0 scaffold — runs as test.fixme until production code lands.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Validation Architecture.
//
// Covers SC2: multi-tab safety. Two browser contexts open the same document.
// Both tabs read+write Y.Doc state and stay in sync (Google Docs pattern), BUT
// only the leader tab (elected via Web Locks) writes to IndexedDB — guards
// against y-indexeddb#25 corruption from concurrent IDB writes.
//
// The fixme flips off when Plan 27-04 wires BroadcastChannel handoff + Web Locks
// election. Two assertions then go live:
//   1. Tab B sees an annotation created in tab A within 1500ms (BroadcastChannel
//      cross-tab Y.applyUpdate fan-out).
//   2. The IndexedDB `updates` store has zero duplicate entries — only the
//      leader writes.

import { test, expect } from '@playwright/test';

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173/';
const TEST_PDF = 'Package 2 - Rev 4 -- IC.pdf';

test.describe('Phase 27 — Multi-tab safety (SC2): no IndexedDB duplicate updates', () => {
  test.fixme(true, 'BroadcastChannel handoff + Web Locks election not yet wired (Plan 27-04)');

  test('two tabs editing same doc — IDB store has no duplicate updates', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await pageA.goto(DEV_URL);
    await pageB.goto(DEV_URL);
    // Open same doc in both tabs
    await pageA.evaluate((p) => window.__test_openPdf?.(p), TEST_PDF);
    await pageB.evaluate((p) => window.__test_openPdf?.(p), TEST_PDF);

    // Create annotation in tab A
    await pageA.evaluate(() => window.__test_createAnnotation?.({ type: 'pen' }));

    // Assert tab B sees it within 1500ms
    await expect(pageB.locator('[data-annotation-id]').first()).toBeVisible({ timeout: 1500 });

    // Query IDB store from leader tab — assert no duplicate updates
    const dupes = await pageA.evaluate(async () => {
      const dbs = await indexedDB.databases();
      // Iterate y-indexeddb's `updates` store, count occurrences of each update bytes
      // (planner stub — Plan 27-04 finalizes the IDB inspection helper)
      return 0;
    });
    expect(dupes).toBe(0);

    await ctxA.close();
    await ctxB.close();
  });
});
