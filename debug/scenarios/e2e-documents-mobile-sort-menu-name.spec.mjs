import { test, expect } from '@playwright/test';

// Documents mobile sort *menu* exposes a name (items were already menuitems).
// Unique leftover after Projects More menu name (`6c01dd63` / `57785303`).
// Live hubPreview Documents filter at 390 opened role="menu" with no
// aria-label — getByRole('menu', { name: 'Sort' }) was 0 while File /
// Project / Last edited / Size menuitems were 1. Same a11y *name* class
// as Documents More / Archive Show and sort / Templates More / Projects
// More, but a new compile-visible host (`.documents-mobile-sort-menu`).
// Official annotationContextMenuitem leftover vs spec Enter is not
// stale vs live source (source already has Enter; spec-only). Distinct
// from leftover-18 / X-01 persist / nameless-menu hosts already proved
// / unnamed-dialog family / remapped-after-CW / dismiss / rail-toggle
// / Documents More name / Archive Show and sort / Templates More /
// Projects More / Projects file-row More.
// Do not name Activity. Do not stamp file.id. Do not click Upload.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const TEMPLATE = 'Security Walk-Through';
const PROJECT = 'Tower 5 — Security';
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

function sortMenu(page) {
  return page.getByRole('menu', { name: 'Sort', exact: true });
}

function mobileFilter(page) {
  return page.locator('.documents-mobile-filter').first();
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

test('390 Documents Sort menu is named + File apply; Escape dismisses', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await sortMenu(page).count()).toBe(0);
  await mobileFilter(page).click();
  await expect(sortMenu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sortMenu(page)).toHaveCount(0);

  await openPage(page, { width: 390, height: 844, url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await sortMenu(page).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.mobile-doc-card').first()).toBeVisible({ timeout: 15_000 });
  expect(await sortMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'File', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);

  await mobileFilter(page).click();
  const menu = sortMenu(page);
  await expect(menu).toBeVisible();
  for (const name of ['File', 'Project', 'Last edited', 'Size']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Add member', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menu', { name: 'Show and sort', exact: true })).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(sortMenu(page)).toHaveCount(0);
  await expect(mobileFilter(page)).toContainText('Last edited');

  await mobileFilter(page).click();
  await expect(sortMenu(page)).toBeVisible();
  await menu.getByRole('menuitem', { name: 'File', exact: true }).click();
  await expect(sortMenu(page)).toHaveCount(0);
  await expect(mobileFilter(page)).toContainText('File');
  await expect(page.locator('.mobile-doc-card').first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'Upload', exact: true }).count()).toBeGreaterThan(0);

  expect(await fileId(page)).toBeNull();
});

test('desktop + editor break for Documents Sort menu name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await sortMenu(page).count()).toBe(0);
  expect(await page.locator('.documents-mobile-filter').count()).toBeGreaterThan(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  expect(await sortMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await sortMenu(page).count()).toBe(0);
  await page.locator('.archive-desktop-search .archive-filter-button').click();
  await expect(page.getByRole('menu', { name: 'Show and sort', exact: true })).toBeVisible();
  expect(await sortMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await sortMenu(page).count()).toBe(0);
  const projectMore = page.locator('.projects-desktop-layout [data-project-id]')
    .filter({ hasText: PROJECT })
    .getByRole('button', { name: 'More' });
  await projectMore.click();
  await expect(page.getByRole('menu', { name: `${PROJECT} actions`, exact: true })).toBeVisible();
  expect(await sortMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const tplMore = page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  }).locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE })
    .getByRole('button', { name: 'More', exact: true });
  await tplMore.click();
  await expect(page.getByRole('menu', { name: `${TEMPLATE} actions`, exact: true })).toBeVisible();
  expect(await sortMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
  await expect(team).toBeVisible({ timeout: 10_000 });
  await team.getByRole('button', { name: 'More', exact: true }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(1);
  expect(await sortMenu(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(await sortMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'File', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menu', { name: 'Eraser Type', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
