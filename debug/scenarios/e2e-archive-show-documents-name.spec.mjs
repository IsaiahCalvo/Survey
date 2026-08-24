import { test, expect } from '@playwright/test';

// Archive project disclosure already had a visible title tooltip
// (`Show documents` / `Hide documents`) but omitted aria-label
// (accname was title-only). Same a11y name class as Templates
// Expand, new host (ArchiveScreen ledger + mobile disclosure).
// Hosted on `?hubPreview=1&tab=archive` without Select apply.
// Toggle Show↔Hide only. Do not click Restore / Delete forever.
// Do not click Select / Close preview / Open file / Share / Upload
// apply. Do not click Delete account. Guest stay unhosted after
// auth Close if Sign in is the only chrome — do not invent
// leftover-18 hosts.

const HUB = '/?hubPreview=1&tab=archive';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=archive';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=archive';
const HUB_DOCUMENTS = '/?hubPreview=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const ATRIUM = 'Atrium';
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

function desktopAtriumRow(page) {
  return page.locator('.archive-desktop-card [data-archive-item-id]').filter({ hasText: ATRIUM }).first();
}

function desktopShow(page) {
  return desktopAtriumRow(page).getByRole('button', { name: 'Show documents', exact: true });
}

function desktopHide(page) {
  return desktopAtriumRow(page).getByRole('button', { name: 'Hide documents', exact: true });
}

function namedShow(page) {
  return page.getByRole('button', { name: 'Show documents', exact: true });
}

function namedHide(page) {
  return page.getByRole('button', { name: 'Hide documents', exact: true });
}

function mobileShow(page) {
  return page.locator('.archive-mobile-disclosure[aria-label="Show documents"]');
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

test('Archive Show documents is named; restore/delete apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(ATRIUM).first()).toBeVisible({ timeout: 15_000 });

  const show = desktopShow(page);
  await expect(show).toBeVisible({ timeout: 8_000 });
  await expect(show).toHaveAttribute('aria-label', 'Show documents');
  await expect(show).toHaveAttribute('title', 'Show documents');
  await expect(show).toHaveAttribute('type', 'button');
  await expect(namedShow(page).first()).toBeVisible();
  expect(await desktopHide(page).count()).toBe(0);

  await show.click();
  const hide = desktopHide(page);
  await expect(hide).toBeVisible({ timeout: 8_000 });
  await expect(hide).toHaveAttribute('aria-label', 'Hide documents');
  await expect(hide).toHaveAttribute('title', 'Hide documents');
  await expect(hide).toHaveAttribute('type', 'button');
  await expect(namedHide(page).first()).toBeVisible();
  await hide.click();
  await expect(desktopShow(page)).toBeVisible({ timeout: 8_000 });
  await expect(desktopShow(page)).toHaveAttribute('aria-label', 'Show documents');

  await desktopShow(page).focus();
  await page.keyboard.press('Escape');
  await expect(desktopShow(page)).toBeVisible();
  await expect(desktopShow(page)).toHaveAttribute('aria-label', 'Show documents');
  await expect(page.getByText(ATRIUM).first()).toBeVisible();

  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for Archive Show documents', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.archive-mobile-card').filter({ hasText: ATRIUM }).first()).toBeVisible({ timeout: 15_000 });
  expect(await desktopShow(page).count()).toBe(0);
  await expect(page.locator('.archive-desktop-card')).toBeHidden();
  const mobile = mobileShow(page);
  await expect(mobile).toBeVisible({ timeout: 8_000 });
  await expect(mobile).toHaveAttribute('aria-label', 'Show documents');
  await expect(mobile).toHaveAttribute('title', 'Show documents');
  await expect(mobile).toHaveAttribute('type', 'button');
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await desktopShow(page).count()).toBe(0);
  expect(await namedShow(page).count()).toBe(0);
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.getByRole('textbox', { name: 'Search archive...', exact: true }).count()).toBeGreaterThan(0);
  await expect(desktopShow(page)).toBeVisible({ timeout: 8_000 });
  await expect(desktopShow(page)).toHaveAttribute('aria-label', 'Show documents');
  expect(await namedShow(page).count()).toBeGreaterThan(0);

  await openPage(page, { url: HUB_DOCUMENTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopShow(page).count()).toBe(0);
  expect(await namedShow(page).count()).toBe(0);
  await expect(page.locator('.documents-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopShow(page).count()).toBe(0);
  expect(await namedShow(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopShow(page).count()).toBe(0);
  expect(await namedShow(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedShow(page).count()).toBe(0);
  expect(await namedHide(page).count()).toBe(0);
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
  expect(await namedShow(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
