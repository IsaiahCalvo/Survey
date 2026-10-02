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
  const target = await waitForFirstVisible(locator, label);
  const box = invariant(await target.boundingBox(), `${label} has no touch bounds`);
  invariant(box.width >= 1 && box.height >= 1, `${label} has invalid touch bounds`);
  await touch.tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return target;
}

async function tapExposedLocator(touch, locator, label) {
  const target = await waitForFirstVisible(locator, label);
  const point = await target.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const fractions = [0.5, 0.25, 0.75];
    for (const yFraction of fractions) {
      for (const xFraction of fractions) {
        const x = rect.left + rect.width * xFraction;
        const y = rect.top + rect.height * yFraction;
        const hit = document.elementFromPoint(x, y);
        if (hit === node || node.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  invariant(point, `${label} has no exposed trusted-touch point`);
  await touch.drag(point, point, { steps: 1 });
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

function entityStyle(entity) {
  return {
    color: entity?.color?.toLowerCase(),
    opacity: entity?.opacity,
    borderColor: entity?.borderColor?.toLowerCase(),
    borderOpacity: entity?.borderOpacity,
    matchFill: !!entity?.matchFill,
  };
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
  const row = page.locator('.templates-mobile-row', { hasText: templateName });
  await waitForFirstVisible(row, `template ${templateName}`, 10_000);
  await tapLocator(
    touch,
    row,
    `template ${templateName}`,
  );
  await page.locator('.templates-mobile-detail').waitFor({ state: 'visible', timeout: 10_000 });
}

async function ensureTemplateList(page) {
  if (await page.locator('.templates-mobile-detail:visible').count() > 0) {
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.locator('.templates-mobile-row:visible').first().waitFor({ state: 'visible', timeout: 10_000 });
  }
}

function categoryCardByName(page, categoryName, { mobile = true } = {}) {
  const base = mobile ? '.templates-mobile-category-card' : '.card-line';
  return page.locator(`${base}:has(input[value=${JSON.stringify(categoryName)}])`);
}

async function ensureCategoryExpanded(touch, card, label) {
  const items = card.locator('.templates-mobile-items');
  if (await items.isVisible().catch(() => false)) return;
  const disclosure = card.locator('.templates-mobile-category-row > button');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tapLocator(touch, disclosure, `${label} disclosure`);
    try {
      await items.waitFor({ state: 'visible', timeout: 2_000 });
      return;
    } catch {
      // A trusted tap can be consumed by the inline input's blur on WebKit;
      // retry the same physical disclosure after the blur settles.
    }
  }
  throw new Error(`Expected expanded ${label}`);
}

async function saveTemplate(page, touch) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'hidden', timeout: 10_000 });
}

