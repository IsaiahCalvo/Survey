import { test, expect } from '@playwright/test';

// Unique leftover after Templates list / content / module Search:
// existing-row rename of seed Cameras / Installation Phase / GC / item text
// (`renameModule` / `renameCategory` / `renameEntity` / `renameItem`).
// Create flows only minted new names — this slice is rename of EXISTING rows.
// Distinct from U-03 template-list create/rename/delete.
// Move/Copy is a dead stub. More menu is sibling overflow — not this GAP.
// Do not invent Print / stamp / measure / Group / Extract / Note-Link /
// Copy-to-Spaces. UL-31 Continue pin parked. No file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';

const SEED_MODS = ['Installation Phase', 'Commissioning Phase'];
const SEED_CATS = ['Cameras', 'Doors'];
const SEED_ENTITIES = ['GC', 'Subcontractor', '100% Complete'];
const CAMERAS_ITEMS = ['Is the camera cable pulled?', 'Is the camera installed?'];
const DOORS_ITEMS = ['Is the door roughed in?', 'Are the door devices installed?'];
const INSTALL_ITEM = 'Is the camera installed?';
const CABLE_ITEM = 'Is the camera cable pulled?';

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

function templatesList(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  });
}

async function openTemplateFromList(page, name) {
  await templatesList(page).locator('[data-drag-rearrange-row]').filter({ hasText: name }).click();
  await expect(page.locator('.templates-editor-grid input.inline-edit.cat-title[title="Click to rename"]').first()).toHaveValue(name, { timeout: 8_000 });
}

function moduleTabs(page) {
  return page.locator('[data-module-tab-id]');
}

function moduleTabButton(page, name) {
  return page.locator(`[data-module-tab-id] button[title^="${name} ·"]`).filter({ hasText: new RegExp(`^${name}$`) });
}

async function moduleTabNames(page) {
  return moduleTabs(page).evaluateAll((nodes) => (
    nodes.filter((node) => node.offsetParent).map((node) => {
      const input = node.querySelector('input');
      const button = node.querySelector('button');
      return (input?.value || button?.textContent || '').trim();
    }).filter(Boolean)
  ));
}

async function startModuleRename(page, name) {
  await expect(moduleTabButton(page, name)).toBeVisible({ timeout: 8_000 });
  await moduleTabButton(page, name).dblclick();
  const field = moduleTabs(page).locator('input.inline-edit');
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(field).toHaveValue(name);
  return field;
}

function editModulesModal(page) {
  return page.locator('.templates-module-edit-modal');
}

async function openDesktopEditModules(page) {
  const select = page.locator('p.micro', { hasText: /^Module$/ }).locator('xpath=following-sibling::button[1]');
  await expect(select).toBeVisible({ timeout: 8_000 });
  await select.click();
  await expect(editModulesModal(page)).toBeVisible({ timeout: 8_000 });
}

function categoryRow(page, name) {
  return page.locator('.templates-editor-grid [data-drag-rearrange-row]')
    .filter({ has: page.locator('button[title="Expand"], button[title="Collapse"]') })
    .filter({ has: page.locator(`input.inline-edit.cat-title[title="Click to rename"][value="${name}"]`) });
}

function categoryField(page, name) {
  return categoryRow(page, name).locator('input.inline-edit.cat-title[title="Click to rename"]');
}

async function categoryNames(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.templates-editor-grid [data-drag-rearrange-row]')];
    return rows.filter((row) => (
      row.querySelector('button[title="Expand"], button[title="Collapse"]') && row.offsetParent
    )).map((row) => {
      const field = row.querySelector('input.inline-edit.cat-title[title="Click to rename"]');
      return (field?.value || '').trim();
    }).filter(Boolean);
  });
}

async function expandCategory(page, name) {
  const row = categoryRow(page, name);
  await expect(row).toBeVisible({ timeout: 8_000 });
  const toggle = row.locator('button[title="Expand"], button[title="Collapse"]');
  if ((await toggle.getAttribute('title')) === 'Expand') {
    await toggle.click();
  }
  await expect(row.locator('button[title="Collapse"]')).toBeVisible();
}

