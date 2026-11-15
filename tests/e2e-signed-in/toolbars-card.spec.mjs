// Nightly 'toolbar-settings' (Drawboard Projects VT-33): the left rail's
// Toolbars card hides the tool bar, the page moves up, the choice survives a
// reload, and the same switch brings the bar back.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test('Toolbars card hides and shows the tool bar, remembered after reload', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.toolbar-settings', '1'));
  const sheet = await seedSheet('Toolbars card');
  await signIn(page, E2E_ACCOUNTS.owner);
  try {
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    const topBar = page.locator('#chrome-top-host');
    await expect(topBar).toBeVisible();
    const viewerTopBefore = (await page.locator('#chrome-left-host').boundingBox()).y;

    await page.locator('[data-toolbars-toggle]').click();
    const card = page.locator('[data-toolbars-menu]');
    const sw = card.locator('[data-toolbars-tool-bar]');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('html')).toHaveAttribute('data-tool-bar', 'hidden');
    await expect(topBar).toBeHidden();
    await expect.poll(async () => (await page.locator('#chrome-left-host').boundingBox()).y).toBeLessThan(viewerTopBefore - 20);

    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.survey-pdfjs-page-canvas').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('html')).toHaveAttribute('data-tool-bar', 'hidden');
    await expect(topBar).toBeHidden();

    await page.locator('[data-toolbars-toggle]').click();
    await page.locator('[data-toolbars-menu] [data-toolbars-tool-bar]').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-tool-bar', /.+/);
    await expect(topBar).toBeVisible();
  } finally {
    await sheet.remove();
  }
});
