import { test, expect } from '@playwright/test';

/**
 * HubPreview silent-success hunt — fail-closed account/auth stubs.
 * Vite: http://localhost:5173/?hubPreview=1
 * Do not invent a Turnstile token. Do not start live OAuth / Stripe / MSAL.
 */

const HUB = '/?hubPreview=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';

async function openSettings(page) {
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function stillOnPreview(page) {
  await expect(page).toHaveURL(/hubPreview=1/);
  await expect(page).not.toHaveURL(/accounts\.google|login\.microsoftonline|identity\.microsoft|checkout\.stripe|billing\.stripe/i);
}

test('sanity: guest Sign in still fail-closed', async ({ page }) => {
  await page.goto(HUB_GUEST);
  const dialog = page.locator('.auth-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('#email').fill('not-a-user@example.invalid');
  await dialog.locator('#password').fill('wrong-password');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.locator('.auth-error')).toContainText(/Preview cannot sign in|I'm human|human/i);
  await expect(dialog).toBeVisible();
  await stillOnPreview(page);
  console.log('HUBPREVIEW_NOOP_SANITY_SIGNIN', JSON.stringify({ blocked: true }));
});

test('intended: save name does not claim profile saved', async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  await dialog.locator('#firstName').fill('Preview');
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot save profile changes/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await expect(dialog.getByText(/updated successfully/i)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await stillOnPreview(page);

  console.log('HUBPREVIEW_NOOP_INTENDED_PROFILE', JSON.stringify({ silentSuccess: false }));
});

test('break: save with no name change does not claim success', async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(dialog.locator('.account-error')).toContainText(/No changes detected/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await stillOnPreview(page);

  console.log('HUBPREVIEW_NOOP_BREAK_PROFILE_NOOP', JSON.stringify({ claimedSaved: false }));
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

  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot update passwords/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await expect(dialog.getByText(/updated successfully/i)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await stillOnPreview(page);

  console.log('HUBPREVIEW_NOOP_EDGE_PASSWORD', JSON.stringify({ mismatch: true, silentSuccess: false }));
});

test('intended: Settings Sign out stays signed in', async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();

  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot sign out/i);
  await expect(dialog).toBeVisible();
  await stillOnPreview(page);
  await dialog.locator('.account-settings-close').click();
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible();
  await expect(page.locator('.profile-signin')).toHaveCount(0);

  console.log('HUBPREVIEW_NOOP_INTENDED_SETTINGS_SIGNOUT', JSON.stringify({ silentSuccess: false, stillSignedIn: true }));
});

test('break: Settings Sign out double-click stays fail-closed', async ({ page }) => {
  const dialog = await openSettings(page);
  const signOut = dialog.getByRole('button', { name: 'Sign out', exact: true });
  await Promise.all([signOut.click(), signOut.click()]);

  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot sign out/i);
  await expect(dialog).toBeVisible();
  await stillOnPreview(page);

  console.log('HUBPREVIEW_NOOP_BREAK_SIGNOUT_DOUBLE', JSON.stringify({ closed: false }));
});

test('edge: profile-menu Sign out toasts and stays signed in', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Sign out' }).click();
  await page.locator('.profile-signout-confirm .danger').click();

  await expect(page.getByRole('status')).toContainText(/Preview cannot sign out/i);
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible();
  await expect(page.locator('.profile-signin')).toHaveCount(0);
  await stillOnPreview(page);

  console.log('HUBPREVIEW_NOOP_EDGE_MENU_SIGNOUT', JSON.stringify({ silentSuccess: false, stillSignedIn: true }));
});

test('edge: settings reset-link and delete stay fail-closed', async ({ page }) => {
  const dialog = await openSettings(page);

  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  await dialog.getByRole('button', { name: /Email me a link/i }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot send password reset emails|I'm human|human/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await dialog.locator('#deleteAccountConfirm').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete account permanently' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot delete accounts/i);
  await expect(dialog).toBeVisible();
  await stillOnPreview(page);

  console.log('HUBPREVIEW_NOOP_EDGE_RESET_DELETE', JSON.stringify({ reset: true, delete: true }));
});

test('edge: Microsoft / Google connect stay fail-closed', async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Connected services' }).click();

  const microsoft = dialog.locator('.account-connected-account').filter({ hasText: 'Microsoft' });
  await microsoft.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Failed to connect Microsoft account|Preview cannot start Microsoft login/i);

  const google = dialog.locator('.account-connected-account').filter({ hasText: 'Google' });
  await google.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot start Google OAuth/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await stillOnPreview(page);

  console.log('HUBPREVIEW_NOOP_EDGE_OAUTH_CONNECT', JSON.stringify({ microsoft: true, google: true }));
});

test('edge: share copy/send do not claim invite sent', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.locator('button[title="Share"]').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('button[title="Share"]').first().click();
  const share = page.getByRole('dialog', { name: /Share /i });
  await expect(share).toBeVisible();
  await share.getByRole('button', { name: 'Copy link' }).click();
  await expect(share.getByText(/Sharing needs a signed-in cloud account|cannot create invite/i)).toBeVisible();
  await share.locator('textarea').fill('someone@example.invalid');
  await share.getByRole('button', { name: /Send/i }).click();
  await expect(share.getByText(/Sharing needs a signed-in cloud account|cannot create invite|Enter at least one valid email/i)).toBeVisible();
  await expect(share.getByText(/^Sent \d+/)).toHaveCount(0);
  await stillOnPreview(page);

  console.log('HUBPREVIEW_NOOP_EDGE_SHARE', JSON.stringify({ silentSuccess: false }));
});
