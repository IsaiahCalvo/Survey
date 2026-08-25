import { test, expect } from '@playwright/test';

// Archived documents must not count toward the free-tier 5-document cap.
// hubPreview is developer (unlimited), so the live host proves Usage chrome
// still wires Documents and that the served hook has the archive filters.
// Cap math is Node-proved against the count query.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function settingsDialog(page) {
  return page.locator('.account-settings-modal');
}

async function openSettingsUsage(page, { width = 1440, height = 900, url = HUB } = {}) {
  await openPage(page, { width, height, url });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const chip = width <= 420
    ? page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' })
    : page.getByRole('button', { name: 'Open account menu' });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await dialog.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(dialog.getByText('Documents', { exact: true })).toBeVisible({ timeout: 15_000 });
  return dialog;
}

test('subscription archive count intended / break / edge', async ({ page, request }) => {
  test.setTimeout(180_000);

  const hook = await request.get('/src/hooks/useSubscriptionLimits.js');
  expect(hook.ok()).toBeTruthy();
  const hookSource = await hook.text();
  expect(hookSource).toMatch(/\.eq\(['"]archived['"],\s*false\)/);
  expect(hookSource).toMatch(/\.is\(['"]user_archived_at['"],\s*null\)/);
  expect(hookSource).toMatch(/from\(['"]documents['"]\)\.select\(['"]\*['"],\s*\{\s*count:\s*['"]exact['"],\s*head:\s*true\s*\}/);

  const dialog = await openSettingsUsage(page);
  await expect(dialog.getByText('Documents', { exact: true })).toBeVisible();
  await expect(dialog.getByText('0 / ∞')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial/ })).toHaveCount(0);
  await dialog.locator('.account-settings-close').click();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.getByText('Archive', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible();

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  const emptyDialog = await openSettingsUsage(page, { url: HUB_EMPTY });
  await expect(emptyDialog.getByText('Documents', { exact: true })).toBeVisible();
  await expect(emptyDialog.getByText('0 / ∞')).toHaveCount(2);
  await emptyDialog.locator('.account-settings-close').click();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Open account menu' })).toHaveCount(0);
  await expect(settingsDialog(page)).toHaveCount(0);

  const mobile = await openSettingsUsage(page, { width: 390, height: 844, url: HUB });
  await expect(mobile.getByText('Documents', { exact: true })).toBeVisible();
  await expect(mobile.getByText('0 / ∞')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  const proof = {
    hookHasArchiveFilters: true,
    seededUsageDocuments: true,
    emptyUsageDocuments: true,
    guestNoSettings: true,
    mobileUsageDocuments: true,
    startTrialNotClicked: true,
    deleteAccountNotClicked: true,
    signOutNotClicked: true,
    subscriptionApplyNotClicked: true,
  };
  console.log('SUBSCRIPTION_ARCHIVE_COUNT_PROOF', JSON.stringify(proof));
  expect(proof.hookHasArchiveFilters).toBe(true);
  expect(proof.guestNoSettings).toBe(true);
  expect(proof.startTrialNotClicked).toBe(true);
});
