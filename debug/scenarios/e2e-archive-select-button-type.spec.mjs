import { test, expect } from '@playwright/test';

// Archive Select already has a visible name (`Select`) but omitted
// type="button" (live type was null). Hosted on default
// `?hubPreview=1&tab=archive` without a row select. Same a11y type
// class as Entity / Template-list / Category / Module Select, new
// host (ArchiveScreen header Select). Do not click Select apply.
// Do not apply archive restore/delete. Do not click Close preview
// apply. Do not click Open file / Share / Upload apply.

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

function archiveSelect(page) {
  return page.locator('.archive-select-row button.mobile-header-select-button');
}

function namedArchiveSelect(page) {
  return page.locator('.archive-select-row').getByRole('button', { name: 'Select', exact: true });
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

test('Archive Select is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(SITE_PLAN).first()).toBeVisible({ timeout: 15_000 });

  const select = archiveSelect(page);
  await expect(select).toBeVisible({ timeout: 8_000 });
  await expect(select).toHaveAttribute('type', 'button');
  await expect(select).toHaveText('Select');
  await expect(namedArchiveSelect(page)).toBeVisible();

  await expect(page.getByText(SITE_PLAN).first()).toBeVisible();
  await select.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(SITE_PLAN).first()).toBeVisible();
  await expect(select).toBeVisible();
  await expect(select).toHaveAttribute('type', 'button');
  await expect(select).toHaveText('Select');
  await expect(namedArchiveSelect(page)).toBeVisible();

  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'All', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'None', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + documents + editor break/edge for Archive Select type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.archive-mobile-card').filter({ hasText: SITE_PLAN }).first()).toBeVisible({ timeout: 15_000 });
  const mobileSelect = archiveSelect(page);
  await expect(mobileSelect).toBeVisible({ timeout: 8_000 });
  await expect(mobileSelect).toHaveAttribute('type', 'button');
  await expect(mobileSelect).toHaveText('Select');
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible();
  await expect(archiveSelect(page)).toHaveAttribute('type', 'button');
  await expect(archiveSelect(page)).toHaveText('Select');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.getByRole('textbox', { name: 'Search archive...', exact: true }).count()).toBeGreaterThan(0);
  await expect(archiveSelect(page)).toHaveAttribute('type', 'button');
  await expect(namedArchiveSelect(page)).toBeVisible();

  await openPage(page, { url: HUB_DOCUMENTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await archiveSelect(page).count()).toBe(0);
  await expect(page.locator('.documents-desktop-card button[aria-label="Close preview"]')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await archiveSelect(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await archiveSelect(page).count()).toBe(0);
  await expect(page.locator('.ed-scope p.micro').filter({ hasText: /^Module$/ })
    .locator('..')
    .getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('type', 'button');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await archiveSelect(page).count()).toBe(0);
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
  expect(await archiveSelect(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
