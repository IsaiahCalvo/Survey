import { test, expect } from '@playwright/test';

// Unique leftovers after Templates Add module / module Duplicate / Add checklist item:
// 1) New category (button "New category" / addCategory / Category N)
// 2) Category Duplicate (Categories Select → duplicateCategories / `${name} copy`)
// 3) Module Delete (Edit modules trash / deleteModules — confirm if a dialog exists)
// Template-list Duplicate (duplicateTemplates) is a distinct leftover — not this pass.
// Distinct from U-03 create/rename/delete, entity color, Add module / module
// Duplicate / Add checklist item, leftover-18 export.
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

function desktopGrid(page) {
  return page.locator('.templates-editor-grid');
}

function moduleTabs(page) {
  return desktopGrid(page).locator('[data-module-tab-id]');
}

function moduleTabButton(page, name) {
  return desktopGrid(page).locator(`[data-module-tab-id] button[title^="${name} ·"]`).filter({ hasText: new RegExp(`^${name}$`) });
}

function moduleSelectButton(page) {
  return desktopGrid(page).locator('p.micro', { hasText: /^Module$/ }).locator('xpath=following-sibling::button[1]');
}

function categoryChrome(page) {
  return desktopGrid(page).locator('p.micro', { hasText: /^Categories$/ }).locator('xpath=..');
}

