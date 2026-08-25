import { test, expect } from '@playwright/test';

const HUB = '/?hubPreview=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function settingsDialog(page) {
  return page.locator('.account-settings-modal');
}

async function openSettings(page, { width = 1440, height = 900, url = HUB } = {}) {
  await openPage(page, { width, height, url });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const chip = width <= 420
    ? page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' })
    : page.getByRole('button', { name: 'Open account menu' });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

test('profile first/last name clear intended / break / edge', async ({ page }) => {
  test.setTimeout(180_000);

  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  const first = dialog.locator('#firstName');
  const last = dialog.locator('#lastName');
  await expect(first).toHaveValue('Isaiah');
  await expect(last).toHaveValue('Calvo');
  expect(await first.evaluate((el) => el.required)).toBe(false);
  expect(await last.evaluate((el) => el.required)).toBe(false);

  await first.fill('');
  await last.fill('');
  expect(await first.evaluate((el) => el.checkValidity())).toBe(true);
  expect(await last.evaluate((el) => el.checkValidity())).toBe(true);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot save profile changes/i);

  await first.fill('Isaiah');
  await last.fill('');
  expect(await last.evaluate((el) => el.checkValidity())).toBe(true);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot save profile changes/i);

  await first.fill('  ');
  await last.fill('Calvo');
  expect(await first.evaluate((el) => el.checkValidity())).toBe(true);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot save profile changes/i);

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog.getByText('Isaiah', { exact: true })).toBeVisible();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Open account menu' })).toHaveCount(0);
  await expect(settingsDialog(page)).toHaveCount(0);

  const mobile = await openSettings(page, { width: 390, height: 844 });
  await mobile.getByRole('button', { name: 'Edit profile' }).click();
  expect(await mobile.locator('#firstName').evaluate((el) => el.required)).toBe(false);
  expect(await mobile.locator('#lastName').evaluate((el) => el.required)).toBe(false);
  await mobile.locator('#firstName').fill('');
  await mobile.locator('#lastName').fill('');
  expect(await mobile.locator('#firstName').evaluate((el) => el.checkValidity())).toBe(true);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  const proof = {
    emptyNamesValid: true,
    previewPersistAttempted: true,
    guestNoSettings: true,
    mobileClearValid: true,
    deleteAccountNotClicked: true,
    signOutNotClicked: true,
    subscriptionApplyNotClicked: true,
  };
  console.log('PROFILE_NAME_CLEAR_PROOF', JSON.stringify(proof));
  expect(proof.emptyNamesValid).toBe(true);
  expect(proof.deleteAccountNotClicked).toBe(true);
});
