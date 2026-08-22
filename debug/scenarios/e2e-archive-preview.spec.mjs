import { test, expect } from '@playwright/test';

// Unique leftover after Archive Search / filter / sort.
// Archive row Preview / Close preview + sibling project Show documents
// expand on hubPreview. Restore / Delete forever stay leftover-18 —
// do not invent Restore writeback.
// Distinct from Documents Preview extras / Open file.
// Do not replay Archive Search / empty chrome / TabBar Close tab /
// Documents extras / Projects extras / Templates / Spaces / Survey-rail /
// PDF waves. mobileProjectLayout unreachable.

const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=archive';
const HUB_DOCS = '/?hubPreview=1&tab=documents';

const DEFAULT_ORDER = ['ap1', 'ad1', 'at1'];

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

function archivePreview(page) {
  return page.locator('.archive-desktop-card aside');
}

function documentsPreview(page) {
  return page.locator('.documents-desktop-card aside');
}

function closePreview(page) {
  return archivePreview(page).getByRole('button', { name: 'Close preview' });
}

function ledgerShowDocuments(page) {
  return page.locator('.archive-desktop-card [data-archive-item-id="ap1"] button[title="Show documents"]');
}

function ledgerHideDocuments(page) {
  return page.locator('.archive-desktop-card [data-archive-item-id="ap1"] button[title="Hide documents"]');
}

function mobileShowDocuments(page) {
  return page.locator('.archive-mobile-card[data-archive-item-id="ap1"] button[title="Show documents"]');
}

function mobileHideDocuments(page) {
  return page.locator('.archive-mobile-card[data-archive-item-id="ap1"] button[title="Hide documents"]');
}

