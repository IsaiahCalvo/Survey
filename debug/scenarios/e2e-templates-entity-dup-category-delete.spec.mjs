import { test, expect } from '@playwright/test';

// Unique leftovers after Templates template-list Duplicate:
// 1) New entity (button "New entity" / addEntity / Entity N) — U-03
//    create/rename/delete was template-list only, still cluster-only here.
// 2) Entity Duplicate (Entities Select → duplicateEntities / `${role} copy`)
// 3) Entity Delete (Entities Select trash / deleteEntities)
// 4) Category Delete (Categories Select trash / deleteCategories)
// Distinct from U-03 template create/rename/delete, entity color, Add module /
// module Duplicate / Add checklist item, New category / category Duplicate /
// module Delete, template-list Duplicate, leftover-18 export.
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const SECURITY_ENTITIES = ['GC', 'Subcontractor', '100% Complete'];
const MEP_ENTITIES = ['MEP', 'Architect'];

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function desktopGrid(page) {
  return page.locator('.templates-editor-grid');
}

function moduleTabButton(page, name) {
  return desktopGrid(page).locator(`[data-module-tab-id] button[title^="${name} ·"]`).filter({ hasText: new RegExp(`^${name}$`) });
}

function entitiesRail(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New entity', exact: true }),
  });
}

function newEntityButton(page) {
  return entitiesRail(page).getByRole('button', { name: 'New entity', exact: true });
}

function categoryChrome(page) {
  return desktopGrid(page).locator('p.micro', { hasText: /^Categories$/ }).locator('xpath=..');
}

function dirtyBar(page) {
  return page.locator('[data-entity-editor-actions]');
}

function colorPanel(page) {
  return page.locator('[data-entity-color-panel]');
}

async function enterEntitySelect(page) {
  const rail = entitiesRail(page);
  const done = rail.getByRole('button', { name: 'Done', exact: true });
  if (await done.count()) return;
  await rail.getByRole('button', { name: 'Select', exact: true }).click();
}

async function enterCategorySelect(page) {
  const chrome = categoryChrome(page);
  const done = chrome.getByRole('button', { name: 'Done', exact: true });
  if (await done.count()) return;
  await chrome.getByRole('button', { name: 'Select', exact: true }).click();
}

async function closeEntityColorPanel(page) {
  const panel = colorPanel(page);
  if (!(await panel.count())) return;
  const closed = await entitiesRail(page).evaluate((rail) => {
    const rows = [...rail.querySelectorAll('[data-drag-rearrange-row]')];
    const openRow = rows.find((row) => row.nextElementSibling?.matches?.('[data-entity-color-panel]'));
    const button = (openRow || rows[rows.length - 1])?.querySelector('button[aria-label="Edit color"]');
    if (!button) return false;
    button.click();
    return true;
  });
  expect(closed, 'close entity color panel').toBe(true);
  await expect(panel).toHaveCount(0);
}

async function entityNames(page) {
  return entitiesRail(page).locator('input[placeholder="Entity name"]').evaluateAll((inputs) => (
    inputs.filter((el) => el.offsetParent).map((el) => el.value)
  ));
}

function entityNameField(page, role) {
  return entitiesRail(page).locator(`input[placeholder="Entity name"][value="${role}"]`);
}

function entityRow(page, role) {
  return entitiesRail(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator(`input[placeholder="Entity name"][value="${role}"]`),
  });
}

async function categoryNames(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.templates-editor-grid [data-drag-rearrange-row]')];
    return rows.flatMap((row) => {
      const toggle = row.querySelector('button[title="Expand"], button[title="Collapse"]');
      const field = row.querySelector('input.inline-edit.cat-title');
      if (!toggle || !field || !field.offsetParent) return [];
      return [field.value];
    });
  });
}

function categoryRow(page, name) {
  return desktopGrid(page).locator('[data-drag-rearrange-row]')
    .filter({ has: page.locator('button[title="Expand"], button[title="Collapse"]') })
    .filter({ has: page.locator(`input.inline-edit.cat-title[value="${name}"]`) });
}

async function toggleRowCheckbox(row) {
  const clicked = await row.evaluate((node) => {
    const box = [...node.querySelectorAll('span')].find((el) => el.style.width === '14px' && el.style.height === '14px');
    if (!box) return false;
    box.click();
    return true;
  });
  expect(clicked, 'row checkbox').toBe(true);
}

async function confirmDialogOpen(page) {
  const archive = await page.locator('[data-testid="archive-confirm-modal"]').count();
  const sure = await page.getByText(/are you sure/i).count();
  const confirmBtn = await page.getByRole('button', { name: /^(Confirm|Delete entity|Delete category)$/i }).count();
  return archive > 0 || sure > 0 || confirmBtn > 0;
}

