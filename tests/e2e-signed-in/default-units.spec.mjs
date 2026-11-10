// Default units (beta flag 'default-units', Drawboard PDF Pro trial audit
// 2026-11-09). Settings > Annotations > Units: Metric makes Set page scale
// start on 1:100 and a new blank document start on A4.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, profileChip, signIn, test } from './helpers.mjs';

async function openAnnotationSettings(page) {
  const tab = page.getByRole('tab', { name: 'Annotations' });
  const settings = page.locator('.account-settings-overlay');
  await expect(async () => {
    if (!(await settings.count())) {
      const item = page.getByRole('menuitem', { name: 'Settings' }).filter({ visible: true });
      if (!(await item.count())) await profileChip(page, E2E_ACCOUNTS.owner).click({ timeout: 2_000 });
      await item.first().click({ timeout: 2_000 });
    }
    await expect(tab).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  await tab.click();
}

test('Metric units start the page scale on 1:100 and a new document on A4', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.default-units', '1');
    localStorage.setItem('survey.flag.new-document', '1');
  });
  const sheet = await seedSheet('Default units', { size: [792, 612] });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await openAnnotationSettings(page);
    const group = page.getByRole('radiogroup', { name: 'Units' });
    await expect(group.getByRole('radio', { name: 'Imperial' })).toHaveAttribute('aria-checked', 'true');
    await group.getByRole('radio', { name: 'Metric' }).click();
    await expect(group.getByRole('radio', { name: 'Metric' })).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('survey:units'))).toBe('metric');
    await page.keyboard.press('Escape');
    await expect(page.locator('.account-settings-overlay')).toHaveCount(0);

    // A new blank document starts on A4.
    await page.locator('[data-home-new="desktop"]').filter({ visible: true }).first().click();
    const form = page.locator('[data-new-document-dialog]');
    await expect(form.getByRole('button', { name: 'Page size' })).toContainText('A4');
    await form.getByRole('button', { name: 'Cancel' }).click();

    // Set page scale starts on 1:100.
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Default units sheet')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.locator('[data-measure-tool="menu"]').click();
    await page.getByText('Page scale…').click();
    const dialog = page.getByRole('dialog', { name: 'Set page scale' });
    await expect(dialog.locator('[data-measure-preset-option="1:100"]')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('[data-measure-preset-option="1/4"]')).toHaveAttribute('aria-checked', 'false');
  } finally {
    await sheet.remove();
  }
});

test('flag off: no Units row', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, E2E_ACCOUNTS.owner);
  await openAnnotationSettings(page);
  await expect(page.getByRole('radiogroup', { name: 'Shift snap angle' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Units' })).toHaveCount(0);
});
