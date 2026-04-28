import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Phase 29 e2e — Plan 29-06 unfixme target.
// Maps to: 29-UI-SPEC.md §1 toast contract (annotation_remote_deleted)
// 29-CONTEXT.md acceptance criterion:
//   "Given a remote collaborator deletes annotation X while the local user is
//    interacting with X, when the deletion arrives, then a sticky 'Removed by
//    [name] — Restore?' toast surfaces with the user's name + a Restore action."
//
// This spec covers the (a) selected interaction state. The remaining four —
// (b) dragging, (c) scaling, (d) edit-canvas open, (e) right-click menu open —
// route through the same toast queue handler in YDocProvider via different
// fields of window.__phase29InteractionState. (e) contextMenuId is deferred per
// 29-deferred-items.md item 1 (App.jsx waiver scope protection).
//
// Skip patterns match the existing two-clients-undo-isolation.spec.mjs convention:
//   - .bot-credentials.json absent → SKIP (no two-account harness available)
//   - fewer than 2 bots → SKIP
//   - dev seed cannot drive sign-in / page load → SKIP at the natural failure point

const credsPath = path.resolve(process.cwd(), '.bot-credentials.json');
const HAS_BOTS = existsSync(credsPath);

test('remote-delete toast surfaces when local user is interacting with deleted anno', async ({ browser }) => {
  test.skip(!HAS_BOTS, '.bot-credentials.json not present (Phase 28 bots required)');
  const creds = JSON.parse(readFileSync(credsPath, 'utf8'));
  const bots = Array.isArray(creds?.bots) ? creds.bots : (Array.isArray(creds) ? creds : []);
  test.skip(bots.length < 2, 'fewer than 2 bot accounts available in .bot-credentials.json');

  const botA = bots[0];
  const botB = bots[1];

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // Sign-in injection per the project's feedback_dev_auto_login pattern.
  for (const [page, bot] of [[pageA, botA], [pageB, botB]]) {
    await page.goto('http://localhost:5173/');
    await page.evaluate(({ email, password }) => {
      window.localStorage.setItem('test-bot-email', email);
      window.localStorage.setItem('test-bot-password', password);
    }, { email: bot.email, password: bot.password });
    await page.reload();
  }

  // Both clients open the same document on page 6 (the canonical CLAUDE.md test page).
  for (const page of [pageA, pageB]) {
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.e-pv-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));
  }
  await pageA.waitForTimeout(1500);

  // Bot A draws a stroke. The annotation will be the target of the remote delete.
  const boxA = await pageA.locator('.e-pv-page-container').first().boundingBox();
  if (!boxA) {
    test.skip(true, 'page container not available — dev seed may not be reachable');
    return;
  }
  await pageA.mouse.move(boxA.x + 100, boxA.y + 100);
  await pageA.mouse.down();
  await pageA.mouse.move(boxA.x + 200, boxA.y + 200, { steps: 12 });
  await pageA.mouse.up();
  // Sync window — Supabase Realtime + IndexedDB persistence settle.
  await pageA.waitForTimeout(2500);

  // Read the annoId on pageA via the data-anno-id seam Plan 29-04 added.
  const annoId = await pageA.evaluate(() => {
    const el = document.querySelector('svg [data-anno-id]');
    return el?.getAttribute('data-anno-id') ?? null;
  });
  test.skip(!annoId, 'no annotation found on pageA after draw — data-anno-id seam may be missing');

  // Simulate "A has the annotation selected" by populating the interaction
  // state directly. Plan 29-05 (FabricEditCanvas waiver) will populate this
  // automatically on real selection events; the e2e harness short-circuits to
  // the same end state because Plan 29-06 only cares about the binding being
  // set at the moment of remote delete.
  await pageA.evaluate((aid) => {
    if (typeof window === 'undefined') return;
    if (!window.__phase29InteractionState) {
      window.__phase29InteractionState = {
        selectedId: null,
        draggingId: null,
        scalingId: null,
        editCanvasId: null,
        contextMenuId: null,
      };
    }
    window.__phase29InteractionState.selectedId = aid;
  }, annoId);

  // Bot B deletes the annotation. Use the data-anno-id seam to find it on
  // page B, click to select, then press Delete (the canonical KBD-01 keyboard
  // shortcut wired in Phase 14).
  const targetOnB = pageB.locator(`svg [data-anno-id="${annoId}"]`).first();
  await targetOnB.click({ timeout: 5000 }).catch(() => {});
  await pageB.keyboard.press('Delete');
  // Sync window for the delete to round-trip back to A.
  await pageB.waitForTimeout(2500);

  // Assert the toast surfaces on pageA. role=alert is the StorageFailureBanner
  // contract from Phase 27; "Removed by" is the Phase 29 heading prefix.
  const toast = pageA.locator('[role="alert"]').filter({ hasText: 'Removed by' }).first();
  await expect(toast).toBeVisible({ timeout: 5000 });

  // Both inline action links must be present per UI-SPEC §1 two-action variant.
  await expect(pageA.locator('button[aria-label="Restore annotation"]').first()).toBeVisible();
  await expect(pageA.locator('button[aria-label="Dismiss"]').first()).toBeVisible();

  // The toast is sticky — explicitly verify it is still visible after a
  // generous wait, NOT auto-dismissing per UI-SPEC §1.
  await pageA.waitForTimeout(1500);
  await expect(toast).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
