// Double / Cover page views (beta flag 'page-spreads', Drawboard PDF Pro push
// 2026-11-12, drawboard-trial/pdf-pro row C17). Drawboard's View settings:
// Double sets pages side by side in pairs (1-2, 3-4); Cover puts page 1 alone
// on the right, then 2-3; a fit mode re-fits the row. Survey keeps the choice
// on the device; the phone keeps one column.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const pageBox = (page, n) => page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`).filter({ visible: true }).first().boundingBox();

async function openSheet(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
}

async function pickView(page, id) {
  await page.getByRole('button', { name: 'Fit options' }).click();
  await page.locator(`[data-page-spread="${id}"]`).click();
  await page.waitForTimeout(700);
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('Double pairs pages side by side, Cover puts page 1 on the right, Single goes back', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.page-spreads', '1'));
    const sheet = await seedSheet('Page spreads', { pages: 4 });
    try {
      await openSheet(page, sheet);
      const single = [await pageBox(page, 1), await pageBox(page, 2)];
      expect(single[1].y).toBeGreaterThan(single[0].y + single[0].height - 1);

      await pickView(page, 'double');
      await expect(page.locator('[data-page-spread="double"]')).toHaveCount(0);
      await expect.poll(async () => Math.round((await pageBox(page, 2)).y - (await pageBox(page, 1)).y)).toBe(0);
      const [d1, d2, d3] = [await pageBox(page, 1), await pageBox(page, 2), await pageBox(page, 3)];
      expect(d2.x).toBeGreaterThan(d1.x + d1.width - 1);
      expect(d3.y).toBeGreaterThan(d1.y + d1.height - 1);
      expect(Math.abs(d3.x - d1.x)).toBeLessThan(1);
      // Fit page re-fitted the row: both pages fit across the view.
      expect(d2.x + d2.width).toBeLessThan(1400);
      await page.screenshot({ path: process.env.SPREAD_SHOT || test.info().outputPath('page-spreads-double.png') });

      // A zoom over the right page holds the point under the pointer (the
      // anchor finds the page by x as well as y).
      const at = { x: d2.x + d2.width * 0.4, y: d2.y + d2.height * 0.3 };
      await page.mouse.move(at.x, at.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -240);
      await page.keyboard.up('Control');
      await page.waitForTimeout(900);
      const z2 = await pageBox(page, 2);
      expect(z2.width).toBeGreaterThan(d2.width * 1.05);
      expect(Math.abs((at.x - z2.x) / z2.width - 0.4)).toBeLessThan(0.03);
      expect(Math.abs((at.y - z2.y) / z2.height - 0.3)).toBeLessThan(0.03);
      await page.getByRole('button', { name: 'Fit options' }).click();
      await page.getByRole('menuitemradio', { name: 'Fit page' }).click();
      await page.waitForTimeout(700);

      await pickView(page, 'cover');
      await expect.poll(async () => Math.round((await pageBox(page, 3)).y - (await pageBox(page, 2)).y)).toBe(0);
      const [c1, c2, c3] = [await pageBox(page, 1), await pageBox(page, 2), await pageBox(page, 3)];
      expect(Math.abs(c1.x - c3.x)).toBeLessThan(1);
      expect(c2.x).toBeLessThan(c1.x);
      expect(c2.y).toBeGreaterThan(c1.y + c1.height - 1);
      await page.screenshot({ path: test.info().outputPath('page-spreads-cover.png') });

      // The choice is kept on the device: a reload opens in Cover.
      await page.reload();
      const p1 = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
      await expect(p1.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => Math.round((await pageBox(page, 3)).y - (await pageBox(page, 2)).y)).toBe(0);

      await pickView(page, 'single');
      await expect.poll(async () => (await pageBox(page, 2)).y > (await pageBox(page, 1)).y + 10).toBe(true);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: no page view rows', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.page-spreads', '0'));
    const sheet = await seedSheet('Page spreads off', { pages: 2 });
    try {
      await openSheet(page, sheet);
      await page.getByRole('button', { name: 'Fit options' }).click();
      await expect(page.getByRole('menu', { name: 'Fit modes' })).toBeVisible();
      await expect(page.locator('[data-page-spread]')).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
