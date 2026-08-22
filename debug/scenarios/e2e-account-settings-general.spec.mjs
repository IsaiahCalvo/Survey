import { test, expect } from '@playwright/test';

// Account Settings General local chrome.
// Last A-04 hunt only opened / closed tabs. This slice is INSIDE Settings.
// Do not replay A-04 menu open/close / Sign out confirm-Cancel as the main
// slice. Fail-closed: A-01 Turnstile / AuthModal, A-02 live MSAL,
// A-03 inbox, A-05 Stripe / Subscription billing, A-06 roster.
// Do not invent .env.local / Stripe / MSAL / wipe persist.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function accountChip(page) {
  return page.getByRole('button', { name: 'Open account menu' });
}

function settingsDialog(page) {
  return page.locator('.account-settings-modal');
}

async function openSettingsFromHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await openPage(page, { width, height, url });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const chip = width <= 420
    ? page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' })
    : accountChip(page);
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  return dialog;
}

function generalDisplays(dialog) {
  return dialog.locator('.account-field-display');
}

async function displayedProfile(dialog) {
  return generalDisplays(dialog).evaluateAll((nodes) => (
    nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
  ));
}

test('Account Settings General local chrome intended / break / edge', async ({ page }) => {
  test.setTimeout(180_000);

  const dialog = await openSettingsFromHub(page);

  // Intended: always land on General. No theme / appearance / notification
  // toggles exist in this pane — do not invent them.
  await expect(dialog.getByRole('button', { name: 'General', exact: true })).toBeVisible();
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(dialog.getByRole('heading', { name: 'Profile information' })).toBeVisible();
  await expect(dialog.getByText('Theme', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Appearance', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Dark mode', { exact: true })).toHaveCount(0);
  await expect(dialog.locator('input[type="checkbox"], [role="switch"]')).toHaveCount(0);

  const seededProfile = await displayedProfile(dialog);
  expect(seededProfile).toEqual([
    'Isaiah',
    'Calvo',
    'dev-hubpreview@example.invalid',
  ]);
  await expect(dialog.getByText('Email cannot be changed')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edit profile' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();

  // Intended: Edit profile + Cancel restores the seeded names.
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  const first = dialog.locator('#firstName');
  const last = dialog.locator('#lastName');
  const email = dialog.locator('#email');
  await expect(first).toHaveValue('Isaiah');
  await expect(last).toHaveValue('Calvo');
  await expect(email).toBeDisabled();
  await expect(email).toHaveValue('dev-hubpreview@example.invalid');
  await expect(dialog.getByText('Set a password')).toBeVisible();
  await expect(dialog.getByText('Password requirements')).toBeVisible();
  await expect(dialog.locator('#currentPassword')).toHaveCount(0);
  await first.fill('Pat');
  await last.fill('Lee');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await displayedProfile(dialog)).toEqual([
    'Isaiah',
    'Calvo',
    'dev-hubpreview@example.invalid',
  ]);
  await expect(page.locator('.who .name').first()).toContainText('Isaiah Calvo');

  // Break: empty / partial required names stay in the browser validity gate.
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  await first.fill('');
  await last.fill('');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  expect(await first.evaluate((el) => !el.checkValidity())).toBe(true);
  await first.fill('Pat');
  await last.fill('');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  expect(await last.evaluate((el) => !el.checkValidity())).toBe(true);

  // Intended: unchanged Save is a local noop. Name change is previewBlocked.
  await first.fill('Isaiah');
  await last.fill('Calvo');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/No changes detected/i);
  await first.fill('Pat');
  await last.fill('Lee');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot save profile changes/i);
  await expect(first).toHaveValue('Pat');
  await expect(page.locator('.who .name').first()).toContainText('Isaiah Calvo');

  // Break: password mismatch / weak password stay local. Reset link is
  // leftover-18 (Turnstile / previewBlocked). Do not invent a token.
  await first.fill('Isaiah');
  await last.fill('Calvo');
  await dialog.locator('#newPassword').fill('short');
  await expect(dialog.getByText('Password does not meet requirements')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/do not match|requirements/i);
  await dialog.locator('#newPassword').fill('PreviewPass1!');
  await dialog.locator('#confirmPassword').fill('PreviewPass2!');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/do not match/i);
  await dialog.getByRole('button', { name: /Email me a link to set a password/i }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot send password reset|human/i);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await displayedProfile(dialog)).toEqual([
    'Isaiah',
    'Calvo',
    'dev-hubpreview@example.invalid',
  ]);

  // Local delete confirm chrome. Wipe persist stays leftover-18.
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
  const wipe = dialog.getByRole('button', { name: 'Delete account permanently' });
  await dialog.locator('#deleteAccountConfirm').fill('delete');
  await expect(wipe).toBeDisabled();
  await dialog.locator('#deleteAccountConfirm').fill('DELETE');
  await expect(wipe).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(wipe).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible();

  // Settings Sign out (not the account-menu confirm). Preview fail-closed.
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot sign out/i);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // Classify Connected / Subscription as leftover-18 host-gated UI.
  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Connected services' })).toBeVisible();
  await expect(dialog.getByText('Microsoft')).toBeVisible();
  await expect(dialog.getByText('Google')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Manage subscription' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Usage' })).toBeVisible();
  await expect(dialog.getByText('Pro', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial|Developer account/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Contact sales' })).toBeVisible();
  // Do not click Start trial (A-05 Stripe) or Connect (A-02 MSAL).
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(dialog.getByRole('button', { name: 'Edit profile' })).toBeVisible();

  // Edge: Escape / overlay / close. Reopen always lands on General.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible();

  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible({ timeout: 15_000 });
  await expect(settingsDialog(page).locator('.account-sidebar-btn.active')).toHaveText('General');
  await settingsDialog(page).getByRole('button', { name: 'Subscription', exact: true }).click();
  await settingsDialog(page).locator('.account-settings-close').click();
  await expect(settingsDialog(page)).toHaveCount(0);

  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page).locator('.account-sidebar-btn.active')).toHaveText('General');
  await page.locator('.account-settings-overlay').click({ position: { x: 8, y: 8 } });
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible();

  // Guest: Settings is not reachable. AuthModal stays A-01 leftover-18.
  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });
  await expect(accountChip(page)).toHaveCount(0);
  await expect(page.locator('.auth-modal')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
  await expect(settingsDialog(page)).toHaveCount(0);

  // ?testPdf= Home reaches the same General pane (editor chip is under overlay).
  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.locator('.tab-bar').getByText('Home', { exact: true }).click();
  await expect(accountChip(page)).toBeVisible({ timeout: 30_000 });
  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const testPdfDialog = settingsDialog(page);
  await expect(testPdfDialog).toBeVisible({ timeout: 15_000 });
  await expect(testPdfDialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  expect(await displayedProfile(testPdfDialog)).toEqual([
    'Isaiah',
    'Calvo',
    'dev-hubpreview@example.invalid',
  ]);
  await testPdfDialog.getByRole('button', { name: 'Edit profile' }).click();
  await testPdfDialog.locator('#firstName').fill('HomePat');
  await testPdfDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await displayedProfile(testPdfDialog)).toEqual([
    'Isaiah',
    'Calvo',
    'dev-hubpreview@example.invalid',
  ]);
  await testPdfDialog.locator('.account-settings-close').click();

  // 390: same General chrome. Overlay is full-bleed — use Escape, not scrim.
  const mobile = await openSettingsFromHub(page, { width: 390, height: 844, url: HUB });
  await expect(mobile.locator('.account-sidebar-btn.active')).toHaveText('General');
  expect(await displayedProfile(mobile)).toEqual([
    'Isaiah',
    'Calvo',
    'dev-hubpreview@example.invalid',
  ]);
  await expect(mobile.getByText('Theme', { exact: true })).toHaveCount(0);
  await mobile.getByRole('button', { name: 'Edit profile' }).click();
  await mobile.locator('#firstName').fill('MobilePat');
  await mobile.locator('#lastName').fill('MobileLee');
  await mobile.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await displayedProfile(mobile)).toEqual([
    'Isaiah',
    'Calvo',
    'dev-hubpreview@example.invalid',
  ]);
  await mobile.getByRole('button', { name: 'Edit profile' }).click();
  await mobile.locator('#firstName').fill('MobilePat');
  await mobile.locator('#lastName').fill('MobileLee');
  await mobile.getByRole('button', { name: 'Save changes' }).click();
  await expect(mobile.locator('.account-error')).toContainText(/Preview cannot save profile changes/i);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.locator('.who .name').first()).toContainText('Isaiah Calvo');

  const proof = {
    seededProfile,
    noThemeToggles: true,
    cancelRestores: true,
    emptyRequiredBlocked: true,
    noopSave: true,
    nameSaveFailClosed: true,
    passwordMismatch: true,
    resetLinkFailClosed: true,
    deleteConfirmLocal: true,
    settingsSignOutFailClosed: true,
    connectedSubscriptionLeftover18: true,
    stripeNotClicked: true,
    msalNotClicked: true,
    escapeClose: true,
    reopenLandsGeneral: true,
    overlayClose: true,
    documentsIsolation: true,
    guestNoSettings: true,
    testPdfHomeGeneral: true,
    mobileGeneral: true,
    chipNameUnchanged: true,
  };
  console.log('ACCOUNT_SETTINGS_GENERAL_PROOF', JSON.stringify(proof));
  expect(proof.noThemeToggles).toBe(true);
  expect(proof.connectedSubscriptionLeftover18).toBe(true);
});