function newCategoryButton(page) {
  return desktopGrid(page).getByRole('button', { name: 'New category', exact: true });
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

function categoryTitleInputs(page) {
  return desktopGrid(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator('button[title="Expand"], button[title="Collapse"]'),
  }).locator('input.inline-edit.cat-title');
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

async function toggleRowCheckbox(row) {
  const clicked = await row.evaluate((node) => {
    const box = [...node.querySelectorAll('span')].find((el) => el.style.width === '14px' && el.style.height === '14px');
    if (!box) return false;
    box.click();
    return true;
  });
  expect(clicked, 'row checkbox').toBe(true);
}

async function categoryItemCount(page, name) {
  return page.evaluate((wanted) => {
    const rows = [...document.querySelectorAll('.templates-editor-grid [data-drag-rearrange-row]')];
    const row = rows.find((node) => {
      const toggle = node.querySelector('button[title="Expand"], button[title="Collapse"]');
      const field = node.querySelector('input.inline-edit.cat-title');
      return toggle && field && field.value === wanted && field.offsetParent;
    });
    const meta = row?.querySelector('.mono') || row?.parentElement?.querySelector('.mono');
    const text = meta?.textContent || '';
    const match = /(\d+)\s+items/.exec(text);
    return match ? Number(match[1]) : -1;
  }, name);
}

test('Templates New category + category Duplicate + module Delete', async ({ page }) => {
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyNewCategory = await newCategoryButton(page).count();
  const emptyCatDup = await categoryChrome(page).getByRole('button', { name: 'Duplicate', exact: true }).count();
  const emptyModDelete = await page.locator('.templates-module-edit-modal button[aria-label="Delete"]').count();
  expect(emptyNewCategory, 'empty hub has no New category').toBe(0);
  expect(emptyCatDup, 'empty hub has no category Duplicate').toBe(0);
  expect(emptyModDelete, 'empty hub has no module Delete').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  await expect(moduleTabButton(page, 'Installation Phase')).toBeVisible();
  await expect(moduleTabButton(page, 'Commissioning Phase')).toBeVisible();
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase']);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);
  await expect(newCategoryButton(page)).toBeVisible();

  // --- New category: intended mint ---
  await newCategoryButton(page).click();
  await expect.poll(async () => categoryNames(page)).toEqual(['Cameras', 'Doors', 'Category 1']);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  expect(await categoryItemCount(page, 'Category 1')).toBe(0);

  // --- New category: break — empty / whitespace snaps back; Escape keeps name ---
  const cat1 = categoryTitleInputs(page).filter({ hasText: /^$/ }).and(page.locator('[value="Category 1"]'));
  const cat1Field = categoryTitleInputs(page).locator('xpath=self::input[@value="Category 1"]');
  await expect(cat1Field).toBeVisible();
  await cat1Field.click();
  await cat1Field.fill('   ');
  await cat1Field.press('Enter');
  await expect.poll(async () => categoryNames(page)).toContain('Category 1');
  expect(await categoryNames(page)).not.toContain('');

  await categoryTitleInputs(page).locator('xpath=self::input[@value="Category 1"]').click();
  await categoryTitleInputs(page).locator('xpath=self::input[@value="Category 1"]').fill('gone');
  await categoryTitleInputs(page).locator('xpath=self::input[@value="gone"]').press('Escape');
  await expect.poll(async () => categoryNames(page)).toContain('Category 1');
  expect(await categoryNames(page)).not.toContain('gone');

  // Ctrl+Z is not history undo — Cancel is the revert.
  await page.keyboard.press('Control+z');
  expect(await categoryNames(page)).toContain('Category 1');
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);

  // --- New category: persist + isolation across modules / templates ---
  await newCategoryButton(page).click();
  await expect.poll(async () => categoryNames(page)).toContain('Category 1');
  const rename = categoryTitleInputs(page).locator('xpath=self::input[@value="Category 1"]');
  await rename.click();
  await rename.fill('E2E Category');
  await rename.press('Enter');
  await expect.poll(async () => categoryNames(page)).toEqual(['Cameras', 'Doors', 'E2E Category']);
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await moduleTabButton(page, 'Commissioning Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras']);
  expect(await categoryNames(page)).not.toContain('E2E Category');
  await page.getByText('MEP As-Built Markup').first().click();
  expect(await moduleTabNames(page)).toEqual(['Equipment']);
  expect(await categoryNames(page)).toEqual(['AHU Equipment']);
  await page.getByText('Security Walk-Through').first().click();
  await moduleTabButton(page, 'Installation Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors', 'E2E Category']);

  // --- Category Duplicate: leftover is CATEGORY (Select → duplicateCategories).
  // Template-list Duplicate is a distinct list action — not this leftover. ---
  const templatesList = page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  });
  await expect(templatesList.getByRole('button', { name: 'Select', exact: true })).toBeVisible();

  await categoryChrome(page).getByRole('button', { name: 'Select', exact: true }).click();
  const catDup = categoryChrome(page).getByRole('button', { name: 'Duplicate', exact: true });
  await expect(catDup).toBeVisible();
  await expect(catDup).toBeDisabled();
  const camerasRow = desktopGrid(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator('button[title="Expand"], button[title="Collapse"]'),
    has: page.locator('input.inline-edit.cat-title[value="Cameras"]'),
  });
  await toggleRowCheckbox(camerasRow);
  await expect(catDup).toBeEnabled();
  await catDup.click();
  await expect.poll(async () => categoryNames(page)).toEqual([
    'Cameras',
    'Cameras copy',
    'Doors',
    'E2E Category',
  ]);
  expect(await categoryItemCount(page, 'Cameras copy')).toBe(2);
  expect(await categoryItemCount(page, 'Doors')).toBe(2);

  // Break: Cancel discards the category copy.
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors', 'E2E Category']);

  // Persist + isolation
  await categoryChrome(page).getByRole('button', { name: 'Select', exact: true }).click();
  await toggleRowCheckbox(camerasRow);
  await catDup.click();
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Cameras copy', 'Doors', 'E2E Category']);
  await moduleTabButton(page, 'Commissioning Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras']);
  expect(await categoryItemCount(page, 'Cameras')).toBe(1);
  await page.getByText('MEP As-Built Markup').first().click();
  expect(await categoryNames(page)).toEqual(['AHU Equipment']);
  await page.getByText('Security Walk-Through').first().click();
  await moduleTabButton(page, 'Installation Phase').click();
  expect(await categoryNames(page)).toContain('Cameras copy');
  expect(await categoryItemCount(page, 'Doors')).toBe(2);

  // --- Module Delete: leftover is Edit-modules trash / deleteModules.
  // Confirm if a dialog exists (source has none — prove immediate delete). ---
  await moduleSelectButton(page).click();
  await expect(editModulesModal(page)).toBeVisible();
  await expect(editModulesModal(page).getByRole('heading', { name: 'Edit modules' })).toBeVisible();
  const modalDelete = editModulesModal(page).getByRole('button', { name: 'Delete', exact: true });
  await expect(modalDelete).toBeDisabled();
  const confirmBefore = await page.locator('[data-testid="archive-confirm-modal"]').count();
  expect(confirmBefore, 'no leftover archive confirm sitting open').toBe(0);

  const commissioningRow = editModulesModal(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator('input[value="Commissioning Phase"]'),
  });
  await toggleRowCheckbox(commissioningRow);
  await expect(modalDelete).toBeEnabled();
  await modalDelete.click();
  const confirmAfter = await page.locator('[data-testid="archive-confirm-modal"]').count();
  const sureCopy = await page.getByText(/are you sure/i).count();
  const confirmBtn = await page.getByRole('button', { name: /^(Confirm|Delete module)$/i }).count();
  expect(confirmAfter, 'module Delete has no archive-confirm dialog').toBe(0);
  expect(sureCopy, 'module Delete has no Are-you-sure copy').toBe(0);
  expect(confirmBtn, 'module Delete has no Confirm / Delete-module button').toBe(0);
  await expect(editModulesModal(page).locator('input[value="Commissioning Phase"]')).toHaveCount(0);
  await expect(editModulesModal(page).locator('input[value="Installation Phase"]')).toBeVisible();

  // Last-remaining module is allowed (no last-module guard).
  const installRow = editModulesModal(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator('input[value="Installation Phase"]'),
  });
  await toggleRowCheckbox(installRow);
  await modalDelete.click();
  expect(await page.locator('[data-testid="archive-confirm-modal"]').count()).toBe(0);
  await expect(editModulesModal(page).locator('input[value="Installation Phase"]')).toHaveCount(0);
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editModulesModal(page)).toHaveCount(0);
  expect(await moduleTabNames(page)).toEqual([]);

  // Break: Cancel restores both modules (no history undo).
  await page.keyboard.press('Control+z');
  expect(await moduleTabNames(page)).toEqual([]);
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase']);
  await moduleTabButton(page, 'Installation Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras', 'Cameras copy', 'Doors', 'E2E Category']);

  // Persist + isolation: delete Commissioning only.
  await moduleSelectButton(page).click();
  await toggleRowCheckbox(commissioningRow);
  await modalDelete.click();
  await expect(editModulesModal(page).locator('input[value="Commissioning Phase"]')).toHaveCount(0);
  expect(await page.locator('[data-testid="archive-confirm-modal"]').count()).toBe(0);
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await moduleTabNames(page)).toEqual(['Installation Phase']);
  expect(await categoryNames(page)).toContain('Cameras copy');
  await page.getByText('MEP As-Built Markup').first().click();
  expect(await moduleTabNames(page)).toEqual(['Equipment']);
  expect(await categoryNames(page)).toEqual(['AHU Equipment']);
  await page.getByText('Security Walk-Through').first().click();
  expect(await moduleTabNames(page)).toEqual(['Installation Phase']);
  expect(await moduleTabNames(page)).not.toContain('Commissioning Phase');

  // 390 chrome
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  let mobileNewCategory = 0;
  let mobileAddedCategory = false;
  let mobileCatDup = 0;
  let mobileModDelete = 0;
  let mobileDeleteHasConfirm = false;
  if (await mobileRow.isVisible().catch(() => false)) {
    await mobileRow.click();
    await expect(page.locator('.templates-mobile-detail')).toBeVisible();
    const newCat = page.locator('.templates-mobile-categories-section').getByRole('button', { name: 'New category', exact: true });
    mobileNewCategory = await newCat.count();
    if (mobileNewCategory > 0) {
      await newCat.first().evaluate((button) => button.click());
      mobileAddedCategory = await page.locator('input[value="Category 1"]').count() > 0
        || await page.getByText('Category 1', { exact: true }).count() > 0;
    }
    const catSelect = page.locator('.templates-mobile-categories-section').getByRole('button', { name: /^(Select|Done)$/ }).first();
    if (await catSelect.isVisible().catch(() => false)) {
      await catSelect.evaluate((button) => button.click());
      mobileCatDup = await page.locator('.templates-mobile-categories-section').getByRole('button', { name: 'Duplicate', exact: true }).count();
    }
    const modSelect = page.locator('.templates-mobile-modules-section .templates-mobile-section-select');
    if (await modSelect.isVisible().catch(() => false)) {
      await modSelect.evaluate((button) => button.click());
      if (await editModulesModal(page).isVisible().catch(() => false)) {
        mobileModDelete = await editModulesModal(page).getByRole('button', { name: 'Delete', exact: true }).count();
        mobileDeleteHasConfirm = (await page.locator('[data-testid="archive-confirm-modal"]').count()) > 0;
        const done = editModulesModal(page).getByRole('button', { name: 'Done', exact: true });
        if (await done.count()) await done.evaluate((button) => button.click());
      }
    }
  }

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_CATEGORY_MODULE_DELETE_PROOF: {
      leftoverKind: 'category-module-delete',
      emptyNewCategory,
      emptyCatDup,
      emptyModDelete,
      newCategoryCancelRestored: true,
      newCategorySaved: true,
      newCategoryIsolation: true,
      categoryDupCancelRestored: true,
      categoryDupSaved: true,
      categoryDupIsolation: true,
      moduleDeleteHasConfirm: false,
      moduleDeleteImmediate: true,
      lastModuleAllowed: true,
      moduleDeleteCancelRestored: true,
      moduleDeleteSaved: true,
      moduleDeleteIsolation: true,
      mobileNewCategory,
      mobileAddedCategory,
      mobileCatDup,
      mobileModDelete,
      mobileDeleteHasConfirm,
    },
  }));
});
