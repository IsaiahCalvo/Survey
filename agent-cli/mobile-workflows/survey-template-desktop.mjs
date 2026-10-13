import { TEMPLATE_WORKFLOW_ROUTE, TEMPLATE_WORKFLOW_STORAGE_KEY } from './survey-template.mjs';

const invariant = (value, message) => {
  if (!value) throw new Error(message);
  return value;
};

async function readTemplates(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), TEMPLATE_WORKFLOW_STORAGE_KEY);
}

async function waitForReloadedTemplate(page, expected) {
  await page.waitForFunction(({ key, templateId, templateName, moduleId }) => {
    let templates;
    try {
      templates = JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return false;
    }
    const stored = templates.find((entry) => entry.id === templateId);
    if (stored?.name !== templateName || !stored.modules?.some((entry) => entry.id === moduleId)) return false;

    const center = document.querySelector('.templates-editor-grid > section');
    if (!center) return false;
    const renamedTemplateVisible = [...center.querySelectorAll('input[title="Click to rename"]')]
      .some((input) => input.value === templateName);
    const moduleVisible = [...center.querySelectorAll('[data-module-tab-id]')]
      .some((element) => element.dataset.moduleTabId === moduleId);
    return renamedTemplateVisible && moduleVisible;
  }, {
    key: TEMPLATE_WORKFLOW_STORAGE_KEY,
    ...expected,
  }, { timeout: 30_000 });
}

async function save(page) {
  const saveButton = page.locator('button:visible', { hasText: /^Save$/ }).first();
  await saveButton.click();
  await saveButton.waitFor({ state: 'hidden', timeout: 10_000 });
}

async function commit(input, value) {
  await input.fill(value);
  await input.press('Enter');
}

const desktopCenter = (page) => page.locator('.templates-editor-grid > section');
const categoryByName = (page, name) => desktopCenter(page).locator(`.card-line:has(input[value=${JSON.stringify(name)}])`);

