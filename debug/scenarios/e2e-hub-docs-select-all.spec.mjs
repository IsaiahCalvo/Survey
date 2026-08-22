import { test, expect } from '@playwright/test';

// Unique leftover after Documents Share / Document Access.
// Documents Select All / None / Done — local selection chrome.
// Distinct from Documents extras (Duplicate / Move/Copy / Copy-Paste /
// Sort File-Size / Preview), Lock persist, Open file, Share Access,
// and Archive Select / All / None / Done.
// Do not replay those families. Do not invent leftover-18 Upload.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const SEED_IDS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function desktopRows(page) {
  return page.locator('.documents-desktop-card [data-document-id]');
}

function mobileCards(page) {
  return page.locator('.mobile-doc-card[data-document-id]');
}

async function desktopIds(page) {
  return desktopRows(page).evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-document-id'))
  ));
}

async function desktopCheckedIds(page) {
  return desktopRows(page).evaluateAll((nodes) => (
    nodes
      .filter((node) => [...node.querySelectorAll('span')].some((span) => span.textContent === '✓'))
      .map((node) => node.getAttribute('data-document-id'))
  ));
}

async function mobileCheckedIds(page) {
  return mobileCards(page).evaluateAll((nodes) => (
    nodes
      .filter((node) => [...node.querySelectorAll('span')].some((span) => span.textContent === '✓'))
      .map((node) => node.getAttribute('data-document-id'))
  ));
}

function sorted(ids) {
  return [...ids].sort();
}

function docsSelect(page) {
  return page.getByRole('button', { name: 'Select', exact: true }).first();
}

function docsDone(page) {
  return page.getByRole('button', { name: 'Done', exact: true }).first();
}

function docsAll(page) {
  return page.getByRole('button', { name: 'All', exact: true });
}

function docsNone(page) {
  return page.getByRole('button', { name: 'None', exact: true });
}

test('Hub Documents Select All / None / Done intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  // --- Break: empty fixture has Select chrome, All keeps zero rows ---
  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  await expect(desktopRows(page)).toHaveCount(0);
  await expect(docsSelect(page)).toBeVisible();
  await expect(docsAll(page)).toHaveCount(0);
  await expect(docsNone(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toHaveCount(0);

  await docsSelect(page).click();
  await expect(docsDone(page)).toBeVisible();
  await expect(docsAll(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move/Copy', exact: true })).toBeDisabled();
  await docsAll(page).click();
  await expect(desktopRows(page)).toHaveCount(0);
  await expect.poll(() => desktopCheckedIds(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled();
  await docsDone(page).click();
  await expect(docsSelect(page)).toBeVisible();
  await expect(docsAll(page)).toHaveCount(0);
  await expect(page.getByText('No documents yet').first()).toBeVisible();

  // --- Intended: Select / All / None / Done over seeded rows ---
  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => desktopIds(page).then((ids) => sorted(ids))).toEqual(SEED_IDS);
  await expect(docsSelect(page)).toBeVisible();
  await expect(docsAll(page)).toHaveCount(0);
  await expect(docsDone(page)).toHaveCount(0);

  await desktopRows(page).filter({ hasText: OWNER }).first().click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file', exact: true })).toBeVisible();

  await docsSelect(page).click();
  await expect(docsDone(page)).toBeVisible();
  await expect(docsAll(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled();
  await expect.poll(() => desktopCheckedIds(page)).toEqual([]);
  await expect(page).toHaveURL(/hubPreview=1/);

  await desktopRows(page).filter({ hasText: OWNER }).first().click();
  await expect.poll(() => desktopCheckedIds(page)).toEqual(['d1']);
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/hubPreview=1/);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);

  await desktopRows(page).filter({ hasText: OWNER }).first().click();
  await expect.poll(() => desktopCheckedIds(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled();

  await docsAll(page).click();
  await expect.poll(() => desktopCheckedIds(page).then(sorted)).toEqual(SEED_IDS);
  await expect(docsNone(page)).toBeVisible();
  await expect(docsAll(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled();

  await docsNone(page).click();
  await expect.poll(() => desktopCheckedIds(page)).toEqual([]);
  await expect(docsAll(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled();

  await desktopRows(page).filter({ hasText: 'test.pdf' }).first().click();
  await expect.poll(() => desktopCheckedIds(page)).toEqual(['d6']);
  await docsDone(page).click();
  await expect(docsSelect(page)).toBeVisible();
  await expect(docsAll(page)).toHaveCount(0);
  await expect.poll(() => desktopCheckedIds(page)).toEqual([]);
  await expect.poll(() => desktopIds(page).then((ids) => sorted(ids))).toEqual(SEED_IDS);

  // --- Break: All operates over currently visible (search-filtered) rows ---
  const search = page.locator('.documents-desktop-search input[placeholder="Search documents..."]');
  await search.fill('SE-011');
  await search.blur();
  await expect.poll(() => desktopIds(page)).toEqual(['d1']);
  await docsSelect(page).click();
  await docsAll(page).click();
  await expect.poll(() => desktopCheckedIds(page)).toEqual(['d1']);
  await expect(docsNone(page)).toBeVisible();
  await search.fill('');
  await search.blur();
  await expect.poll(() => desktopIds(page).then((ids) => sorted(ids))).toEqual(SEED_IDS);
  await expect.poll(() => desktopCheckedIds(page)).toEqual(['d1']);
  await expect(docsAll(page)).toBeVisible();
  await docsDone(page).click();

  // Isolation: Archive Select is Restore / Delete forever, not Duplicate
  await page.locator('aside.side nav').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete forever', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();

  await page.locator('aside.side nav.nav:not(.nav-bottom)').getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 15_000 });
  await docsSelect(page).click();
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
  await docsDone(page).click();

  // --- Edge: 390 Select / All / None / Done ---
  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  await expect(docsSelect(page)).toBeVisible();
  await docsSelect(page).click();
  await expect(docsDone(page)).toBeVisible();
  await expect(docsAll(page)).toBeVisible();
  await expect.poll(() => mobileCheckedIds(page)).toEqual([]);
  await docsAll(page).click();
  await expect.poll(() => mobileCheckedIds(page).then(sorted)).toEqual(SEED_IDS);
  await expect(docsNone(page)).toBeVisible();
  await docsNone(page).click();
  await expect.poll(() => mobileCheckedIds(page)).toEqual([]);
  await expect(docsAll(page)).toBeVisible();
  await docsDone(page).click();
  await expect(docsSelect(page)).toBeVisible();
  await expect(docsAll(page)).toHaveCount(0);

  console.log('DOCS_SELECT_ALL_PROOF', JSON.stringify({
    emptyAllKeepsZero: true,
    allSix: SEED_IDS,
    noneClears: true,
    rowToggleNoNavigate: true,
    searchAllOnlyD1: true,
    archiveIsolated: true,
    mobileAllNone: true,
    leftover18UploadNotInvented: true,
  }));
});
