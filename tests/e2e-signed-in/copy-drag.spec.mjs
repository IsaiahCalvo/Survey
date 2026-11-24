// Ctrl + drag (Cmd on a Mac) copies, as in Visio (owner 2026-10-22, again
// 2026-11-14: "if you Control-drag on an annotation, it copies it. If you
// Control-drag just on empty space, you do the selection"). Under Select it
// already copied a mark, picked or not; under Pan, Survey's default tool, the
// same drag only scrolled the page. Now under both tools: Ctrl + drag on any
// mark, callout or Survey Marker leaves it in place and drops a copy where
// the drag ends; Ctrl + drag on bare page draws a selection box; a plain drag
// under Pan still pans. (A finger has no Ctrl: touch is unchanged.)
import { adminClient, expect, test } from './helpers.mjs';
import {
  button, calloutIds, cleanup, drawEverything, markIds, markerIds, openDoc, scrollPointTo, seed, sheetBox, spotsFor, toScreen, zoomIn,
} from './clickOnlyPicks.shared.mjs';

const allIds = async (page) => [...await markIds(page), ...await calloutIds(page), ...await markerIds(page)];

async function ctrlDrag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down('Control');
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Control');
}

test('Ctrl + drag copies any mark under Select and under Pan, and boxes marks on bare page', async ({ page }) => {
  test.setTimeout(420_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    await page.addInitScript(() => { try { localStorage.setItem('survey.flag.smart-fill', '1'); } catch { /* none */ } });
    await openDoc(page, seeded);
    await page.waitForTimeout(1200);
    const list = await drawEverything(page, seeded);
    // As in click-only-picks: zoomed in, the marks in view.
    await page.keyboard.press('v');
    await zoomIn(page, 3);
    const view = page.viewportSize();
    await scrollPointTo(page, 330, 330, view.width * 0.38, view.height * 0.5);
    await page.waitForTimeout(600);
    const failures = [];
    for (const mode of ['survey mode', 'regular mode']) {
      if (mode === 'regular mode') {
        await button(page, 'Survey').click();
        await button(page, 'Done').click();
        await page.waitForTimeout(800);
      }
      // Spots are found under Select: under Pan the marks take no hover hits
      // until a press arms the layer.
      await page.keyboard.press('v');
      await page.waitForTimeout(300);
      const shown = (await spotsFor(page, list)).filter((item) => (mode === 'survey mode' ? item.marker : !item.marker));
      console.log(`[copy-drag] ${mode}: ${shown.map((item) => item.label).join(', ')}`);
      expect(shown.length, `${mode} marks shown`).toBe(mode === 'survey mode' ? 5 : 12);
      for (const [tool, key] of [['Pan', 'm'], ['Select', 'v']]) {
        await page.keyboard.press(key);
        await page.waitForTimeout(300);
        for (const item of shown) {
          const before = await allIds(page);
          const sb = await sheetBox(page);
          const at = { x: sb.x + sb.width * item.spot.fx, y: sb.y + sb.height * item.spot.fy };
          await ctrlDrag(page, at, { x: at.x + 18, y: at.y + 70 });
          await page.waitForTimeout(600);
          const after = await allIds(page);
          const added = after.filter((id) => !before.includes(id));
          const kept = before.every((id) => after.includes(id));
          if (added.length !== 1 || !kept) failures.push(`${mode} ${tool} ${item.label}: ${added.length} copies, original kept ${kept}`);
          // Undo the copy so marks don't pile up on the next one's spot.
          if (added.length) { await page.keyboard.press('Control+z'); await page.waitForTimeout(400); }
          await page.keyboard.press('Escape');
          await page.keyboard.press(key);
          await page.waitForTimeout(200);
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);

    // Bare page under Pan: Ctrl + drag boxes the marks; a plain drag pans.
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    const s = await sheetBox(page);
    const count = (await allIds(page)).length;
    await ctrlDrag(page, toScreen(s, 60, 60), toScreen(s, 245, 150));
    await expect(page.locator('[data-resize-handle]').first()).toBeVisible();
    expect((await allIds(page)).length, 'a box makes no copies').toBe(count);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 450);
    const scrolled = () => page.evaluate(() => document.querySelector('.survey-pdfjs-viewer')?.scrollTop || 0);
    const top = await scrolled();
    const from = { x: view.width * 0.3, y: view.height * 0.45 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 120, { steps: 6 });
    await page.mouse.up();
    await expect.poll(scrolled).not.toBe(top);
    expect((await allIds(page)).length, 'a pan makes no copies').toBe(count);
  } finally {
    await cleanup(admin, seeded);
  }
});