test('Archive row Preview / Close preview + Show documents intended + break + edge', async ({ page }) => {
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
  const showDocuments = await page.getByTitle('Show documents').count();
  const closePreviewCount = await page.getByRole('button', { name: 'Close preview' }).count();
  const archiveChrome = await visibleNames(page.locator('button, [role="menuitem"], input, [title]'));
  console.log('HUNT_INVENTORY', JSON.stringify({
    docsChrome: docsChrome.slice(0, 20),
    projectsChrome: projectsChrome.slice(0, 16),
    templatesChrome: templatesChrome.slice(0, 16),
    archiveChrome: archiveChrome.slice(0, 24),
    archiveEmpty,
    archiveSearch,
    archiveHostError,
    showDocuments,
    closePreviewCount,
  }));

  // --- Break: empty fixture has no rows, no Preview pane, no Show documents ---
  await openPage(page, { url: HUB_EMPTY });
  await waitArchiveSeed(page);
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible({ timeout: 15_000 });
  await expect(desktopRows(page)).toHaveCount(0);
  await expect(archivePreview(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);
  await expect(page.getByTitle('Show documents')).toHaveCount(0);
  await expect(page.getByTitle('Hide documents')).toHaveCount(0);
  await expect(page.getByText('invalid input syntax for type uuid')).toHaveCount(0);
  const emptyRestore = await page.getByRole('button', { name: 'Restore', exact: true }).count();
  expect(emptyRestore, 'empty chrome has no Restore until Select').toBe(0);

  // --- Intended: seeded row click opens Archive Preview; Close preview hides ---
  await openPage(page, { url: HUB_ARCHIVE });
  await waitArchiveSeed(page);
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await expect(archivePreview(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);
  await expect(ledgerShowDocuments(page)).toBeVisible();
  await expect(page.getByText('Level 1')).toHaveCount(0);

  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await expect(archivePreview(page)).toBeVisible();
  await expect(archivePreview(page).locator('.section-label', { hasText: 'Preview' })).toBeVisible();
  await expect(archivePreview(page).getByText('Site plan', { exact: true })).toBeVisible();
  await expect(archivePreview(page).getByText(/Document/)).toBeVisible();
  await expect(archivePreview(page).getByText(/Tower 5 — Security/)).toBeVisible();
  await expect(archivePreview(page).getByText(/MB/)).toBeVisible();
  await expect(archivePreview(page).locator('.section-label', { hasText: 'Archived' })).toBeVisible();
  await expect(archivePreview(page).locator('.section-label', { hasText: 'Time remaining' })).toBeVisible();
  await expect(closePreview(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file' })).toHaveCount(0);

  await closePreview(page).click();
  await expect(archivePreview(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);

  // Re-open + switch rows (document → project → template)
  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await expect(archivePreview(page).getByText('Site plan', { exact: true })).toBeVisible();
  await page.locator('.archive-desktop-card [data-archive-item-id="ap1"]').click();
  await expect(archivePreview(page).getByText('Atrium', { exact: true }).first()).toBeVisible();
  await expect(archivePreview(page).locator('.section-label', { hasText: 'Contents' })).toBeVisible();
  await expect(archivePreview(page).getByText('Level 1')).toBeVisible();
  await expect(archivePreview(page).getByText('Level 2')).toBeVisible();
  await expect(archivePreview(page).getByTitle('Hide documents')).toBeVisible();
  await expect(ledgerShowDocuments(page)).toBeVisible();
  await expect(ledgerHideDocuments(page)).toHaveCount(0);

  await page.locator('.archive-desktop-card [data-archive-item-id="at1"]').click();
  await expect(archivePreview(page).getByText('Bravo checklist', { exact: true })).toBeVisible();
  await expect(archivePreview(page).locator('.section-label', { hasText: 'Modules' })).toBeVisible();
  await expect(archivePreview(page).getByText('Walk-through')).toBeVisible();
  await expect(archivePreview(page).getByText('Cameras')).toBeVisible();
  await expect(archivePreview(page).locator('.section-label', { hasText: 'Entities' })).toBeVisible();
  await expect(archivePreview(page).getByText('GC', { exact: true })).toBeVisible();
  await expect(archivePreview(page).getByText('Level 1')).toHaveCount(0);

  // Escape / outside do not close Archive Preview (no dismiss barrier)
  await page.keyboard.press('Escape');
  await expect(archivePreview(page).getByText('Bravo checklist', { exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Archive', exact: true }).click();
  await expect(archivePreview(page)).toBeVisible();

  // Filter that hides the previewed row stale-resolves the pane
  await page.locator('.archive-desktop-search .archive-filter-button').click();
  await page.locator('.archive-desktop-search .archive-sort-menu').getByRole('menuitemradio', { name: /^Documents/ }).click();
  await expect.poll(() => desktopIds(page)).toEqual(['ad1']);
  await expect(archivePreview(page)).toHaveCount(0);
  await page.locator('.archive-desktop-search .archive-filter-button').click();
  await page.locator('.archive-desktop-search .archive-sort-menu').getByRole('menuitemradio', { name: /^All/ }).click();
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);

  // Select mode hides Preview; clicking a row checks instead of previewing.
  // Done restores the last previewId — Select does not clear it.
  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await expect(archivePreview(page)).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await expect(archivePreview(page)).toHaveCount(0);
  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await expect(archivePreview(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
  await expect(archivePreview(page).getByText('Site plan', { exact: true })).toBeVisible();

  // --- Sibling leftover: ledger Show documents expand (independent of Preview) ---
  await expect(ledgerShowDocuments(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview Level 1' })).toHaveCount(0);
  await ledgerShowDocuments(page).click();
  await expect(ledgerHideDocuments(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview Level 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview Level 2' })).toBeVisible();
  await expect(archivePreview(page).getByText('Site plan', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Preview Level 1' }).click();
  await expect(archivePreview(page).getByText('Level 1', { exact: true })).toBeVisible();
  await expect(archivePreview(page).getByText(/Document/)).toBeVisible();
  await expect(archivePreview(page).getByText(/Atrium/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview Level 2' })).toBeVisible();

  await archivePreview(page).getByTitle('Hide documents').click();
  await expect(archivePreview(page).getByText('Level 2')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview Level 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview Level 2' })).toBeVisible();

  await ledgerHideDocuments(page).click();
  await expect(ledgerShowDocuments(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview Level 1' })).toHaveCount(0);
  await expect(archivePreview(page).getByText('Level 1', { exact: true })).toBeVisible();

  await closePreview(page).click();
  await expect(archivePreview(page)).toHaveCount(0);

  // Isolation: Documents Preview is a different pane
  await page.locator('aside.side nav.nav:not(.nav-bottom)').getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByText('SE-011 Security Shop Drawings.pdf').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: 'SE-011' }).first().click();
  await expect(documentsPreview(page)).toBeVisible();
  await expect(documentsPreview(page).getByText(/SE-011/)).toBeVisible();
  await expect(documentsPreview(page).getByRole('button', { name: 'Close preview' })).toBeVisible();
  await expect(documentsPreview(page).getByRole('button', { name: 'Open file' })).toBeVisible();
  await expect(page.locator('.archive-desktop-card aside')).toHaveCount(0);
  await documentsPreview(page).getByRole('button', { name: 'Close preview' }).click();

  await page.locator('aside.side nav').getByRole('button', { name: 'Archive', exact: true }).click();
  await waitArchiveSeed(page);
  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await expect(archivePreview(page).getByText('Site plan', { exact: true })).toBeVisible();
  await expect(archivePreview(page).getByText(/SE-011/)).toHaveCount(0);
  await expect(archivePreview(page).getByRole('button', { name: 'Open file' })).toHaveCount(0);
  await closePreview(page).click();

  // --- Edge: 390 has no Preview pane; Show documents still expands ---
  await openPage(page, { width: 390, height: 844, url: HUB_ARCHIVE });
  await waitArchiveSeed(page);
  await expect.poll(() => mobileIds(page)).toEqual(DEFAULT_ORDER);
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);
  await expect(archivePreview(page)).toHaveCount(0);
  await expect(mobileShowDocuments(page)).toBeVisible();
  await expect(page.locator('.archive-mobile-child-name', { hasText: 'Level 1' })).toHaveCount(0);

  await mobileCards(page).filter({ hasText: 'Site plan' }).click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);
  await expect(archivePreview(page)).toHaveCount(0);

  await mobileShowDocuments(page).click();
  await expect(mobileHideDocuments(page)).toBeVisible();
  await expect(page.locator('.archive-mobile-child-name', { hasText: 'Level 1' })).toBeVisible();
  await expect(page.locator('.archive-mobile-child-name', { hasText: 'Level 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);

  await mobileHideDocuments(page).click();
  await expect(mobileShowDocuments(page)).toBeVisible();
  await expect(page.locator('.archive-mobile-child-name', { hasText: 'Level 1' })).toHaveCount(0);

  await openPage(page, { width: 390, height: 844, url: HUB_EMPTY });
  await waitArchiveSeed(page);
  await expect(page.getByText('Nothing in Archive').filter({ visible: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);
  await expect(page.getByTitle('Show documents')).toHaveCount(0);
  await expect.poll(() => mobileIds(page)).toEqual([]);

  console.log('ARCHIVE_PREVIEW_PROOF', JSON.stringify({
    defaultOrder: DEFAULT_ORDER,
    archiveHostError,
    emptyRestore,
    emptyClosePreview: 0,
    desktopClosePreviewAria: true,
    showDocumentsIndependent: true,
    documentsIsolation: true,
    mobilePreviewAbsent: true,
    mobileShowDocuments: true,
    mobileEmpty: true,
  }));
});
