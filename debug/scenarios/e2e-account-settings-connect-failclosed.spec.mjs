import { test, expect } from '@playwright/test';

// Leftover-18 A-02 / UL-21 fail-closed slice that was still thinner than a
// dedicated intended+break+edge proof: Account Settings Connect.
// leftover18-unblock + chrome-03 already click Microsoft/Google once.
// Click must not complete MSAL, navigate to Microsoft/Google OAuth, or mint
// a token. Distinct from leftover18-unblock catalog, chrome-03 Microsoft
// click, Settings General / Usage, Guest AuthModal A-01, Documents Upload,
// and Start trial.
// Do not invent .env.local, MSAL, Google OAuth completion, Stripe, Turnstile,
// leases, or SQL.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const OWNER = 'Package 2 — Rev 4 — IC.pdf';
const TRIAL = /Start 7-day trial|Start annual trial/;
const MSAL_HOST = /login\.microsoftonline|login\.live|login\.microsoft\.com|account\.live|graph\.microsoft|msal/i;
const GOOGLE_HOST = /accounts\.google|googleapis\.com\/identity|oauth2\.googleapis/i;
const OAUTH_HOST = /login\.microsoftonline|login\.live|login\.microsoft\.com|accounts\.google|oauth2|graph\.microsoft/i;

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

function microsoftRow(dialog) {
  return dialog.locator('.account-connected-account').filter({ hasText: 'Microsoft' });
}

function googleRow(dialog) {
  return dialog.locator('.account-connected-account').filter({ hasText: 'Google' });
}

function attachOAuthWatchers(page) {
  const opened = [];
  const oauthReqs = [];
  page.on('request', (req) => {
    const url = req.url();
    if (OAUTH_HOST.test(url)) oauthReqs.push(url);
  });
  page.on('popup', (popup) => {
    opened.push(popup.url());
  });
  return { opened, oauthReqs };
}

async function stubWindowOpen(page, opened) {
  await page.exposeFunction('__connectRecordOpen', (url) => {
    opened.push(String(url || ''));
  });
  await page.addInitScript(() => {
    window.open = (url) => {
      window.__connectRecordOpen?.(url);
      return null;
    };
  });
}

async function tokenProbe(page) {
  return page.evaluate(() => {
    const keys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
    return {
      msalKeys: keys.filter((key) => /msal|microsoft|google.*token|access_token|id_token|refresh_token/i.test(key)),
      windowMsal: Boolean(window.msal),
    };
  });
}

async function assertNoOAuth(page, dialog, { opened, oauthReqs }) {
  expect(opened.filter((url) => OAUTH_HOST.test(url))).toEqual([]);
  expect(oauthReqs).toEqual([]);
  await expect(page).toHaveURL(/hubPreview=1|testPdf=/);
  await expect(page).not.toHaveURL(MSAL_HOST);
  await expect(page).not.toHaveURL(GOOGLE_HOST);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  const tokens = await tokenProbe(page);
  expect(tokens.msalKeys).toEqual([]);
  expect(tokens.windowMsal).toBe(false);
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
  return dialog;
}

async function openConnectedServices(dialog) {
  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Connected services' })).toBeVisible();
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('Connected services');
}

async function clickConnectFailClosed(page, dialog, watchers, { provider, message }) {
  const row = provider === 'microsoft' ? microsoftRow(dialog) : googleRow(dialog);
  const connect = row.getByRole('button', { name: 'Connect', exact: true });
  await expect(connect).toBeVisible();
  await expect(connect).toBeEnabled();
  const popupPromise = page.waitForEvent('popup', { timeout: 1500 }).catch(() => null);
  await connect.click();
  await expect(dialog.locator('.account-error')).toHaveText(message);
  expect(await popupPromise).toBeNull();
  await expect(row.getByText(/Not connected/)).toBeVisible();
  await expect(row.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: /Disconnect|Reconnect/ })).toHaveCount(0);
  await assertNoOAuth(page, dialog, watchers);
}

