// Calibrate takes feet-inches and shows the traced paper length (beta flag
// 'calibrate-entry', Drawboard PDF Pro trial audit 2026-11-10).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';
import { seedSheet } from './seedSheet.mjs';

test(`calibrating with 20' 6" sets a scale that reads it back`, async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.calibrate-entry', '1'));
  const sheet = await seedSheet('Calibrate entry', { size: [792, 612], pages: 1 });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.locator('[data-measure-tool="menu"]').click();
    await page.locator('[data-measure-tool="scale"]').click();
    const dialog = page.getByRole('dialog', { name: 'Set page scale' });
    await dialog.getByText('Calibrate instead').click();
    await expect(dialog).toBeHidden();
    const box = await pageDiv.boundingBox();
    const drag = async () => {
      await page.mouse.move(box.x + 100, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(box.x + 400, box.y + 300, { steps: 10 });
      await page.mouse.up();
    };
    await drag();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-measure-paper-length]')).toContainText('in on paper');
    const field = dialog.locator('[data-measure-real-length]');
    await field.fill('abc');
    await expect(dialog.locator('[data-measure-apply]')).toBeDisabled();
    await field.fill(`20' 6"`);
    await dialog.locator('[data-measure-unit-option="ft"]').click();
    await expect(dialog.locator('[data-measure-apply]')).toBeEnabled();
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();
    // A Length drawn the same way now reads 20' 6".
    await page.locator('[data-measure-tool="menu"]').click();
    await page.locator('[data-measure-tool="length"]').click();
    await page.mouse.move(box.x + 100, box.y + 420);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 420, { steps: 10 });
    await page.mouse.up();
    await expect(pageDiv.locator('.measure-label').filter({ hasText: `20' 6"` }).first()).toBeVisible();
  } finally {
    await sheet.remove();
  }
});
