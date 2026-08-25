import { test, expect } from '@playwright/test';

// Account Settings Connected services Connect already has a
// visible name but omitted type="button" (live type was null).
// Hosted on `?hubPreview=1` after Open account menu → Settings →
// Connected services. Same a11y type class as Settings Sign out /
// Edit profile / sidebar tabs / Close, new host (AccountSettings
// Connect). Do NOT click Connect apply (leftover-18 A-02 / MSAL).
// Do not click Delete account / Sign out / Subscription apply /
// Edit profile apply / Start trial / Manage billing. Guest 390
// drill can hit auth modal — do not drill as guest.

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

function connectButtons(page) {
  return settingsDialog(page).getByRole('button', { name: 'Connect', exact: true });
}

function microsoftConnect(page) {
  return settingsDialog(page).locator('.account-connected-account').filter({ hasText: 'Microsoft' })
    .getByRole('button', { name: 'Connect', exact: true });
}

function googleConnect(page) {
  return settingsDialog(page).locator('.account-connected-account').filter({ hasText: 'Google' })
    .getByRole('button', { name: 'Connect', exact: true });
}

async function expectConnectTyped(page) {
  const buttons = connectButtons(page);
  await expect(buttons).toHaveCount(2, { timeout: 8_000 });
  await expect(microsoftConnect(page)).toBeVisible();
  await expect(googleConnect(page)).toBeVisible();
  await expect(microsoftConnect(page)).toHaveAttribute('type', 'button');
  await expect(googleConnect(page)).toHaveAttribute('type', 'button');
  await expect(microsoftConnect(page)).toHaveText('Connect');
  await expect(googleConnect(page)).toHaveText('Connect');
  const implicit = await settingsDialog(page).evaluate((dialog) => (
    [...dialog.querySelectorAll('button')]
      .filter((node) => {
        if (node.getAttribute('type')) return false;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((node) => (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'Connect')).toBe(false);
  await expect(settingsDialog(page).getByRole('heading', { name: 'Connected services' })).toBeVisible();
}

async function openDesktopSettingsConnected(page) {
  const chip = page.getByRole('button', { name: 'Open account menu' }).first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible({ timeout: 15_000 });
  await settingsDialog(page).getByRole('button', { name: 'Connected services', exact: true }).click();
  await expect(settingsDialog(page).locator('.account-sidebar-btn.active')).toHaveText('Connected services');
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

test('Account Settings Connect is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await settingsDialog(page).count()).toBe(0);
  expect(await connectButtons(page).count()).toBe(0);

  await openDesktopSettingsConnected(page);
  await expectConnectTyped(page);
  await expect(settingsDialog(page).getByRole('button', { name: 'Close', exact: true })).toHaveAttribute('type', 'button');
  await expect(settingsDialog(page).locator('.account-sidebar-btn').filter({ hasText: 'Connected services' })).toHaveAttribute('type', 'button');

  await microsoftConnect(page).focus();
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0, { timeout: 8_000 });
  expect(await connectButtons(page).count()).toBe(0);
  await expect(page.locator('.survey-hub')).toBeVisible();

  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for Settings Connect type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await connectButtons(page).count()).toBe(0);
  const mobileChip = page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' });
  await expect(mobileChip).toBeVisible();
  await mobileChip.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible({ timeout: 15_000 });
  await settingsDialog(page).getByRole('button', { name: 'Connected services', exact: true }).click();
  await expectConnectTyped(page);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await connectButtons(page).count()).toBe(0);
  await openDesktopSettingsConnected(page);
  await expectConnectTyped(page);
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
  expect(await connectButtons(page).count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await connectButtons(page).count()).toBe(0);
  await expect(page.locator('.documents-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await connectButtons(page).count()).toBe(0);
  await expect(page.locator('.archive-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await connectButtons(page).count()).toBe(0);
  await expect(page.locator('.templates-mobile-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await connectButtons(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout [data-testid="project-select-toggle"]')).toHaveAttribute('type', 'button');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await connectButtons(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Search text in PDF', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await connectButtons(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
