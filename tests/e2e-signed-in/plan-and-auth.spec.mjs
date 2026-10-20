import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { expect, profileChip, signIn, test } from './helpers.mjs';

test('Pro account shows the Pro plan', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.pro);
  await expect(profileChip(page, E2E_ACCOUNTS.pro)).toContainText('Synced · Pro');
});

test('free account shows the Free plan and has no documents of its own', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.free);
  const chip = profileChip(page, E2E_ACCOUNTS.free);
  await expect(chip).toContainText('Synced · Free');
  await expect(chip).not.toContainText('Pro');
  await expect(page.getByText('No documents yet').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(E2E_DOCUMENT.name, { exact: true })).toHaveCount(0);
});

test('a wrong password is rejected in the sign-in dialog', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill(E2E_ACCOUNTS.free.email);
  await dialog.getByLabel('Password').fill('not-the-password');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.locator('.auth-error')).toBeVisible();
  await expect(dialog).toBeVisible();
});
