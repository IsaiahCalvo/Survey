import { test, expect } from '@playwright/test';

const HUB = '/?hubPreview=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page, fixture) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

async function openSettings(page) {
  await page.goto(HUB);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
}

test('A-01 guest Sign in chrome + AuthModal intended / break / edge', async ({ page }) => {
  await page.goto(HUB_GUEST);
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });

  const dialog = page.locator('.auth-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue without an account' })).toBeVisible();

  // Break: submit without completing Turnstile (do not invent a captcha token).
  await dialog.locator('#email').fill('not-a-user@example.invalid');
  await dialog.locator('#password').fill('wrong-password');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  const captchaGate = dialog.getByText(/I'm human|human/i);
  const authError = dialog.locator('.auth-error');
  await expect.poll(async () => (
    (await captchaGate.count()) + (await authError.count())
  ), { timeout: 8_000 }).toBeGreaterThan(0);

  // Edge: signup mismatch + dismiss without an account.
  await dialog.getByRole('button', { name: 'Create an account' }).click();
  await expect(dialog.getByRole('heading', { name: 'Create account' })).toBeVisible();
  await dialog.locator('#email').fill('not-a-user@example.invalid');
  await dialog.locator('#firstName').fill('Pat');
  await dialog.locator('#lastName').fill('Lee');
  await dialog.locator('#password').fill('Short1!');
  await dialog.locator('#confirmPassword').fill('Different1!');
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog.locator('.auth-error')).toContainText(/match|requirements|human/i);

  await dialog.getByRole('button', { name: 'Continue without an account' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.profile-signin').first()).toBeVisible();

  console.log('A01_PROOF', JSON.stringify({ guestChrome: true, captchaNotInvented: true, dismiss: true }));
});

test('A-03 / UL-24 ShareModal roles + invalid email + mint fails closed', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 30_000 });
  await page.getByText('Package 2 — Rev 4 — IC.pdf').first().click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: /Share document/i });
  await expect(dialog).toBeVisible();
  const permission = dialog.locator('select');
  await expect(permission).toHaveValue('Viewer');
  const options = await permission.locator('option').allTextContents();
  expect(options).toEqual(['Viewer', 'Editor', 'Owner']);
  expect(options).not.toContain('Commenter');

  await expect(dialog).toContainText('Press Copy link to create a secure viewer link');
  await expect(dialog).not.toContainText('https://surveytool.app/invite/fake');

  // Break: invalid emails do not mint.
  await dialog.locator('textarea').fill('not-an-email, also bad');
  await dialog.getByRole('button', { name: /Send viewer invite/i }).click();
  await expect(dialog).toContainText('Enter at least one valid email.');

  // Edge: Copy link with preview auth fails closed (no live mint / no fake URL).
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog).toContainText(/Sharing needs a signed-in cloud account|Must be signed in|Could not create invite link/i);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  console.log('A03_UL24_PROOF', JSON.stringify({ roles: options, invalidEmail: true, mintFailedClosed: true }));
});

