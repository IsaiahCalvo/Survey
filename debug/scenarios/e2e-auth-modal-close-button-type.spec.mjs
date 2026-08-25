import { test, expect } from '@playwright/test';

// AuthModal Close already has a visible name (`Close`) but
// omitted type="button" (live type was null). Hosted on
// `?hubPreview=1&guest=1`. Same a11y type class as Settings
// Close / AccessManagement Close, new host (AuthModal Close).
// Do NOT click Sign in / Create account / Continue with Google /
// Send reset / Continue without an account (A-01 apply).
// Escape dismisses. Do not stamp file.id.

const HUB = '/?hubPreview=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const HUB_GUEST_EMPTY = '/?hubPreview=1&empty=1&guest=1';
const HUB_GUEST_PROJECTS = '/?hubPreview=1&guest=1&tab=projects';
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

function authDialog(page) {
  return page.getByRole('dialog', { name: 'Welcome back', exact: true });
}

function authClose(page) {
  return authDialog(page).getByRole('button', { name: 'Close', exact: true });
}

async function expectCloseTyped(page) {
  const close = authClose(page);
  await expect(close).toBeVisible({ timeout: 8_000 });
  await expect(close).toHaveAttribute('type', 'button');
  await expect(close).toHaveAttribute('aria-label', 'Close');
  await expect(authDialog(page).getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  const implicit = await authDialog(page).evaluate((dialog) => (
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
  expect(implicit.some((name) => name === 'Close')).toBe(false);
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

test('AuthModal Close is typed; Sign in apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(authDialog(page)).toBeVisible({ timeout: 15_000 });
  await expectCloseTyped(page);
  expect(await page.getByRole('button', { name: 'Open account menu' }).count()).toBe(0);

  await authClose(page).focus();
  await page.keyboard.press('Escape');
  await expect(authDialog(page)).toHaveCount(0, { timeout: 8_000 });
  expect(await authClose(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.survey-hub')).toBeVisible();

  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Find a teammate', exact: true }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + signed-in tabs + editor break/edge for AuthModal Close type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(authDialog(page)).toBeVisible({ timeout: 15_000 });
  await expectCloseTyped(page);
  await page.keyboard.press('Escape');
  await expect(authDialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible({ timeout: 8_000 });
  expect(await page.getByRole('button', { name: 'Open account menu' }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(authDialog(page)).toBeVisible({ timeout: 15_000 });
  await expectCloseTyped(page);
  await page.keyboard.press('Escape');
  await expect(authDialog(page)).toHaveCount(0);

  await openPage(page, { url: HUB_GUEST_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(authDialog(page)).toBeVisible({ timeout: 15_000 });
  await expectCloseTyped(page);
  expect(await page.getByRole('textbox', { name: 'Find a teammate', exact: true }).count()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(authDialog(page)).toHaveCount(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await authDialog(page).count()).toBe(0);
  expect(await authClose(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Open account menu' }).first()).toBeVisible();

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await authClose(page).count()).toBe(0);
  await expect(page.locator('.documents-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await authClose(page).count()).toBe(0);
  await expect(page.locator('.archive-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await authClose(page).count()).toBe(0);
  await expect(page.locator('.templates-mobile-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await authClose(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout [data-testid="project-select-toggle"]')).toHaveAttribute('type', 'button');
  expect(await page.getByRole('textbox', { name: 'Find a teammate', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await authClose(page).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Search text in PDF', exact: true }).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await authClose(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
