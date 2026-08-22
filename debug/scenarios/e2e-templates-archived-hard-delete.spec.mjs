import { test, expect } from '@playwright/test';

// Unique leftover after checklist item Delete (unused hard-delete +
// usage>0 archive-confirm). This slice is permanent-delete of
// ALREADY-ARCHIVED items (`hardDeleteItem` /
// aria-label="Permanently delete (orphans historical responses)" +
// 390 aria-label="Permanently delete").
// Do not replay unused × / archive-confirm as the GAP — archive is
// setup only. Move/Copy stays a dead stub. Do not invent Print /
// stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces /
// category Move/Copy. UL-31 Continue pin parked. No file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const USED_ITEM = 'Is the camera cable pulled?';
const UNUSED_ITEM = 'Is the camera installed?';
const DOOR_A = 'Is the door roughed in?';
const DOOR_B = 'Are the door devices installed?';
const COMM_ITEM = 'Camera tested and online?';
const MEP_ITEM = 'Tags updated?';
const DESKTOP_PERM_DELETE = 'Permanently delete (orphans historical responses)';
const MOBILE_PERM_DELETE = 'Permanently delete';

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function dirtyBar(page) {
  return page.locator('[data-entity-editor-actions]');
}

async function expectNoDirty(page) {
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
}

async function expectDirty(page) {
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
}

async function clickSave(page) {
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expectNoDirty(page);
}

async function clickCancel(page) {
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectNoDirty(page);
}

function archiveModal(page) {
  return page.getByTestId('archive-confirm-modal');
}

function moduleTabButton(page, name) {
  return page.locator(`[data-module-tab-id] button[title^="${name} ·"]`).filter({ hasText: new RegExp(`^${name}$`) });
}

async function expandCategory(page, name) {
  const clicked = await page.evaluate((wanted) => {
    const titles = [...document.querySelectorAll('input.inline-edit.cat-title')];
    const field = titles.find((el) => el.value === wanted && el.offsetParent);
    if (!field) return false;
    const row = field.closest('[data-drag-rearrange-row]');
    const toggle = row?.querySelector('button[title="Expand"], button[title="Collapse"]');
    if (!toggle) return false;
    if (toggle.getAttribute('title') === 'Expand') toggle.click();
    return true;
  }, name);
  expect(clicked, `expand ${name}`).toBe(true);
}

function itemRow(page, label) {
  return page.locator('[data-drag-rearrange-row]').filter({
    has: page.locator(`input[placeholder="Add checklist item"][value="${label}"]`),
  });
}

function archivedRow(page, itemId = 'i1') {
  return page.locator(`[data-archived-item-id="${itemId}"]`).filter({ visible: true });
}

async function itemValues(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('input.inline-edit[placeholder="Add checklist item"]')]
      .filter((el) => {
        if (!el.offsetParent) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none';
      })
      .map((el) => el.value)
  ));
}

async function clickDeleteItem(page, label) {
  const button = itemRow(page, label).getByRole('button', { name: 'Delete item', exact: true });
  await expect(button).toBeVisible();
  await button.evaluate((el) => el.click());
}

async function clickDesktopPermanentDelete(page, itemId = 'i1') {
  const button = archivedRow(page, itemId).getByRole('button', { name: DESKTOP_PERM_DELETE, exact: true });
  await expect(button).toBeVisible();
  await button.evaluate((el) => el.click());
}

async function openSecurityCameras(page) {
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  await page.getByText('Security Walk-Through').first().click();
  await expect(moduleTabButton(page, 'Installation Phase')).toBeVisible();
  await expandCategory(page, 'Cameras');
  await expect(itemRow(page, USED_ITEM)).toBeVisible();
  await expect(itemRow(page, UNUSED_ITEM)).toBeVisible();
}

