import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { expect, profileChip, signIn, test } from './helpers.mjs';

test('Pro account shows the Pro plan', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.pro);
  await expect(profileChip(page, E2E_ACCOUNTS.pro)).toContainText('Synced · Pro');
});

test('offline, the profile chip says Offline and keeps the Pro plan', async ({ page, context }) => {
  await signIn(page, E2E_ACCOUNTS.pro);
  const chip = profileChip(page, E2E_ACCOUNTS.pro);
  await expect(chip).toContainText('Synced · Pro');
  await context.setOffline(true);
  await expect(chip).toContainText('Offline · Pro');
  await context.setOffline(false);
  await expect(chip).toContainText('Synced · Pro');
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

// Round 3 audit: the first Delete account step was a green "Continue" you
// could press with the box empty, which closed the dialog with its error
// behind it. It is red now, and stays off until DELETE is typed.
test('Delete account stays off until DELETE is typed', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.free);
  await profileChip(page, E2E_ACCOUNTS.free).click();
  await page.getByRole('menuitem', { name: /Settings/ }).first().click();
  await page.getByRole('button', { name: /^Delete account/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Delete account' });
  const go = dialog.getByRole('button', { name: 'Continue' });
  await expect(go).toBeDisabled();
  await expect(go).toHaveClass(/is-danger/);
  await dialog.getByRole('textbox').fill('DELET');
  await expect(go).toBeDisabled();
  await dialog.getByRole('textbox').fill('DELETE');
  await expect(go).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
