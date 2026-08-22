import { test, expect } from '@playwright/test';

// Unique leftovers after Templates entity color:
// 1) Add module (title="New module" / addModule)
// 2) Duplicate — MODULE (Edit modules modal / duplicateModules → `${name} copy`).
//    Template-list Duplicate (duplicateTemplates) is a distinct list action;
//    this pass asserts which and proves the module leftover.
// 3) Add checklist item (addItem / TemplatesEditor create, not a survey seed).
// Distinct from U-03 create/rename/delete, entity color, leftover-18 export.
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function moduleTabs(page) {
  return page.locator('[data-module-tab-id]');
}

function moduleTabButton(page, name) {
  return page.locator('[data-module-tab-id] button', { hasText: name });
}

function newModulePlus(page) {
  return page.locator('button[title="New module"]');
}

function moduleSelectButton(page) {
  return page.locator('p.micro', { hasText: /^Module$/ }).locator('xpath=following-sibling::button[1]');
}

function dirtyBar(page) {
  return page.locator('[data-entity-editor-actions]');
}

function editModulesModal(page) {
  return page.locator('.templates-module-edit-modal');
}

async function moduleTabNames(page) {
  return moduleTabs(page).evaluateAll((nodes) => (
    nodes.map((node) => {
      const input = node.querySelector('input');
      const button = node.querySelector('button');
      return (input?.value || button?.textContent || '').trim();
    }).filter(Boolean)
  ));
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

async function categoryItemCount(page, name) {
  return page.evaluate((wanted) => {
    const titles = [...document.querySelectorAll('input.inline-edit.cat-title')];
    const field = titles.find((el) => el.value === wanted && el.offsetParent);
    const row = field?.closest('[data-drag-rearrange-row]');
    const meta = row?.parentElement?.querySelector('.mono');
    const text = meta?.textContent || '';
    const match = /(\d+)\s+items/.exec(text);
    return match ? Number(match[1]) : -1;
  }, name);
}

async function checklistValues(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('input.inline-edit[placeholder="Add checklist item"]')]
      .filter((el) => el.offsetParent)
      .map((el) => el.value)
  ));
}

