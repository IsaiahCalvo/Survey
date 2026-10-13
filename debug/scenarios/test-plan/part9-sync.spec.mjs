// TEST-PLAN Part 9 — Two windows (sync), items 59-65
// (docs/handoff-2026-09-29/TEST-PLAN.md). Same output and run line as
// part8-marks.spec.mjs:
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/part9-sync.spec.mjs
//
// Items 59-64 need a signed-in backend and are skipped (NEEDS-BACKEND): two
// windows only share edits through the document's live channel (Supabase
// realtime + the Yjs provider, src/components/collab/YDocProvider.jsx). The
// local fake-data route (?testPdf=…) opens a file with no document id, so the
// collaboration layer never mounts there, and giving it an id makes the
// provider try to reach the real Supabase project — which these walks must
// never touch. Item 64 also needs a second real account. To run 59-64
// without the production database, point the app at a local Supabase stack
// (supabase start) with two seeded test users.
//
// Item 65 (the right-click menu acts on the whole selection) needs only one
// window and runs here.
import { test, expect } from '@playwright/test';
import * as L from './lib.mjs';

test.use({ video: 'off', screenshot: 'off' });
test.describe.configure({ timeout: 300_000 });

const BACKEND = 'two windows share edits only through the live document channel (Supabase realtime); the local fake-data route has none';
for (const [item, name] of [
  [59, 'live drawing (ghost ink in window B)'],
  [60, 'live moves'],
  [61, 'two edits to one mark merge'],
  [62, 'Survey Markers live'],
  [63, 'Delete stays on your mark while the other window deletes another'],
  [64, 'open editing by a second account'],
]) {
  test(`${item} ${name}`, async () => {
    L.record(item, 'two-windows', 'NEEDS-BACKEND', item === 64 ? `${BACKEND}; also needs a second signed-in test account` : BACKEND);
    test.skip(true, `NEEDS-BACKEND: ${BACKEND}`);
  });
}

// ------------------------------------------------------------------ 65
{
  test('65 menu on a selection (two marks picked, right-click one)', async () => {
    const env = await L.launch({});
    const { page, errors } = await L.openViewer(env);
    try {
      const menuItems = () => page.evaluate(() => [...document.querySelectorAll('[data-annotation-context-menu] button, [data-annotation-context-menu] [role=menuitem]')]
        .filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()));
      const choose = async (label) => {
        await page.locator('[data-annotation-context-menu] button, [data-annotation-context-menu] [role=menuitem]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();
        await L.wait(600);
      };
      const lockedBy = async (ids) => page.evaluate((ids) => ids.map((id) => {
        const o = (window.__diagState?.annotationsByPage?.[1]?.objects || []).find((x) => String(x.data?.id || x.id) === id);
        return o ? (o.data?.lockedBy || null) : 'GONE';
      }), ids);
      await L.drawRect(page, 100, 660, 180, 720);
      await L.drawRect(page, 250, 660, 330, 720);
      const ms = await L.marks(page);
      const ids = ms.slice(-2).map((m) => m.id);
      const [ax, ay] = await L.at(page, 120, 660);
      const [bx, by] = await L.at(page, 270, 660);
      const pickBoth = async () => {
        await L.key(page, 'Escape'); await L.tool(page, 'select');
        await L.click(page, ax, ay);
        await L.click(page, bx, by, { modifiers: ['Shift'] });
      };
      // Lock from the menu opened on the SECOND mark
      await pickBoth();
      const picked = (await L.selection(page)).length;
      await L.click(page, bx, by, { button: 'right' });
      const items = await menuItems();
      await L.shot(page, '65-menu');
      await choose('Lock');
      const afterLock = await lockedBy(ids);
      const badges = await page.locator('[data-selection-lock-badge]').count();
      // Unlock from the menu opened on the FIRST mark
      await pickBoth();
      await L.click(page, ax, ay, { button: 'right' });
      await choose('Unlock');
      const afterUnlock = await lockedBy(ids);
      // Delete from the menu opened on the second mark
      await pickBoth();
      await L.click(page, bx, by, { button: 'right' });
      await choose('Delete');
      const afterDelete = await lockedBy(ids);
      const path = await L.shot(page, '65-after-delete');
      const ok = picked === 2 && afterLock.every((v) => v === 'dev-test-user') && afterUnlock.every((v) => v === null)
        && afterDelete.every((v) => v === 'GONE');
      L.record(65, 'chromium-desktop', ok ? 'PASS' : 'FAIL', `2 picked; menu ${JSON.stringify(items)}; Lock -> lockedBy ${JSON.stringify(afterLock)} (badges ${badges}); Unlock -> ${JSON.stringify(afterUnlock)}; Delete -> ${JSON.stringify(afterDelete)}; ${path}`);
      expect(ok).toBe(true);
      expect(errors).toEqual([]);
    } finally { await env.browser.close(); }
  });
}
