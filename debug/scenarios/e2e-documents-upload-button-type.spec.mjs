import { test, expect } from '@playwright/test';

// Documents desktop Upload already has a visible name (`Upload`)
// but omitted type="button" (live type was null). Shared 390
// hub-mobile-primary-action sibling. Same a11y type class as Add
// files / New project / New template / Manage team, new host
// (DocumentsLedger desktop Upload / 390 Upload). Do not click
// Upload apply / do not pick a file. Do not click Upload PDF
// empty-state apply. Do not stamp file.id.

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

function desktopUpload(page) {
  return page.locator('.documents-desktop-upload');
}

function mobileUpload(page) {
  return page.locator('.hub-mobile-primary-action').filter({ hasText: 'Upload' });
}

function namedUpload(page) {
  return page.getByRole('button', { name: 'Upload', exact: true });
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

test('Documents Upload is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });

  const upload = desktopUpload(page);
  await expect(upload).toBeVisible({ timeout: 8_000 });
  await expect(upload).toHaveAttribute('type', 'button');
  await expect(namedUpload(page).first()).toBeVisible();
  await expect(upload).toHaveText(/Upload/);

  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close preview', exact: true })).toHaveAttribute('type', 'button');

  await upload.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(OWNER).first()).toBeVisible();
  await expect(upload).toHaveAttribute('type', 'button');
  await expect(namedUpload(page).first()).toBeVisible();
  await expect(upload).not.toBeDisabled();
  expect(await page.locator('input[type="file"]').count()).toBeGreaterThan(0);

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + templates + editor break/edge for Documents Upload type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopUpload(page).count()).toBe(1);
  await expect(desktopUpload(page)).toBeHidden();
  const mobile = mobileUpload(page);
  await expect(mobile).toBeVisible({ timeout: 10_000 });
  await expect(mobile).toHaveAttribute('type', 'button');
  await expect(namedUpload(page).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(desktopUpload(page)).toBeVisible();
  await expect(desktopUpload(page)).toHaveAttribute('type', 'button');
  expect(await namedUpload(page).count()).toBeGreaterThan(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search documents...', exact: true }).count()).toBeGreaterThan(0);
  await expect(desktopUpload(page)).toBeVisible();
  await expect(desktopUpload(page)).toHaveAttribute('type', 'button');
  expect(await namedUpload(page).count()).toBeGreaterThan(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopUpload(page).count()).toBe(0);
  expect(await namedUpload(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopUpload(page).count()).toBe(0);
  expect(await namedUpload(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[title$="· drag to reorder · double-click to rename"]').first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await desktopUpload(page).count()).toBe(0);
  expect(await namedUpload(page).count()).toBe(0);
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
  expect(await desktopUpload(page).count()).toBe(0);
  expect(await namedUpload(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