test('Templates Add module + module Duplicate + Add checklist item', async ({ page }) => {
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyAddModule = await newModulePlus(page).count();
  const emptyAddItem = await page.getByRole('button', { name: /Add checklist item/ }).count();
  const emptyDup = await page.getByRole('button', { name: 'Duplicate', exact: true }).count();
  expect(emptyAddModule, 'empty hub has no Add module').toBe(0);
  expect(emptyAddItem, 'empty hub has no Add checklist item').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  await expect(moduleTabButton(page, 'Installation Phase')).toBeVisible();
  await expect(moduleTabButton(page, 'Commissioning Phase')).toBeVisible();
  const seedMods = await moduleTabNames(page);
  expect(seedMods).toEqual(['Installation Phase', 'Commissioning Phase']);
  await expect(newModulePlus(page)).toBeVisible();

  // --- Add module: intended ---
  await newModulePlus(page).click();
  await expect.poll(async () => (await moduleTabNames(page)).length).toBe(3);
  expect(await moduleTabNames(page)).toContain('Module 1');
  const renameField = moduleTabs(page).locator('input.inline-edit');
  await expect(renameField).toBeVisible();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();

  // --- Add module: break — empty / whitespace / Escape keep Module 1 ---
  await renameField.fill('   ');
  await renameField.press('Enter');
  expect(await moduleTabNames(page)).toContain('Module 1');
  await moduleTabButton(page, 'Module 1').dblclick();
  await expect(moduleTabs(page).locator('input.inline-edit')).toBeVisible();
  await moduleTabs(page).locator('input.inline-edit').press('Escape');
  expect(await moduleTabNames(page)).toContain('Module 1');

  // Cancel discards the new module (no history undo — Cancel is the revert).
  await page.keyboard.press('Control+z');
  expect(await moduleTabNames(page)).toContain('Module 1');
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase']);

  // --- Add module: intended persist + isolation ---
  await newModulePlus(page).click();
  await expect(moduleTabs(page).locator('input.inline-edit')).toBeVisible();
  await moduleTabs(page).locator('input.inline-edit').fill('E2E Module');
  await moduleTabs(page).locator('input.inline-edit').press('Enter');
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase', 'E2E Module']);
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await page.getByText('MEP As-Built Markup').first().click();
  expect(await moduleTabNames(page)).toEqual(['Equipment']);
  await page.getByText('Security Walk-Through').first().click();
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase', 'E2E Module']);

  // --- Duplicate: assert MODULE leftover (Edit modules / duplicateModules) ---
  const listSelect = page.locator('aside').first().getByRole('button', { name: 'Select', exact: true });
  await listSelect.click();
  const templateDup = page.locator('aside').first().getByRole('button', { name: 'Duplicate', exact: true });
  await expect(templateDup).toBeDisabled();
  await page.getByText('Security Walk-Through', { exact: true }).first().click();
  await expect(templateDup).toBeEnabled();
  await page.locator('aside').first().getByRole('button', { name: 'Done', exact: true }).click();

  await moduleSelectButton(page).click();
  await expect(editModulesModal(page)).toBeVisible();
  await expect(editModulesModal(page).getByRole('heading', { name: 'Edit modules' })).toBeVisible();
  const modalDup = editModulesModal(page).getByRole('button', { name: 'Duplicate', exact: true });
  await expect(modalDup).toBeDisabled();
  const installRow = editModulesModal(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator('input[value="Installation Phase"]'),
  });
  await installRow.locator('span').nth(0).click();
  await expect(modalDup).toBeEnabled();
  await modalDup.click();
  await expect(editModulesModal(page).locator('input[value="Installation Phase copy"]')).toBeVisible();
  expect(await editModulesModal(page).locator('[data-drag-rearrange-row]').count()).toBe(4);
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editModulesModal(page)).toHaveCount(0);
  expect(await moduleTabNames(page)).toContain('Installation Phase copy');
  await expect(moduleTabButton(page, 'E2E Module')).toBeVisible();

  // Break: Cancel discards the module copy.
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase', 'E2E Module']);

  // Persist + isolation
  await moduleSelectButton(page).click();
  await installRow.locator('span').nth(0).click();
  await modalDup.click();
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await moduleTabNames(page)).toEqual([
    'Installation Phase',
    'Installation Phase copy',
    'Commissioning Phase',
    'E2E Module',
  ]);
  await page.getByText('MEP As-Built Markup').first().click();
  expect(await moduleTabNames(page)).toEqual(['Equipment']);
  await page.getByText('Security Walk-Through').first().click();
  expect(await moduleTabNames(page)).toContain('Installation Phase copy');

  // --- Add checklist item: intended + break + edge ---
  await moduleTabButton(page, 'Installation Phase').click();
  await expandCategory(page, 'Cameras');
  const camerasBefore = await categoryItemCount(page, 'Cameras');
  expect(camerasBefore).toBe(2);
  const doorsBefore = await categoryItemCount(page, 'Doors');
  expect(doorsBefore).toBe(2);
  await page.getByRole('button', { name: /Add checklist item/ }).first().click();
  await expect.poll(async () => categoryItemCount(page, 'Cameras')).toBe(3);
  const emptyRow = page.locator('input.inline-edit[placeholder="Add checklist item"][value=""]');
  await expect(emptyRow.first()).toBeVisible();

  // Empty name: blur refuses, row stays, hint fires.
  await emptyRow.first().click();
  await emptyRow.first().blur();
  await expect.poll(async () => categoryItemCount(page, 'Cameras')).toBe(3);
  const blankHint = await page.getByText("Can't be empty — type something or hit Esc to cancel.").count();
  expect(blankHint, 'fresh blank row refuses empty commit').toBeGreaterThan(0);
  expect(await categoryItemCount(page, 'Doors')).toBe(2);

  // Escape on a fresh blank row removes it.
  await page.locator('input.inline-edit[placeholder="Add checklist item"][value=""]').first().click();
  await page.locator('input.inline-edit[placeholder="Add checklist item"][value=""]').first().press('Escape');
  await expect.poll(async () => categoryItemCount(page, 'Cameras')).toBe(2);

  // Cancel after a named add discards it.
  await page.getByRole('button', { name: /Add checklist item/ }).first().click();
  const draft = page.locator('input.inline-edit[placeholder="Add checklist item"][value=""]').first();
  await draft.fill('E2E discarded item');
  await draft.press('Enter');
  await expect.poll(async () => categoryItemCount(page, 'Cameras')).toBe(3);
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(async () => categoryItemCount(page, 'Cameras')).toBe(2);
  expect((await checklistValues(page)).includes('E2E discarded item')).toBe(false);

  await page.getByRole('button', { name: /Add checklist item/ }).first().click();
  const keep = page.locator('input.inline-edit[placeholder="Add checklist item"][value=""]').first();
  await keep.fill('E2E cable labeled?');
  await keep.press('Enter');
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expandCategory(page, 'Cameras');
  expect(await categoryItemCount(page, 'Cameras')).toBe(3);
  expect(await checklistValues(page)).toContain('E2E cable labeled?');
  expect(await categoryItemCount(page, 'Doors')).toBe(2);

  await page.getByText('MEP As-Built Markup').first().click();
  await moduleTabButton(page, 'Equipment').click();
  await expandCategory(page, 'AHU Equipment');
  expect(await checklistValues(page)).toContain('Tags updated?');
  expect(await checklistValues(page)).not.toContain('E2E cable labeled?');
  await page.getByText('Security Walk-Through').first().click();
  await moduleTabButton(page, 'Installation Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await checklistValues(page)).toContain('E2E cable labeled?');

  // 390 chrome
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  let mobileNewModule = 0;
  let mobileAddItem = 0;
  let mobileModuleDup = 0;
  let mobileAddedModule = false;
  let mobileAddedItem = false;
  if (await mobileRow.isVisible().catch(() => false)) {
    await mobileRow.click();
    const newMod = page.getByRole('button', { name: /New module/ }).first();
    mobileNewModule = await newMod.count();
    if (mobileNewModule > 0) {
      await newMod.click();
      mobileAddedModule = await page.getByText('Module 1', { exact: true }).count() > 0
        || await page.locator('input[value="Module 1"]').count() > 0;
    }
    const camerasToggle = page.getByRole('button', { name: /Expand Cameras|Collapse Cameras/ });
    if (await camerasToggle.count()) {
      const label = await camerasToggle.first().getAttribute('aria-label');
      if (label?.startsWith('Expand')) await camerasToggle.first().click();
    }
    const addLine = page.locator('.templates-mobile-add-line').filter({ hasText: 'Add checklist item' });
    mobileAddItem = await addLine.count();
    if (mobileAddItem > 0) {
      const before = await page.locator('.templates-mobile-item-row').count();
      await addLine.first().click();
      mobileAddedItem = (await page.locator('.templates-mobile-item-row').count()) > before
        || (await page.locator('input[placeholder="Add checklist item"][value=""]').count()) > 0;
    }
    const modSelect = page.locator('.templates-mobile-modules-section .templates-mobile-section-select');
    if (await modSelect.count()) {
      await modSelect.click();
      if (await editModulesModal(page).isVisible().catch(() => false)) {
        mobileModuleDup = await editModulesModal(page).getByRole('button', { name: 'Duplicate', exact: true }).count();
        await page.keyboard.press('Escape').catch(() => {});
        if (await editModulesModal(page).isVisible().catch(() => false)) {
          await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click().catch(() => {});
        }
      }
    }
  }

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_MODULE_DUP_CHECKLIST_PROOF: {
      leftoverKind: 'module-duplicate',
      emptyAddModule: emptyAddModule,
      emptyAddItem,
      emptyDup,
      seedMods,
      addModuleCancelRestored: true,
      addModuleSaved: true,
      moduleDupCancelRestored: true,
      moduleDupSaved: true,
      isolation: true,
      checklistEmptyRefused: blankHint > 0,
      checklistEscRemoved: true,
      checklistSaved: true,
      doorsIsolated: true,
      mobileNewModule,
      mobileAddedModule,
      mobileAddItem,
      mobileAddedItem,
      mobileModuleDup,
    },
  }));
});
