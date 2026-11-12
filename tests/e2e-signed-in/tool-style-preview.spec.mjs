// Tool style preview (beta flag 'tool-style-preview', Drawboard PDF Pro push
// 2026-11-12, the pen panel's live preview): the desktop colour popover shows
// what the armed tool will draw, and redraws when the colour changes.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function openSheet(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('rectangle: the popover previews the shape and follows the colour', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.tool-style-preview', '1'));
    const sheet = await seedSheet('Tool style preview', { pages: 1 });
    try {
      await openSheet(page, sheet);
      await page.keyboard.press('r');
      await page.getByRole('button', { name: 'Border and fill colors' }).filter({ visible: true }).first().click();
      const preview = page.locator('[data-tool-style-preview="shape"]');
      await expect(preview).toBeVisible();
      const shape = preview.locator('svg rect');
      await expect(shape).toHaveCount(1);
      const before = await shape.evaluate((el) => `${el.getAttribute('stroke')}|${el.getAttribute('fill')}`);
      // Pick another colour in the open picker: the preview follows.
      const swatches = page.locator('[data-annotation-color-picker] button[aria-label]').filter({ visible: true });
      const count = await swatches.count();
      let changed = false;
      for (let i = 0; i < count && !changed; i += 1) {
        const label = (await swatches.nth(i).getAttribute('aria-label')) || '';
        if (!/^#|^(Red|Blue|Green|Yellow|Orange|Purple|Black|White|Pink)/i.test(label)) continue;
        await swatches.nth(i).click();
        changed = await expect.poll(() => shape.evaluate((el) => `${el.getAttribute('stroke')}|${el.getAttribute('fill')}`), { timeout: 3000 })
          .not.toBe(before).then(() => true, () => false);
      }
      expect(changed).toBe(true);
      await page.screenshot({ path: process.env.PREVIEW_SHOT || test.info().outputPath('tool-style-preview.png') });
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: no preview', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.tool-style-preview', '0'));
    const sheet = await seedSheet('Tool style preview off', { pages: 1 });
    try {
      await openSheet(page, sheet);
      await page.keyboard.press('r');
      await page.getByRole('button', { name: 'Border and fill colors' }).filter({ visible: true }).first().click();
      await expect(page.locator('[data-annotation-color-picker]')).toBeVisible();
      await expect(page.locator('[data-tool-style-preview]')).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