async function itemNamesInCategory(page, name) {
  return page.evaluate((wanted) => {
    const titles = [...document.querySelectorAll('.templates-editor-grid input.inline-edit.cat-title[title="Click to rename"]')];
    const field = titles.find((el) => el.value === wanted && el.offsetParent);
    if (!field) return [];
    const card = field.closest('.card-line');
    if (!card) return [];
    return [...card.querySelectorAll('input.inline-edit[placeholder="Add checklist item"]')]
      .filter((el) => {
        const style = getComputedStyle(el);
        return el.offsetParent && style.visibility !== 'hidden' && Number(style.opacity) > 0;
      })
      .map((el) => el.value);
  }, name);
}

function itemField(page, text) {
  return page.locator('.templates-editor-grid input.inline-edit[placeholder="Add checklist item"]').filter({
    hasText: /^$/,
  }).evaluateAll;
}

async function visibleItemField(page, text) {
  const handle = await page.evaluateHandle((wanted) => {
    const fields = [...document.querySelectorAll('.templates-editor-grid input.inline-edit[placeholder="Add checklist item"]')];
    return fields.find((el) => el.value === wanted && el.offsetParent) || null;
  }, text);
  const element = handle.asElement();
  expect(element, `item field ${text}`).toBeTruthy();
  return element;
}

function entityField(page, role) {
  return page.locator('.templates-editor-grid aside input.inline-edit.cat-title[placeholder="Entity name"]').or(
    page.locator('aside input.inline-edit.cat-title[placeholder="Entity name"]'),
  ).evaluateAll;
}

async function entityNames(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('input.inline-edit.cat-title[placeholder="Entity name"]')]
      .filter((el) => el.offsetParent)
      .map((el) => el.value)
  ));
}

async function visibleEntityField(page, role) {
  const handle = await page.evaluateHandle((wanted) => {
    const fields = [...document.querySelectorAll('input.inline-edit.cat-title[placeholder="Entity name"]')];
    return fields.find((el) => el.value === wanted && el.offsetParent) || null;
  }, role);
  const element = handle.asElement();
  expect(element, `entity field ${role}`).toBeTruthy();
  return element;
}

async function commitTyped(field, value, { key = 'Enter' } = {}) {
  await field.click();
  await field.fill(value);
  await field.press(key);
}