test('Account Settings Connect fail-closed intended / break / edge', async ({ page }) => {
  test.setTimeout(180_000);
  const watchers = attachOAuthWatchers(page);
  await stubWindowOpen(page, watchers.opened);
  await page.route(MSAL_HOST, (route) => route.abort());
  await page.route(GOOGLE_HOST, (route) => route.abort());

  const hubMs = 'Preview cannot start Microsoft login.';
  const hubGoogle = 'Preview cannot start Google OAuth.';
  const testPdfMs = 'Test PDF cannot start Microsoft login.';
  const testPdfGoogle = 'Test PDF cannot start Google OAuth.';

  // --- Intended: seeded hub Connected services → Microsoft then Google ---
  const dialog = await openSettingsFromHub(page);
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);

  await openConnectedServices(dialog);
  await expect(dialog.getByText('Not connected. Connect to sync exported surveys')).toBeVisible();
  await expect(dialog.getByText('Not connected. Use as an alternative login method')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: TRIAL })).toHaveCount(0);
  await expect(dialog.getByText(/iOS\/Android app/)).toHaveCount(0);
  const capacitorHidden = await page.evaluate(() => {
    const origin = String(window.location?.origin || '');
    return origin.startsWith('capacitor://') || origin.startsWith('ionic://');
  });
  expect(capacitorHidden).toBe(false);

  await clickConnectFailClosed(page, dialog, watchers, {
    provider: 'microsoft',
    message: hubMs,
  });
  await clickConnectFailClosed(page, dialog, watchers, {
    provider: 'google',
    message: hubGoogle,
  });

  // Double-click still fail-closed (no MSAL / Google token minted).
  await clickConnectFailClosed(page, dialog, watchers, {
    provider: 'microsoft',
    message: hubMs,
  });
  await clickConnectFailClosed(page, dialog, watchers, {
    provider: 'google',
    message: hubGoogle,
  });

  // --- Break: Subscription / General isolation (do not replay Start trial) ---
  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await dialog.getByRole('button', { name: 'Manage subscription', exact: true }).click();
  await expect(dialog.getByRole('button', { name: TRIAL })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Contact sales' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(dialog.getByText('0 B / 100.0 GB')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: TRIAL })).toBeHidden();

  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await expect(dialog.getByText('Isaiah')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: TRIAL })).toHaveCount(0);

  await openConnectedServices(dialog);
  await expect(dialog.getByText(hubGoogle)).toBeVisible();
  await clickConnectFailClosed(page, dialog, watchers, {
    provider: 'microsoft',
    message: hubMs,
  });

  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByText(OWNER).first()).toBeVisible();

  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page).locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(settingsDialog(page).locator('.account-error')).toHaveCount(0);
  await settingsDialog(page).locator('.account-settings-close').click();

  // --- Break: empty=1 still has Connect; same fail-closed ---
  const emptyDialog = await openSettingsFromHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible();
  await openConnectedServices(emptyDialog);
  await clickConnectFailClosed(page, emptyDialog, watchers, {
    provider: 'microsoft',
    message: hubMs,
  });
  await clickConnectFailClosed(page, emptyDialog, watchers, {
    provider: 'google',
    message: hubGoogle,
  });
  await emptyDialog.locator('.account-settings-close').click();

  // --- Break: guest has no Settings / no Connect (do not replay A-01 submit) ---
  await openPage(page, { url: HUB_GUEST });
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(accountChip(page)).toHaveCount(0);
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);

  // --- Edge: ?testPdf= Home ---
  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.locator('.tab-bar').getByText('Home', { exact: true }).click();
  await expect(accountChip(page)).toBeVisible({ timeout: 30_000 });
  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const testPdfDialog = settingsDialog(page);
  await expect(testPdfDialog).toBeVisible({ timeout: 15_000 });
  await expect(testPdfDialog.getByText('Isaiah')).toHaveCount(0);
  await expect(testPdfDialog.getByText('Dev', { exact: true })).toBeVisible();
  await openConnectedServices(testPdfDialog);
  await clickConnectFailClosed(page, testPdfDialog, watchers, {
    provider: 'microsoft',
    message: testPdfMs,
  });
  await clickConnectFailClosed(page, testPdfDialog, watchers, {
    provider: 'google',
    message: testPdfGoogle,
  });
  await testPdfDialog.locator('.account-settings-close').click();

  // --- Edge: 390 ---
  const mobile = await openSettingsFromHub(page, { width: 390, height: 844, url: HUB });
  await openConnectedServices(mobile);
  await clickConnectFailClosed(page, mobile, watchers, {
    provider: 'microsoft',
    message: hubMs,
  });
  await clickConnectFailClosed(page, mobile, watchers, {
    provider: 'google',
    message: hubGoogle,
  });
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  const proof = {
    intendedMicrosoft: true,
    intendedGoogle: true,
    doubleClick: true,
    subscriptionIsolated: true,
    usageIsolated: true,
    generalIsolated: true,
    escapeClose: true,
    reopenLandsGeneral: true,
    emptyHub: true,
    guestNoSettings: true,
    testPdfHome: true,
    mobile390: true,
    oauthRequestCount: watchers.oauthReqs.length,
    oauthOpened: watchers.opened.filter((url) => OAUTH_HOST.test(url)).length,
    leftover18HostNotInvented: true,
  };
  console.log('ACCOUNT_SETTINGS_CONNECT_FAILCLOSED_PROOF', JSON.stringify(proof));
  expect(proof.oauthRequestCount).toBe(0);
  expect(proof.oauthOpened).toBe(0);
  expect(proof.guestNoSettings).toBe(true);
});
