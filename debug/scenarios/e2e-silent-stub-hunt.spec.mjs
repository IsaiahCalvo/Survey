import { test, expect } from '@playwright/test';

/**
 * Repo-wide silent-success hunt — fail-closed account/auth stubs outside HubPreview.
 * Vite: http://localhost:5173/?testPdf=clickable-link-test.pdf
 * Do not invent a Turnstile token. Do not start live OAuth / Stripe / MSAL.
 */

const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const SPIKE = '/?spike=features';

async function stillOnTestPdf(page) {
  await expect(page).toHaveURL(/testPdf=/);
  await expect(page).not.toHaveURL(/accounts\.google|login\.microsoftonline|identity\.microsoft|checkout\.stripe|billing\.stripe/i);
}

async function goHomeFromTestPdf(page) {
  await page.goto(TEST_PDF);
  await expect(page.locator('.tab-bar').getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.locator('.tab-bar').getByText('Home', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible({ timeout: 30_000 });
}

async function openSettings(page) {
  await goHomeFromTestPdf(page);
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings' }).click();
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

test('intended: save name does not claim profile saved', async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  await dialog.locator('#firstName').fill('Preview');
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(dialog.locator('.account-error')).toContainText(/Test PDF cannot save profile changes/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await expect(dialog.getByText(/updated successfully/i)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await stillOnTestPdf(page);

  console.log('SILENT_STUB_INTENDED_PROFILE', JSON.stringify({ silentSuccess: false }));
});

test('break: save with no name change does not claim success', async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(dialog.locator('.account-error')).toContainText(/No changes detected/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await stillOnTestPdf(page);

  console.log('SILENT_STUB_BREAK_PROFILE_NOOP', JSON.stringify({ claimedSaved: false }));
});

test('edge: set password does not claim password updated', async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  await expect(dialog.getByText('Set a password', { exact: true })).toBeVisible();

  await dialog.locator('#newPassword').fill('PreviewPass12!');
  await dialog.locator('#confirmPassword').fill('MismatchPass12!');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/do not match/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);

  await dialog.locator('#confirmPassword').fill('PreviewPass12!');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Test PDF cannot update passwords|I'm human|human/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await expect(dialog.getByText(/updated successfully/i)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await stillOnTestPdf(page);

  console.log('SILENT_STUB_EDGE_PASSWORD', JSON.stringify({ mismatch: true, silentSuccess: false }));
});

test('intended: Settings Sign out stays signed in', async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();

  await expect(dialog.locator('.account-error')).toContainText(/Test PDF cannot sign out/i);
  await expect(dialog).toBeVisible();
  await stillOnTestPdf(page);
  await dialog.locator('.account-settings-close').click();
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible();
  await expect(page.locator('.profile-signin')).toHaveCount(0);

  console.log('SILENT_STUB_INTENDED_SETTINGS_SIGNOUT', JSON.stringify({ silentSuccess: false, stillSignedIn: true }));
});

test('break: Settings Sign out double-click stays fail-closed', async ({ page }) => {
  const dialog = await openSettings(page);
  const signOut = dialog.getByRole('button', { name: 'Sign out', exact: true });
  await Promise.all([signOut.click(), signOut.click()]);

  await expect(dialog.locator('.account-error')).toContainText(/Test PDF cannot sign out/i);
  await expect(dialog).toBeVisible();
  await stillOnTestPdf(page);

  console.log('SILENT_STUB_BREAK_SIGNOUT_DOUBLE', JSON.stringify({ closed: false }));
});

test('edge: profile-menu Sign out toasts and stays signed in', async ({ page }) => {
  await goHomeFromTestPdf(page);
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Sign out' }).click();
  await page.locator('.profile-signout-confirm .danger').click();

  await expect(page.getByRole('status', { name: 'Dismiss' })).toContainText(/Test PDF cannot sign out/i);
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible();
  await expect(page.locator('.profile-signin')).toHaveCount(0);
  await stillOnTestPdf(page);

  console.log('SILENT_STUB_EDGE_MENU_SIGNOUT', JSON.stringify({ silentSuccess: false, stillSignedIn: true }));
});

test('edge: settings reset-link and delete stay fail-closed', async ({ page }) => {
  const dialog = await openSettings(page);

  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  await dialog.getByRole('button', { name: /Email me a link/i }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Test PDF cannot send password reset emails|I'm human|human/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await dialog.locator('#deleteAccountConfirm').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete account permanently' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Test PDF cannot delete accounts/i);
  await expect(dialog).toBeVisible();
  await stillOnTestPdf(page);

  console.log('SILENT_STUB_EDGE_RESET_DELETE', JSON.stringify({ reset: true, delete: true }));
});

test('edge: Microsoft / Google connect stay fail-closed', async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Connected services' }).click();

  const microsoft = dialog.locator('.account-connected-account').filter({ hasText: 'Microsoft' });
  await microsoft.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Failed to connect Microsoft account|Test PDF cannot start Microsoft login/i);

  const google = dialog.locator('.account-connected-account').filter({ hasText: 'Google' });
  await google.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Test PDF cannot start Google OAuth/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await stillOnTestPdf(page);

  console.log('SILENT_STUB_EDGE_OAUTH_CONNECT', JSON.stringify({ microsoft: true, google: true }));
});

test('edge: share copy/send do not claim invite sent when share exists', async ({ page }) => {
  await goHomeFromTestPdf(page);
  const shareBtn = page.locator('button[title="Share"]').first();
  if (await shareBtn.count() === 0) {
    console.log('SILENT_STUB_EDGE_SHARE', JSON.stringify({ skipped: 'no share button on empty testPdf hub' }));
    await stillOnTestPdf(page);
    return;
  }
  await shareBtn.click();
  const share = page.getByRole('dialog', { name: /Share /i });
  await expect(share).toBeVisible();
  await share.getByRole('button', { name: 'Copy link' }).click();
  await expect(share.getByText(/Sharing needs a signed-in cloud account|cannot create invite/i)).toBeVisible();
  await share.locator('textarea').fill('someone@example.invalid');
  await share.getByRole('button', { name: /Send/i }).click();
  await expect(share.getByText(/Sharing needs a signed-in cloud account|cannot create invite|Enter at least one valid email/i)).toBeVisible();
  await expect(share.getByText(/^Sent \d+/)).toHaveCount(0);
  await stillOnTestPdf(page);

  console.log('SILENT_STUB_EDGE_SHARE', JSON.stringify({ silentSuccess: false }));
});

test('spike: no auth/billing silent-success chrome', async ({ page }) => {
  await page.goto(SPIKE);
  await expect(page.getByRole('button', { name: /Real package|Annotation test|Find/i }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.auth-modal')).toHaveCount(0);
  await expect(page.locator('.account-settings-modal')).toHaveCount(0);
  await expect(page.getByText(/updated successfully|Password reset link sent|Confirmation email sent|upgraded/i)).toHaveCount(0);
  await expect(page).toHaveURL(/spike=features/);
  await expect(page).not.toHaveURL(/accounts\.google|checkout\.stripe|billing\.stripe/i);

  console.log('SILENT_STUB_SPIKE_SANITY', JSON.stringify({ authChrome: false, silentSuccessCopy: false }));
});
