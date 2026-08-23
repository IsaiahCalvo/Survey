import { test, expect } from '@playwright/test';

// Leftover-18 UL-16 fail-closed slice that was still thinner than a
// dedicated intended+break+edge proof: Account Settings Delete account
// permanently. leftover18-unblock already clicked wipe once; Settings
// General only proved Cancel. Click must not invoke delete-account, reload,
// sign Isaiah out, or drop hub rows.
// Distinct from leftover18-unblock catalog, Settings General Cancel,
// Connect, Start trial, Usage, Guest AuthModal A-01, Documents Upload.
// Do not invent .env.local, a wipe backend, Stripe, MSAL, Turnstile,
// leases, or SQL.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const OWNER = 'Package 2 — Rev 4 — IC.pdf';
const TRIAL = /Start 7-day trial|Start annual trial/;
const WIPE_FN = /delete-account|delete_account/i;
const AUTH_WIPE = /\/auth\/v1\/(admin\/users|user)/i;
const GONE = /account (deleted|closed|removed)|signed out|goodbye/i;

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

function wipeButton(dialog) {
  return dialog.getByRole('button', { name: 'Delete account permanently' });
}

function visibleOwner(page) {
  // 390 keeps the desktop ledger span in the tree but hidden.
  return page.getByText(OWNER).filter({ visible: true });
}

function attachWipeWatchers(page) {
  const wipeReqs = [];
  const authReqs = [];
  page.on('request', (req) => {
    const url = req.url();
    if (WIPE_FN.test(url)) wipeReqs.push(url);
    if (AUTH_WIPE.test(url)) authReqs.push(url);
  });
  return { wipeReqs, authReqs };
}

async function assertAccountStillHere(page, dialog, { profile = 'Isaiah' } = {}) {
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(dialog.getByText(profile, { exact: true })).toBeVisible();
  await expect(accountChip(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: GONE })).toHaveCount(0);
}

async function assertNoWipe(page, dialog, watchers, { urlPattern = /hubPreview=1|testPdf=/ } = {}) {
  expect(watchers.wipeReqs).toEqual([]);
  expect(watchers.authReqs).toEqual([]);
  await expect(page).toHaveURL(urlPattern);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
}

async function openSettingsFromHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await openPage(page, { width, height, url });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const chip = width <= 420
    ? page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' })
    : accountChip(page);
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function openWipeConfirm(dialog) {
  // Tab switches unmount General chrome but keep deleteConfirmOpen, so
  // returning to General can already be on the confirm panel.
  if (await wipeButton(dialog).count()) {
    await expect(dialog.getByText('Delete this account?')).toBeVisible();
    await expect(wipeButton(dialog)).toBeVisible();
    return;
  }
  const open = dialog.getByRole('button', { name: 'Delete account', exact: true });
  await expect(open).toBeVisible();
  await expect(open).toBeEnabled();
  await open.click();
  await expect(dialog.getByText('Delete this account?')).toBeVisible();
  await expect(wipeButton(dialog)).toBeVisible();
  await expect(wipeButton(dialog)).toBeDisabled();
}

async function typeConfirm(dialog, value) {
  await dialog.locator('#deleteAccountConfirm').fill(value);
}

async function clickWipeFailClosed(page, dialog, watchers, { message, profile = 'Isaiah' } = {}) {
  await expect(wipeButton(dialog)).toBeEnabled();
  const navPromise = page.waitForEvent('framenavigated', { timeout: 1500 }).catch(() => null);
  await wipeButton(dialog).click();
  await expect(dialog.locator('.account-error')).toHaveText(message);
  expect(await navPromise).toBeNull();
  await expect(wipeButton(dialog)).toBeVisible();
  await expect(wipeButton(dialog)).toHaveText('Delete account permanently');
  await assertAccountStillHere(page, dialog, { profile });
  await assertNoWipe(page, dialog, watchers);
}

