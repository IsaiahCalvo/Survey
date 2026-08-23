import { test, expect } from '@playwright/test';

// Hub Account menu *actions* expose role=menuitem (not Settings content).
// Unique leftover after Pages thumbnail context menuitem (`d5b6d570` /
// `2bbc746d`). Settings / Sign out / mobile Archive were named <button>s
// inside role="menu" — getByRole('menuitem') was 0 while the menu was
// open. Same a11y class as Home-tab / annotation / Pages context.
// Settings General local chrome is already dedicated — this leftover is
// the menu item role. Distinct from leftover-18 / X-01 / remapped-after-CW /
// dismiss-family / rail-toggle / overlay-mount / Home `?` / annotation
// context actions / Pages context actions / Pages apply catalogs.
// Do not invent leftover-18 auth/billing panes. Do not stamp file.id.

const HUB = '/?hubPreview=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openHub(page, { width = 1400, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

function accountChip(page) {
  return page.getByRole('button', { name: 'Open account menu' });
}

function accountMenu(page) {
  return page.getByRole('menu', { name: 'Account menu' });
}

async function openDesktopAccountMenu(page) {
  const chip = accountChip(page).first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await expect(accountMenu(page)).toBeVisible();
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

test('desktop Account menu actions are named menuitems + Enter Settings', async ({ page }) => {
  test.setTimeout(120_000);
  await openHub(page);

  expect(await page.getByRole('menuitem', { name: 'Settings', exact: true }).count()).toBe(0);
  await openDesktopAccountMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Extract/i })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Group', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(accountMenu(page)).toHaveCount(0);
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(dialog.locator('.account-sidebar-btn.active')).toHaveText('General');
  await expect(dialog.getByRole('heading', { name: 'Profile information' })).toBeVisible();
  await expect(page.locator('iframe[src*="challenges.cloudflare.com"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Connect Microsoft|Sign in with Microsoft/i })).toHaveCount(0);
  await dialog.locator('.account-settings-close').click();
  await expect(dialog).toHaveCount(0);

  await openDesktopAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.profile-signout-copy')).toContainText('Sign out of Survey?');
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toHaveCount(0);
  await expect(page.locator('.profile-signout-buttons button', { hasText: 'Cancel' })).toBeVisible();
  await page.locator('.profile-signout-buttons button', { hasText: 'Cancel' }).click();
  await expect(page.locator('.profile-signout-copy')).toHaveCount(0);
  await expect(accountMenu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(accountMenu(page)).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + editor break for Account menuitem chrome', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  const mobileChip = page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' });
  await expect(mobileChip).toBeVisible();
  await mobileChip.click();
  await expect(accountMenu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: /Extract/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(accountMenu(page)).toHaveCount(0);

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('menu', { name: 'Account menu' }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Settings', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Rotate', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
