import { test, expect } from '@playwright/test';

// Leftover-18 A-05 / UL-20 fail-closed slice that was still thinner than a
// dedicated intended+break+edge proof: Account Settings Start trial.
// Prior catalog / leftover18-unblock / chrome-03 / Usage left the button
// visible and unclicked. Click must not mint Stripe Checkout, open
// checkout.stripe.com, or invent a billing backend.
// Distinct from Settings General / Usage, leftover18-unblock catalog,
// Contact sales mailto, Guest AuthModal A-01, Documents Upload, Connect.
// Do not invent .env.local, Stripe session, MSAL, Turnstile, leases, or SQL.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const OWNER = 'Package 2 — Rev 4 — IC.pdf';
const TRIAL = /Start 7-day trial|Start annual trial/;
const STRIPE_HOST = /checkout\.stripe|billing\.stripe|js\.stripe\.com/i;
const CHECKOUT_FN = /create-checkout-session|create-portal-session/i;

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

function attachBillingWatchers(page) {
  const opened = [];
  const checkoutReqs = [];
  const stripeReqs = [];
  page.on('request', (req) => {
    const url = req.url();
    if (CHECKOUT_FN.test(url)) checkoutReqs.push(url);
    if (STRIPE_HOST.test(url)) stripeReqs.push(url);
  });
  page.on('popup', (popup) => {
    opened.push(popup.url());
  });
  return { opened, checkoutReqs, stripeReqs };
}

async function stubWindowOpen(page, opened) {
  await page.exposeFunction('__startTrialRecordOpen', (url) => {
    opened.push(String(url || ''));
  });
  await page.addInitScript(() => {
    window.open = (url) => {
      window.__startTrialRecordOpen?.(url);
      return null;
    };
  });
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

async function openSubscriptionManage(dialog) {
  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Manage subscription', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Manage subscription', exact: true }).click();
  await expect(dialog.getByText('Pro', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

async function assertNoCheckout(page, dialog, { opened, checkoutReqs, stripeReqs }) {
  expect(opened.filter((url) => STRIPE_HOST.test(url))).toEqual([]);
  expect(checkoutReqs).toEqual([]);
  expect(stripeReqs).toEqual([]);
  await expect(page).toHaveURL(/hubPreview=1|testPdf=/);
  await expect(page).not.toHaveURL(STRIPE_HOST);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
}

async function clickStartTrialFailClosed(page, dialog, watchers) {
  const trial = dialog.getByRole('button', { name: TRIAL });
  await expect(trial).toBeVisible();
  await expect(trial).toBeEnabled();
  await trial.click();
  await expect(dialog.getByText(/Error:\s*Must be signed in to start a trial/i)).toBeVisible({ timeout: 15_000 });
  await expect(trial).toHaveText(TRIAL);
  await assertNoCheckout(page, dialog, watchers);
}

test('Account Settings Start trial fail-closed intended / break / edge', async ({ page }) => {
  test.setTimeout(180_000);
  const watchers = attachBillingWatchers(page);
  await stubWindowOpen(page, watchers.opened);
  await page.route(STRIPE_HOST, (route) => route.abort());
  await page.route(CHECKOUT_FN, (route) => route.abort());

  // --- Intended: seeded hub Subscription → Start 7-day trial ---
  const dialog = await openSettingsFromHub(page);
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(dialog.getByRole('button', { name: TRIAL })).toHaveCount(0);

  await openSubscriptionManage(dialog);
  await expect(dialog.getByText('Enterprise').first()).toBeVisible();
  await expect(dialog.getByText(/Monthly|Annual|Save 17%/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Contact sales' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await clickStartTrialFailClosed(page, dialog, watchers);

  // Double-click still fail-closed (no session minted).
  await clickStartTrialFailClosed(page, dialog, watchers);

  // --- Break: Usage / General isolation ---
  await dialog.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(dialog.getByText('0 B / 100.0 GB')).toBeVisible();
  await expect(dialog.getByRole('button', { name: TRIAL })).toBeHidden();
  await expect(dialog.getByText(/Error:\s*Must be signed in to start a trial/i)).toBeHidden();

  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await expect(dialog.getByText('Isaiah')).toBeVisible();
  await expect(dialog.getByRole('button', { name: TRIAL })).toHaveCount(0);

  await openSubscriptionManage(dialog);
  await expect(dialog.getByText(/Error:\s*Must be signed in to start a trial/i)).toHaveCount(0);
  await clickStartTrialFailClosed(page, dialog, watchers);

  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByText(OWNER).first()).toBeVisible();

  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page).locator('.account-sidebar-btn.active')).toHaveText('General');
  await settingsDialog(page).locator('.account-settings-close').click();

  // --- Break: empty=1 still has Start trial; same fail-closed ---
  const emptyDialog = await openSettingsFromHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible();
  await openSubscriptionManage(emptyDialog);
  await clickStartTrialFailClosed(page, emptyDialog, watchers);
  await emptyDialog.locator('.account-settings-close').click();

  // --- Break: guest has no Settings / no Start trial (do not replay A-01 submit) ---
  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });
  await expect(accountChip(page)).toHaveCount(0);
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: TRIAL })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();

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
  await openSubscriptionManage(testPdfDialog);
  await clickStartTrialFailClosed(page, testPdfDialog, watchers);
  await testPdfDialog.locator('.account-settings-close').click();

  // --- Edge: 390 ---
  const mobile = await openSettingsFromHub(page, { width: 390, height: 844, url: HUB });
  await openSubscriptionManage(mobile);
  await clickStartTrialFailClosed(page, mobile, watchers);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  const proof = {
    intendedClick: true,
    doubleClick: true,
    usageIsolated: true,
    generalIsolated: true,
    escapeClose: true,
    reopenLandsGeneral: true,
    emptyHub: true,
    guestNoSettings: true,
    testPdfHome: true,
    mobile390: true,
    checkoutInvokeCount: watchers.checkoutReqs.length,
    stripeHostCount: watchers.stripeReqs.length,
    stripeOpened: watchers.opened.filter((url) => STRIPE_HOST.test(url)).length,
    leftover18HostNotInvented: true,
  };
  console.log('ACCOUNT_SETTINGS_START_TRIAL_FAILCLOSED_PROOF', JSON.stringify(proof));
  expect(proof.checkoutInvokeCount).toBe(0);
  expect(proof.stripeHostCount).toBe(0);
  expect(proof.stripeOpened).toBe(0);
  expect(proof.guestNoSettings).toBe(true);
});
