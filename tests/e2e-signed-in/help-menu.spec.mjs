// Nightly 'help-menu' (Drawboard Projects parity AE-12 / 17 / 19 / 20): the
// account menu's "Help & support" opens a start guide with links to the
// site's help pages and the app's version.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function openMenu(page) {
  await page.getByRole('button', { name: 'Open account menu' }).filter({ visible: true }).first().click();
}

test('Help & support opens the guide, its links go to the site, Escape closes it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.help-menu', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Help & support' }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Help & support' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-help-steps] li')).toHaveCount(5);
  await expect(dialog.locator('[data-help-link="faq"]')).toHaveAttribute('href', 'https://surveytool.app/faq');
  await expect(dialog.locator('[data-help-link="status"]')).toHaveAttribute('href', 'https://surveytool.app/status');
  await expect(dialog.locator('[data-help-link="whats-new"]')).toHaveAttribute('target', '_blank');
  await expect(dialog.locator('[data-help-version]')).toContainText('Survey');
  await expect(dialog.getByRole('button', { name: 'Reload Survey' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Keyboard shortcuts from the footer hands over to the shortcuts sheet.
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Help & support' }).filter({ visible: true }).first().click();
  await dialog.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Keyboard shortcuts/i }).filter({ visible: true })).toHaveCount(1);
});

test('without the flag the menu has no Help & support', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.help-menu', '0'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Settings' }).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Help & support' })).toHaveCount(0);
});