test('Templates New entity + entity Duplicate + entity Delete + category Delete', async ({ page }) => {
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyNewEntityBtn = page.getByRole('button', { name: 'New entity', exact: true });
  const emptyNewEntity = await emptyNewEntityBtn.count();
  const emptyNewEntityEnabled = emptyNewEntity > 0 && await emptyNewEntityBtn.first().isEnabled();
  if (emptyNewEntity > 0) {
    await emptyNewEntityBtn.first().click({ force: true }).catch(() => {});
  }
  expect(await page.locator('input[placeholder="Entity name"][value="Entity 1"]').count(), 'empty hub does not mint Entity 1').toBe(0);
  expect(emptyNewEntityEnabled, 'empty hub New entity is not enabled').toBe(false);
  const emptyEntDup = await entitiesRail(page).getByRole('button', { name: 'Duplicate', exact: true }).count();
  const emptyEntDelete = await entitiesRail(page).getByRole('button', { name: 'Delete', exact: true }).count();
  const emptyCatDelete = await categoryChrome(page).getByRole('button', { name: 'Delete', exact: true }).count();
  expect(emptyEntDup, 'empty hub has no entity Duplicate').toBe(0);
  expect(emptyEntDelete, 'empty hub has no entity Delete').toBe(0);
  expect(emptyCatDelete, 'empty hub has no category Delete').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);
  await expect(newEntityButton(page)).toBeVisible();
  await expect(newEntityButton(page)).toBeEnabled();

  // --- New entity: intended mint ---
  await newEntityButton(page).click();
  await expect.poll(async () => entityNames(page)).toEqual([...SECURITY_ENTITIES, 'Entity 1']);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(colorPanel(page)).toBeVisible();

  // --- New entity: break — empty / whitespace snaps back; Escape keeps name ---
  const entity1Field = entityNameField(page, 'Entity 1');
  await expect(entity1Field).toBeVisible();
  await entity1Field.click();
  await entity1Field.fill('   ');
  await entity1Field.press('Enter');
  await expect.poll(async () => entityNames(page)).toContain('Entity 1');
  expect(await entityNames(page)).not.toContain('');

  await entity1Field.click();
  await entity1Field.fill('gone');
  await entity1Field.press('Escape');
  await expect.poll(async () => entityNames(page)).toContain('Entity 1');
  expect(await entityNames(page)).not.toContain('gone');

  // Ctrl+Z is not history undo — Cancel is the revert.
  await page.keyboard.press('Control+z');
  expect(await entityNames(page)).toContain('Entity 1');
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);

  // --- New entity: persist + isolation across templates ---
  await newEntityButton(page).click();
  await expect.poll(async () => entityNames(page)).toContain('Entity 1');
  const rename = entityNameField(page, 'Entity 1');
  await rename.click();
  await rename.fill('E2E Entity');
  await rename.press('Enter');
  await expect.poll(async () => entityNames(page)).toEqual([...SECURITY_ENTITIES, 'E2E Entity']);
  await closeEntityColorPanel(page);
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await moduleTabButton(page, 'Commissioning Phase').click();
  expect(await entityNames(page)).toEqual([...SECURITY_ENTITIES, 'E2E Entity']);
  await page.getByText('MEP As-Built Markup').first().click();
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  expect(await entityNames(page)).not.toContain('E2E Entity');
  await page.getByText('Security Walk-Through').first().click();
  expect(await entityNames(page)).toEqual([...SECURITY_ENTITIES, 'E2E Entity']);

  // --- Entity Duplicate: leftover is ENTITY (Select → duplicateEntities).
  // Template-list / module / category Duplicate are distinct leftovers. ---
  await enterEntitySelect(page);
  const entDup = entitiesRail(page).getByRole('button', { name: 'Duplicate', exact: true });
  await expect(entDup).toBeVisible();
  await expect(entDup).toBeDisabled();
  await toggleRowCheckbox(entityRow(page, 'GC'));
  await expect(entDup).toBeEnabled();
  await entDup.click();
  await expect.poll(async () => entityNames(page)).toEqual([
    'GC',
    'GC copy',
    'Subcontractor',
    '100% Complete',
    'E2E Entity',
  ]);

  // Break: Cancel discards the entity copy.
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await entityNames(page)).toEqual([...SECURITY_ENTITIES, 'E2E Entity']);

  // Persist + isolation. Dirty-bar Cancel does not exit entity Select.
  await enterEntitySelect(page);
  await toggleRowCheckbox(entityRow(page, 'GC'));
  await entDup.click();
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await entityNames(page)).toEqual([
    'GC',
    'GC copy',
    'Subcontractor',
    '100% Complete',
    'E2E Entity',
  ]);
  await page.getByText('MEP As-Built Markup').first().click();
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  expect(await entityNames(page)).not.toContain('GC copy');
  await page.getByText('Security Walk-Through').first().click();
  expect(await entityNames(page)).toContain('GC copy');
  expect(await entityNames(page)).toContain('Subcontractor');

  // Edge: Duplicate twice — product rule is `${role} copy` (copy then copy copy).
  await enterEntitySelect(page);
  await toggleRowCheckbox(entityRow(page, 'GC copy'));
  await entDup.click();
  await expect.poll(async () => entityNames(page)).toEqual([
    'GC',
    'GC copy',
    'GC copy copy',
    'Subcontractor',
    '100% Complete',
    'E2E Entity',
  ]);
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await entityNames(page)).toEqual([
    'GC',
    'GC copy',
    'Subcontractor',
    '100% Complete',
    'E2E Entity',
  ]);

  // --- Entity Delete: leftover is Entities Select trash / deleteEntities.
  // Confirm if a dialog exists (source has none — prove immediate delete). ---
  await enterEntitySelect(page);
  const entDelete = entitiesRail(page).getByRole('button', { name: 'Delete', exact: true });
  await expect(entDelete).toBeVisible();
  await expect(entDelete).toBeDisabled();
  expect(await confirmDialogOpen(page), 'no leftover confirm sitting open').toBe(false);

  await toggleRowCheckbox(entityRow(page, 'GC copy'));
  await expect(entDelete).toBeEnabled();
  await entDelete.click();
  expect(await confirmDialogOpen(page), 'entity Delete has no confirm dialog').toBe(false);
  await expect.poll(async () => entityNames(page)).toEqual([
    'GC',
    'Subcontractor',
    '100% Complete',
    'E2E Entity',
  ]);

  // Last-remaining entity is allowed (no last-entity guard).
  const allBtn = entitiesRail(page).getByRole('button', { name: 'All', exact: true });
  await expect(allBtn).toBeVisible();
  await allBtn.click();
  await entDelete.click();
  expect(await confirmDialogOpen(page)).toBe(false);
  await expect.poll(async () => entityNames(page)).toEqual([]);
  await expect(entitiesRail(page).getByText('No entities on this template yet.')).toBeVisible();

  // Break: Cancel restores the saved roster (no history undo).
  await page.keyboard.press('Control+z');
  expect(await entityNames(page)).toEqual([]);
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await entityNames(page)).toEqual([
    'GC',
    'GC copy',
    'Subcontractor',
    '100% Complete',
    'E2E Entity',
  ]);

  // Persist + isolation: delete 100% Complete only.
  await enterEntitySelect(page);
  await toggleRowCheckbox(entityRow(page, '100% Complete'));
  await entDelete.click();
  expect(await confirmDialogOpen(page)).toBe(false);
  await expect.poll(async () => entityNames(page)).toEqual([
    'GC',
    'GC copy',
    'Subcontractor',
    'E2E Entity',
  ]);
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await entityNames(page)).not.toContain('100% Complete');
  await page.getByText('MEP As-Built Markup').first().click();
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  await page.getByText('Security Walk-Through').first().click();
  expect(await entityNames(page)).toEqual([
    'GC',
    'GC copy',
    'Subcontractor',
    'E2E Entity',
  ]);
  expect(await entityNames(page)).not.toContain('100% Complete');

  // --- Category Delete: leftover is Categories Select trash / deleteCategories.
  // Distinct from module Delete and survey-rail category Delete. ---
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);
  await enterCategorySelect(page);
  const catDelete = categoryChrome(page).getByRole('button', { name: 'Delete', exact: true });
  await expect(catDelete).toBeVisible();
  await expect(catDelete).toBeDisabled();
  expect(await confirmDialogOpen(page)).toBe(false);

  await toggleRowCheckbox(categoryRow(page, 'Cameras'));
  await expect(catDelete).toBeEnabled();
  await catDelete.click();
  expect(await confirmDialogOpen(page), 'category Delete has no confirm dialog').toBe(false);
  await expect.poll(async () => categoryNames(page)).toEqual(['Doors']);

  // Last-remaining category is allowed (no last-category guard).
  await toggleRowCheckbox(categoryRow(page, 'Doors'));
  await catDelete.click();
  expect(await confirmDialogOpen(page)).toBe(false);
  await expect.poll(async () => categoryNames(page)).toEqual([]);
  await expect(desktopGrid(page).getByText('This module has no categories yet.')).toBeVisible();

  // Break: Cancel restores both categories.
  await page.keyboard.press('Control+z');
  expect(await categoryNames(page)).toEqual([]);
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);

  // Persist + isolation: delete Cameras only.
  await enterCategorySelect(page);
  await toggleRowCheckbox(categoryRow(page, 'Cameras'));
  await catDelete.click();
  expect(await confirmDialogOpen(page)).toBe(false);
  await expect.poll(async () => categoryNames(page)).toEqual(['Doors']);
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await categoryNames(page)).toEqual(['Doors']);
  await moduleTabButton(page, 'Commissioning Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras']);
  await page.getByText('MEP As-Built Markup').first().click();
  expect(await categoryNames(page)).toEqual(['AHU Equipment']);
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  await page.getByText('Security Walk-Through').first().click();
  await moduleTabButton(page, 'Installation Phase').click();
  expect(await categoryNames(page)).toEqual(['Doors']);
  expect(await categoryNames(page)).not.toContain('Cameras');
  expect(await entityNames(page)).toEqual([
    'GC',
    'GC copy',
    'Subcontractor',
    'E2E Entity',
  ]);

  // 390 chrome
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  let mobileNewEntity = 0;
  let mobileAddedEntity = false;
  let mobileEntDup = 0;
  let mobileEntDelete = 0;
  let mobileCatDelete = 0;
  let mobileDeleteHasConfirm = false;
  if (await mobileRow.isVisible().catch(() => false)) {
    await mobileRow.click();
    await expect(page.locator('.templates-mobile-detail')).toBeVisible();
    const entitiesOpen = page.getByRole('button', { name: 'Entities', exact: true });
    if (await entitiesOpen.isVisible().catch(() => false)) {
      await entitiesOpen.click();
      const mobileDialog = page.getByRole('dialog', { name: 'Entities' });
      await expect(mobileDialog).toBeVisible();
      const newEnt = mobileDialog.getByRole('button', { name: 'New entity', exact: true });
      mobileNewEntity = await newEnt.count();
      if (mobileNewEntity > 0) {
        await newEnt.first().evaluate((button) => button.click());
        mobileAddedEntity = await mobileDialog.locator('input[value="Entity 1"]').count() > 0
          || await mobileDialog.getByText('Entity 1', { exact: true }).count() > 0;
      }
      const entSelect = mobileDialog.getByRole('button', { name: /^(Select|Done)$/ }).first();
      if (await entSelect.isVisible().catch(() => false)) {
        await entSelect.evaluate((button) => button.click());
        mobileEntDup = await mobileDialog.getByRole('button', { name: 'Duplicate', exact: true }).count();
        mobileEntDelete = await mobileDialog.getByRole('button', { name: 'Delete', exact: true }).count();
        mobileDeleteHasConfirm = await confirmDialogOpen(page);
      }
      const close = mobileDialog.getByRole('button', { name: 'Close', exact: true });
      if (await close.count()) await close.evaluate((button) => button.click());
    }
    const catSelect = page.locator('.templates-mobile-categories-section').getByRole('button', { name: /^(Select|Done)$/ }).first();
    if (await catSelect.isVisible().catch(() => false)) {
      await catSelect.evaluate((button) => button.click());
      mobileCatDelete = await page.locator('.templates-mobile-categories-section').getByRole('button', { name: 'Delete', exact: true }).count();
      mobileDeleteHasConfirm = mobileDeleteHasConfirm || await confirmDialogOpen(page);
    }
  }

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_ENTITY_DUP_CATEGORY_DELETE_PROOF: {
      leftoverKind: 'entity-dup-category-delete',
      emptyNewEntity,
      emptyNewEntityEnabled,
      emptyEntDup,
      emptyEntDelete,
      emptyCatDelete,
      newEntityCancelRestored: true,
      newEntitySaved: true,
      newEntityIsolation: true,
      entityDupCancelRestored: true,
      entityDupSaved: true,
      entityDupIsolation: true,
      entityDeleteHasConfirm: false,
      entityDeleteImmediate: true,
      lastEntityAllowed: true,
      entityDeleteCancelRestored: true,
      entityDeleteSaved: true,
      entityDeleteIsolation: true,
      categoryDeleteHasConfirm: false,
      categoryDeleteImmediate: true,
      lastCategoryAllowed: true,
      categoryDeleteCancelRestored: true,
      categoryDeleteSaved: true,
      categoryDeleteIsolation: true,
      mobileNewEntity,
      mobileAddedEntity,
      mobileEntDup,
      mobileEntDelete,
      mobileCatDelete,
      mobileDeleteHasConfirm,
    },
  }));
});