test('Account Settings Delete account permanently fail-closed intended / break / edge', async ({ page }) => {
  test.setTimeout(180_000);
  const watchers = attachWipeWatchers(page);
  await page.route(WIPE_FN, (route) => route.abort());
  await page.route(AUTH_WIPE, (route) => route.abort());

  const hubMsg = 'Preview cannot delete accounts.';
  const testPdfMsg = 'Test PDF cannot delete accounts.';

  // --- Intended: seeded hub General → confirm gate + Cancel + Confirm ---
  const dialog = await openSettingsFromHub(page);
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(dialog.getByText('Isaiah', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Calvo', { exact: true })).toBeVisible();
  await expect(accountChip(page).locator('.name')).toHaveText('Isaiah Calvo');
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: TRIAL })).toHaveCount(0);

  await openWipeConfirm(dialog);
  await typeConfirm(dialog, 'delete');
  await expect(wipeButton(dialog)).toBeDisabled();
  await typeConfirm(dialog, 'Delete');
  await expect(wipeButton(dialog)).toBeDisabled();
  await typeConfirm(dialog, 'DELETES');
  await expect(wipeButton(dialog)).toBeDisabled();
  await typeConfirm(dialog, 'DELETE');
  await expect(wipeButton(dialog)).toBeEnabled();

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(wipeButton(dialog)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible();
  await expect(dialog.locator('.account-error')).toHaveCount(0);
  await assertAccountStillHere(page, dialog);

  await openWipeConfirm(dialog);
  await typeConfirm(dialog, 'DELETE');
  await clickWipeFailClosed(page, dialog, watchers, { message: hubMsg });

  // Double-click still fail-closed (no wipe invoke / no account gone).
  await clickWipeFailClosed(page, dialog, watchers, { message: hubMsg });

  // --- Break: Connect / Start trial isolation (do not complete those) ---
  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Connected services' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toHaveCount(0);
  await expect(wipeButton(dialog)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: TRIAL })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await dialog.getByRole('button', { name: 'Manage subscription', exact: true }).click();
  await expect(dialog.getByRole('button', { name: TRIAL })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Contact sales' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toHaveCount(0);
  await expect(wipeButton(dialog)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(dialog.getByText('0 B / 100.0 GB')).toBeVisible();
  await expect(dialog.getByRole('button', { name: TRIAL })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await expect(dialog.getByText('Isaiah', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: TRIAL })).toHaveCount(0);
  await openWipeConfirm(dialog);
  await typeConfirm(dialog, 'DELETE');
  await clickWipeFailClosed(page, dialog, watchers, { message: hubMsg });

  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(visibleOwner(page)).toBeVisible();
  await expect(accountChip(page).locator('.name')).toHaveText('Isaiah Calvo');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);

  await accountChip(page).click();
  await expect(page.getByRole('menu', { name: 'Account menu' })).toContainText('Isaiah Calvo');
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page).locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(settingsDialog(page).locator('.account-error')).toHaveCount(0);
  await expect(settingsDialog(page).getByText('Isaiah', { exact: true })).toBeVisible();
  await settingsDialog(page).locator('.account-settings-close').click();
  await expect(visibleOwner(page)).toBeVisible();

  // --- Break: empty=1 still has wipe; same fail-closed ---
  const emptyDialog = await openSettingsFromHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible();
  await expect(accountChip(page).locator('.name')).toHaveText('Isaiah Calvo');
  await openWipeConfirm(emptyDialog);
  await typeConfirm(emptyDialog, 'delete');
  await expect(wipeButton(emptyDialog)).toBeDisabled();
  await typeConfirm(emptyDialog, 'DELETE');
  await clickWipeFailClosed(page, emptyDialog, watchers, { message: hubMsg });
  await emptyDialog.locator('.account-settings-close').click();
  await expect(page.getByText('No documents yet').first()).toBeVisible();
  await expect(accountChip(page).locator('.name')).toHaveText('Isaiah Calvo');

  // --- Break: guest has no Settings / no wipe (do not replay A-01 submit) ---
  await openPage(page, { url: HUB_GUEST });
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(accountChip(page)).toHaveCount(0);
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete account permanently' })).toHaveCount(0);

  // --- Edge: ?testPdf= Home ---
  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.locator('.tab-bar').getByText('Home', { exact: true }).click();
  await expect(accountChip(page)).toBeVisible({ timeout: 30_000 });
  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const testPdfDialog = settingsDialog(page);
  await expect(testPdfDialog).toBeVisible({ timeout: 15_000 });
  await expect(testPdfDialog.getByText('Isaiah')).toHaveCount(0);
  await expect(testPdfDialog.getByText('Dev', { exact: true })).toBeVisible();
  await openWipeConfirm(testPdfDialog);
  await typeConfirm(testPdfDialog, 'DELETE');
  await clickWipeFailClosed(page, testPdfDialog, watchers, {
    message: testPdfMsg,
    profile: 'Dev',
  });
  await testPdfDialog.locator('.account-settings-close').click();

  // --- Edge: 390 ---
  const mobile = await openSettingsFromHub(page, { width: 390, height: 844, url: HUB });
  await expect(mobile.getByText('Isaiah', { exact: true })).toBeVisible();
  await openWipeConfirm(mobile);
  await typeConfirm(mobile, 'delete');
  await expect(wipeButton(mobile)).toBeDisabled();
  await typeConfirm(mobile, 'DELETE');
  await clickWipeFailClosed(page, mobile, watchers, { message: hubMsg });
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(visibleOwner(page)).toBeVisible();

  const proof = {
    intendedConfirmGate: true,
    cancelKeepsAccount: true,
    confirmFailClosed: true,
    doubleClick: true,
    connectIsolated: true,
    startTrialIsolated: true,
    usageIsolated: true,
    escapeClose: true,
    reopenLandsGeneral: true,
    rowsStay: true,
    emptyHub: true,
    guestNoSettings: true,
    testPdfHome: true,
    mobile390: true,
    wipeRequestCount: watchers.wipeReqs.length,
    authWipeRequestCount: watchers.authReqs.length,
    leftover18HostNotInvented: true,
  };
  console.log('ACCOUNT_SETTINGS_DELETE_ACCOUNT_FAILCLOSED_PROOF', JSON.stringify(proof));
  expect(proof.wipeRequestCount).toBe(0);
  expect(proof.authWipeRequestCount).toBe(0);
  expect(proof.guestNoSettings).toBe(true);
});
