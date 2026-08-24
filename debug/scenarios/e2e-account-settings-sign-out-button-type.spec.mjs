import { test, expect } from '@playwright/test';

// Account Settings Sign out already has a visible name but
// omitted type="button" (live type was null). Hosted on
// `?hubPreview=1` after Open account menu → Settings. Same a11y
// type class as Account Settings Edit profile / sidebar tabs /
// Close / Invite-open Edit / Documents Close preview, new host
// (AccountSettings Sign out). Do not click Sign out apply. Do
// not click Delete account (leftover-18). Do not click Edit
// profile / Start trial / Connect Microsoft / Manage billing
// apply. Do not click Upload / Open file / Share / Select apply.
// Guest 390 drill can hit auth modal — do not drill as guest.

const HUB = '/?hubPreview=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
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

function settingsDialog(page) {
  return page.getByRole('dialog', { name: 'Settings', exact: true });
}

function settingsClose(page) {
  return settingsDialog(page).getByRole('button', { name: 'Close', exact: true });
}

function settingsSignOut(page) {
  return settingsDialog(page).getByRole('button', { name: 'Sign out', exact: true });
}

function editProfile(page) {
  return settingsDialog(page).getByRole('button', { name: 'Edit profile', exact: true });
}

async function expectSignOutTyped(page) {
  const button = settingsSignOut(page);
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  await expect(settingsDialog(page).getByRole('heading', { name: 'Profile information' })).toBeVisible();
}

async function openDesktopSettings(page) {
  const chip = page.getByRole('button', { name: 'Open account menu' }).first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible({ timeout: 15_000 });
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

test('Account Settings Sign out is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await settingsDialog(page).count()).toBe(0);
  expect(await settingsSignOut(page).count()).toBe(0);

  await openDesktopSettings(page);
  await expectSignOutTyped(page);
  await expect(editProfile(page)).toHaveAttribute('type', 'button');
  await expect(settingsClose(page)).toHaveAttribute('type', 'button');
  await expect(settingsDialog(page).locator('.account-sidebar-btn').filter({ hasText: 'General' })).toHaveAttribute('type', 'button');

  await settingsSignOut(page).focus();
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0, { timeout: 8_000 });
  expect(await settingsSignOut(page).count()).toBe(0);
  await expect(page.locator('.survey-hub')).toBeVisible();

  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Connect Microsoft|Sign in with Microsoft/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for Settings Sign out type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await settingsSignOut(page).count()).toBe(0);
  const mobileChip = page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' });
  await expect(mobileChip).toBeVisible();
  await mobileChip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible({ timeout: 15_000 });
  await expectSignOutTyped(page);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await settingsSignOut(page).count()).toBe(0);
  await openDesktopSettings(page);
  await expectSignOutTyped(page);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible({ timeout: 8_000 });
  expect(await page.getByRole('button', { name: 'Open account menu' }).count()).toBe(0);
  expect(await settingsDialog(page).count()).toBe(0);
  expect(await settingsSignOut(page).count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await settingsSignOut(page).count()).toBe(0);
  await expect(page.locator('.documents-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await settingsSignOut(page).count()).toBe(0);
  await expect(page.locator('.archive-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await settingsSignOut(page).count()).toBe(0);
  await expect(page.locator('.templates-mobile-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await settingsSignOut(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout [data-testid="project-select-toggle"]')).toHaveAttribute('type', 'button');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await settingsSignOut(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await settingsSignOut(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