async function dragBetween(touch, from, to, label, { axis = 'vertical', holdMs = 0 } = {}) {
  const explicitHandleBox = await from.evaluate((node) => {
    const handle = node.matches?.('[data-drag-rearrange-handle]')
      ? node
      : node.querySelector?.('[data-drag-rearrange-handle]');
    if (!handle) return null;
    const rect = handle.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const fromBox = invariant(explicitHandleBox || await from.boundingBox(), `${label}: source handle has no bounds`);
  const toBox = invariant(await to.boundingBox(), `${label}: destination row has no bounds`);
  const start = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 };
  const end = axis === 'horizontal'
    ? { x: toBox.x + toBox.width / 2, y: start.y }
    : { x: start.x, y: toBox.y + toBox.height / 2 };
  if (holdMs > 0) {
    await touch.start(start);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    for (let step = 1; step <= 16; step += 1) {
      await touch.move({
        x: start.x + ((end.x - start.x) * step) / 16,
        y: start.y + ((end.y - start.y) * step) / 16,
      });
      await wait(12);
    }
    await touch.end();
  } else {
    await touch.drag(start, end, { steps: 16 });
  }
}

async function coverTouchReorderPersistence({ page, touch, baseUrl, artifacts }) {
  await page.goto(`${baseUrl}${TEMPLATE_WORKFLOW_ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('heading', { name: 'Templates' }).waitFor({ state: 'visible', timeout: 30_000 });
  const restoreTemplates = await readTemplates(page);
  const reorderFixtures = [
    {
      id: 't1', name: 'Security Walk-Through',
      entities: [{ id: 'e1', name: 'GC', color: '#d8a84e' }],
      modules: [
        {
          id: 'm1', name: 'Installation Phase', categories: [
            { id: 'c1', name: 'Cameras', checklist: [
              { id: 'i1', text: 'Is the camera cable pulled?' },
              { id: 'i2', text: 'Is the camera installed?' },
            ] },
            { id: 'c2', name: 'Doors', checklist: [{ id: 'i3', text: 'Is the door roughed in?' }] },
          ],
        },
        { id: 'm2', name: 'Commissioning Phase', categories: [{ id: 'c3', name: 'Testing', checklist: [] }] },
      ],
    },
    {
      id: 't2', name: 'MEP As-Built Markup',
      entities: [{ id: 'e2', name: 'MEP', color: '#7ab7e6' }],
      modules: [{ id: 'm3', name: 'Equipment', categories: [] }],
    },
  ];
  await page.evaluate(({ key, fixtures }) => {
    localStorage.setItem(key, JSON.stringify(fixtures));
  }, { key: TEMPLATE_WORKFLOW_STORAGE_KEY, fixtures: reorderFixtures });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForTemplateModel(page, (templates) => templates.length >= 2, 'seeded templates');
  const originalTemplates = await readTemplates(page);
  const orderPreferenceKey = 'surveyHub.templateOrder:isaiahcalvo123@gmail.com';
  const originalOrderPreference = await page.evaluate((key) => localStorage.getItem(key), orderPreferenceKey);

  const templateRows = page.locator('.templates-mobile-row:visible');
  const secondTemplateId = originalTemplates[1].id;
  await dragBetween(
    touch,
    page.locator(`[data-sortable-rearrange-item="${secondTemplateId}"]:visible`),
    page.locator(`[data-sortable-rearrange-item="${originalTemplates[0].id}"]:visible`),
    'template touch reorder',
  );
  await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key) || '[]')?.[0] === id,
    { key: orderPreferenceKey, id: secondTemplateId }, { timeout: 5_000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  invariant((await templateRows.first().innerText()).includes(originalTemplates[1].name), 'Template touch reorder changed after reload');

  await openTemplate(page, originalTemplates[0].name, touch);
  await dragBetween(
    touch,
    page.locator(`[data-module-tab-id="m2"]:visible`),
    page.locator(`[data-module-tab-id="m1"]:visible`),
    'module touch reorder',
    { axis: 'horizontal', holdMs: 190 },
  );
  await page.waitForTimeout(300);
  await saveTemplate(page, touch);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await ensureTemplateList(page);
  await openTemplate(page, originalTemplates[0].name, touch);
  await page.locator('[data-module-tab-id="m1"]:visible').click();
  await page.locator('[data-sortable-rearrange-item="c1"]:visible').waitFor({ state: 'visible', timeout: 10_000 });
  await dragBetween(
    touch,
    page.locator('[data-sortable-rearrange-item="c2"]:visible'),
    page.locator('[data-sortable-rearrange-item="c1"]:visible'),
    'category touch reorder',
  );
  await page.waitForTimeout(300);
  await saveTemplate(page, touch);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await ensureTemplateList(page);
  await openTemplate(page, originalTemplates[0].name, touch);
  await page.locator('[data-module-tab-id="m1"]:visible').click();
  await ensureCategoryExpanded(touch, categoryCardByName(page, 'Cameras'), 'Cameras');
  const installedItem = page.locator('.templates-mobile-item-row:has(input[value="Is the camera installed?"]):visible').locator('..');
  const cableItem = page.locator('.templates-mobile-item-row:has(input[value="Is the camera cable pulled?"]):visible').locator('..');
  await installedItem.waitFor({ state: 'visible', timeout: 10_000 });
  await dragBetween(
    touch,
    installedItem,
    cableItem,
    'checklist item touch reorder',
  );
  await page.waitForTimeout(300);
  await saveTemplate(page, touch);
  let templates = await waitForTemplateModel(
    page,
    (value) => {
      const template = value.find((entry) => entry.id === 't1');
      const installation = template?.modules?.find((module) => module.id === 'm1');
      const cameras = installation?.categories?.find((category) => category.id === 'c1');
      return template?.modules?.[0]?.id === 'm2'
        && installation?.categories?.[0]?.id === 'c2'
        && cameras?.checklist?.[0]?.id === 'i2';
    },
    'touch reorder persistence',
  );
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  templates = await readTemplates(page);
  const reloaded = templates.find((entry) => entry.id === 't1');
  invariant(reloaded.modules[0].id === 'm2', 'Module touch reorder changed after reload');
  invariant(reloaded.modules.find((module) => module.id === 'm1').categories[0].id === 'c2', 'Category touch reorder changed after reload');
  invariant(reloaded.modules.find((module) => module.id === 'm1').categories.find((category) => category.id === 'c1').checklist[0].id === 'i2', 'Item touch reorder changed after reload');
  await artifacts?.screenshot?.(page, 'template-touch-reorders-reloaded');

  await page.evaluate(({ key, orderKey, orderValue, templates: snapshot }) => {
    localStorage.setItem(key, JSON.stringify(snapshot));
    if (orderValue == null) localStorage.removeItem(orderKey);
    else localStorage.setItem(orderKey, orderValue);
  }, {
    key: TEMPLATE_WORKFLOW_STORAGE_KEY,
    orderKey: orderPreferenceKey,
    orderValue: originalOrderPreference,
    templates: restoreTemplates,
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
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

  await tapLocator(touch, page.getByRole('button', { name: 'Add module', exact: true }), 'New module');
  const moduleInput = page.locator('.templates-mobile-module-tabs [data-module-tab-id] input.inline-edit').last();
  await moduleInput.waitFor({ state: 'visible', timeout: 10_000 });
  const moduleId = invariant(await moduleInput.locator('xpath=..').getAttribute('data-module-tab-id'), 'Created module has no stable id');
  const moduleName = 'Mobile Walkthrough Module';
  await fillAndCommit(moduleInput, moduleName);

  await tapLocator(touch, page.getByRole('button', { name: 'Add category', exact: true }), 'New category');
  const categoryCard = page.locator('.templates-mobile-category-card').last();
  await categoryCard.waitFor({ state: 'visible', timeout: 10_000 });
  const categoryInput = categoryCard.locator('.templates-mobile-category-row input');
  const categoryName = 'Mobile Survey Category';
  await fillAndCommit(categoryInput, categoryName);
  const renamedCategoryCard = categoryCardByName(page, categoryName);
  await renamedCategoryCard.waitFor({ state: 'visible', timeout: 10_000 });
  await ensureCategoryExpanded(touch, renamedCategoryCard, `created category ${categoryName}`);

  const categoryId = invariant(await categoryCard.locator('[data-drag-rearrange-row]').getAttribute('data-rbd-draggable-id').catch(() => null)
    || await categoryCard.evaluate((node) => node.querySelector('[data-drag-rearrange-row]')?.parentElement?.getAttribute('data-sortable-id'))
    || `category:${categoryName}`,
  'Created category has no stable identity');

  const addItem = renamedCategoryCard.getByRole('button', { name: 'Add checklist item', exact: false });
  await tapLocator(touch, addItem, 'Add checklist item');
  const itemInput = renamedCategoryCard.locator('.templates-mobile-item-row input').last();
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
  await ensureCategoryExpanded(touch, category, `category ${ids.categoryName}`);
  const itemInput = category.locator('.templates-mobile-item-row input').first();
  await itemInput.waitFor({ state: 'visible' });
  invariant(await itemInput.inputValue() === ids.itemText, 'Checklist item text changed after hard reload');
}

async function openEntityColorPanel(touch, modal, row, label) {
  const colorPanel = modal.locator('.templates-mobile-color-panel').first();
  for (let attempt = 0; attempt < 3 && !await colorPanel.isVisible().catch(() => false); attempt += 1) {
    await tapLocator(touch, row.getByTitle('Edit color'), `Open ${label} color picker`);
    if (!await colorPanel.isVisible().catch(() => false)) {
      // Renaming blurs the input and closes the picker. DismissBarrier keeps a
      // short trailing shield so that blur gesture cannot activate underlying
      // UI; retry only after that bounded shield expires.
      await wait(950);
    }
  }
  await colorPanel.waitFor({ state: 'visible', timeout: 10_000 });
  await colorPanel.scrollIntoViewIfNeeded();
  return colorPanel;
}

async function tapEntityColorControl(touch, locator, label) {
  const target = locator.first();
  await target.scrollIntoViewIfNeeded();
  return tapExposedLocator(touch, target, label);
}

async function coverEntitiesAndReload({ page, touch, baseUrl, ids, artifacts }) {
  await tapLocator(touch, page.getByRole('button', { name: 'Entities', exact: true }), 'Open Entities');
  const modal = page.getByRole('dialog', { name: 'Entities', exact: true });
  await modal.waitFor({ state: 'visible', timeout: 10_000 });

  const addEntity = modal.getByRole('button', { name: 'Add entity', exact: true });
  await tapLocator(touch, addEntity, 'New Inspector entity');
  let rows = modal.locator('.templates-mobile-entity-row');
  let inspectorRow = rows.last();
  await fillAndCommit(inspectorRow.locator('input'), 'Inspector');
  let colorPanel = await openEntityColorPanel(touch, modal, inspectorRow, 'Inspector');
  await tapEntityColorControl(touch, colorPanel.getByTitle('#00FF00'), 'Inspector fill green');
  await tapEntityColorControl(touch, colorPanel.getByRole('button', { name: 'Border', exact: true }), 'Inspector border tab');
  await tapEntityColorControl(touch, colorPanel.getByTitle('#0000FF'), 'Inspector border blue');
  await tapLocator(touch, inspectorRow.getByTitle('Edit color'), 'Close Inspector color picker');
  await colorPanel.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.waitForTimeout(950);

  // Duplicate before Save: the clone must snapshot the live picker maps, not
  // the last persisted roster values.
  await tapLocator(touch, inspectorRow.locator('.templates-mobile-more'), 'Inspector More before save');
  const duplicateInspector = await waitForFirstVisible(
    page.getByRole('menuitem', { name: 'Duplicate', exact: true }),
    'Duplicate Inspector before save',
  );
  await tapLocator(touch, duplicateInspector, 'Duplicate Inspector before save');
  const inspectorCopyRow = modal.locator('.templates-mobile-entity-row:has(input[value="Inspector copy"])');
  await inspectorCopyRow.waitFor({ state: 'visible', timeout: 10_000 });

  await tapLocator(touch, addEntity, 'New Owner entity');
  rows = modal.locator('.templates-mobile-entity-row');
  const ownerRow = rows.last();
  await fillAndCommit(ownerRow.locator('input'), 'Owner');
  colorPanel = await openEntityColorPanel(touch, modal, ownerRow, 'Owner');
  await tapEntityColorControl(touch, colorPanel.getByTitle('#FF0000'), 'Owner fill red');
  await tapEntityColorControl(touch, colorPanel.getByRole('button', { name: 'Border', exact: true }), 'Owner border tab');
  await tapEntityColorControl(touch, colorPanel.getByTitle('#0000FF'), 'Owner border blue before match fill');
  const matchFill = colorPanel.getByRole('checkbox');
  await tapEntityColorControl(touch, matchFill, 'Owner match fill');
  invariant(await matchFill.isChecked(), 'Owner Match fill did not enable');
  await tapLocator(touch, ownerRow.getByTitle('Edit color'), 'Close Owner color picker');
  await colorPanel.waitFor({ state: 'hidden', timeout: 10_000 });
  // DismissBarrier deliberately retains its trailing click shield briefly after
  // the picker unmounts so the same physical tap cannot activate the surface
  // underneath it. Trusted touch automation does not always emit that click,
  // therefore wait for the shield's bounded fallback before the next gesture.
  await page.waitForTimeout(950);

  const reorderedOwnerRow = modal.locator('.templates-mobile-entity-row:has(input[value="Owner"])');
  const firstEntityRow = modal.locator('.templates-mobile-entity-row').first();
  await dragBetween(
    touch,
    reorderedOwnerRow.locator('xpath=..'),
    firstEntityRow.locator('xpath=..'),
    'entity touch reorder',
  );
  await page.waitForTimeout(1_000);
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await modal.waitFor({ state: 'hidden', timeout: 10_000 });

  // Whole-template duplicate before Save. Its fresh entity ids must carry the
  // same unsaved fill, opacity, border, and match-fill values through the
  // duplicate's immediate persistence and a hard reload.
  await page.locator('.templates-mobile-back-button').click();
  const sourceRow = page.locator('.templates-mobile-row', { hasText: ids.templateName });
  await sourceRow.waitFor({ state: 'visible', timeout: 10_000 });
  await tapLocator(touch, sourceRow.getByTitle('More'), 'Source template More before save');
  const copyBeforeSave = await waitForFirstVisible(
    page.getByRole('menuitem', { name: 'Copy', exact: true }),
    'Copy template before save',
  );
  await tapLocator(touch, copyBeforeSave, 'Copy template before save');
  const unsavedCopyName = `${ids.templateName} copy`;

  let templates = await waitForTemplateModel(
    page,
    (value) => {
      const template = value.find((entry) => entry?.name?.startsWith('Mobile Template '));
      const owner = template?.entities?.find((entity) => entity.name === 'Owner');
      const inspector = template?.entities?.find((entity) => entity.name === 'Inspector');
      const inspectorCopy = template?.entities?.find((entity) => entity.name === 'Inspector copy');
      const templateCopy = value.find((entry) => entry?.name === `${template?.name} copy`);
      const copiedOwner = templateCopy?.entities?.find((entity) => entity.name === 'Owner');
      const copiedInspector = templateCopy?.entities?.find((entity) => entity.name === 'Inspector');
      const copiedInspectorCopy = templateCopy?.entities?.find((entity) => entity.name === 'Inspector copy');
      return template?.entities?.[0]?.name === 'Owner'
        && owner?.color?.toLowerCase() === '#ff0000'
        && owner?.matchFill === true
        && owner?.borderColor?.toLowerCase() === '#ff0000'
        && inspector?.color?.toLowerCase() === '#00ff00'
        && inspector?.borderColor?.toLowerCase() === '#0000ff'
        && inspector?.matchFill === false
        && inspectorCopy?.color === inspector?.color
        && inspectorCopy?.opacity === inspector?.opacity
        && inspectorCopy?.borderColor === inspector?.borderColor
        && inspectorCopy?.borderOpacity === inspector?.borderOpacity
        && inspectorCopy?.matchFill === inspector?.matchFill
        && copiedOwner?.color === owner?.color
        && copiedOwner?.borderColor === owner?.borderColor
        && copiedOwner?.matchFill === owner?.matchFill
        && copiedInspector?.borderColor === inspector?.borderColor
        && copiedInspectorCopy?.borderColor === inspectorCopy?.borderColor;
    },
    'unsaved entity and template duplicate styling',
  );
  let template = findTemplate(templates, ids.templateId);
  const ownerId = invariant(template.entities.find((entity) => entity.name === 'Owner')?.id, 'Owner entity has no persisted id');
  const inspectorId = invariant(template.entities.find((entity) => entity.name === 'Inspector')?.id, 'Inspector entity has no persisted id');
  const inspectorCopyId = invariant(template.entities.find((entity) => entity.name === 'Inspector copy')?.id, 'Inspector copy has no persisted id');
  const unsavedTemplateCopy = invariant(templates.find((entry) => entry.name === unsavedCopyName), 'Unsaved-styled template copy missing');
  const expectedSourceStyles = Object.fromEntries(
    template.entities
      .filter((entity) => ['Owner', 'Inspector', 'Inspector copy'].includes(entity.name))
      .map((entity) => [entity.name, entityStyle(entity)]),
  );
  const expectedCopyStyles = Object.fromEntries(
    unsavedTemplateCopy.entities
      .filter((entity) => ['Owner', 'Inspector', 'Inspector copy'].includes(entity.name))
      .map((entity) => [entity.name, entityStyle(entity)]),
  );
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  templates = await readTemplates(page);
  template = findTemplate(templates, ids.templateId);
  invariant(template?.entities?.[0]?.id === ownerId, 'Entity touch reorder changed after hard reload');
  invariant(template?.entities?.some((entity) => entity.id === inspectorId && entity.borderColor.toLowerCase() === '#0000ff'), 'Entity colors changed after hard reload');
  invariant(template?.entities?.some((entity) => entity.id === inspectorCopyId && entity.borderColor.toLowerCase() === '#0000ff'), 'Unsaved entity duplicate styling changed after hard reload');
  const reloadedTemplateCopy = findTemplate(templates, unsavedTemplateCopy.id);
  for (const name of ['Owner', 'Inspector', 'Inspector copy']) {
    const reloadedSourceStyle = entityStyle(template.entities.find((entity) => entity.name === name));
    const reloadedCopyStyle = entityStyle(reloadedTemplateCopy.entities.find((entity) => entity.name === name));
    invariant(JSON.stringify(reloadedSourceStyle) === JSON.stringify(expectedSourceStyles[name]),
      `Unsaved ${name} entity style changed after hard reload`);
    invariant(JSON.stringify(reloadedCopyStyle) === JSON.stringify(expectedCopyStyles[name]),
      `Unsaved template copy ${name} style changed after hard reload`);
  }

  const unsavedCopyRow = page.locator('.templates-mobile-row', { hasText: unsavedCopyName });
  await unsavedCopyRow.scrollIntoViewIfNeeded();
  await tapLocator(touch, unsavedCopyRow.getByTitle('More'), 'Unsaved-styled template copy More');
  const deleteUnsavedCopy = await waitForFirstVisible(
    page.getByRole('menuitem', { name: 'Delete', exact: true }),
    'Delete unsaved-styled template copy',
  );
  await tapLocator(touch, deleteUnsavedCopy, 'Delete unsaved-styled template copy');
  await waitForTemplateModel(
    page,
    (value) => !value.some((entry) => entry?.name?.endsWith(' copy')),
    'unsaved-styled template copy cleanup',
  );

  await openTemplate(page, ids.templateName, touch);
  await tapLocator(touch, page.getByRole('button', { name: 'Entities', exact: true }), 'Reopen Entities');
  await modal.waitFor({ state: 'visible', timeout: 10_000 });
  const persistedInspector = modal.locator('.templates-mobile-entity-row:has(input[value="Inspector"])');
  await tapLocator(touch, persistedInspector.locator('.templates-mobile-more'), 'Inspector More');
  const deleteInspector = await waitForFirstVisible(
    page.getByRole('menuitem', { name: 'Delete', exact: true }),
    'Delete Inspector',
  );
  await tapLocator(touch, deleteInspector, 'Delete Inspector');
  await page.waitForTimeout(1_000);
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await modal.waitFor({ state: 'hidden', timeout: 10_000 });
  await saveTemplate(page, touch);
  await waitForTemplateModel(
    page,
    (value) => !value.find((entry) => entry?.name?.startsWith('Mobile Template '))?.entities?.some((entity) => entity.name === 'Inspector'),
    'entity delete',
  );
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  invariant(!findTemplate(await readTemplates(page), ids.templateId)?.entities?.some((entity) => entity.id === inspectorId), 'Deleted entity returned after reload');
  await artifacts?.screenshot?.(page, 'entities-persisted-reloaded');
  return { ownerId, inspectorId, inspectorCopyId };
}

async function coverTemplateDuplicateReload({ page, touch, baseUrl, ids }) {
  await page.goto(`${baseUrl}${TEMPLATE_WORKFLOW_ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const sourceRow = page.locator('.templates-mobile-row', { hasText: ids.templateName });
  await sourceRow.waitFor({ state: 'visible', timeout: 30_000 });
  await tapLocator(touch, sourceRow.getByTitle('More'), 'Source template More');
  const copyAction = await waitForFirstVisible(page.getByRole('menuitem', { name: 'Copy', exact: true }), 'Copy template');
  await tapLocator(touch, copyAction, 'Copy template');
  const copyName = `${ids.templateName} copy`;
  let templates = await waitForTemplateModel(
    page,
    (value) => value.some((template) => template?.name?.endsWith(' copy') && template?.name?.startsWith('Mobile Template ')),
    'template duplicate',
  );
  const source = invariant(findTemplate(templates, ids.templateId), 'Source template vanished during duplicate');
  const copy = invariant(templates.find((template) => template.name === copyName), 'Persisted template copy missing');
  invariant(copy.id !== source.id, 'Template copy reused source id');
  invariant(copy.modules[0]?.id !== source.modules[0]?.id, 'Template copy reused module id');
  invariant(copy.modules[0]?.categories[0]?.id !== source.modules[0]?.categories[0]?.id, 'Template copy reused category id');
  invariant(copy.modules[0]?.categories[0]?.checklist[0]?.id !== source.modules[0]?.categories[0]?.checklist[0]?.id, 'Template copy reused checklist id');
  invariant(copy.entities[0]?.id !== source.entities[0]?.id, 'Template copy reused entity id');
  invariant(copy.entities[0]?.color === source.entities[0]?.color && copy.entities[0]?.matchFill === source.entities[0]?.matchFill,
    'Template copy changed persisted entity styling');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  templates = await readTemplates(page);
  invariant(templates.some((template) => template.id === copy.id), 'Duplicated template returned missing after reload');

  const copyRow = page.locator('.templates-mobile-row', { hasText: copyName });
  await copyRow.scrollIntoViewIfNeeded();
  await copyRow.waitFor({ state: 'visible', timeout: 10_000 });
  await tapLocator(touch, copyRow.getByTitle('More'), 'Copied template More');
  const deleteCopy = await waitForFirstVisible(
    page.getByRole('menuitem', { name: 'Delete', exact: true }),
    'Delete copied template',
  );
  await tapLocator(touch, deleteCopy, 'Delete copied template');
  await waitForTemplateModel(page, (value) => !value.some((template) => template.name.endsWith(' copy')), 'template copy cleanup');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  invariant(await page.getByText(copyName, { exact: true }).count() === 0, 'Deleted template copy returned after reload');
  await openTemplate(page, ids.templateName, touch);
  return { copyId: copy.id };
}

async function coverDeletes({ page, touch, ids }) {
  const primaryCategory = categoryCardByName(page, ids.categoryName);

  // Item delete: create a disposable row, edit it, then delete it through its
  // visible touch action. The primary item remains for the viewer survey.
  await ensureCategoryExpanded(touch, primaryCategory, 'primary category');
  await tapLocator(touch, primaryCategory.getByRole('button', { name: 'Add checklist item', exact: false }), 'Add disposable checklist item');
  const disposableItem = primaryCategory.locator('.templates-mobile-item-row').last();
  await fillAndCommit(disposableItem.locator('input'), 'Disposable mobile item');
  await tapLocator(touch, disposableItem.getByRole('button', { name: 'Delete item', exact: true }), 'Delete checklist item');

  // Category delete through mobile Select mode.
  await tapLocator(touch, page.getByRole('button', { name: 'Add category', exact: true }), 'New disposable category');
  const disposableCategory = page.locator('.templates-mobile-category-card').last();
  await fillAndCommit(disposableCategory.locator('.templates-mobile-category-row input'), 'Disposable mobile category');
  const disposableCategoryNamed = categoryCardByName(page, 'Disposable mobile category');
  const categoriesSection = page.locator('.templates-mobile-categories-section');
  await tapLocator(touch, categoriesSection.getByRole('button', { name: 'Select', exact: true }), 'Select categories');
  await tapExposedLocator(touch, disposableCategoryNamed.locator('.templates-mobile-check'), 'Disposable category checkbox');
  await disposableCategoryNamed.locator('.templates-mobile-check.checked').waitFor({ state: 'visible' });
  await tapLocator(touch, categoriesSection.getByTitle('Delete'), 'Delete category');
  await page.waitForFunction(() => ![...document.querySelectorAll('.templates-mobile-category-card input')]
    .some((input) => input.value === 'Disposable mobile category'));
  await tapLocator(touch, categoriesSection.getByRole('button', { name: 'Done', exact: true }), 'Finish category selection');

  // Module edit/delete through the real mobile edit modal.
  await tapLocator(touch, page.getByRole('button', { name: 'Add module', exact: true }), 'New disposable module');
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
  if (collapse) {
    await tapLocator(touch, collapse, 'Collapse Survey panel');
    await page.getByRole('button', { name: 'Expand Survey panel' })
      .waitFor({ state: 'visible', timeout: 5_000 });
  }
  await tapLocator(touch, page.getByRole('button', { name: 'Select', exact: true }), 'Select tool');
  const hit = page.locator(`[data-survey-marker-id="${markerId}"] [data-survey-marker-hit-target="true"]`);
  const renamed = `${originalName} mobile edited`;
  const rename = page.getByRole('textbox', { name: `Rename ${originalName}` });
  for (let attempt = 0; attempt < 3 && !await rename.isVisible().catch(() => false); attempt += 1) {
    const hitBox = invariant(await hit.boundingBox(), 'Survey Marker has no touch hit target');
    const point = { x: hitBox.x + hitBox.width / 2, y: hitBox.y + hitBox.height / 2 };
    await touch.tap(point);
    await wait(80);
    await touch.tap(point);
    await rename.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
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
    page.getByRole('menuitem', { name: 'Delete', exact: true }),
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
  await coverTouchReorderPersistence({ page, touch, baseUrl, artifacts });
  const ids = await createTemplateTree({ page, touch, artifacts });
  await verifyTreeAfterReload({ page, touch, baseUrl, ids });
  const entities = await coverEntitiesAndReload({ page, touch, baseUrl, ids, artifacts });
  const duplicate = await coverTemplateDuplicateReload({ page, touch, baseUrl, ids });
  await coverDeletes({ page, touch, ids });
  await openCreatedSurveyInViewer({ page, touch, ids, baseUrl });
  const marker = await runMarkerThroughCreatedSurvey({ page, touch, ids, artifacts });
  await deleteTemplateAndVerify({ page, touch, baseUrl, ids });
  const result = {
    status: 'passed',
    workflow: 'survey-template',
    lifecycle: 'template-module-category-item-entity-touch-reorder-reload-create-template-module-category-item-entity-crud-colors-border-match-fill-reload-template-duplicate-reload-delete-nested-open-survey-create-edit-reload-delete-marker-delete-template-reload',
    ...ids,
    ...entities,
    ...duplicate,
    ...marker,
  };
  artifacts?.recordScenario?.(result);
  return result;
}
