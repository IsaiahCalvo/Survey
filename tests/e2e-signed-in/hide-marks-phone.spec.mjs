// Phone: More > Hide marks hides every mark; the chip's Show brings them back
// (beta flag 'hide-marks', Drawboard PDF Pro trial audit 2026-11-10).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

for (const on of [true, false]) {
  test(`phone More ${on ? 'has' : 'has no'} Hide marks`, async ({ page }) => {
    test.setTimeout(120_000);
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.hide-marks', '1'));
    const sheet = await seedSheet('Phone hide marks');
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().tap();
      await page.waitForTimeout(1200);
      const open = page.getByRole('button', { name: 'Open file' });
      if (await open.isVisible().catch(() => false)) await open.tap();
      const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
      await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
      const layer = pageDiv.locator('[data-svg-annotation-layer="1"]').first();
      await page.getByRole('button', { name: 'More document options' }).tap();
      const row = page.locator('[data-mobile-hide-marks]');
      if (!on) {
        await expect(page.getByRole('group', { name: 'More document options' })).toBeVisible();
        await expect(row).toHaveCount(0);
        return;
      }
      await expect(row).toHaveText('Hide marks');
      await row.tap();
      await expect(layer).toBeHidden();
      const chip = page.locator('[data-marks-hidden-chip]');
      await expect(chip).toBeVisible();
      // Clear of the bottom tool bar.
      const c = await chip.boundingBox();
      expect(c.y + c.height, JSON.stringify(c)).toBeLessThan(844 - 60);
      expect(c.height, JSON.stringify(c)).toBeLessThan(60);
      await page.screenshot({ path: test.info().outputPath('phone-hidden.png') });
      await page.getByRole('button', { name: 'More document options' }).tap();
      await expect(row).toHaveText('Show marks');
      await row.tap();
      await expect(chip).toHaveCount(0);
      await expect(layer).toBeVisible();
    } finally {
      await sheet.remove();
    }
  });
}