export async function runDesktopSurveyTemplateWorkflow({ page, baseUrl, artifacts = null }) {
  await page.goto(`${baseUrl}${TEMPLATE_WORKFLOW_ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const grid = page.locator('.templates-editor-grid');
  await grid.waitFor({ state: 'visible', timeout: 30_000 });
  const center = desktopCenter(page);

  await page.getByRole('button', { name: 'New template', exact: true }).first().click();
  const templateName = `Desktop Template ${Date.now().toString(36)}`;
  const title = center.locator('input[title="Click to rename"]').first();
  await title.waitFor({ state: 'visible' });
  await commit(title, templateName);

  await center.getByRole('button', { name: 'Add module', exact: true }).click();
  const moduleInput = center.locator('[data-module-tab-id] input.inline-edit').last();
  await moduleInput.waitFor({ state: 'visible' });
  const moduleId = invariant(await moduleInput.locator('xpath=ancestor::*[@data-module-tab-id][1]').getAttribute('data-module-tab-id'), 'Desktop module has no id');
  const moduleName = 'Desktop Walkthrough Module';
  await commit(moduleInput, moduleName);

  await center.getByRole('button', { name: 'Add category', exact: true }).click();
  const freshCategory = center.locator('.card-line:has(input[value^="Category "])').last();
  await freshCategory.waitFor({ state: 'visible' });
  const categoryName = 'Desktop Survey Category';
  await commit(freshCategory.locator('input.cat-title').first(), categoryName);
  const category = categoryByName(page, categoryName);
  await category.getByTitle('Expand').click().catch(() => {});
  const addItem = category.getByRole('button', { name: 'Add checklist item', exact: false });
  await addItem.click();
  const itemText = 'Desktop item persists after reload';
  await commit(category.locator('input[placeholder="Add checklist item"]').last(), itemText);
  await save(page);

  let templates = await readTemplates(page);
  let template = invariant(templates.find((entry) => entry.name === templateName), 'Desktop template missing from storage');
  let module = invariant(template.modules?.find((entry) => entry.name === moduleName), 'Desktop module missing from storage');
  let categoryModel = invariant(module.categories?.find((entry) => entry.name === categoryName), 'Desktop category missing from storage');
  const item = invariant(categoryModel.checklist?.find((entry) => entry.text === itemText), 'Desktop item missing from storage');
  const ids = { templateId: template.id, templateName, moduleId: module.id || moduleId, moduleName, categoryId: categoryModel.id, categoryName, itemId: item.id, itemText };

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await grid.waitFor({ state: 'visible', timeout: 30_000 });
  // `grid` becomes visible before React has necessarily selected and painted
  // the persisted template under parallel-suite CPU load. Wait for BOTH the
  // exact persisted mock model and its matching DOM tree; then keep strict
  // cardinality assertions below so readiness cannot mask wrong content.
  await waitForReloadedTemplate(page, ids);
  invariant(await center.locator(`input[value=${JSON.stringify(templateName)}]`).count() === 1,
    'Desktop template rename missing after reload');
  invariant(await center.locator(`[data-module-tab-id="${ids.moduleId}"]`).count() === 1,
    'Desktop module missing after reload');
  const reloadedCategory = categoryByName(page, categoryName);
  await reloadedCategory.waitFor({ state: 'visible' });
  await reloadedCategory.getByTitle('Expand').click();
  invariant(await reloadedCategory.locator(`input[value=${JSON.stringify(itemText)}]`).count(), 'Desktop item missing after reload');

  // Disposable item delete.
  await reloadedCategory.getByRole('button', { name: 'Add checklist item', exact: false }).click();
  const disposableItem = reloadedCategory.locator('input[placeholder="Add checklist item"]').last();
  await commit(disposableItem, 'Disposable desktop item');
  await disposableItem.locator('xpath=..').getByRole('button', { name: 'Delete item', exact: true }).click();

  // Disposable category delete via the center-pane Select controls.
  await center.getByRole('button', { name: 'Add category', exact: true }).click();
  const disposableCategory = center.locator('.card-line:has(input[value^="Category "])').last();
  await commit(disposableCategory.locator('input.cat-title').first(), 'Disposable desktop category');
  const categorySelect = center.getByRole('button', { name: 'Select', exact: true }).nth(1);
  await categorySelect.click();
  const disposableCategoryNamed = categoryByName(page, 'Disposable desktop category');
  const disposableHeader = disposableCategoryNamed.locator('[data-drag-rearrange-row]');
  const categorySelectionControl = disposableHeader.locator(':scope > span').last();
  await categorySelectionControl.click();
  const deleteSelectedCategory = center.locator('button[title="Delete"]');
  await deleteSelectedCategory.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const centerPane = document.querySelector('.templates-editor-grid > section');
    const button = centerPane?.querySelector('button[title="Delete"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await deleteSelectedCategory.click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.templates-editor-grid > section input')]
    .some((input) => input.value === 'Disposable desktop category'));
  await center.getByRole('button', { name: 'Done', exact: true }).click();

  // Disposable module delete via shared edit modal.
  await center.getByRole('button', { name: 'Add module', exact: true }).click();
  const disposableModuleInput = center.locator('[data-module-tab-id] input.inline-edit').last();
  await disposableModuleInput.waitFor({ state: 'visible' });
  await commit(disposableModuleInput, 'Disposable desktop module');
  await center.getByRole('button', { name: 'Select', exact: true }).first().click();
  const modal = page.locator('.templates-module-edit-modal');
  await modal.waitFor({ state: 'visible' });
  const disposableModuleRow = modal.locator('[data-drag-rearrange-row]:has(input[value="Disposable desktop module"])');
  const moduleBox = invariant(await disposableModuleRow.boundingBox(), 'Desktop module selection row has no bounds');
  await page.mouse.click(moduleBox.x + 49, moduleBox.y + moduleBox.height / 2);
  await modal.getByTitle('Delete').click();
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
  await save(page);

  templates = await readTemplates(page);
  template = invariant(templates.find((entry) => entry.id === ids.templateId), 'Desktop template vanished after nested deletes');
  invariant(template.modules?.length === 1, 'Desktop disposable module persisted');
  invariant(template.modules[0]?.categories?.length === 1, 'Desktop disposable category persisted');
  invariant(template.modules[0]?.categories[0]?.checklist?.length === 1, 'Desktop disposable item persisted');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await grid.waitFor({ state: 'visible', timeout: 30_000 });
  templates = await readTemplates(page);
  invariant(templates.find((entry) => entry.id === ids.templateId)?.modules?.[0]?.categories?.[0]?.checklist?.[0]?.text === itemText,
    'Desktop exact nested model changed after final reload');
  await artifacts?.screenshot?.(page, 'desktop-template-tree-persisted');

  // Template delete and hard-reload absence.
  const templateRow = grid.locator('aside').first().locator('[data-drag-rearrange-row]', { hasText: templateName });
  await templateRow.getByTitle('More').click();
  await page.locator('button:visible', { hasText: /^Delete$/ }).click();
  await page.waitForFunction(({ key, id }) => !JSON.parse(localStorage.getItem(key) || '[]').some((entry) => entry.id === id),
    { key: TEMPLATE_WORKFLOW_STORAGE_KEY, id: ids.templateId });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  invariant(!(await readTemplates(page)).some((entry) => entry.id === ids.templateId), 'Desktop deleted template returned after reload');

  const result = {
    status: 'passed',
    device: 'desktop',
    workflow: 'survey-template',
    lifecycle: 'create-edit-save-reload-delete-nested-reload-delete-template-reload',
    ...ids,
  };
  artifacts?.recordScenario?.(result);
  return result;
}
