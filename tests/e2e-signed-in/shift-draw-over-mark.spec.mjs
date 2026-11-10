// A Shift-drag with a shape tool draws even when it starts on another mark;
// a Shift-click on that mark still adds it to the pick (Drawboard PDF Pro
// trial audit 2026-11-10, R3-F #2: the Shift-click path ran first and the
// drag drew nothing).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test.use({ viewport: { width: 1400, height: 900 } });

const markIds = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id]')]
  .map((el) => el.getAttribute('data-annotation-id')))].filter((x) => x && !x.startsWith('creation-preview')));

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
}

test('Shift-drag from a mark draws; Shift-click adds it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.shift-square', '1'));
  const sheet = await seedSheet('Shift draw over mark');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const box = await pageDiv.boundingBox();
    const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

    await pageDiv.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('r');
    await drag(page, at(0.2, 0.2), at(0.4, 0.3));
    // A second mark, so the first is no longer the picked one.
    await drag(page, at(0.6, 0.6), at(0.7, 0.7));
    await expect.poll(async () => (await markIds(page)).length).toBe(2);

    // Shift-drag starting on the first rectangle's top side draws a third.
    await page.keyboard.down('Shift');
    await drag(page, at(0.3, 0.2), at(0.5, 0.45));
    await page.keyboard.up('Shift');
    await expect.poll(async () => (await markIds(page)).length).toBe(3);

    // Shift-click on the first rectangle's side adds it to the pick.
    await page.keyboard.down('Shift');
    await page.mouse.click(at(0.2, 0.25).x, at(0.2, 0.25).y);
    await page.keyboard.up('Shift');
    await expect.poll(async () => (await markIds(page)).length).toBe(3);
    // The pick's box now reaches the first rectangle's left side (0.2); the
    // new square alone starts at 0.3.
    const leftHandleX = async () => {
      const b = await page.locator('[data-resize-handle="ml"]').first().boundingBox().catch(() => null);
      return b ? (b.x + b.width / 2 - box.x) / box.width : null;
    };
    await expect.poll(leftHandleX).toBeLessThan(0.23);
  } finally {
    await sheet.remove();
  }
});
