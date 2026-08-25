import { test, expect } from '@playwright/test';

// Archive desktop Name / Type / Archived / Days remaining were
// clickable <span>s. Mouse sort worked; Tab never reached them.
// Now type="button" so keyboard can sort.
// Distinct from leftover-18, Documents desktop sort headers,
// 390 Archive filter menu, Archive Show documents, Invite accept
// type, 390 MobileRailNav Escape.
// Do not click Restore / Delete forever / Permanently delete /
// Select / Upload / Share / Open file / Sign out / Delete
// account. Do not stamp file.id.

const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=archive';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=archive';
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

function desktopCard(page) {
  return page.locator('.archive-desktop-card');
}

function nameHeader(page) {
  return desktopCard(page).getByRole('button', { name: /^Name/i });
}

function typeHeader(page) {
  return desktopCard(page).getByRole('button', { name: /^Type/i });
}

function archivedHeader(page) {
  return desktopCard(page).getByRole('button', { name: /^Archived/i });
}

function daysHeader(page) {
  return desktopCard(page).getByRole('button', { name: /^Days remaining/i });
}

function fileHeader(page) {
  return page.locator('.documents-desktop-card').getByRole('button', { name: /^File/i });
}

async function firstArchiveId(page) {
  return desktopCard(page).locator('[data-archive-item-id]').first().getAttribute('data-archive-item-id');
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

test('Archive desktop sort headers are buttons; Name sorts; Escape does not apply', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(desktopCard(page)).toBeVisible({ timeout: 15_000 });
  await expect(nameHeader(page)).toBeVisible();
  await expect(typeHeader(page)).toBeVisible();
  await expect(archivedHeader(page)).toBeVisible();
  await expect(daysHeader(page)).toBeVisible();
  await expect(nameHeader(page)).toHaveAttribute('type', 'button');
  await expect(typeHeader(page)).toHaveAttribute('type', 'button');
  await expect(archivedHeader(page)).toHaveAttribute('type', 'button');
  await expect(daysHeader(page)).toHaveAttribute('type', 'button');

  const before = await firstArchiveId(page);
  expect(before).toBeTruthy();
  await expect(archivedHeader(page)).toHaveText(/Archived\s*↓/i);

  await nameHeader(page).click();
  await expect(nameHeader(page)).toHaveText(/Name\s*↑/i);
  const afterName = await firstArchiveId(page);
  expect(afterName).toBeTruthy();

  await page.keyboard.press('Escape');
  await expect(nameHeader(page)).toHaveText(/Name\s*↑/i);
  expect(await firstArchiveId(page)).toBe(afterName);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await nameHeader(page).focus();
  await expect(nameHeader(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(nameHeader(page)).toHaveText(/Name\s*↓/i);
  const afterEnter = await firstArchiveId(page);
  expect(afterEnter).not.toBe(afterName);
  expect(afterEnter).toBeTruthy();

  expect(await page.getByRole('button', { name: 'Select', exact: true }).count()).toBeGreaterThan(0);
});

test('Archive desktop sort headers break + edge; leftover-18 skipped', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await nameHeader(page).count()).toBe(0);
  expect(await typeHeader(page).count()).toBe(0);
  expect(await archivedHeader(page).count()).toBe(0);
  expect(await daysHeader(page).count()).toBe(0);
  await expect(page.locator('.archive-mobile-search-row').first()).toBeVisible();
  await expect(page.locator('.archive-filter-button').first()).toBeVisible();

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(nameHeader(page)).toBeVisible();
  await expect(nameHeader(page)).toHaveAttribute('type', 'button');
  expect(await desktopCard(page).locator('[data-archive-item-id]').count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(typeHeader(page)).toBeVisible();
  await typeHeader(page).click();
  await expect(typeHeader(page)).toHaveText(/Type\s*[↑↓]/i);
  expect(await nameHeader(page).innerText()).toMatch(/^Name$/i);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await nameHeader(page).count()).toBe(0);
  await expect(fileHeader(page)).toBeVisible();
  await expect(fileHeader(page)).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await nameHeader(page).count()).toBe(0);
  expect(await fileHeader(page).count()).toBe(0);
  expect(await page.locator('[data-kal31-role-trigger]').count()).toBe(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await nameHeader(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.count()) {
    await expect(authClose.first()).toHaveAttribute('type', 'button');
  }
  if (await nameHeader(page).count()) {
    await expect(nameHeader(page)).toHaveAttribute('type', 'button');
  }

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await nameHeader(page).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await nameHeader(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Back to Survey', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await nameHeader(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const hidden = await hiddenCounts(page);
  for (const name of HIDDEN) {
    expect(hidden[name], name).toBe(0);
  }
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
});
