import { test, expect } from '@playwright/test';

// Unique leftover after Account Settings General.
// Last General hunt classified Subscription Usage as leftover-18 UL-18
// and claimed UsageIndicator stayed empty. Independent live hunt found
// local empty/fail-closed meters (Projects 0 / ∞, Documents 0 / ∞,
// Storage 0 B / 100.0 GB, DEVELOPER). UL-18 is NOT leftover-18
// (parked list is U-04 cloud checklist usage, not this pane).
// Distinct from General display/Edit/Save and leftover-18 A-05 Stripe.
// Do not click Start trial / Connect / wipe. Do not invent .env.local.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
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
  return dialog;
}

async function openUsageTab(dialog) {
  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await dialog.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(dialog.getByText('Projects', { exact: true })).toBeVisible({ timeout: 15_000 });
}

async function usageSnapshot(dialog) {
  await expect(dialog.getByText('Projects', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Documents', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Storage', { exact: true })).toBeVisible();
  await expect(dialog.getByText('0 / ∞')).toHaveCount(2);
  await expect(dialog.getByText('0 B / 100.0 GB')).toBeVisible();
  await expect(dialog.getByText(/developer/i)).toBeVisible();
  return {
    projects: await dialog.getByText('Projects', { exact: true }).count(),
    documents: await dialog.getByText('Documents', { exact: true }).count(),
    storage: await dialog.getByText('Storage', { exact: true }).count(),
    unlimitedRows: await dialog.getByText('0 / ∞').count(),
    storageLabel: await dialog.getByText('0 B / 100.0 GB').count(),
    upgradeNudge: await dialog.getByText('Running low on space?').count(),
    retry: await dialog.getByRole('button', { name: 'Retry' }).count(),
    startTrial: await dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial/ }).count(),
  };
}

test('Account Settings Usage local empty chrome intended / break / edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const emptyDialog = settingsDialog(page);
  await expect(emptyDialog).toBeVisible({ timeout: 15_000 });
  await openUsageTab(emptyDialog);
  const emptyUsage = await usageSnapshot(emptyDialog);
  expect(emptyUsage.unlimitedRows).toBe(2);
  expect(emptyUsage.storageLabel).toBe(1);
  expect(emptyUsage.upgradeNudge).toBe(0);
  expect(emptyUsage.retry).toBe(0);
  await emptyDialog.locator('.account-settings-close').click();

  const dialog = await openSettingsFromHub(page);
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(dialog.getByText('Projects', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('0 B / 100.0 GB')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  await expect(dialog.getByText('Microsoft')).toBeVisible();
  await expect(dialog.getByText('Projects', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('0 B / 100.0 GB')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Manage subscription', exact: true })).toBeVisible();
  await expect(dialog.getByText(/Pro|Enterprise|Developer account/).first()).toBeVisible();
  await expect(dialog.getByText('0 B / 100.0 GB')).toBeHidden();
  await expect(dialog.getByText(/Monthly|Annual|Save 17%/)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Usage', exact: true }).click();
  const seeded = await usageSnapshot(dialog);
  expect(seeded.unlimitedRows).toBe(2);
  expect(seeded.storageLabel).toBe(1);
  expect(seeded.upgradeNudge).toBe(0);
  expect(seeded.retry).toBe(0);
  expect(seeded.startTrial).toBe(0);

  await dialog.getByRole('button', { name: 'Manage subscription', exact: true }).click();
  await expect(dialog.getByText('0 B / 100.0 GB')).toBeHidden();
  await expect(dialog.getByText('Projects', { exact: true })).toBeHidden();
  await expect(dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial|Developer account/ }).first()).toBeVisible();

  await dialog.locator('.account-settings-close').click();
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible();

  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page).locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(settingsDialog(page).getByText('0 B / 100.0 GB')).toHaveCount(0);
  await settingsDialog(page).locator('.account-settings-close').click();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });
  await expect(accountChip(page)).toHaveCount(0);
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByText('0 B / 100.0 GB')).toHaveCount(0);

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.locator('.tab-bar').getByText('Home', { exact: true }).click();
  await expect(accountChip(page)).toBeVisible({ timeout: 30_000 });
  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const testPdfDialog = settingsDialog(page);
  await expect(testPdfDialog).toBeVisible({ timeout: 15_000 });
  await expect(testPdfDialog.getByText('Isaiah')).toHaveCount(0);
  await openUsageTab(testPdfDialog);
  const testPdfUsage = await usageSnapshot(testPdfDialog);
  expect(testPdfUsage.unlimitedRows).toBe(2);
  expect(testPdfUsage.storageLabel).toBe(1);
  await testPdfDialog.locator('.account-settings-close').click();

  const mobile = await openSettingsFromHub(page, { width: 390, height: 844, url: HUB });
  await openUsageTab(mobile);
  const mobileUsage = await usageSnapshot(mobile);
  expect(mobileUsage.unlimitedRows).toBe(2);
  expect(mobileUsage.storageLabel).toBe(1);
  expect(mobileUsage.upgradeNudge).toBe(0);
  expect(mobileUsage.retry).toBe(0);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  const proof = {
    emptyHubUsage: emptyUsage,
    seededUsage: seeded,
    manageHidesMeters: true,
    connectedHasNoMeters: true,
    billingToggleHidden: true,
    reopenLandsGeneral: true,
    guestNoSettings: true,
    testPdfHomeUsage: testPdfUsage,
    mobileUsage,
    stripeNotClicked: true,
    msalNotClicked: true,
    leftover18MeterNotInvented: true,
  };
  console.log('ACCOUNT_SETTINGS_USAGE_PROOF', JSON.stringify(proof));
  expect(proof.seededUsage.unlimitedRows).toBe(2);
  expect(proof.guestNoSettings).toBe(true);
  expect(proof.stripeNotClicked).toBe(true);
});
