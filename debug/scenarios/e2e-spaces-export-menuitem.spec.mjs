import { test, expect } from '@playwright/test';

// Spaces export *actions* expose role=menuitem + a named menu.
// Unique leftover after Projects file-row More menu name (`ab95667e` /
// `36f0841c`). Live ?testPdf= Spaces export opened role="menu" of named
// <button>s — getByRole('menuitem') was 0 while CSV / PDF Pages were
// visible as buttons. Same a11y *item* class as hub Account / annotation /
// Pages / Manage Team / Selection Mode / Eraser Type, but a new
// compile-visible host (SpacesPanel header export). Distinct from
// leftover-18 Space CSV / PDF Pages *apply* (not clicked) / X-01 persist /
// Survey/Spaces menu dismiss / Spaces rail toggle / nameless-menu hosts
// already proved / unnamed-dialog family / remapped-after-CW / rail-toggle
// / Projects file-row More name.
// Official annotationContextMenuitem leftover vs spec Enter is not stale
// vs live source (source already has Enter; spec-only).
// Do not click CSV. Do not click PDF Pages. Do not stamp file.id.
// Do not invent leftover-18 mint / roster / Stripe. Do not name Activity.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
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
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function exportMenu(page, name = 'Export Space 1') {
  return page.getByRole('menu', { name, exact: true });
}

async function openSpaces(page) {
  const tab = page.getByRole('button', { name: 'Spaces', exact: true });
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible({ timeout: 15_000 });
}

async function createSpaceAndOpenExport(page) {
  await openSpaces(page);
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.waitForTimeout(360);
  const exportBtn = page.getByRole('button', { name: 'Export Space 1', exact: true });
  await expect(exportBtn).toBeEnabled({ timeout: 8_000 });
  await exportBtn.click();
  await expect(exportMenu(page)).toBeVisible({ timeout: 8_000 });
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

test('desktop Spaces export actions are named menuitems; Escape dismisses', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Spaces', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Export Space 1', exact: true }).count()).toBe(0);
  expect(await exportMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'CSV', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'PDF Pages', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Print).toBe(0);

  expect(await exportMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'CSV', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'PDF Pages', exact: true }).count()).toBe(0);

  await openSpaces(page);
  const disabledExport = page.getByRole('button', { name: 'Create a space to export', exact: true });
  await expect(disabledExport).toBeVisible({ timeout: 8_000 });
  await expect(disabledExport).toBeDisabled();
  expect(await exportMenu(page).count()).toBe(0);

  await createSpaceAndOpenExport(page);
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'PDF Pages', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'CSV', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PDF Pages', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Lock document', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(exportMenu(page)).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'PDF Pages', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Export Space 1', exact: true }).click();
  await expect(exportMenu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(exportMenu(page)).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + hub/search break for Spaces export menuitem', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Open spaces', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await exportMenu(page).count()).toBe(0);
  await page.getByRole('button', { name: 'Open spaces', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.waitForTimeout(360);
  const mobileExport = page.getByRole('button', { name: 'Export Space 1', exact: true });
  await expect(mobileExport).toBeEnabled({ timeout: 8_000 });
  await mobileExport.click();
  await expect(exportMenu(page)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'PDF Pages', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'CSV', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(exportMenu(page)).toHaveCount(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await exportMenu(page).count()).toBe(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  expect(await page.getByRole('menuitem', { name: 'CSV', exact: true }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const fileMore = page.locator('.projects-desktop-layout [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await fileMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  expect(await exportMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await exportMenu(page).count()).toBe(0);
  await openSpaces(page);
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.waitForTimeout(360);
  await expect(page.getByRole('button', { name: 'Export Space 1', exact: true })).toBeEnabled({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Export Space 1', exact: true }).click();
  await expect(exportMenu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(exportMenu(page)).toHaveCount(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
});
