import { test, expect } from '@playwright/test';

// Unique leftover after TabBar Close tab.
// Archive Search / filter / sort on hubPreview. Restore stays
// host-blocked (leftover-18) — do not invent Restore writeback.
// Empty chrome already catalog-completeness live (`empty=1`).
// Do not replay Templates family / Documents extras / Open file /
// Projects extras / file chrome / Spaces / Survey-rail / PDF waves /
// TabBar Close tab. mobileProjectLayout unreachable.

const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=archive';
const HUB_DOCS = '/?hubPreview=1&tab=documents';

const SEED_IDS = ['ap1', 'ad1', 'at1'];
const DEFAULT_ORDER = ['ap1', 'ad1', 'at1']; // archived desc: Atrium, Site plan, Bravo
const NAME_AZ = ['ap1', 'at1', 'ad1'];
const NAME_ZA = ['ad1', 'at1', 'ap1'];
const SIZE_DESC = ['ad1', 'ap1', 'at1']; // Site plan 4.2MB, Atrium 2MB, Bravo none

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80)
  ));
}

function desktopSearch(page) {
  return page.locator('.archive-desktop-search input[placeholder="Search archive..."]');
}

function mobileSearch(page) {
  return page.locator('.archive-mobile-search-row input[placeholder="Search archive..."]');
}

function desktopFilterButton(page) {
  return page.locator('.archive-desktop-search .archive-filter-button');
}

function mobileFilterButton(page) {
  return page.locator('.archive-mobile-search-row .archive-filter-button');
}

function desktopRows(page) {
  return page.locator('.archive-desktop-card [data-archive-item-id]');
}

function mobileCards(page) {
  return page.locator('.archive-mobile-card[data-archive-item-id]');
}

async function desktopIds(page) {
  return desktopRows(page).evaluateAll((nodes) => (
    nodes.filter((node) => node.offsetParent).map((node) => node.getAttribute('data-archive-item-id'))
  ));
}

async function mobileIds(page) {
  return mobileCards(page).evaluateAll((nodes) => (
    nodes.filter((node) => node.offsetParent).map((node) => node.getAttribute('data-archive-item-id'))
  ));
}

async function waitArchiveSeed(page) {
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('invalid input syntax for type uuid')).toHaveCount(0);
}

async function pickMenu(page, scope, label) {
  const menu = scope.locator('.archive-sort-menu');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).click();
}

