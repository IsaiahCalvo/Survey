import { test, expect } from '@playwright/test';

// 390 hub MobileRailNav ignored Escape while open.
// Live `?hubPreview=1` at 390 (default rail). Open navigation
// opens the drawer; Escape now dismisses. Distinct from leftover-18,
// Invite accept type, AuthModal Close, profile menu Escape,
// Documents / Templates More Escape, Archive filter Escape.
// Do not click Documents / Projects / Templates / Archive apply
// inside the drawer. Do not click Sign in / Upload / Share /
// Select / Restore / Delete forever / Open file / Sign out.
// Do not stamp file.id.

const HUB = '/?hubPreview=1';
const HUB_TABS = '/?hubPreview=1&mobileNav=tabs';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const INVITE = '/invite/leftover-type-probe';
const RESET = '/reset-password';
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
      localStorage.removeItem('kal31_pending_invite_token');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function navTrigger(page) {
  return page.getByRole('button', { name: 'Open navigation', exact: true });
}

function navDrawer(page) {
  return page.locator('[aria-label="Mobile navigation"]');
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

test('390 hub rail nav Escape dismisses; nav apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(navTrigger(page)).toBeVisible({ timeout: 15_000 });
  await expect(navDrawer(page)).toHaveCount(0);

  await navTrigger(page).click();
  await expect(navDrawer(page)).toBeVisible({ timeout: 8_000 });
  await expect(navDrawer(page).getByRole('button', { name: 'Documents', exact: true })).toBeVisible();
  await expect(page.locator('.survey-hub')).toHaveClass(/hub-tab-documents/);

  await page.keyboard.press('Escape');
  await expect(navDrawer(page)).toHaveCount(0);
  await expect(navTrigger(page)).toBeVisible();
  await expect(page.locator('.survey-hub')).toHaveClass(/hub-tab-documents/);
  await expect(page.locator('.survey-hub')).toBeVisible();
});

test('390 hub rail nav Escape break + edge; leftover-18 skipped', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await navTrigger(page).count()).toBe(0);
  expect(await navDrawer(page).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB_TABS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await navTrigger(page).count()).toBe(0);
  expect(await navDrawer(page).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(navTrigger(page)).toBeVisible({ timeout: 15_000 });
  await navTrigger(page).click();
  await expect(navDrawer(page)).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  await expect(navDrawer(page)).toHaveCount(0);

  await openPage(page, { width: 390, height: 844, url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(navTrigger(page)).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(navTrigger(page)).toBeVisible({ timeout: 15_000 });

  await openPage(page, { width: 390, height: 844, url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(navTrigger(page)).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('[data-kal31-role-trigger]').count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.count()) {
    await expect(authClose.first()).toHaveAttribute('type', 'button');
  }
  expect(await navDrawer(page).count()).toBe(0);

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  const signInContinue = page.getByRole('button', { name: 'Sign in to continue', exact: true });
  await expect(signInContinue).toBeVisible({ timeout: 15_000 });
  await expect(signInContinue).toHaveAttribute('type', 'button');
  expect(await navTrigger(page).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await navTrigger(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Back to Survey', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await navTrigger(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const hidden = await hiddenCounts(page);
  for (const name of HIDDEN) {
    expect(hidden[name], name).toBe(0);
  }
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Search text in PDF', exact: true }).count()).toBe(0);
});
