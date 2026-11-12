// Selection count (beta flag 'selection-count', Drawboard PDF Pro push
// 2026-11-12, drawboard-trial/pdf-pro row B15): a box drag over three marks
// shows "3" in the selection bar; one picked mark shows no count; flag off:
// no count.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const COUNT = '[data-selection-quick-bar][data-visible="true"] [data-selection-count]';

async function drawMark(page, key, from, to) {
  await page.keyboard.press(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

// A fresh sheet each run, so earlier runs' marks never join the pick.
async function boxPickThree(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  const pb = await pageDiv.boundingBox();
  const at = (fx, fy) => ({ x: pb.x + pb.width * fx, y: pb.y + pb.height * fy });
  await drawMark(page, 'r', at(0.2, 0.62), at(0.3, 0.7));
  await drawMark(page, 'o', at(0.36, 0.62), at(0.46, 0.72));
  await drawMark(page, 'l', at(0.32, 0.8), at(0.56, 0.84));
  await page.waitForTimeout(800);
  await page.mouse.click(5, 450);
  await page.keyboard.press('v');
  await page.mouse.move(at(0.14, 0.56).x, at(0.14, 0.56).y);
  await page.mouse.down();
  await page.mouse.move(at(0.6, 0.9).x, at(0.6, 0.9).y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-group-selection-bbox]')).toHaveCount(1);
  return at;
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('a box pick of three marks shows 3 in the selection bar; one mark shows none', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.selection-count', '1'));
    const sheet = await seedSheet('Selection count', { pages: 1 });
    try {
    const at = await boxPickThree(page, sheet);
    await expect(page.locator(COUNT)).toHaveText('3');
    await expect(page.locator(COUNT)).toHaveAttribute('aria-label', '3 marks picked');
    await page.screenshot({ path: process.env.COUNT_SHOT || test.info().outputPath('selection-count.png') });
    // A click on empty page clears; a click on one mark picks only it.
    await page.mouse.click(at(0.8, 0.95).x, at(0.8, 0.95).y);
    await page.mouse.click(at(0.2, 0.66).x, at(0.2, 0.66).y);
    await expect(page.locator('[data-selection-quick-bar][data-visible="true"]')).toBeVisible();
    await expect(page.locator(COUNT)).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: no count', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.selection-count', '0'));
    const sheet = await seedSheet('Selection count off', { pages: 1 });
    try {
      await boxPickThree(page, sheet);
      await expect(page.locator('[data-selection-quick-bar][data-visible="true"]')).toBeVisible();
      await expect(page.locator(COUNT)).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