test('Archive Search / filter / sort intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const docsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible({ timeout: 15_000 });
  const projectsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  const templatesChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav').getByRole('button', { name: 'Archive', exact: true }).click();
  await waitArchiveSeed(page);
  const archiveEmpty = await page.getByText('Nothing in Archive').count();
  const archiveSearch = await page.getByPlaceholder('Search archive...').count();
  const archiveHostError = await page.getByText(/invalid input syntax for type uuid/i).count();
  const archiveChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  console.log('HUNT_INVENTORY', JSON.stringify({
    docsChrome: docsChrome.slice(0, 20),
    projectsChrome: projectsChrome.slice(0, 16),
    templatesChrome: templatesChrome.slice(0, 16),
    archiveChrome: archiveChrome.slice(0, 20),
    archiveEmpty,
    archiveSearch,
    archiveHostError,
  }));

  // --- Break: empty fixture has Search but no rows; no host UUID error ---
  await openPage(page, { url: HUB_EMPTY });
  await waitArchiveSeed(page);
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder('Search archive...')).toHaveCount(2);
  await expect(page.getByText('invalid input syntax for type uuid')).toHaveCount(0);
  await expect(desktopRows(page)).toHaveCount(0);
  const emptyRestore = await page.getByRole('button', { name: 'Restore', exact: true }).count();
  expect(emptyRestore, 'empty chrome has no Restore until Select').toBe(0);
  await desktopSearch(page).fill('Site');
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible();
  await expect(page.getByText('No archived items match your search.')).toHaveCount(0);

  // --- Intended: seeded Search match / case / no-match / clear / Escape ---
  await openPage(page, { url: HUB_ARCHIVE });
  await waitArchiveSeed(page);
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await expect(page.getByText('Atrium').first()).toBeVisible();
  await expect(page.getByText('Site plan').first()).toBeVisible();
  await expect(page.getByText('Bravo checklist').first()).toBeVisible();
  await expect(page.getByText('3 items').first()).toBeVisible();

  const search = desktopSearch(page);
  await search.fill('site');
  await expect.poll(() => desktopIds(page)).toEqual(['ad1']);
  await expect(page.getByText('1 item').first()).toBeVisible();
  await search.fill('SITE');
  await expect.poll(() => desktopIds(page)).toEqual(['ad1']);
  await search.fill('Level 1');
  await expect.poll(() => desktopIds(page)).toEqual(['ap1']);
  await expect(page.getByText('Level 1').first()).toBeVisible();
  await expect(page.getByText('Level 2')).toHaveCount(0);
  await search.fill('zzzz-no-such-archive');
  await expect(page.getByText('No archived items match your search.').first()).toBeVisible();
  await expect.poll(() => desktopIds(page)).toEqual([]);
  await search.fill('site');
  await expect.poll(() => desktopIds(page)).toEqual(['ad1']);
  await search.press('Escape');
  await expect(search).toHaveValue('site');
  await expect.poll(() => desktopIds(page)).toEqual(['ad1']);
  await search.fill('');
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);

  // Filter + sort (real menu + column headers)
  await desktopFilterButton(page).click();
  await pickMenu(page, page.locator('.archive-desktop-search'), 'Documents');
  await expect.poll(() => desktopIds(page)).toEqual(['ad1']);
  await expect(page.getByText('1 item').first()).toBeVisible();
  await desktopFilterButton(page).click();
  await pickMenu(page, page.locator('.archive-desktop-search'), 'Projects');
  await expect.poll(() => desktopIds(page)).toEqual(['ap1']);
  await desktopFilterButton(page).click();
  await pickMenu(page, page.locator('.archive-desktop-search'), 'Templates');
  await expect.poll(() => desktopIds(page)).toEqual(['at1']);
  await desktopFilterButton(page).click();
  await pickMenu(page, page.locator('.archive-desktop-search'), 'All');
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);

  await page.locator('.archive-desktop-card').locator('span', { hasText: /^Name/ }).first().click();
  await expect.poll(() => desktopIds(page)).toEqual(NAME_AZ);
  await page.locator('.archive-desktop-card').locator('span', { hasText: /^Name/ }).first().click();
  await expect.poll(() => desktopIds(page)).toEqual(NAME_ZA);
  await desktopFilterButton(page).click();
  await pickMenu(page, page.locator('.archive-desktop-search'), 'Size');
  await expect.poll(() => desktopIds(page)).toEqual(SIZE_DESC);
  await pickMenu(page, page.locator('.archive-desktop-search'), 'Most recently archived');
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await page.keyboard.press('Escape');
  await expect(page.locator('.archive-desktop-search .archive-sort-menu')).toHaveCount(0);

  // Isolation: Documents still seeded; Archive search does not invent Restore
  await page.locator('aside.side nav.nav:not(.nav-bottom)').getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByText('SE-011 Security Shop Drawings.pdf').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('aside.side nav').getByRole('button', { name: 'Archive', exact: true }).click();
  await waitArchiveSeed(page);
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await expect(page.getByText(/Could not restore/i).first()).toBeVisible({ timeout: 8_000 });

  // --- Edge: 390 mobile Search + filter ---
  await openPage(page, { width: 390, height: 844, url: HUB_ARCHIVE });
  await waitArchiveSeed(page);
  await expect.poll(() => mobileIds(page)).toEqual(DEFAULT_ORDER);
  const mSearch = mobileSearch(page);
  await expect(mSearch).toBeVisible();
  await mSearch.fill('site');
  await expect.poll(() => mobileIds(page)).toEqual(['ad1']);
  await mSearch.fill('SITE');
  await expect.poll(() => mobileIds(page)).toEqual(['ad1']);
  await mSearch.fill('zzzz-no-such-archive');
  await expect(page.getByText('No archived items match your search.').filter({ visible: true })).toBeVisible();
  await mSearch.fill('');
  await expect.poll(() => mobileIds(page)).toEqual(DEFAULT_ORDER);
  await mobileFilterButton(page).click();
  await pickMenu(page, page.locator('.archive-mobile-search-row'), 'Documents');
  await expect.poll(() => mobileIds(page)).toEqual(['ad1']);
  await mobileFilterButton(page).click();
  await pickMenu(page, page.locator('.archive-mobile-search-row'), 'All');
  await expect.poll(() => mobileIds(page)).toEqual(DEFAULT_ORDER);

  await openPage(page, { width: 390, height: 844, url: HUB_EMPTY });
  await waitArchiveSeed(page);
  await expect(page.getByText('Nothing in Archive').filter({ visible: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => mobileIds(page)).toEqual([]);

  console.log('ARCHIVE_SEARCH_PROOF', JSON.stringify({
    seedIds: SEED_IDS,
    defaultOrder: DEFAULT_ORDER,
    nameAz: NAME_AZ,
    nameZa: NAME_ZA,
    sizeDesc: SIZE_DESC,
    archiveHostError,
    emptyRestore,
    restoreDidNotRemove: true,
    mobileEmpty: true,
  }));
});