/** Setup only — archive-confirm is already proven. Leaves i1 archived + saved. */
async function archiveUsedItemAndSave(page) {
  await clickDeleteItem(page, USED_ITEM);
  await expect(archiveModal(page)).toBeVisible();
  await page.getByTestId('archive-confirm-archive').click();
  await expect(archiveModal(page)).toHaveCount(0);
  await expect(page.getByTestId('archived-items-c1')).toBeVisible();
  await expect(archivedRow(page, 'i1')).toContainText(USED_ITEM);
  await expectDirty(page);
  await clickSave(page);
}

test('Templates permanent-delete of archived items (hardDeleteItem)', async ({ page }) => {
  test.setTimeout(180_000);

  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyDesktopPerm = await page.getByRole('button', { name: DESKTOP_PERM_DELETE, exact: true }).count();
  const emptyMobilePerm = await page.getByRole('button', { name: MOBILE_PERM_DELETE, exact: true }).count();
  expect(emptyDesktopPerm, 'empty hub has no desktop Permanently delete').toBe(0);
  expect(emptyMobilePerm, 'empty hub has no 390 Permanently delete').toBe(0);

  await openHub(page);
  await openSecurityCameras(page);
  const penOnHub = await page.getByRole('button', { name: 'Pen', exact: true }).count();
  expect(penOnHub, 'Pen N/A on hub').toBe(0);
  expect(await itemValues(page)).toEqual([USED_ITEM, UNUSED_ITEM]);
  const seedArchived = await page.getByTestId('archived-items-c1').count();
  const seedPerm = await page.getByRole('button', { name: DESKTOP_PERM_DELETE, exact: true }).count();
  expect(seedArchived, 'seed has no archived section').toBe(0);
  expect(seedPerm, 'seed has no Permanently delete').toBe(0);

  // --- Setup: archive used i1 (not the GAP) then Save ---
  await archiveUsedItemAndSave(page);
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([UNUSED_ITEM]);
  await expect(page.getByTestId('archived-items-c1')).toBeVisible();
  await expect(archivedRow(page, 'i1')).toContainText(USED_ITEM);
  await expect(archivedRow(page, 'i1').locator('span[title*="historical responses preserved"]')).toBeVisible();
  const permBtn = archivedRow(page, 'i1').getByRole('button', { name: DESKTOP_PERM_DELETE, exact: true });
  await expect(permBtn).toBeVisible();
  await expect(permBtn).toHaveAttribute('title', DESKTOP_PERM_DELETE);
  await expectNoDirty(page);
  const orphanCopyShown = true;

  // --- Immediate hard-delete: no confirm (Cancel / Escape / outside N/A) ---
  await clickDesktopPermanentDelete(page, 'i1');
  await expect(archiveModal(page)).toHaveCount(0);
  await expect(page.getByTestId('archived-items-c1')).toHaveCount(0);
  await expect(archivedRow(page, 'i1')).toHaveCount(0);
  expect(await itemValues(page)).toEqual([UNUSED_ITEM]);
  await expectDirty(page);
  const noConfirm = true;

  await page.keyboard.press('Escape');
  await expect(archiveModal(page)).toHaveCount(0);
  await expect(archivedRow(page, 'i1')).toHaveCount(0);
  await expectDirty(page);

  // Cancel restores the archived row (last saved), not the active item
  await clickCancel(page);
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([UNUSED_ITEM]);
  await expect(page.getByTestId('archived-items-c1')).toBeVisible();
  await expect(archivedRow(page, 'i1')).toContainText(USED_ITEM);
  await expectNoDirty(page);

  // Permanently delete + Save; empty archived list; isolation
  await clickDesktopPermanentDelete(page, 'i1');
  await expect(page.getByTestId('archived-items-c1')).toHaveCount(0);
  await expectDirty(page);
  await clickSave(page);
  await expect(page.getByTestId('archived-items-c1')).toHaveCount(0);
  await expect(page.getByRole('button', { name: DESKTOP_PERM_DELETE, exact: true })).toHaveCount(0);
  expect(await itemValues(page)).toEqual([UNUSED_ITEM]);
  const emptyAfterLast = true;

  await expandCategory(page, 'Doors');
  expect(await itemValues(page)).toEqual(expect.arrayContaining([DOOR_A, DOOR_B]));
  expect(await itemValues(page)).not.toContain(USED_ITEM);
  await expect(page.getByTestId('archived-items-c2')).toHaveCount(0);
  await moduleTabButton(page, 'Commissioning Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([COMM_ITEM]);
  await page.getByText('MEP As-Built Markup').first().click();
  await expandCategory(page, 'AHU Equipment');
  expect(await itemValues(page)).toEqual([MEP_ITEM]);
  await page.getByText('Security Walk-Through').first().click();
  await moduleTabButton(page, 'Installation Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([UNUSED_ITEM]);
  await expect(page.getByTestId('archived-items-c1')).toHaveCount(0);
  const isolation = true;

  // ========== 390 ==========
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.evaluate((row) => row.click());
  await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });
  const camerasToggle = page.locator('.templates-mobile-category-toggle[aria-label*="Cameras"]').first();
  if ((await camerasToggle.getAttribute('aria-label') || '').startsWith('Expand')) {
    await camerasToggle.evaluate((button) => button.click());
  }
  const mobileItemRow = (label) => page.locator('.templates-mobile-item-row').filter({
    has: page.locator(`input[value="${label}"]`),
  });
  await expect(mobileItemRow(USED_ITEM)).toBeVisible();
  await expect(mobileItemRow(UNUSED_ITEM)).toBeVisible();
  const mobileSeedPerm = await page.getByRole('button', { name: MOBILE_PERM_DELETE, exact: true }).count();
  expect(mobileSeedPerm, '390 seed has no Permanently delete').toBe(0);

  await mobileItemRow(USED_ITEM).getByRole('button', { name: 'Delete item', exact: true }).evaluate((el) => el.click());
  await expect(archiveModal(page)).toBeVisible();
  await page.getByTestId('archive-confirm-archive').click();
  await expect(archiveModal(page)).toHaveCount(0);
  await expect(page.getByTestId('mobile-archived-items-c1')).toBeVisible();
  await expect(archivedRow(page, 'i1')).toContainText(USED_ITEM);
  await expectDirty(page);
  await clickSave(page);

  const mobilePerm = archivedRow(page, 'i1').getByRole('button', { name: MOBILE_PERM_DELETE, exact: true });
  await expect(mobilePerm).toBeVisible();
  await expect(mobilePerm).toHaveAttribute('title', MOBILE_PERM_DELETE);
  await mobilePerm.evaluate((el) => el.click());
  await expect(archiveModal(page)).toHaveCount(0);
  await expect(page.getByTestId('mobile-archived-items-c1')).toHaveCount(0);
  await expect(archivedRow(page, 'i1')).toHaveCount(0);
  await expect(mobileItemRow(UNUSED_ITEM)).toBeVisible();
  await expectDirty(page);

  await clickCancel(page);
  if ((await camerasToggle.getAttribute('aria-label') || '').startsWith('Expand')) {
    await camerasToggle.evaluate((button) => button.click());
  }
  await expect(page.getByTestId('mobile-archived-items-c1')).toBeVisible();
  await expect(archivedRow(page, 'i1')).toContainText(USED_ITEM);

  await archivedRow(page, 'i1').getByRole('button', { name: MOBILE_PERM_DELETE, exact: true }).evaluate((el) => el.click());
  await expectDirty(page);
  await clickSave(page);
  await expect(page.getByTestId('mobile-archived-items-c1')).toHaveCount(0);
  await expect(page.getByRole('button', { name: MOBILE_PERM_DELETE, exact: true })).toHaveCount(0);
  await expect(mobileItemRow(UNUSED_ITEM)).toBeVisible();
  const mobileHardDeleted = true;

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_ARCHIVED_HARD_DELETE_PROOF: {
      leftoverKind: 'templates-archived-hard-delete',
      emptyDesktopPerm,
      emptyMobilePerm,
      seedArchived,
      seedPerm,
      penOnHub,
      orphanCopyShown,
      noConfirm,
      emptyAfterLast,
      isolation,
      mobileSeedPerm,
      mobileHardDeleted,
    },
  }));
});
