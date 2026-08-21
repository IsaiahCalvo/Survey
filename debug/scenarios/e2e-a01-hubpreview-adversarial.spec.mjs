import { test, expect } from '@playwright/test';

/**
 * A-01 hubPreview fail-closed — adversarial + extra edges.
 * Vite: http://localhost:5173/?hubPreview=1&guest=1
 * Do not invent a Turnstile token. Do not start live OAuth / MSAL.
 */

const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';

async function openGuestAuth(page) {
  await page.goto(HUB_GUEST);
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });
  const dialog = page.locator('.auth-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function modalStillOpen(page, dialog) {
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/hubPreview=1/);
  await expect(page).not.toHaveURL(/accounts\.google|login\.microsoftonline|identity\.microsoft|supabase\.co\/auth/i);
}

test('A-01 intended: submit without captcha token blocks and stays open', async ({ page }) => {
  const dialog = await openGuestAuth(page);
  await expect(dialog.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await dialog.locator('#email').fill('not-a-user@example.invalid');
  await dialog.locator('#password').fill('wrong-password');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(dialog.locator('.auth-error')).toContainText(/Preview cannot sign in|I'm human|human/i);
  await modalStillOpen(page, dialog);
  await expect(page.locator('.profile-signin').first()).toBeVisible();

  console.log('A01_ADV_INTENDED', JSON.stringify({ blocked: true, closed: false }));
});

test('A-01 break: empty email / empty password / garbage email do not close', async ({ page }) => {
  const dialog = await openGuestAuth(page);
  const email = dialog.locator('#email');
  const password = dialog.locator('#password');
  const submit = dialog.getByRole('button', { name: 'Sign in', exact: true });

  // Empty email + empty password: native required, no submit, no close.
  await submit.click();
  expect(await email.evaluate((el) => el.checkValidity())).toBe(false);
  await modalStillOpen(page, dialog);

  // Empty password only.
  await email.fill('not-a-user@example.invalid');
  await password.fill('');
  await submit.click();
  expect(await password.evaluate((el) => el.checkValidity())).toBe(false);
  await modalStillOpen(page, dialog);

  // Garbage email fails type=email; modal stays.
  await email.fill('not-an-email');
  await password.fill('wrong-password');
  await submit.click();
  expect(await email.evaluate((el) => el.checkValidity())).toBe(false);
  await modalStillOpen(page, dialog);
  await expect(dialog.locator('.auth-error')).toHaveCount(0);

  console.log('A01_ADV_BREAK_EMPTY_GARBAGE', JSON.stringify({
    emptyEmail: true,
    emptyPassword: true,
    garbageEmail: true,
    closed: false,
  }));
});

test('A-01 break: double-submit stays fail-closed (one error, no close)', async ({ page }) => {
  const dialog = await openGuestAuth(page);
  await dialog.locator('#email').fill('not-a-user@example.invalid');
  await dialog.locator('#password').fill('wrong-password');
  const submit = dialog.getByRole('button', { name: 'Sign in', exact: true });
  await Promise.all([submit.click(), submit.click()]);

  await expect(dialog.locator('.auth-error')).toContainText(/Preview cannot sign in|I'm human|human/i);
  await expect(dialog.locator('.auth-error')).toHaveCount(1);
  await modalStillOpen(page, dialog);
  await expect(submit).toBeEnabled();

  console.log('A01_ADV_BREAK_DOUBLE', JSON.stringify({ errorCount: 1, closed: false }));
});

test('A-01 edge: Sign up / Continue without account / Google / Microsoft+SSO', async ({ page }) => {
  const dialog = await openGuestAuth(page);

  // Sign up with matching, policy-passing fields still fail-closed.
  await dialog.getByRole('button', { name: 'Create an account' }).click();
  await expect(dialog.getByRole('heading', { name: 'Create account' })).toBeVisible();
  await dialog.locator('#email').fill('preview-signup@example.invalid');
  await dialog.locator('#firstName').fill('Pat');
  await dialog.locator('#lastName').fill('Lee');
  await dialog.locator('#password').fill('PreviewPass12!');
  await dialog.locator('#confirmPassword').fill('PreviewPass12!');
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog.locator('.auth-error')).toContainText(/Preview cannot create an account|I'm human|human/i);
  await expect(dialog.getByRole('heading', { name: 'Check your email' })).toHaveCount(0);
  await modalStillOpen(page, dialog);

  // Back to Sign in; Google does not start live OAuth.
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  const beforeGoogle = page.url();
  page.on('popup', (popup) => {
    throw new Error(`Google started a popup: ${popup.url()}`);
  });
  await dialog.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(dialog.locator('.auth-error')).toContainText(/Preview cannot start Google sign-in/i);
  expect(page.url()).toBe(beforeGoogle);
  await modalStillOpen(page, dialog);

  // Microsoft is not a guest AuthModal button. SSO is the live-OAuth-adjacent
  // control on this surface; it must fail-closed without a redirect.
  await expect(dialog.getByRole('button', { name: /Microsoft|Continue with Microsoft/i })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Sign in with company SSO (enterprise)' }).click();
  await expect(dialog.getByRole('heading', { name: 'Company sign-in' })).toBeVisible();
  await dialog.locator('#ssoDomain').fill('contoso.com');
  const beforeSso = page.url();
  await dialog.getByRole('button', { name: 'Continue with SSO' }).click();
  await expect(dialog.locator('.auth-error')).toContainText(/Preview cannot start SSO/i);
  expect(page.url()).toBe(beforeSso);
  await modalStillOpen(page, dialog);

  // Continue without an account dismisses and leaves guest chrome.
  await dialog.getByRole('button', { name: 'Continue without an account' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.profile-signin').first()).toBeVisible();
  await expect(page).toHaveURL(/hubPreview=1/);

  console.log('A01_ADV_EDGE_MODES', JSON.stringify({
    signupBlocked: true,
    googleNoOAuth: true,
    microsoftButtonAbsent: true,
    ssoBlocked: true,
    continueWithoutAccount: true,
  }));
});

test('A-01 extra: Forgot password fail-closed (no silent success)', async ({ page }) => {
  const dialog = await openGuestAuth(page);
  await dialog.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(dialog.getByRole('heading', { name: 'Reset password' })).toBeVisible();
  await dialog.locator('#email').fill('not-a-user@example.invalid');
  await dialog.getByRole('button', { name: 'Send reset link' }).click();

  await expect(dialog.locator('.auth-error')).toContainText(/Preview cannot send password reset emails/i);
  await expect(dialog.locator('.auth-message')).toHaveCount(0);
  await modalStillOpen(page, dialog);

  console.log('A01_ADV_EXTRA_RESET', JSON.stringify({ silentSuccess: false, closed: false }));
});
