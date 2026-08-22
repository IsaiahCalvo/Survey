import { test, expect } from '@playwright/test';

// Unique leftover after Templates More menu overflow:
// checklist item Delete (`deleteItem` / aria-label="Delete item").
// Add item / item rename / item reorder already proven — do not replay
// those as the GAP. This slice is unused hard-delete vs usage>0
// archive-confirm (Cancel / Archive / Escape / outside).
// Permanent-delete of archived items is a sibling leftover.
// Move/Copy stays a dead stub. Do not invent Print / stamp / measure /
// Group / Extract / Note-Link / Copy-to-Spaces / category Move/Copy.
// UL-31 Continue pin parked. No file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const USED_ITEM = 'Is the camera cable pulled?';
const UNUSED_ITEM = 'Is the camera installed?';
const DOOR_A = 'Is the door roughed in?';
const DOOR_B = 'Are the door devices installed?';
const COMM_ITEM = 'Camera tested and online?';
const MEP_ITEM = 'Tags updated?';

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

async function openSecurityCameras(page) {
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  await page.getByText('Security Walk-Through').first().click();
  await expect(moduleTabButton(page, 'Installation Phase')).toBeVisible();
  await expandCategory(page, 'Cameras');
  await expect(itemRow(page, USED_ITEM)).toBeVisible();
  await expect(itemRow(page, UNUSED_ITEM)).toBeVisible();
}

