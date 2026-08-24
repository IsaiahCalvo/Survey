import { test, expect } from '@playwright/test';

// Archive desktop Close preview already has a visible name
// (`Close preview`) but omitted type="button" (live type was null).
// Default `?hubPreview=1&tab=archive` does not host it without a
// selected row — select a row to host, then Escape-dismiss.
// Same a11y type class as Documents Close preview / Share / Open
// file / Upload / Manage team, new host (ArchiveScreen desktop
// Close preview). Do not click Close preview apply. Do not apply
// archive restore/delete. Do not click Open file / Share / Upload
// apply. Do not click Select apply.

const HUB = '/?hubPreview=1&tab=archive';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=archive';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=archive';
const HUB_DOCUMENTS = '/?hubPreview=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const SITE_PLAN = 'Site plan';
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

function desktopClosePreview(page) {
  return page.locator('.archive-desktop-card button[aria-label="Close preview"]');
}

function namedClosePreview(page) {
  return page.getByRole('button', { name: 'Close preview', exact: true });
}

function archiveRow(page, name) {
  return page.locator('.archive-desktop-card [data-archive-item-id]').filter({ hasText: name }).first();
}

async function hostArchivePreview(page, name = SITE_PLAN) {
  const row = archiveRow(page, name);
  await expect(row).toBeVisible({ timeout: 8_000 });
  await row.click();
  await expect(desktopClosePreview(page)).toBeVisible({ timeout: 8_000 });
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

test('Archive Close preview is typed after row select; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(SITE_PLAN).first()).toBeVisible({ timeout: 15_000 });

  expect(await desktopClosePreview(page).count()).toBe(0);
  expect(await namedClosePreview(page).count()).toBe(0);

  await hostArchivePreview(page);

  const closePreview = desktopClosePreview(page);
  await expect(closePreview).toBeVisible();
  await expect(closePreview).toHaveAttribute('type', 'button');
  await expect(namedClosePreview(page).first()).toBeVisible();
  await expect(closePreview).toHaveAttribute('aria-label', 'Close preview');
  await expect(closePreview).toHaveAttribute('title', 'Close preview');

  await expect(page.getByText(SITE_PLAN).first()).toBeVisible();
  await expect(page.locator('.section-label').filter({ hasText: 'Preview' }).first()).toBeVisible();

  await closePreview.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(SITE_PLAN).first()).toBeVisible();
  await expect(closePreview).toBeVisible();
  await expect(closePreview).toHaveAttribute('type', 'button');
  await expect(namedClosePreview(page).first()).toBeVisible();
  await expect(page.locator('.section-label').filter({ hasText: 'Preview' }).first()).toBeVisible();

  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + documents + editor break/edge for Archive Close preview type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(SITE_PLAN).first()).toBeVisible({ timeout: 15_000 });
  const mobileCard = page.locator('.archive-mobile-card').filter({ hasText: SITE_PLAN }).first();
  await expect(mobileCard).toBeVisible();
  await mobileCard.click();
  expect(await desktopClosePreview(page).count()).toBe(1);
  await expect(desktopClosePreview(page)).toBeHidden();
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await desktopClosePreview(page).count()).toBe(0);
  expect(await namedClosePreview(page).count()).toBe(0);
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  expect(await page.getByRole('textbox', { name: 'Search archive...', exact: true }).count()).toBeGreaterThan(0);
  await hostArchivePreview(page);
  await expect(desktopClosePreview(page)).toHaveAttribute('type', 'button');
  expect(await namedClosePreview(page).count()).toBeGreaterThan(0);

  await openPage(page, { url: HUB_DOCUMENTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopClosePreview(page).count()).toBe(0);
  await expect(page.locator('.documents-desktop-card button[aria-label="Close preview"]')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopClosePreview(page).count()).toBe(0);
  expect(await namedClosePreview(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopClosePreview(page).count()).toBe(0);
  expect(await namedClosePreview(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[title$="· drag to reorder · double-click to rename"]').first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedClosePreview(page).count()).toBe(0);
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
  expect(await namedClosePreview(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