test('Templates existing-row rename (module / category / entity / item)', async ({ page }) => {
  test.setTimeout(180_000);

  // --- Empty hub: no seed rows to rename ---
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyModule = await moduleTabButton(page, 'Installation Phase').count();
  const emptyCategory = await page.locator('input.inline-edit.cat-title[title="Click to rename"][value="Cameras"]').count();
  const emptyEntity = await page.locator('input.inline-edit.cat-title[placeholder="Entity name"][value="GC"]').count();
  const emptyItem = await page.locator('input.inline-edit[placeholder="Add checklist item"][value="Is the camera installed?"]').count();
  expect(emptyModule, 'empty hub has no Installation Phase').toBe(0);
  expect(emptyCategory, 'empty hub has no Cameras').toBe(0);
  expect(emptyEntity, 'empty hub has no GC').toBe(0);
  expect(emptyItem, 'empty hub has no seed item').toBe(0);
  await expectNoDirty(page);

  // --- Seed editor ---
  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  await openTemplateFromList(page, 'Security Walk-Through');
  expect(await moduleTabNames(page)).toEqual(SEED_MODS);
  expect(await categoryNames(page)).toEqual(SEED_CATS);
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);
  await expandCategory(page, 'Cameras');
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(CAMERAS_ITEMS);
  await expectNoDirty(page);

  // ========== MODULE: Installation Phase ==========
  // Break: empty / whitespace keep seed, no dirty
  let field = await startModuleRename(page, 'Installation Phase');
  await commitTyped(field, '');
  expect(await moduleTabNames(page)).toEqual(SEED_MODS);
  await expectNoDirty(page);

  field = await startModuleRename(page, 'Installation Phase');
  await commitTyped(field, '   ');
  expect(await moduleTabNames(page)).toEqual(SEED_MODS);
  await expectNoDirty(page);

  // Break: Escape after a typed change restores, no dirty
  field = await startModuleRename(page, 'Installation Phase');
  await field.fill('gone-module');
  await field.press('Escape');
  expect(await moduleTabNames(page)).toEqual(SEED_MODS);
  await expectNoDirty(page);

  // Edge: unchanged / whitespace-padded same name is a no-op
  field = await startModuleRename(page, 'Installation Phase');
  await commitTyped(field, 'Installation Phase');
  expect(await moduleTabNames(page)).toEqual(SEED_MODS);
  await expectNoDirty(page);

  field = await startModuleRename(page, 'Installation Phase');
  await commitTyped(field, '  Installation Phase  ');
  expect(await moduleTabNames(page)).toEqual(SEED_MODS);
  await expectNoDirty(page);

  // Cancel vs Save
  field = await startModuleRename(page, 'Installation Phase');
  await commitTyped(field, 'Install Phase');
  expect(await moduleTabNames(page)).toEqual(['Install Phase', 'Commissioning Phase']);
  await expectDirty(page);
  await clickCancel(page);
  expect(await moduleTabNames(page)).toEqual(SEED_MODS);

  field = await startModuleRename(page, 'Installation Phase');
  await commitTyped(field, 'E2E Install');
  expect(await moduleTabNames(page)).toEqual(['E2E Install', 'Commissioning Phase']);
  await clickSave(page);
  await openTemplateFromList(page, 'MEP As-Built Markup');
  expect(await moduleTabNames(page)).toEqual(['Equipment']);
  await openTemplateFromList(page, 'Security Walk-Through');
  expect(await moduleTabNames(page)).toEqual(['E2E Install', 'Commissioning Phase']);
  const moduleSaved = true;
  const moduleIsolation = true;

  // Edit-modules also renames the same existing row (and no-ops same name)
  await openDesktopEditModules(page);
  const modalInstall = editModulesModal(page).locator('[data-drag-rearrange-row] input').nth(0);
  await expect(modalInstall).toHaveValue('E2E Install');
  await modalInstall.click();
  await modalInstall.fill('E2E Install');
  await modalInstall.press('Enter');
  await expectNoDirty(page);
  await modalInstall.fill('E2E Install Phase');
  await modalInstall.press('Enter');
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editModulesModal(page)).toHaveCount(0);
  expect(await moduleTabNames(page)).toEqual(['E2E Install Phase', 'Commissioning Phase']);
  await clickSave(page);
  const moduleModalRename = true;

  // ========== CATEGORY: Cameras ==========
  await expect(categoryField(page, 'Cameras')).toBeVisible();
  await categoryField(page, 'Cameras').click();
  await categoryField(page, 'Cameras').fill('');
  await categoryField(page, 'Cameras').press('Enter');
  expect(await categoryNames(page)).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await categoryField(page, 'Cameras').click();
  await categoryField(page, 'Cameras').fill('   ');
  await categoryField(page, 'Cameras').press('Enter');
  expect(await categoryNames(page)).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await categoryField(page, 'Cameras').click();
  await categoryField(page, 'Cameras').fill('gone-cat');
  await categoryField(page, 'Cameras').press('Escape');
  expect(await categoryNames(page)).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await categoryField(page, 'Cameras').click();
  await categoryField(page, 'Cameras').fill('Cameras');
  await categoryField(page, 'Cameras').press('Enter');
  expect(await categoryNames(page)).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await categoryField(page, 'Cameras').fill('Cams');
  await categoryField(page, 'Cameras').press('Enter');
  expect(await categoryNames(page)).toEqual(['Cams', 'Doors']);
  await expectDirty(page);
  await clickCancel(page);
  expect(await categoryNames(page)).toEqual(SEED_CATS);

  await categoryField(page, 'Cameras').fill('E2E Cameras');
  await categoryField(page, 'Cameras').press('Enter');
  expect(await categoryNames(page)).toEqual(['E2E Cameras', 'Doors']);
  await clickSave(page);
  expect(await categoryNames(page)).toEqual(['E2E Cameras', 'Doors']);
  await moduleTabButton(page, 'Commissioning Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras']);
  await moduleTabButton(page, 'E2E Install Phase').click();
  expect(await categoryNames(page)).toEqual(['E2E Cameras', 'Doors']);
  await openTemplateFromList(page, 'MEP As-Built Markup');
  expect(await categoryNames(page)).toEqual(['AHU Equipment']);
  await openTemplateFromList(page, 'Security Walk-Through');
  expect(await categoryNames(page)).toEqual(['E2E Cameras', 'Doors']);
  const categorySaved = true;
  const categoryIsolation = true;

  // ========== ENTITY: GC ==========
  let entity = await visibleEntityField(page, 'GC');
  await entity.click();
  await entity.fill('');
  await entity.press('Enter');
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);
  await expectNoDirty(page);

  entity = await visibleEntityField(page, 'GC');
  await entity.click();
  await entity.fill('   ');
  await entity.press('Enter');
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);
  await expectNoDirty(page);

  entity = await visibleEntityField(page, 'GC');
  await entity.click();
  await entity.fill('gone-entity');
  await entity.press('Escape');
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);
  await expectNoDirty(page);

  entity = await visibleEntityField(page, 'GC');
  await entity.click();
  await entity.fill('GC');
  await entity.press('Enter');
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);
  await expectNoDirty(page);

  entity = await visibleEntityField(page, 'GC');
  await entity.fill('General');
  await entity.press('Enter');
  expect(await entityNames(page)).toEqual(['General', 'Subcontractor', '100% Complete']);
  await expectDirty(page);
  await clickCancel(page);
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);

  entity = await visibleEntityField(page, 'GC');
  await entity.fill('E2E GC');
  await entity.press('Enter');
  expect(await entityNames(page)).toEqual(['E2E GC', 'Subcontractor', '100% Complete']);
  await clickSave(page);
  await openTemplateFromList(page, 'MEP As-Built Markup');
  expect(await entityNames(page)).toEqual(['MEP', 'Architect']);
  await openTemplateFromList(page, 'Security Walk-Through');
  expect(await entityNames(page)).toEqual(['E2E GC', 'Subcontractor', '100% Complete']);
  const entitySaved = true;
  const entityIsolation = true;

  // ========== ITEM: existing Cameras checklist text ==========
  await expandCategory(page, 'E2E Cameras');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);
  await expandCategory(page, 'Doors');
  expect(await itemNamesInCategory(page, 'Doors')).toEqual(DOORS_ITEMS);

  let item = await visibleItemField(page, INSTALL_ITEM);
  await item.click();
  await item.fill('');
  await item.press('Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);
  await expectNoDirty(page);

  item = await visibleItemField(page, INSTALL_ITEM);
  await item.click();
  await item.fill('   ');
  await item.press('Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);
  await expectNoDirty(page);

  item = await visibleItemField(page, INSTALL_ITEM);
  await item.click();
  await item.fill('gone-item');
  await item.press('Escape');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);
  await expectNoDirty(page);

  item = await visibleItemField(page, INSTALL_ITEM);
  await item.click();
  await item.fill(INSTALL_ITEM);
  await item.press('Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);
  await expectNoDirty(page);

  item = await visibleItemField(page, INSTALL_ITEM);
  await item.fill('Camera installed now?');
  await item.press('Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual([CABLE_ITEM, 'Camera installed now?']);
  await expectDirty(page);
  await clickCancel(page);
  await expandCategory(page, 'E2E Cameras');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);

  item = await visibleItemField(page, INSTALL_ITEM);
  await item.fill('E2E camera installed?');
  await item.press('Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual([CABLE_ITEM, 'E2E camera installed?']);
  expect(await itemNamesInCategory(page, 'Doors')).toEqual(DOORS_ITEMS);
  await clickSave(page);
  await expandCategory(page, 'E2E Cameras');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual([CABLE_ITEM, 'E2E camera installed?']);
  await moduleTabButton(page, 'Commissioning Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(['Camera tested and online?']);
  await openTemplateFromList(page, 'MEP As-Built Markup');
  await expandCategory(page, 'AHU Equipment');
  expect(await itemNamesInCategory(page, 'AHU Equipment')).toEqual(['Tags updated?']);
  await openTemplateFromList(page, 'Security Walk-Through');
  await expandCategory(page, 'E2E Cameras');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual([CABLE_ITEM, 'E2E camera installed?']);
  const itemSaved = true;
  const itemIsolation = true;

  // ========== 390: same existing seed rows (fresh goto resets in-memory Save) ==========
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.templates-mobile-browser')).toBeVisible({ timeout: 15_000 });
  const mobileRow = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  await mobileRow.evaluate((row) => row.click());
  await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });

  const mobileCatsBefore = await page.locator('.templates-mobile-category-row input.templates-mobile-inline-input').evaluateAll((nodes) => (
    nodes.filter((el) => el.offsetParent).map((el) => el.value)
  ));
  expect(mobileCatsBefore).toEqual(SEED_CATS);

  const camerasField = page.locator('.templates-mobile-category-row input.templates-mobile-inline-input').nth(0);
  await camerasField.click();
  await camerasField.fill('');
  await camerasField.press('Enter');
  expect(await page.locator('.templates-mobile-category-row input.templates-mobile-inline-input').evaluateAll((nodes) => (
    nodes.filter((el) => el.offsetParent).map((el) => el.value)
  ))).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await camerasField.fill('E2E Mobile Cameras');
  await camerasField.press('Enter');
  await expectDirty(page);
  await clickSave(page);
  const mobileCategory = await page.locator('.templates-mobile-category-row input.templates-mobile-inline-input').evaluateAll((nodes) => (
    nodes.filter((el) => el.offsetParent).map((el) => el.value)
  ));
  expect(mobileCategory[0]).toBe('E2E Mobile Cameras');
  const mobileCategoryOk = true;

  const camerasToggle = page.locator('.templates-mobile-category-toggle[aria-label*="E2E Mobile Cameras"]').first();
  if ((await camerasToggle.getAttribute('aria-label') || '').startsWith('Expand')) {
    await camerasToggle.evaluate((button) => button.click());
  }
  const mobileItem = page.locator('.templates-mobile-item-row input.templates-mobile-inline-input').filter({
    hasNot: page.locator('[value=""]'),
  });
  const installMobile = page.locator('.templates-mobile-item-row input.templates-mobile-inline-input').nth(1);
  await expect(installMobile).toHaveValue(INSTALL_ITEM, { timeout: 8_000 });
  await installMobile.click();
  await installMobile.fill('');
  await installMobile.press('Enter');
  await expect(installMobile).toHaveValue(INSTALL_ITEM);
  await expectNoDirty(page);
  await installMobile.fill('E2E mobile installed?');
  await installMobile.press('Enter');
  await expectDirty(page);
  await clickSave(page);
  await expect(installMobile).toHaveValue('E2E mobile installed?');
  const mobileItemOk = true;

  await page.locator('.templates-mobile-section-select').filter({ hasText: 'Select' }).first().click();
  await expect(editModulesModal(page)).toBeVisible({ timeout: 8_000 });
  const mobileMod = editModulesModal(page).locator('[data-drag-rearrange-row] input').nth(0);
  await expect(mobileMod).toHaveValue('Installation Phase');
  await mobileMod.click();
  await mobileMod.fill('');
  await mobileMod.press('Enter');
  await expect(mobileMod).toHaveValue('Installation Phase');
  await expectNoDirty(page);
  await mobileMod.fill('E2E Mobile Install');
  await mobileMod.press('Enter');
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editModulesModal(page)).toHaveCount(0);
  await expectDirty(page);
  await clickSave(page);
  const mobileModuleOk = true;

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.locator('.templates-mobile-entity-modal')).toBeVisible({ timeout: 8_000 });
  const mobileGc = page.locator('.templates-mobile-entity-modal input.templates-mobile-inline-input').nth(0);
  await expect(mobileGc).toHaveValue('GC');
  await mobileGc.click();
  await mobileGc.fill('');
  await mobileGc.press('Enter');
  await expect(mobileGc).toHaveValue('GC');
  await expectNoDirty(page);
  await mobileGc.fill('E2E Mobile GC');
  await mobileGc.press('Enter');
  await page.locator('.templates-mobile-entity-modal').getByRole('button', { name: 'Close', exact: true }).click();
  await expectDirty(page);
  await clickSave(page);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.locator('.templates-mobile-entity-modal input.templates-mobile-inline-input').nth(0)).toHaveValue('E2E Mobile GC');
  await page.locator('.templates-mobile-entity-modal').getByRole('button', { name: 'Close', exact: true }).click();
  const mobileEntityOk = true;

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_EXISTING_ROW_RENAME_PROOF: {
      leftoverKind: 'templates-existing-row-rename',
      emptyModule,
      emptyCategory,
      emptyEntity,
      emptyItem,
      moduleSaved,
      moduleIsolation,
      moduleModalRename,
      categorySaved,
      categoryIsolation,
      entitySaved,
      entityIsolation,
      itemSaved,
      itemIsolation,
      mobileCategoryOk,
      mobileItemOk,
      mobileModuleOk,
      mobileEntityOk,
      noDirtyNoops: true,
    },
  }));
});
