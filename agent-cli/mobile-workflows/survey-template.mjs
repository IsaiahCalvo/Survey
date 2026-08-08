const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const TEMPLATE_WORKFLOW_STORAGE_KEY = 'mobileWorkflowTemplates';
export const TEMPLATE_WORKFLOW_ROUTE = '/?hubPreview=1&workflowE2E=1&tab=templates&mobileNav=tabs&nativeShell=expo';

function invariant(value, message) {
  if (!value) throw new Error(message);
  return value;
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function waitForFirstVisible(locator, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = await firstVisible(locator);
    if (candidate) return candidate;
    await wait(40);
  }
  throw new Error(`Expected visible ${label}`);
}

async function tapLocator(touch, locator, label) {
  const target = invariant(await firstVisible(locator), `Expected visible ${label}`);
  const box = invariant(await target.boundingBox(), `${label} has no touch bounds`);
  invariant(box.width >= 1 && box.height >= 1, `${label} has invalid touch bounds`);
  await touch.tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return target;
}

async function fillAndCommit(locator, value) {
  await locator.fill(value);
  await locator.press('Enter');
}

async function readTemplates(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), TEMPLATE_WORKFLOW_STORAGE_KEY);
}

function findTemplate(templates, id) {
  return templates.find((template) => template?.id === id) || null;
}

async function waitForTemplateModel(page, predicate, label) {
  await page.waitForFunction(({ key, source }) => {
    try {
      const templates = JSON.parse(localStorage.getItem(key) || '[]');
      return Function('templates', `return (${source})(templates)`)(templates);
    } catch {
      return false;
    }
  }, { key: TEMPLATE_WORKFLOW_STORAGE_KEY, source: String(predicate) }, { timeout: 10_000 });
  const templates = await readTemplates(page);
  invariant(predicate(templates), `${label}: persisted model mismatch`);
  return templates;
}

async function openTemplate(page, templateName, touch) {
  await tapLocator(
    touch,
    page.locator('.templates-mobile-row', { hasText: templateName }),
    `template ${templateName}`,
  );
  await page.locator('.templates-mobile-detail').waitFor({ state: 'visible', timeout: 10_000 });
}

function categoryCardByName(page, categoryName, { mobile = true } = {}) {
  const base = mobile ? '.templates-mobile-category-card' : '.card-line';
  return page.locator(`${base}:has(input[value=${JSON.stringify(categoryName)}])`);
}

async function saveTemplate(page, touch) {
  await tapLocator(touch, page.getByRole('button', { name: 'Save', exact: true }), 'Save templates');
  await page.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'hidden', timeout: 10_000 });
}