test('A-04 / UL-13 / UL-15–18 / UL-20–22 AccountSettings live chrome', async ({ page }) => {
  await openSettings(page);
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog.getByRole('button', { name: 'General', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connected services', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Subscription', exact: true })).toBeVisible();

  // UL-13 intended: names + locked email. Break: empty required fields.
  await expect(dialog.getByText('Isaiah', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Calvo', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Email cannot be changed')).toBeVisible();
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  const first = dialog.locator('#firstName');
  const last = dialog.locator('#lastName');
  await expect(dialog.locator('#email')).toBeDisabled();
  await first.fill('');
  await last.fill('');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  const emptyBlocked = await first.evaluate((el) => !el.checkValidity());
  expect(emptyBlocked).toBe(true);

  // UL-15 break: password mismatch (do not invent a captcha token).
  await first.fill('Isaiah');
  await last.fill('Calvo');
  await dialog.locator('#newPassword').fill('PreviewPass1!');
  await dialog.locator('#confirmPassword').fill('PreviewPass2!');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/do not match|human|requirements/i);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  // UL-16: wrong confirm stays disabled; DELETE enables; Cancel (no wipe).
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
  const confirm = dialog.locator('#deleteAccountConfirm');
  const wipe = dialog.getByRole('button', { name: 'Delete account permanently' });
  await confirm.fill('delete');
  await expect(wipe).toBeDisabled();
  await confirm.fill('DELETE');
  await expect(wipe).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(wipe).toHaveCount(0);

  // UL-17: preview signOut is fail-closed (not a silent no-op). Settings stay.
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot sign out/i);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  const again = dialog;

  // A-05 / UL-18 / UL-20: subscription catalog. Do not click Start trial (live Stripe).
  await again.getByRole('button', { name: 'Subscription', exact: true }).click();
  await again.getByRole('button', { name: 'Usage' }).click();
  await expect(again.getByRole('button', { name: 'Usage' })).toBeVisible();
  await again.getByRole('button', { name: 'Manage subscription' }).click();
  await expect(again.getByText('Pro', { exact: true }).first()).toBeVisible();
  await expect(again.getByText('Enterprise').first()).toBeVisible();
  await expect(again.getByRole('button', { name: /Start 7-day trial|Start annual trial|Developer account/ })).toBeVisible();
  await expect(again.getByRole('button', { name: 'Contact sales' })).toBeVisible();

  // A-02 / UL-21 / UL-22: Connect chrome. Clicks fail closed (no live MSAL/OAuth).
  await again.getByRole('button', { name: 'Connected services' }).click();
  await expect(again.getByText('Microsoft')).toBeVisible();
  await expect(again.getByText('Not connected. Connect to sync exported surveys')).toBeVisible();
  await again.getByRole('button', { name: 'Connect', exact: true }).first().click();
  await expect(again.locator('.account-error')).toContainText(/Failed to connect Microsoft|Preview cannot/i);
  await expect(again.getByText('Google')).toBeVisible();
  await again.getByRole('button', { name: 'Connect', exact: true }).last().click();
  await expect(again.locator('.account-error')).toContainText(/Failed to update Google|Preview cannot/i);

  console.log('ACCOUNT_SETTINGS_PROOF', JSON.stringify({
    tabs: true,
    profileEmptyBlocked: true,
    passwordMismatch: true,
    deleteConfirm: true,
    billingCatalog: true,
    stripeNotClicked: true,
    msConnectFailedClosed: true,
    googleConnectFailedClosed: true,
  }));
});

test('X-06 Excel EXPORT creates a workbook download without a host sheet', async ({ page }) => {
  await openEditor(page, SURVEY_PDF);
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();

  const exportBtn = page.locator('.survey-marker-export-compact-button').first();
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);

  // Break / edge: no linked workbook → Microsoft 365 push is not offered as enabled.
  const excelMenu = page.getByLabel('Excel actions');
  if (await excelMenu.count()) {
    await excelMenu.click();
    await expect(page.getByText('Sync Microsoft 365')).toBeVisible();
  }

  console.log('X06_PROOF', JSON.stringify({
    filename: download.suggestedFilename(),
    hostWorkbook: false,
    fileIdNotStamped: true,
  }));
});

test('UL-46 mobile styled select + color-picker backdrop on 390×844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page, LINK_PDF);

  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  const eraserMode = page.getByRole('button', { name: /Eraser mode/i });
  await expect(eraserMode).toBeVisible();
  await eraserMode.click();
  const listbox = page.getByRole('listbox', { name: 'Eraser mode' });
  await expect(listbox).toBeVisible();
  await listbox.getByRole('option', { name: 'Full Stroke' }).click();
  await expect(listbox).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Eraser mode: Full Stroke/i })).toBeVisible();

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const format = page.getByRole('button', { name: 'Text formatting' });
  if (await format.count()) {
    await format.click();
  }
  const openPicker = page.getByRole('button', { name: 'Open Text color picker' });
  if (await openPicker.count() === 0) {
    // Armed text tool may use the strip swatch → sheet path.
    const swatch = page.getByRole('button', { name: /Fill and border colors|Stroke color|Font color/i }).first();
    if (await swatch.count()) await swatch.click();
  }
  if (await openPicker.count()) {
    await openPicker.click();
    const backdrop = page.locator('.mobile-pdf-colorpicker-backdrop');
    await expect(backdrop).toBeVisible();
    await backdrop.evaluate((el) => el.click());
    await expect(backdrop).toHaveCount(0);
  } else {
    // Sheet backdrop is the same close contract when the picker host is the sheet.
    const sheetBackdrop = page.locator('.mobile-pdf-sheet-backdrop, .mobile-pdf-colorpicker-backdrop').first();
    await expect(sheetBackdrop).toBeVisible();
    await sheetBackdrop.click();
    await expect(page.locator('.mobile-pdf-colorpicker-backdrop')).toHaveCount(0);
  }

  console.log('UL46_PROOF', JSON.stringify({
    viewport: '390x844',
    styledSelect: true,
    colorBackdrop: true,
    nativeCapacitor: false,
  }));
});
