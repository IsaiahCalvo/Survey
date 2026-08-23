import { test, expect } from '@playwright/test';

// Archive Show/Sort *menu* exposes a name (items were already menuitemradios).
// Unique leftover after Documents More menu name (`b5b9951d` / `38a11745`).
// Live hubPreview Archive filter opened role="menu" with no aria-label —
// getByRole('menu', { name: 'Show and sort' }) was 0 while Documents
// menuitemradio was 1. Same a11y *name* class as Documents More / Pages /
// Manage Team menus, but a new compile-visible host (sort/filter, not
// document actions). Official annotationContextMenuitem leftover vs spec
// Enter is not stale vs live source (source already has Enter; spec-only).
// Distinct from leftover-18 / X-01 persist / nameless-menu hosts already
// proved / unnamed-dialog family / remapped-after-CW / dismiss / rail-toggle
// / Documents More name / archive Search-filter-sort apply catalogs.
// Do not click Restore / Delete forever (leftover-18 host-blocked).
// Do not name Activity. Do not stamp file.id.

const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=archive';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=archive';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
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

function showAndSort(page) {
  return page.getByRole('menu', { name: 'Show and sort', exact: true });
}

function desktopFilter(page) {
  return page.locator('.archive-desktop-search .archive-filter-button');
}

function mobileFilter(page) {
  return page.locator('.archive-mobile-search-row .archive-filter-button');
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

test('desktop Archive Show and sort menu is named + Documents filter; Escape dismisses', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible({ timeout: 15_000 });
  expect(await showAndSort(page).count()).toBe(0);
  await desktopFilter(page).click();
  await expect(showAndSort(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(showAndSort(page)).toHaveCount(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await showAndSort(page).count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await showAndSort(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Site plan').first()).toBeVisible({ timeout: 15_000 });
  expect(await showAndSort(page).count()).toBe(0);
  expect(await page.getByRole('menuitemradio', { name: /^Documents/ }).count()).toBe(0);

  await desktopFilter(page).click();
  await expect(showAndSort(page)).toBeVisible();
  for (const name of ['All', 'Documents', 'Projects', 'Templates', 'File', 'Project', 'Most recently archived', 'Size']) {
    await expect(page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) })).toHaveCount(1);
  }
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(showAndSort(page)).toHaveCount(0);
  await expect(page.getByText('Atrium').first()).toBeVisible();
  await expect(page.getByText('Bravo checklist').first()).toBeVisible();

  await desktopFilter(page).click();
  await expect(showAndSort(page)).toBeVisible();
  await page.getByRole('menuitemradio', { name: /^Documents/ }).click();
  await expect(showAndSort(page)).toHaveCount(0);
  await expect(page.getByText('Site plan').first()).toBeVisible();
  await expect(page.getByText('Atrium')).toHaveCount(0);
  await expect(page.getByText('Bravo checklist')).toHaveCount(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBeGreaterThan(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + editor break for Archive Show and sort menu name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Site plan').first()).toBeVisible({ timeout: 15_000 });
  expect(await showAndSort(page).count()).toBe(0);
  await mobileFilter(page).click();
  await expect(showAndSort(page)).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: /^Documents/ })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(showAndSort(page)).toHaveCount(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await showAndSort(page).count()).toBe(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  expect(await showAndSort(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
  await expect(team).toBeVisible({ timeout: 10_000 });
  await team.getByRole('button', { name: 'More', exact: true }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(1);
  expect(await showAndSort(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(await showAndSort(page).count()).toBe(0);
  expect(await page.getByRole('menuitemradio', { name: /^Documents/ }).count()).toBe(0);
  expect(await page.getByRole('menu', { name: 'Eraser Type', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