async function createTemplateTree({ page, touch, artifacts }) {
  const newTemplate = await waitForFirstVisible(
    page.getByRole('button', { name: 'New template', exact: true }),
    'New template',
    30_000,
  );
  await tapLocator(touch, newTemplate, 'New template');
  const row = page.locator('.templates-mobile-row').first();
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  const initialName = (await row.locator('strong').innerText()).trim();
  await openTemplate(page, initialName, touch);

  const templateName = `Mobile Template ${Date.now().toString(36)}`;
  const title = page.locator('.templates-mobile-title-input');
  await fillAndCommit(title, templateName);

  await tapLocator(touch, page.getByRole('button', { name: 'New module', exact: true }), 'New module');
  const moduleInput = page.locator('.templates-mobile-module-tabs [data-module-tab-id] input.inline-edit').last();
  await moduleInput.waitFor({ state: 'visible', timeout: 10_000 });
  const moduleId = invariant(await moduleInput.locator('xpath=..').getAttribute('data-module-tab-id'), 'Created module has no stable id');
  const moduleName = 'Mobile Walkthrough Module';
  await fillAndCommit(moduleInput, moduleName);

  await tapLocator(touch, page.getByRole('button', { name: 'New category', exact: true }), 'New category');
  const categoryCard = page.locator('.templates-mobile-category-card').last();
  await categoryCard.waitFor({ state: 'visible', timeout: 10_000 });
  const categoryInput = categoryCard.locator('.templates-mobile-category-row input');
  const categoryName = 'Mobile Survey Category';
  await fillAndCommit(categoryInput, categoryName);

  const categoryId = invariant(await categoryCard.locator('[data-drag-rearrange-row]').getAttribute('data-rbd-draggable-id').catch(() => null)
    || await categoryCard.evaluate((node) => node.querySelector('[data-drag-rearrange-row]')?.parentElement?.getAttribute('data-sortable-id'))
    || `category:${categoryName}`,
  'Created category has no stable identity');

  const addItem = categoryCard.getByRole('button', { name: 'Add checklist item', exact: false });
  await tapLocator(touch, addItem, 'Add checklist item');
  const itemInput = categoryCard.locator('.templates-mobile-item-row input').last();
  await itemInput.waitFor({ state: 'visible', timeout: 10_000 });
  const itemText = 'Mobile item persists after reload';
  await fillAndCommit(itemInput, itemText);

  await saveTemplate(page, touch);
  const templates = await waitForTemplateModel(
    page,
    (value) => value.some((template) => template?.name?.startsWith('Mobile Template ')
      && template?.modules?.some((module) => module?.name === 'Mobile Walkthrough Module'
        && module?.categories?.some((category) => category?.name === 'Mobile Survey Category'
          && category?.checklist?.some((item) => item?.text === 'Mobile item persists after reload')))),
    'create template tree',
  );
  const template = invariant(templates.find((entry) => entry.name === templateName), 'Created template missing from storage');
  const module = invariant(template.modules.find((entry) => entry.name === moduleName), 'Created module missing from storage');
  const category = invariant(module.categories.find((entry) => entry.name === categoryName), 'Created category missing from storage');
  const item = invariant(category.checklist.find((entry) => entry.text === itemText), 'Created item missing from storage');
  await artifacts?.screenshot?.(page, 'template-tree-created');
  return {
    templateId: invariant(template.id, 'Persisted template has no stable id'),
    templateName,
    moduleId: module.id || moduleId,
    moduleName,
    categoryId: category.id || categoryId,
    categoryName,
    itemId: item.id,
    itemText,
  };
}

