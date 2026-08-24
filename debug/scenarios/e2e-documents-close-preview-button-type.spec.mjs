import { test, expect } from '@playwright/test';

// Documents desktop Close preview already has a visible name
// (`Close preview`) but omitted type="button" (live type was null).
// Preview pane is hosted by default on Documents (previewOpen starts
// true). Same a11y type class as Upload / Manage team, new host
// (DocumentsLedger desktop Close preview). Do not click Close
// preview apply. Do not click Open file / Share apply. Do not
// click Upload apply. Archive Close preview stays a later host.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
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
  return page.locator('.documents-desktop-card').getByRole('button', { name: 'Close preview', exact: true });
}

function namedClosePreview(page) {
  return page.getByRole('button', { name: 'Close preview', exact: true });
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

test('Documents Close preview is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });

  const closePreview = desktopClosePreview(page);
  await expect(closePreview).toBeVisible({ timeout: 8_000 });
  await expect(closePreview).toHaveAttribute('type', 'button');
  await expect(namedClosePreview(page).first()).toBeVisible();
  await expect(closePreview).toHaveAttribute('aria-label', 'Close preview');
  await expect(closePreview).toHaveAttribute('title', 'Close preview');

  await expect(page.locator('.documents-desktop-upload')).toHaveAttribute('type', 'button');
  await expect(page.getByRole('button', { name: 'Open file', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share', exact: true }).first()).toBeVisible();

  await closePreview.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(OWNER).first()).toBeVisible();
  await expect(closePreview).toBeVisible();
  await expect(closePreview).toHaveAttribute('type', 'button');
  await expect(namedClosePreview(page).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Preview', exact: true }).or(page.locator('.section-label').filter({ hasText: 'Preview' })).first()).toBeVisible();

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + templates + editor break/edge for Documents Close preview type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopClosePreview(page).count()).toBe(1);
  await expect(desktopClosePreview(page)).toBeHidden();
  expect(await page.getByRole('button', { name: 'Close details', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await desktopClosePreview(page).count()).toBe(0);
  expect(await namedClosePreview(page).count()).toBe(0);
  await expect(page.locator('.documents-desktop-upload')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search documents...', exact: true }).count()).toBeGreaterThan(0);
  await expect(desktopClosePreview(page)).toBeVisible();
  await expect(desktopClosePreview(page)).toHaveAttribute('type', 'button');
  expect(await namedClosePreview(page).count()).toBeGreaterThan(0);

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
