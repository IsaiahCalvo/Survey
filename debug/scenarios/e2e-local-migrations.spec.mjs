import { test, expect } from '@playwright/test';

// Safe signed-in leftovers next to the local-migration attempt.
// Do not wipe. Do not click Stripe. Do not create accounts or plus-aliases.
// Microsoft: start OAuth then cancel — no password. Skip if already connected.
// Invite Send: clearly invalid address only (client fail-closed).

function sanitizeAuthLog(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]');
}

async function waitSignedInHub(page) {
  const pageErrors = [];
  const authLogs = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));
  page.on('console', (msg) => {
    const text = msg.text();
    if (/dev-auto-login|captcha|sign-in FAILED|creds NOT loaded/i.test(text)) {
      authLogs.push(sanitizeAuthLog(text).slice(0, 180));
    }
  });
  await page.addInitScript(() => { window.__AUTH_DEBUG = true; });
  await page.goto('/');
  const accountMenu = page.getByRole('button', { name: 'Open account menu' });
  try {
    await accountMenu.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    return { signedIn: false, authLogs, pageErrors };
  }
  return { signedIn: true, authLogs, pageErrors };
}

async function openSettings(page) {
  const trigger = page.getByRole('button', { name: 'Open account menu' });
  const menu = page.getByRole('menu', { name: 'Account menu' });
  for (let i = 0; i < 3; i += 1) {
    try {
      if (!(await menu.count())) {
        await trigger.click({ timeout: 8_000, force: true });
      }
      await menu.waitFor({ state: 'visible', timeout: 4_000 });
      await menu.getByRole('menuitem', { name: 'Settings', exact: true }).click({ timeout: 4_000 });
      return true;
    } catch {
      if (await menu.count()) {
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
  }
  return false;
}

test('signed-in MS OAuth cancel + invalid invite send fail-closed', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

  const boot = await waitSignedInHub(page);
  console.log('AUTOLOGIN', JSON.stringify({
    signedIn: boot.signedIn,
    href: page.url(),
    pageErrorCount: (boot.pageErrors || []).length,
    authLogs: boot.authLogs || [],
  }));
  if (!boot.signedIn) {
    test.info().annotations.push({ type: 'blocker', description: 'auto-login did not produce a hub session' });
    console.log('MS_OAUTH', JSON.stringify({ visible: false, started: false, cancelled: false, reason: 'not signed in' }));
    console.log('INVITE_SEND', JSON.stringify({ sent: false, reason: 'not signed in' }));
    return;
  }

  // Invite first (does not need Settings). Invalid address only — no live mint.
  const firstDoc = page.locator('.documents-desktop-card [data-document-id]').first();
  await expect(firstDoc).toBeVisible({ timeout: 45_000 });
  await firstDoc.click({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Share' }).click();

  if (await page.getByRole('button', { name: 'Invite' }).count()) {
    await page.getByRole('button', { name: 'Invite' }).click();
  }

  const dialog = page.locator('[role="dialog"]').filter({ has: page.getByRole('button', { name: /Send .* invite/i }) }).first();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('textarea').first().fill('not-an-email');
  await dialog.getByRole('button', { name: /Send viewer invite/i }).click();
  const failClosed = await dialog.getByText('Enter at least one valid email.').count();
  const successCopy = await dialog.getByText(/Sent \d+ .* share email/i).count();
  expect(failClosed).toBeGreaterThan(0);
  expect(successCopy).toBe(0);
  console.log('INVITE_SEND', JSON.stringify({
    address: 'not-an-email',
    failClosed: failClosed > 0,
    emailDelivered: false,
    plusAlias: false,
  }));
  await dialog.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
  if (await dialog.count()) await page.keyboard.press('Escape').catch(() => {});
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible({ timeout: 45_000 });

  // Microsoft Connect: start OAuth and cancel only if Connect is visible.
  const opened = await openSettings(page);
  if (!opened) {
    console.log('MS_OAUTH', JSON.stringify({
      visible: false,
      started: false,
      cancelled: false,
      reason: 'settings menu did not open after invite',
    }));
    return;
  }

  const settings = page.locator('.account-settings-modal');
  await expect(settings.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  await settings.getByRole('button', { name: 'Connected services' }).click();
  await expect(settings.getByText('Microsoft')).toBeVisible();

  const alreadyConnected = await settings.getByText(/Connected as /i).count();
  const connectBtn = settings.getByRole('button', { name: /^(Connect|Reconnect)$/ }).first();
  const connectVisible = await connectBtn.count();
  const status = alreadyConnected
    ? 'already-connected'
    : (connectVisible ? 'connect-visible' : 'hidden');

  let started = false;
  let cancelled = false;
  let oauthHost = null;
  if (status === 'connect-visible') {
    await connectBtn.click();
    try {
      await page.waitForURL(/login\.microsoftonline\.com|login\.live\.com|microsoftonline/i, { timeout: 20_000 });
      started = true;
      oauthHost = new URL(page.url()).host;
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      if (/login\.microsoftonline\.com|login\.live\.com/i.test(page.url())) {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
      }
      cancelled = !/login\.microsoftonline\.com|login\.live\.com/i.test(page.url());
    } catch {
      const err = await settings.locator('.account-error').textContent().catch(() => '');
      console.log('MS_OAUTH', JSON.stringify({
        visible: true,
        started: false,
        cancelled: false,
        status,
        errorHint: err ? sanitizeAuthLog(err).slice(0, 80) : 'no redirect and no settings error',
      }));
      return;
    }
  }

  console.log('MS_OAUTH', JSON.stringify({
    visible: status === 'connect-visible',
    status,
    started,
    cancelled,
    oauthHost,
    passwordTyped: false,
  }));
});