async function verifyTreeAfterReload({ page, touch, baseUrl, ids }) {
  await page.goto(`${baseUrl}${TEMPLATE_WORKFLOW_ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('.templates-mobile-row', { hasText: ids.templateName }).waitFor({ state: 'visible', timeout: 30_000 });
  await openTemplate(page, ids.templateName, touch);
  await page.locator(`.templates-mobile-module-tabs [data-module-tab-id="${ids.moduleId}"]`).waitFor({ state: 'visible' });
  const category = categoryCardByName(page, ids.categoryName);
  await category.waitFor({ state: 'visible' });
  await tapLocator(touch, category.locator('.templates-mobile-category-row > button'), 'Expand category');
  const itemInput = category.locator('.templates-mobile-item-row input').first();
  await itemInput.waitFor({ state: 'visible' });
  invariant(await itemInput.inputValue() === ids.itemText, 'Checklist item text changed after hard reload');
}

async function coverDeletes({ page, touch, ids }) {
  const primaryCategory = categoryCardByName(page, ids.categoryName);

  // Item delete: create a disposable row, edit it, then delete it through its
  // visible touch action. The primary item remains for the viewer survey.
  await tapLocator(touch, primaryCategory.getByRole('button', { name: 'Add checklist item', exact: false }), 'Add disposable checklist item');
  const disposableItem = primaryCategory.locator('.templates-mobile-item-row').last();
  await fillAndCommit(disposableItem.locator('input'), 'Disposable mobile item');
  await tapLocator(touch, disposableItem.getByRole('button', { name: '×', exact: true }), 'Delete checklist item');

  // Category delete through mobile Select mode.
  await tapLocator(touch, page.getByRole('button', { name: 'New category', exact: true }), 'New disposable category');
  const disposableCategory = page.locator('.templates-mobile-category-card').last();
  await fillAndCommit(disposableCategory.locator('.templates-mobile-category-row input'), 'Disposable mobile category');
  const disposableCategoryNamed = categoryCardByName(page, 'Disposable mobile category');
  const categoriesSection = page.locator('.templates-mobile-categories-section');
  await tapLocator(touch, categoriesSection.getByRole('button', { name: 'Select', exact: true }), 'Select categories');
  await tapLocator(touch, disposableCategoryNamed.locator('.templates-mobile-check'), 'Disposable category checkbox');
  await tapLocator(touch, categoriesSection.getByTitle('Delete'), 'Delete category');
  await page.waitForFunction(() => ![...document.querySelectorAll('.templates-mobile-category-card input')]
    .some((input) => input.value === 'Disposable mobile category'));
  await tapLocator(touch, categoriesSection.getByRole('button', { name: 'Done', exact: true }), 'Finish category selection');

  // Module edit/delete through the real mobile edit modal.
  await tapLocator(touch, page.getByRole('button', { name: 'New module', exact: true }), 'New disposable module');
  const moduleInput = page.locator('.templates-mobile-module-tabs [data-module-tab-id] input.inline-edit').last();
  await moduleInput.waitFor({ state: 'visible' });
  await fillAndCommit(moduleInput, 'Disposable mobile module');
  await tapLocator(touch, page.locator('.templates-mobile-modules-section').getByRole('button', { name: 'Select', exact: true }), 'Select modules');
  const modal = page.locator('.templates-module-edit-modal');
  await modal.waitFor({ state: 'visible' });
  const disposableModuleRow = modal.locator('[data-drag-rearrange-row]:has(input[value="Disposable mobile module"])');
  const disposableModuleBox = invariant(await disposableModuleRow.boundingBox(), 'Disposable module row has no touch bounds');
  // Row grid: 8px inset + 24px grip + 10px gap + 14px checkbox. Tap the
  // checkbox center; it intentionally has no semantic label in product UI.
  await touch.tap({ x: disposableModuleBox.x + 49, y: disposableModuleBox.y + disposableModuleBox.height / 2 });
  await tapLocator(touch, modal.getByTitle('Delete'), 'Delete module');
  await disposableModuleRow.waitFor({ state: 'detached', timeout: 10_000 });
  await tapLocator(touch, modal.getByRole('button', { name: 'Done', exact: true }), 'Finish module selection');

  await saveTemplate(page, touch);
  await waitForTemplateModel(
    page,
    (templates) => templates.some((template) => template?.name?.startsWith('Mobile Template ')
      && template.modules?.length === 1
      && template.modules[0]?.categories?.length === 1
      && template.modules[0]?.categories[0]?.checklist?.length === 1),
    'nested delete cleanup',
  );
}

async function armCreatedSurveyInViewer({ page, touch, ids }) {
  await page.getByRole('button', { name: 'Open survey' }).waitFor({ state: 'visible', timeout: 60_000 });
  const openSurvey = invariant(await firstVisible(page.getByRole('button', { name: 'Open survey' })), 'Open survey is not visible');
  await openSurvey.click();
  const chooser = page.locator('h1:visible, h2:visible, h3:visible', { hasText: 'Choose survey template' });
  const category = page.locator('button.survey-marker-category-main:visible', { hasText: ids.categoryName });
  const state = await Promise.race([
    chooser.first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'chooser'),
    category.first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'category'),
  ]);
  if (state === 'chooser') {
    const templateButton = invariant(await firstVisible(page.getByRole('button', { name: new RegExp(ids.templateName) })), 'Created survey template is not visible');
    await templateButton.click();
  }
  await category.first().waitFor({ state: 'visible', timeout: 10_000 });
  const visibleCategory = invariant(await firstVisible(category), 'Created survey category is not visible');
  await visibleCategory.click();
  const collapse = await firstVisible(page.getByRole('button', { name: 'Collapse Survey panel' }));
  if (collapse) await collapse.click();
}

async function openCreatedSurveyInViewer({ page, touch, ids, baseUrl }) {
  // Hub tab transitions have their own exhaustive suite. Navigate directly to
  // the stable Documents fixture here so a retained hidden template-detail
  // tree cannot race this survey lifecycle's real PDF selection.
  const documentsRoute = TEMPLATE_WORKFLOW_ROUTE.replace('tab=templates', 'tab=documents');
  await page.goto(`${baseUrl}${documentsRoute}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('heading', { name: 'Documents', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  const documentRow = page.locator('[data-document-id]:visible').filter({ hasText: 'test.pdf' });
  const fallbackRow = page.getByText('test.pdf', { exact: true }).filter({ visible: true });
  const target = await documentRow.count() ? documentRow : fallbackRow;
  await target.first().waitFor({ state: 'visible', timeout: 10_000 });
  await tapLocator(touch, target, 'test PDF');
  await armCreatedSurveyInViewer({ page, touch, ids });
}

async function markerStorage(page) {
  return page.evaluate(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith('surveyMarkers_')) continue;
      try { out.push([key, JSON.parse(localStorage.getItem(key) || '{}')]); } catch { /* ignore */ }
    }
    return out;
  });
}

