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

async function entityNames(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('input.inline-edit.cat-title[placeholder="Entity name"]')]
      .filter((el) => el.offsetParent)
      .map((el) => el.value)
  ));
}

async function commitTyped(field, value, { key = 'Enter' } = {}) {
  await field.click();
  await field.fill(value);
  await field.press(key);
}

/* dnd-kit's rearrange row intercepts Playwright pointer on checklist /
   entity inputs after the first commit. Focus via the DOM, then type
   with a real keyboard so Escape / Enter hit the React handlers. */
async function commitNamedInput(page, selector, current, next, key = 'Enter') {
  const ok = await page.evaluate(({ selector, current }) => {
    const el = [...document.querySelectorAll(selector)]
      .find((node) => node.value === current && node.offsetParent);
    if (!el) return false;
    el.focus();
    el.select();
    return true;
  }, { selector, current });
  expect(ok, `focus ${current}`).toBe(true);
  await page.keyboard.press('Control+a');
  if (next === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(next);
  await page.keyboard.press(key);
}

const ENTITY_SELECTOR = 'input.inline-edit.cat-title[placeholder="Entity name"]';
const ITEM_SELECTOR = '.templates-editor-grid input.inline-edit[placeholder="Add checklist item"]';
const CAT_SELECTOR = '.templates-editor-grid [data-drag-rearrange-row] input.inline-edit.cat-title[title="Click to rename"]';

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
  await commitNamedInput(page, CAT_SELECTOR, 'Cameras', '', 'Enter');
  expect(await categoryNames(page)).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await commitNamedInput(page, CAT_SELECTOR, 'Cameras', '   ', 'Enter');
  expect(await categoryNames(page)).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await commitNamedInput(page, CAT_SELECTOR, 'Cameras', 'gone-cat', 'Escape');
  expect(await categoryNames(page)).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await commitNamedInput(page, CAT_SELECTOR, 'Cameras', 'Cameras', 'Enter');
  expect(await categoryNames(page)).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await commitNamedInput(page, CAT_SELECTOR, 'Cameras', 'Cams', 'Enter');
  expect(await categoryNames(page)).toEqual(['Cams', 'Doors']);
  await expectDirty(page);
  await clickCancel(page);
  expect(await categoryNames(page)).toEqual(SEED_CATS);

  await commitNamedInput(page, CAT_SELECTOR, 'Cameras', 'E2E Cameras', 'Enter');
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
  await commitNamedInput(page, ENTITY_SELECTOR, 'GC', '', 'Enter');
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);
  await expectNoDirty(page);

  await commitNamedInput(page, ENTITY_SELECTOR, 'GC', '   ', 'Enter');
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);
  await expectNoDirty(page);

  await commitNamedInput(page, ENTITY_SELECTOR, 'GC', 'gone-entity', 'Escape');
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);
  await expectNoDirty(page);

  await commitNamedInput(page, ENTITY_SELECTOR, 'GC', 'GC', 'Enter');
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);
  await expectNoDirty(page);

  await commitNamedInput(page, ENTITY_SELECTOR, 'GC', 'General', 'Enter');
  expect(await entityNames(page)).toEqual(['General', 'Subcontractor', '100% Complete']);
  await expectDirty(page);
  await clickCancel(page);
  expect(await entityNames(page)).toEqual(SEED_ENTITIES);

  await commitNamedInput(page, ENTITY_SELECTOR, 'GC', 'E2E GC', 'Enter');
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

  await expandCategory(page, 'E2E Cameras');
  await commitNamedInput(page, ITEM_SELECTOR, INSTALL_ITEM, '', 'Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);
  await expectNoDirty(page);

  await commitNamedInput(page, ITEM_SELECTOR, INSTALL_ITEM, '   ', 'Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);
  await expectNoDirty(page);

  await commitNamedInput(page, ITEM_SELECTOR, INSTALL_ITEM, 'gone-item', 'Escape');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);
  await expectNoDirty(page);

  await commitNamedInput(page, ITEM_SELECTOR, INSTALL_ITEM, INSTALL_ITEM, 'Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);
  await expectNoDirty(page);

  await commitNamedInput(page, ITEM_SELECTOR, INSTALL_ITEM, 'Camera installed now?', 'Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual([CABLE_ITEM, 'Camera installed now?']);
  await expectDirty(page);
  await clickCancel(page);
  await expandCategory(page, 'E2E Cameras');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual(CAMERAS_ITEMS);

  await commitNamedInput(page, ITEM_SELECTOR, INSTALL_ITEM, 'E2E camera installed?', 'Enter');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual([CABLE_ITEM, 'E2E camera installed?']);
  await expandCategory(page, 'Doors');
  expect(await itemNamesInCategory(page, 'Doors')).toEqual(DOORS_ITEMS);
  await clickSave(page);
  await expandCategory(page, 'E2E Cameras');
  expect(await itemNamesInCategory(page, 'E2E Cameras')).toEqual([CABLE_ITEM, 'E2E camera installed?']);
  await expandCategory(page, 'Doors');
  expect(await itemNamesInCategory(page, 'Doors')).toEqual(DOORS_ITEMS);
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

  const mobileCatSel = '.templates-mobile-category-row input.templates-mobile-inline-input';
  await commitNamedInput(page, mobileCatSel, 'Cameras', '', 'Enter');
  expect(await page.locator(mobileCatSel).evaluateAll((nodes) => (
    nodes.filter((el) => el.offsetParent).map((el) => el.value)
  ))).toEqual(SEED_CATS);
  await expectNoDirty(page);

  await commitNamedInput(page, mobileCatSel, 'Cameras', 'E2E Mobile Cameras', 'Enter');
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
  const mobileItemSel = '.templates-mobile-item-row input.templates-mobile-inline-input';
  await expect.poll(async () => page.locator(mobileItemSel).count()).toBeGreaterThan(1);
  await commitNamedInput(page, mobileItemSel, INSTALL_ITEM, '', 'Enter');
  expect(await page.locator(mobileItemSel).evaluateAll((nodes) => (
    nodes.filter((el) => el.offsetParent).map((el) => el.value)
  ))).toContain(INSTALL_ITEM);
  await expectNoDirty(page);
  await commitNamedInput(page, mobileItemSel, INSTALL_ITEM, 'E2E mobile installed?', 'Enter');
  await expectDirty(page);
  await clickSave(page);
  expect(await page.locator(mobileItemSel).evaluateAll((nodes) => (
    nodes.filter((el) => el.offsetParent).map((el) => el.value)
  ))).toContain('E2E mobile installed?');
  const mobileItemOk = true;

  await page.locator('.templates-mobile-section-select').filter({ hasText: 'Select' }).first().click();
  await expect(editModulesModal(page)).toBeVisible({ timeout: 8_000 });
  const mobileModSel = '.templates-module-edit-modal [data-drag-rearrange-row] input';
  await expect(page.locator(mobileModSel).nth(0)).toHaveValue('Installation Phase');
  await commitNamedInput(page, mobileModSel, 'Installation Phase', '', 'Enter');
  await expect(page.locator(mobileModSel).nth(0)).toHaveValue('Installation Phase');
  await expectNoDirty(page);
  await commitNamedInput(page, mobileModSel, 'Installation Phase', 'E2E Mobile Install', 'Enter');
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editModulesModal(page)).toHaveCount(0);
  await expectDirty(page);
  await clickSave(page);
  const mobileModuleOk = true;

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.locator('.templates-mobile-entity-modal')).toBeVisible({ timeout: 8_000 });
  const mobileEntSel = '.templates-mobile-entity-modal input.templates-mobile-inline-input';
  await expect(page.locator(mobileEntSel).nth(0)).toHaveValue('GC');
  await commitNamedInput(page, mobileEntSel, 'GC', '', 'Enter');
  await expect(page.locator(mobileEntSel).nth(0)).toHaveValue('GC');
  await expectNoDirty(page);
  await commitNamedInput(page, mobileEntSel, 'GC', 'E2E Mobile GC', 'Enter');
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
