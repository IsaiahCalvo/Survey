import { test, expect } from '@playwright/test';

// Account Settings dialog had role="dialog" + aria-modal but no
// aria-label / aria-labelledby. Sibling hub dialogs (Share, Create
// project, Rename, Auth) are named. Settings General *content* is
// already dedicated — this leftover is the dialog accessible name.
// Distinct from leftover-18 / X-01 / nameless-menu / rail-toggle /
// dismiss / Home `?` / hub nav type / keep-mount inert / Sync chip /
// remapped-after-CW / hub Account menuitem. Do not stamp file.id.
// Do not invent leftover-18 auth/billing panes.

const HUB = '/?hubPreview=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

function settingsDialog(page) {
  return page.getByRole('dialog', { name: 'Settings', exact: true });
}

async function openDesktopSettings(page) {
  const chip = page.getByRole('button', { name: 'Open account menu' }).first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible({ timeout: 15_000 });
}

test('desktop Settings dialog is named; General content stays dedicated', async ({ page }) => {
  test.setTimeout(120_000);
  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);
  await openDesktopSettings(page);

  const dialog = settingsDialog(page);
  await expect(dialog).toHaveAttribute('aria-labelledby', 'account-settings-title');
  await expect(page.locator('#account-settings-title')).toHaveText('Settings');
  await expect(dialog.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(dialog.getByRole('heading', { name: 'Profile information' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edit profile' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible();
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('Connected services');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(1);

  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible();
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('Subscription');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  await openDesktopSettings(page);
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  await dialog.locator('.account-settings-close').click();
  await expect(settingsDialog(page)).toHaveCount(0);

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Connect Microsoft|Sign in with Microsoft/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + testPdf Home + guest break/edge for Settings dialog name', async ({ page }) => {
  test.setTimeout(120_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileChip = page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' });
  await expect(mobileChip).toBeVisible();
  await mobileChip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible({ timeout: 15_000 });
  await expect(settingsDialog(page).locator('.account-sidebar-btn.active')).toHaveText('General');
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No documents yet').first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'Open account menu' }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-hub-keep-mount]').evaluate((host) => (
    host.hasAttribute('inert') || host.inert === true
  ))).toBe(true);
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  await openDesktopSettings(page);
  await expect(settingsDialog(page).getByText('dev-test-user@example.invalid')).toBeVisible();
  await expect(settingsDialog(page).locator('.account-sidebar-btn.active')).toHaveText('General');
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden();
  await expect(page.locator('.documents-desktop-search').getByPlaceholder('Search documents...')).toBeVisible();
  expect(await fileId(page)).toBeNull();
});
