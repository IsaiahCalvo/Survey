import { test, expect } from '@playwright/test';

// Survey export *menus* expose a name + already-present menuitems.
// Unique leftover after Spaces export menuitem (`119e7317` / `894ed53f`).
// Last hunt noted Survey export menus were 0 (not opened). Live
// ?testPdf=&surveyTransitionE2E=1 opens the desktop Excel actions
// role="menu" with Open linked / Update existing menuitems, but the
// menu itself had no aria-label — getByRole('menu', { name: 'Excel
// actions' }) was 0. 390 Export survey data was the same nameless
// host. Same a11y *name* class as Spaces export / Documents More /
// Archive Show and sort, but a new compile-visible host
// (SurveySpacesRail desktop compact + mobile sheet). Distinct from
// leftover-18 Survey EXPORT / Push / Sync apply (not clicked) /
// Space CSV / PDF Pages apply / X-01 persist / Excel actions
// fail-closed apply / Survey/Spaces menu dismiss / Spaces export
// menuitem / nameless-menu hosts already proved / unnamed-dialog
// family / remapped-after-CW / rail-toggle.
// Official annotationContextMenuitem leftover vs spec Enter is not
// stale vs live source (source already has Enter; spec-only).
// Do not click EXPORT. Do not click Open linked / Update existing /
// Export Excel / Sync Microsoft 365. Do not stamp file.id.
// Do not invent leftover-18 mint / roster / Stripe. Do not name Activity.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const KAL436 = /KAL-436 Preservation Template/;
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
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function excelMenu(page) {
  return page.getByRole('menu', { name: 'Excel actions', exact: true });
}

function mobileExportMenu(page) {
  return page.getByRole('menu', { name: 'Export survey data', exact: true });
}

function excelChevron(page) {
  return page.getByRole('button', { name: 'Excel actions', exact: true });
}

async function enterSurveyKal436(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
  await expect(excelChevron(page)).toBeVisible({ timeout: 15_000 });
}

async function openExcelMenu(page) {
  const chevron = excelChevron(page);
  await expect(chevron).toBeVisible({ timeout: 8_000 });
  if ((await chevron.getAttribute('aria-expanded')) !== 'true') {
    await chevron.click();
  }
  await expect(excelMenu(page)).toBeVisible({ timeout: 8_000 });
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

test('desktop Survey Excel actions menu is named; Escape dismisses', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Survey', exact: true }).count()).toBe(0);
  expect(await excelChevron(page).count()).toBe(0);
  expect(await excelMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Open linked', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Update existing', exact: true }).count()).toBe(0);

  await openPage(page, { url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Print).toBe(0);

  expect(await excelChevron(page).count()).toBe(0);
  expect(await excelMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Open linked', exact: true }).count()).toBe(0);

  await enterSurveyKal436(page);
  expect(await excelMenu(page).count()).toBe(0);
  await expect(page.locator('.survey-marker-export-compact-button').first()).toHaveText('EXPORT');

  await openExcelMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Open linked', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Update existing', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open linked', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Update existing', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'PDF Pages', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByText('Pull from Excel').count()).toBe(0);
  expect(await page.getByText('Live Sync').count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(excelMenu(page)).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Open linked', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Update existing', exact: true })).toHaveCount(0);

  await excelChevron(page).click();
  await expect(excelMenu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open linked', exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(excelMenu(page)).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + hub/search break for Survey export menu name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await excelChevron(page).count()).toBe(0);
  expect(await excelMenu(page).count()).toBe(0);
  expect(await mobileExportMenu(page).count()).toBe(0);

  await page.getByRole('button', { name: 'Open survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
  const exportSurvey = page.getByRole('button', { name: 'Export survey data', exact: true });
  await expect(exportSurvey).toBeVisible({ timeout: 15_000 });
  expect(await excelChevron(page).count()).toBe(0);
  await exportSurvey.click();
  await expect(mobileExportMenu(page)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('menuitem', { name: /Export Excel/ })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: /Sync Microsoft 365/ })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Open linked', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(mobileExportMenu(page)).toHaveCount(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await excelMenu(page).count()).toBe(0);
  expect(await mobileExportMenu(page).count()).toBe(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  expect(await page.getByRole('menuitem', { name: 'Open linked', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: /Export Excel/ }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await excelMenu(page).count()).toBe(0);
  await enterSurveyKal436(page);
  await openExcelMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Open linked', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Update existing', exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(excelMenu(page)).toHaveCount(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
});
