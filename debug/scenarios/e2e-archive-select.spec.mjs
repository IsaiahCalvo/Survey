import { test, expect } from '@playwright/test';

// Unique leftover after Archive row Preview / Close preview + Show documents.
// Archive Select / All / None / Done — local selection chrome that aims
// Restore / Delete forever. Those two actions stay leftover-18:
// prove them fail-closed (previewBlocked / toast / no row mutation).
// Do not invent a local restore.
// Distinct from Documents Select (Duplicate / Move/Copy / Share / Delete).
// Do not replay Archive Search / filter / sort; Archive row Preview /
// Close preview; Show documents expand; Archive empty chrome; TabBar
// Close tab; Documents extras + Open file; Projects family; Templates
// family; Spaces; Survey-rail; PDF waves.

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

async function desktopPressed(page) {
  return desktopRows(page).evaluateAll((nodes) => (
    nodes
      .filter((node) => node.offsetParent && node.getAttribute('aria-pressed') === 'true')
      .map((node) => node.getAttribute('data-archive-item-id'))
  ));
}

async function waitArchiveSeed(page) {
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('invalid input syntax for type uuid')).toHaveCount(0);
}

function archivePreview(page) {
  return page.locator('.archive-desktop-card aside');
}

function archiveSelect(page) {
  return page.getByRole('button', { name: 'Select', exact: true });
}

function archiveDone(page) {
  return page.getByRole('button', { name: 'Done', exact: true });
}

function archiveAll(page) {
  return page.getByRole('button', { name: 'All', exact: true });
}

function archiveNone(page) {
  return page.getByRole('button', { name: 'None', exact: true });
}

function archiveRestore(page) {
  return page.getByRole('button', { name: 'Restore', exact: true });
}

function archiveDeleteForever(page) {
  return page.getByRole('button', { name: 'Delete forever', exact: true });
}

