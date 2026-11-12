// Phone Rectangle settings sheet: picking Line style Cloud draws a cloud in
// the sheet's live preview (Drawboard PDF Pro push 2026-11-12,
// drawboard-trial/pdf-pro/apps-side-by-side.md, style sheet row).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test.describe('phone web', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Cloud in the Rectangle sheet shows a cloud preview', async ({ page }) => {
    test.setTimeout(150_000);
    const sheet = await seedSheet('Sheet cloud preview');
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().tap();
      const openFile = page.getByRole('button', { name: 'Open file' });
      if (await openFile.isVisible().catch(() => false)) await openFile.tap();
      const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
      await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Shapes', exact: true }).filter({ visible: true }).first().tap();
      await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).last().tap();
      await page.getByRole('button', { name: /^More .* settings$/ }).filter({ visible: true }).first().tap();
      const preview = page.locator('.mobile-tool-sheet__preview').filter({ visible: true }).first();
      await expect(preview).toBeVisible();
      await expect(preview.locator('[data-preview-cloud]')).toHaveCount(0);
      await page.getByRole('radio', { name: /cloud/i }).filter({ visible: true }).first().tap();
      await expect(preview.locator('[data-preview-cloud]')).toHaveCount(1);
      await page.screenshot({ path: process.env.CLOUD_SHOT || test.info().outputPath('cloud-sheet.png') });
    } finally {
      await sheet.remove();
    }
  });
});