async function runMarkerThroughCreatedSurvey({ page, touch, ids, artifacts }) {
  const before = new Set((await markerStorage(page)).flatMap(([, records]) => Object.keys(records || {})));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await armCreatedSurveyInViewer({ page, touch, ids });
    }
    const layer = page.locator('[data-svg-annotation-layer="1"]').first();
    const box = invariant(await layer.boundingBox(), 'Survey viewer annotation layer has no bounds');
    const viewport = invariant(page.viewportSize(), 'Mobile viewport unavailable');
    const top = Math.max(box.y + 20, 112);
    const bottom = Math.min(box.y + box.height - 20, viewport.height - 118);
    await wait(350);
    await touch.drag(
      { x: box.x + box.width * (0.24 + attempt * 0.08), y: top + (bottom - top) * 0.25 },
      { x: box.x + box.width * (0.55 + attempt * 0.08), y: top + (bottom - top) * 0.48 },
      { steps: 12 },
    );
    try {
      await page.waitForFunction((prior) => {
        const ids = new Set([...document.querySelectorAll('[data-survey-marker-id]')]
          .map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean));
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (!key?.startsWith('surveyMarkers_')) continue;
          try { Object.keys(JSON.parse(localStorage.getItem(key) || '{}')).forEach((id) => ids.add(id)); } catch { /* ignore */ }
        }
        return [...ids].some((id) => !prior.includes(id));
      }, [...before], { timeout: 6_000 });
      break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  const entries = await markerStorage(page);
  const markerId = invariant(entries.flatMap(([, records]) => Object.keys(records || {}))
    .find((id) => !before.has(id)), 'Created Survey Marker has no stable persisted id');
  const [markerKey, markerMap] = invariant(entries.find(([, records]) => records?.[markerId]), 'Survey Marker missing from exact storage');
  let marker = markerMap[markerId];
  // Survey Marker records are scoped by module/category; the selected
  // template owns those ids but is intentionally not duplicated on the row.
  invariant(marker.moduleId === ids.moduleId || marker.module_id === ids.moduleId,
    'Survey Marker did not retain created module id');
  invariant(marker.categoryId === ids.categoryId || marker.category_id === ids.categoryId,
    'Survey Marker did not retain created category id');
  const originalName = marker.name;

  await artifacts?.screenshot?.(page, 'created-template-survey-marker-created');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: 'Open survey' }).waitFor({ state: 'visible', timeout: 60_000 });
  marker = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || '{}')?.[id] || null,
    { key: markerKey, id: markerId });
  invariant(marker?.name === originalName, 'Created Survey Marker missing after first hard reload');
  await armCreatedSurveyInViewer({ page, touch, ids });

  const collapse = await firstVisible(page.getByRole('button', { name: 'Collapse Survey panel' }));
  if (collapse) await tapLocator(touch, collapse, 'Collapse Survey panel');
  await tapLocator(touch, page.getByRole('button', { name: 'Select', exact: true }), 'Select tool');
  const hit = page.locator(`[data-survey-marker-id="${markerId}"] [data-survey-marker-hit-target="true"]`);
  const hitBox = invariant(await hit.boundingBox(), 'Survey Marker has no touch hit target');
  const point = { x: hitBox.x + hitBox.width / 2, y: hitBox.y + hitBox.height / 2 };
  await touch.tap(point);
  await wait(80);
  await touch.tap(point);
  const renamed = `${originalName} mobile edited`;
  const rename = page.getByRole('textbox', { name: `Rename ${originalName}` });
  if (!await rename.isVisible().catch(() => false)) {
    await wait(450);
    const retryBox = invariant(await hit.boundingBox(), 'Selected Survey Marker lost its hit target');
    const retryPoint = { x: retryBox.x + retryBox.width / 2, y: retryBox.y + retryBox.height / 2 };
    await touch.tap(retryPoint);
    await wait(80);
    await touch.tap(retryPoint);
  }
  await rename.waitFor({ state: 'visible', timeout: 10_000 });
  await fillAndCommit(rename, renamed);
  await page.waitForFunction(({ key, id, name }) => JSON.parse(localStorage.getItem(key) || '{}')?.[id]?.name === name,
    { key: markerKey, id: markerId, name: renamed });
  await artifacts?.screenshot?.(page, 'created-template-survey-marker');

  // Reload proves both the template-to-marker linkage and edited marker name.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: 'Open survey' }).waitFor({ state: 'visible', timeout: 60_000 });
  marker = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || '{}')?.[id] || null,
    { key: markerKey, id: markerId });
  invariant(marker?.name === renamed, 'Edited Survey Marker missing after hard reload');

  // Rehydrate the created template, select marker, delete by >=44px touch UI,
  // then reload and assert exact persisted absence.
  await armCreatedSurveyInViewer({ page, touch, ids });
  await tapLocator(touch, page.getByRole('button', { name: 'Select', exact: true }), 'Select marker after reload');
  const rehydratedHit = page.locator(`[data-survey-marker-id="${markerId}"] [data-survey-marker-hit-target="true"]`);
  await rehydratedHit.waitFor({ state: 'visible', timeout: 10_000 });
  const selectedBox = invariant(await rehydratedHit.boundingBox(), 'Reloaded marker has no hit target');
  await touch.tap({ x: selectedBox.x + selectedBox.width / 2, y: selectedBox.y + selectedBox.height / 2 });
  await wait(400);
  const deleteButton = await firstVisible(page.getByRole('button', { name: 'Delete Survey Marker', exact: true }));
  invariant(deleteButton, 'Selected marker has no touch Delete action');
  const deleteBox = invariant(await deleteButton.boundingBox(), 'Survey Marker Delete has no bounds');
  invariant(deleteBox.width >= 44 && deleteBox.height >= 44, 'Survey Marker Delete is below 44px touch size');
  await touch.tap({ x: deleteBox.x + deleteBox.width / 2, y: deleteBox.y + deleteBox.height / 2 });
  await page.waitForFunction(({ key, id }) => !JSON.parse(localStorage.getItem(key) || '{}')?.[id], { key: markerKey, id: markerId });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  const deleted = await page.evaluate(({ key, id }) => Boolean(JSON.parse(localStorage.getItem(key) || '{}')?.[id]),
    { key: markerKey, id: markerId });
  invariant(!deleted, 'Deleted Survey Marker returned after reload');
  return { markerId, markerKey, markerName: renamed };
}