test('Archive Select / All / None / Done intended + break + edge', async ({ page }) => {
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
  const selectCount = await archiveSelect(page).count();
  const restoreBeforeSelect = await archiveRestore(page).count();
  const archiveChrome = await visibleNames(page.locator('button, [role="menuitem"], input, [title]'));
  console.log('HUNT_INVENTORY', JSON.stringify({
    docsChrome: docsChrome.slice(0, 20),
    projectsChrome: projectsChrome.slice(0, 16),
    templatesChrome: templatesChrome.slice(0, 16),
    archiveChrome: archiveChrome.slice(0, 24),
    archiveEmpty,
    archiveSearch,
    archiveHostError,
    selectCount,
    restoreBeforeSelect,
  }));

  // --- Break: empty fixture has Select chrome, no rows, no Restore until Select ---
  await openPage(page, { url: HUB_EMPTY });
  await waitArchiveSeed(page);
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible({ timeout: 15_000 });
  await expect(desktopRows(page)).toHaveCount(0);
  await expect(page.getByText('0 items').first()).toBeVisible();
  await expect(archiveSelect(page)).toBeVisible();
  await expect(archiveRestore(page)).toHaveCount(0);
  await expect(archiveDeleteForever(page)).toHaveCount(0);
  await expect(archiveAll(page)).toHaveCount(0);
  await expect(page.getByText('invalid input syntax for type uuid')).toHaveCount(0);

  await archiveSelect(page).click();
  await expect(archiveDone(page)).toBeVisible();
  await expect(archiveAll(page)).toBeVisible();
  await expect(archiveRestore(page)).toBeVisible();
  await expect(archiveDeleteForever(page)).toBeVisible();
  await expect(archiveRestore(page)).toBeDisabled();
  await expect(archiveDeleteForever(page)).toBeDisabled();
  await archiveAll(page).click();
  await expect(desktopRows(page)).toHaveCount(0);
  await expect(archiveRestore(page)).toBeDisabled();
  await archiveDone(page).click();
  await expect(archiveSelect(page)).toBeVisible();
  await expect(archiveRestore(page)).toHaveCount(0);
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible();

  // --- Intended: Select / All / None / Done over seeded rows ---
  await openPage(page, { url: HUB_ARCHIVE });
  await waitArchiveSeed(page);
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await expect(page.getByText('3 items').first()).toBeVisible();
  await expect(archiveSelect(page)).toBeVisible();
  await expect(archiveRestore(page)).toHaveCount(0);
  await expect(archiveAll(page)).toHaveCount(0);
  await expect(archiveDone(page)).toHaveCount(0);

  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await expect(archivePreview(page).getByText('Site plan', { exact: true })).toBeVisible();

  await archiveSelect(page).click();
  await expect(archiveDone(page)).toBeVisible();
  await expect(archiveAll(page)).toBeVisible();
  await expect(archiveRestore(page)).toBeVisible();
  await expect(archiveDeleteForever(page)).toBeVisible();
  await expect(archiveRestore(page)).toBeDisabled();
  await expect(archivePreview(page)).toHaveCount(0);
  await expect.poll(() => desktopPressed(page)).toEqual([]);

  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await expect.poll(() => desktopPressed(page)).toEqual(['ad1']);
  await expect(archivePreview(page)).toHaveCount(0);
  await expect(archiveRestore(page)).toBeEnabled();
  await expect(archiveDeleteForever(page)).toBeEnabled();

  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await expect.poll(() => desktopPressed(page)).toEqual([]);
  await expect(archiveRestore(page)).toBeDisabled();

  await archiveAll(page).click();
  await expect.poll(() => desktopPressed(page)).toEqual(DEFAULT_ORDER);
  await expect(archiveNone(page)).toBeVisible();
  await expect(archiveAll(page)).toHaveCount(0);
  await expect(archiveRestore(page)).toBeEnabled();

  await archiveNone(page).click();
  await expect.poll(() => desktopPressed(page)).toEqual([]);
  await expect(archiveAll(page)).toBeVisible();
  await expect(archiveRestore(page)).toBeDisabled();

  await page.locator('.archive-desktop-card [data-archive-item-id="ap1"]').click();
  await expect.poll(() => desktopPressed(page)).toEqual(['ap1']);
  await archiveDone(page).click();
  await expect(archiveSelect(page)).toBeVisible();
  await expect(archiveRestore(page)).toHaveCount(0);
  await expect(archiveAll(page)).toHaveCount(0);
  await expect.poll(() => desktopPressed(page)).toEqual([]);
  await expect(archivePreview(page).getByText('Site plan', { exact: true })).toBeVisible();
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);

  // All operates over currently visible rows only (Select chrome, not a Search replay)
  await page.locator('.archive-desktop-search .archive-filter-button').click();
  await page.locator('.archive-desktop-search .archive-sort-menu').getByRole('menuitemradio', { name: /^Documents/ }).click();
  await expect.poll(() => desktopIds(page)).toEqual(['ad1']);
  await archiveSelect(page).click();
  await archiveAll(page).click();
  await expect.poll(() => desktopPressed(page)).toEqual(['ad1']);
  await expect(archiveNone(page)).toBeVisible();
  await page.locator('.archive-desktop-search .archive-filter-button').click();
  await page.locator('.archive-desktop-search .archive-sort-menu').getByRole('menuitemradio', { name: /^All/ }).click();
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await expect.poll(() => desktopPressed(page)).toEqual(['ad1']);
  await expect(archiveAll(page)).toBeVisible();
  await archiveDone(page).click();

  // Child rows stay excluded from selection (project is the unit)
  await page.locator('.archive-desktop-card [data-archive-item-id="ap1"] button[title="Show documents"]').click();
  await expect(page.getByRole('button', { name: 'Preview Level 1' })).toBeVisible();
  await archiveSelect(page).click();
  await page.getByRole('button', { name: 'Preview Level 1' }).click();
  await expect(archivePreview(page)).toHaveCount(0);
  await expect.poll(() => desktopPressed(page)).toEqual([]);
  await expect(archiveRestore(page)).toBeDisabled();
  await page.locator('.archive-desktop-card [data-archive-item-id="ap1"]').click();
  await expect.poll(() => desktopPressed(page)).toEqual(['ap1']);
  await archiveDone(page).click();

  // --- Fail-closed: Restore / Delete forever toast, rows stay ---
  await archiveSelect(page).click();
  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await archiveRestore(page).click();
  await expect(page.getByText(/Could not restore 1 item: Site plan/i).first()).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await expect.poll(() => desktopPressed(page)).toEqual(['ad1']);

  await page.locator('.archive-desktop-card [data-archive-item-id="ad1"]').click();
  await page.locator('.archive-desktop-card [data-archive-item-id="at1"]').click();
  await expect.poll(() => desktopPressed(page)).toEqual(['at1']);
  await archiveDeleteForever(page).click();
  const deleteDialog = page.locator('[role="dialog"]').filter({ hasText: 'Delete forever?' });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog.getByText(/This cannot be undone/i)).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(deleteDialog).toHaveCount(0);
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await expect(page.getByText(/Could not delete/i)).toHaveCount(0);

  await archiveDeleteForever(page).click();
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Delete forever', exact: true }).click();
  await expect(page.getByText(/Could not delete 1 item: Bravo checklist/i).first()).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await expect(page.getByText('Bravo checklist').first()).toBeVisible();
  await archiveDone(page).click();

  // Isolation: Documents Select is a different family (no Restore / Delete forever)
  await page.locator('aside.side nav.nav:not(.nav-bottom)').getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByText('SE-011 Security Shop Drawings.pdf').first()).toBeVisible({ timeout: 15_000 });
  await expect(archiveRestore(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move/Copy', exact: true }).first()).toBeVisible();
  await expect(archiveRestore(page)).toHaveCount(0);
  await expect(archiveDeleteForever(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();

  await page.locator('aside.side nav').getByRole('button', { name: 'Archive', exact: true }).click();
  await waitArchiveSeed(page);
  await expect.poll(() => desktopIds(page)).toEqual(DEFAULT_ORDER);
  await expect(archiveSelect(page)).toBeVisible();
  await archiveSelect(page).click();
  await expect(archiveRestore(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move/Copy', exact: true })).toHaveCount(0);
  await archiveDone(page).click();

  // --- Edge: 390 Select / All / None / Done + fail-closed ---
  await openPage(page, { width: 390, height: 844, url: HUB_ARCHIVE });
  await waitArchiveSeed(page);
  await expect.poll(() => mobileIds(page)).toEqual(DEFAULT_ORDER);
  await expect(archiveSelect(page)).toBeVisible();
  await expect(archiveRestore(page)).toHaveCount(0);

  await archiveSelect(page).click();
  await expect(archiveDone(page)).toBeVisible();
  await expect(archiveAll(page)).toBeVisible();
  await expect(archiveRestore(page)).toBeDisabled();
  await mobileCards(page).filter({ hasText: 'Site plan' }).click();
  await expect(archiveRestore(page)).toBeEnabled();
  await archiveAll(page).click();
  await expect(archiveNone(page)).toBeVisible();
  await archiveNone(page).click();
  await expect(archiveAll(page)).toBeVisible();
  await expect(archiveRestore(page)).toBeDisabled();
  await mobileCards(page).filter({ hasText: 'Site plan' }).click();
  await archiveRestore(page).click();
  await expect(page.getByText(/Could not restore 1 item: Site plan/i).first()).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => mobileIds(page)).toEqual(DEFAULT_ORDER);

  await mobileCards(page).filter({ hasText: 'Site plan' }).click();
  await mobileCards(page).filter({ hasText: 'Bravo checklist' }).click();
  await archiveDeleteForever(page).click();
  const mobileDeleteDialog = page.locator('[role="dialog"]').filter({ hasText: 'Delete forever?' });
  await expect(mobileDeleteDialog).toBeVisible();
  await mobileDeleteDialog.getByRole('button', { name: 'Delete forever', exact: true }).click();
  await expect(page.getByText(/Could not delete 1 item: Bravo checklist/i).first()).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => mobileIds(page)).toEqual(DEFAULT_ORDER);
  await archiveDone(page).click();
  await expect(archiveSelect(page)).toBeVisible();
  await expect(archiveRestore(page)).toHaveCount(0);

  await openPage(page, { width: 390, height: 844, url: HUB_EMPTY });
  await waitArchiveSeed(page);
  await expect(page.getByText('Nothing in Archive').filter({ visible: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => mobileIds(page)).toEqual([]);
  await expect(archiveSelect(page)).toBeVisible();
  await expect(archiveRestore(page)).toHaveCount(0);
  await archiveSelect(page).click();
  await expect(archiveRestore(page)).toBeDisabled();
  await expect(archiveDeleteForever(page)).toBeDisabled();
  await archiveDone(page).click();

  console.log('ARCHIVE_SELECT_PROOF', JSON.stringify({
    defaultOrder: DEFAULT_ORDER,
    archiveHostError,
    restoreBeforeSelect,
    emptySelectKeepsZeroRows: true,
    desktopAllNoneDone: true,
    allOverVisibleOnly: true,
    childExcluded: true,
    restoreFailClosed: true,
    deleteForeverFailClosed: true,
    documentsIsolation: true,
    mobileSelect: true,
    mobileEmpty: true,
  }));
});
