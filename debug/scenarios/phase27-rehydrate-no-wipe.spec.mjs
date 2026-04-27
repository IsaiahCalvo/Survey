// debug/scenarios/phase27-rehydrate-no-wipe.spec.mjs
// Phase 27 Wave 0 scaffold — runs as test.fixme until production code lands.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Validation Architecture.
//
// Covers SC4: applyUpdate-only invariant. Defends Pitfall 5 — the 1-second
// verify-wipe regression that killed the previous simple-sync system.
//
// Scenario: user is mid-edit (local Y.Map.set in flight) when a server snapshot
// arrives. The CRDT layer MUST merge the snapshot via Y.applyUpdate(doc, bytes)
// — it must NEVER replace doc state wholesale. If both ids ('local-1' and
// 'remote-1') survive after the simulated server push, the invariant holds.
//
// Plan 27-04/05 owns the applyUpdate-only path + the test hooks
// (__test_inflightEdit, __test_simulateServerSnapshot, __test_getAllAnnotationIds).

import { test, expect } from '@playwright/test';

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173/';
const TEST_PDF = 'Package 2 - Rev 4 -- IC.pdf';

test.describe('Phase 27 — applyUpdate-only invariant (SC4)', () => {
  test.fixme(true, 'applyUpdate-only path not yet wired (Plan 27-04/05)');

  test('server snapshot during in-flight local edit — local edit survives', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.evaluate((p) => window.__test_openPdf?.(p), TEST_PDF);

    // Simulate in-flight local edit (Y.Map.set on annotations map)
    await page.evaluate(() => window.__test_inflightEdit?.({ id: 'local-1', color: 'red' }));

    // Simulate server snapshot rehydrate (must use Y.applyUpdate, never replace)
    await page.evaluate(() =>
      window.__test_simulateServerSnapshot?.({ id: 'remote-1', color: 'blue' })
    );

    // Assert BOTH local-1 and remote-1 are present in Y.Doc state
    const annotationIds = await page.evaluate(() => window.__test_getAllAnnotationIds?.());
    expect(annotationIds).toContain('local-1');
    expect(annotationIds).toContain('remote-1');
  });
});