test('Templates checklist item Delete (unused hard-delete + usage>0 archive-confirm)', async ({ page }) => {
  test.setTimeout(180_000);

  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyDelete = await page.getByRole('button', { name: 'Delete item', exact: true }).count();
  expect(emptyDelete, 'empty hub has no Delete item').toBe(0);

  await openHub(page);
  await openSecurityCameras(page);
  const penOnHub = await page.getByRole('button', { name: 'Pen', exact: true }).count();
  expect(penOnHub, 'Pen N/A on hub').toBe(0);
  expect(await itemValues(page)).toEqual([USED_ITEM, UNUSED_ITEM]);

  // --- Unused (usage 0): hard-delete, no modal ---
  await clickDeleteItem(page, UNUSED_ITEM);
  await expect(archiveModal(page)).toHaveCount(0);
  expect(await itemValues(page)).toEqual([USED_ITEM]);
  await expectDirty(page);
  await clickCancel(page);
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([USED_ITEM, UNUSED_ITEM]);

  await clickDeleteItem(page, UNUSED_ITEM);
  expect(await itemValues(page)).toEqual([USED_ITEM]);
  await expectDirty(page);
  await clickSave(page);
  await expandCategory(page, 'Doors');
  expect(await itemValues(page)).toEqual(expect.arrayContaining([DOOR_A, DOOR_B]));
  expect(await itemValues(page)).not.toContain(UNUSED_ITEM);
  await moduleTabButton(page, 'Commissioning Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([COMM_ITEM]);
  await page.getByText('MEP As-Built Markup').first().click();
  await expandCategory(page, 'AHU Equipment');
  expect(await itemValues(page)).toEqual([MEP_ITEM]);
  await page.getByText('Security Walk-Through').first().click();
  await moduleTabButton(page, 'Installation Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([USED_ITEM]);
  const unusedIsolation = true;

  // --- Used (usage 3): archive-confirm ---
  await clickDeleteItem(page, USED_ITEM);
  await expect(archiveModal(page)).toBeVisible();
  await expect(archiveModal(page).getByRole('heading', { name: 'Archive checklist item?' })).toBeVisible();
  await expect(archiveModal(page)).toContainText('3');
  await expect(archiveModal(page)).toContainText('survey markers have');
  await expect(archiveModal(page)).toContainText(USED_ITEM);
  await expectNoDirty(page);

  await page.getByTestId('archive-confirm-cancel').click();
  await expect(archiveModal(page)).toHaveCount(0);
  expect(await itemValues(page)).toContain(USED_ITEM);
  await expect(page.locator('[data-archived-item-id="i1"]').filter({ visible: true })).toHaveCount(0);
  await expectNoDirty(page);

  await clickDeleteItem(page, USED_ITEM);
  await expect(archiveModal(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(archiveModal(page)).toHaveCount(0);
  expect(await itemValues(page)).toContain(USED_ITEM);
  await expectNoDirty(page);
  const escapeDismiss = true;

  await clickDeleteItem(page, USED_ITEM);
  await expect(archiveModal(page)).toBeVisible();
  await archiveModal(page).click({ position: { x: 8, y: 8 } });
  await expect(archiveModal(page)).toHaveCount(0);
  expect(await itemValues(page)).toContain(USED_ITEM);
  await expectNoDirty(page);
  const outsideDismiss = true;

  await clickDeleteItem(page, USED_ITEM);
  await expect(archiveModal(page)).toBeVisible();
  await page.getByTestId('archive-confirm-archive').click();
  await expect(archiveModal(page)).toHaveCount(0);
  expect(await itemValues(page)).not.toContain(USED_ITEM);
  await expect(page.getByTestId('archived-items-c1')).toBeVisible();
  await expect(page.locator('[data-archived-item-id="i1"]').filter({ visible: true })).toContainText(USED_ITEM);
  await expectDirty(page);
  await clickCancel(page);
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toContain(USED_ITEM);
  await expect(page.locator('[data-archived-item-id="i1"]').filter({ visible: true })).toHaveCount(0);

  await clickDeleteItem(page, USED_ITEM);
  await page.getByTestId('archive-confirm-archive').click();
  await expectDirty(page);
  await clickSave(page);
  await expect(page.locator('[data-archived-item-id="i1"]').filter({ visible: true })).toContainText(USED_ITEM);
  await expandCategory(page, 'Doors');
  expect(await itemValues(page)).toEqual(expect.arrayContaining([DOOR_A, DOOR_B]));
  await page.getByText('MEP As-Built Markup').first().click();
  await expandCategory(page, 'AHU Equipment');
  expect(await itemValues(page)).toEqual([MEP_ITEM]);
  await page.getByText('Security Walk-Through').first().click();
  await expandCategory(page, 'Cameras');
  await expect(page.locator('[data-archived-item-id="i1"]').filter({ visible: true })).toContainText(USED_ITEM);
  const archiveIsolation = true;

  // --- Last-item delete is allowed (Commissioning Cameras has one unused) ---
  await moduleTabButton(page, 'Commissioning Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([COMM_ITEM]);
  await clickDeleteItem(page, COMM_ITEM);
  await expect(archiveModal(page)).toHaveCount(0);
  expect(await itemValues(page)).toEqual([]);
  await expect(page.getByText('No checklist items yet.').first()).toBeVisible();
  await expectDirty(page);
  await clickCancel(page);
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([COMM_ITEM]);
  await clickDeleteItem(page, COMM_ITEM);
  await clickSave(page);
  await expandCategory(page, 'Cameras');
  expect(await itemValues(page)).toEqual([]);
  const lastItemAllowed = true;

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
  const mobileDelete = await page.locator('.templates-mobile-item-row').getByRole('button', { name: 'Delete item', exact: true }).count();
  expect(mobileDelete, '390 Delete item').toBeGreaterThan(0);

  await mobileItemRow(UNUSED_ITEM).getByRole('button', { name: 'Delete item', exact: true }).evaluate((el) => el.click());
  await expect(archiveModal(page)).toHaveCount(0);
  await expect(mobileItemRow(UNUSED_ITEM)).toHaveCount(0);
  const mobileUnusedHardDeleted = true;

  await mobileItemRow(USED_ITEM).getByRole('button', { name: 'Delete item', exact: true }).evaluate((el) => el.click());
  await expect(archiveModal(page)).toBeVisible();
  await expect(archiveModal(page)).toContainText('3');
  await page.getByTestId('archive-confirm-cancel').click();
  await expect(archiveModal(page)).toHaveCount(0);
  await expect(mobileItemRow(USED_ITEM)).toBeVisible();
  await mobileItemRow(USED_ITEM).getByRole('button', { name: 'Delete item', exact: true }).evaluate((el) => el.click());
  await page.getByTestId('archive-confirm-archive').click();
  await expect(archiveModal(page)).toHaveCount(0);
  await expect(mobileItemRow(USED_ITEM)).toHaveCount(0);
  await expect(page.locator('[data-archived-item-id="i1"]').filter({ visible: true })).toContainText(USED_ITEM);
  const mobileArchived = true;

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_CHECKLIST_ITEM_DELETE_PROOF: {
      leftoverKind: 'templates-checklist-item-delete',
      emptyDelete,
      penOnHub,
      unusedHardDeleted: true,
      unusedIsolation,
      usedUsage: 3,
      cancelLeftItem: true,
      escapeDismiss,
      outsideDismiss,
      archiveIsolation,
      lastItemAllowed,
      mobileDelete,
      mobileUnusedHardDeleted,
      mobileArchived,
    },
  }));
});