async function deleteTemplateAndVerify({ page, touch, baseUrl, ids }) {
  await page.goto(`${baseUrl}${TEMPLATE_WORKFLOW_ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const row = page.locator('.templates-mobile-row', { hasText: ids.templateName });
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await tapLocator(touch, row.getByTitle('More'), 'Template More menu');
  const deleteTemplate = await waitForFirstVisible(
    page.getByRole('button', { name: 'Delete', exact: true }),
    'Delete template',
  );
  await tapLocator(touch, deleteTemplate, 'Delete template');
  await row.waitFor({ state: 'detached', timeout: 10_000 });
  await waitForTemplateModel(page, (templates) => !templates.some((template) => template?.name?.startsWith('Mobile Template ')), 'template delete');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  invariant(await page.getByText(ids.templateName, { exact: true }).count() === 0, 'Deleted template returned after reload');
}

export async function runSurveyTemplateWorkflow({ page, touch, baseUrl, artifacts = null }) {
  await page.goto(`${baseUrl}${TEMPLATE_WORKFLOW_ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('heading', { name: 'Templates' }).waitFor({ state: 'visible', timeout: 30_000 });
  const ids = await createTemplateTree({ page, touch, artifacts });
  await verifyTreeAfterReload({ page, touch, baseUrl, ids });
  await coverDeletes({ page, touch, ids });
  await openCreatedSurveyInViewer({ page, touch, ids, baseUrl });
  const marker = await runMarkerThroughCreatedSurvey({ page, touch, ids, artifacts });
  await deleteTemplateAndVerify({ page, touch, baseUrl, ids });
  const result = {
    status: 'passed',
    workflow: 'survey-template',
    lifecycle: 'create-template-module-category-item-edit-save-reload-delete-nested-open-survey-create-edit-reload-delete-marker-delete-template-reload',
    ...ids,
    ...marker,
  };
  artifacts?.recordScenario?.(result);
  return result;
}
