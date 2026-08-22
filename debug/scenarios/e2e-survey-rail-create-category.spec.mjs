import { test, expect } from '@playwright/test';

// Unique leftover after survey-rail Delete selected categories:
// survey-rail `aria-label="Create category"` → CreateCategoryModal →
// addCategoryToCurrentTemplate / addCategoryAsNewTemplate.
// Not item Delete. Not overlay Delete. Not Rename. Not category Delete
// as the GAP (compose-edge only). Not U-01 Walls stamp-create.
// UL-31 Continue pin stays parked. Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const NEW_CATEGORY = 'E2E-Cat';
const PEN_CATEGORY = 'E2E-Pen';

async function openEditor(page, { width = 1440, height = 900 } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(SURVEY_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

function createCategoryBtn(page) {
  return rightRail(page).locator('.survey-marker-category-create-button');
}

function createDialog(page) {
  return page.getByRole('dialog').filter({ hasText: 'Name the new category' });
}

function confirmCreateBtn(page) {
  return createDialog(page).getByRole('button', { name: 'Create category', exact: true });
}

function categoryNameField(page) {
  return createDialog(page).getByPlaceholder('Enter category name...');
}

function deleteCategoriesBtn(page) {
  return page.getByRole('button', { name: 'Delete selected categories' });
}

function confirmDeleteDialog(page) {
  return page.getByRole('dialog').filter({ hasText: /Delete \d+ categor(y|ies)\?/ });
}

function categorySelectToggle(page) {
  return rightRail(page).locator('.survey-marker-category-select-button');
}

function railCategory(page, name) {
  // Rail row accessible name is `${name} ${count}` (e.g. "Walls 0").
  return rightRail(page).locator('.survey-marker-category-main').filter({
    has: page.locator('.survey-marker-category-main-label', { hasText: new RegExp(`^${name}$`) }),
  });
}

async function enterSurveyTemplate(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(railCategory(page, 'Walls')).toBeVisible({ timeout: 15_000 });
  await expect(createCategoryBtn(page)).toBeVisible({ timeout: 8_000 });
}

async function openSurveyRail(page) {
  if (await createCategoryBtn(page).isVisible().catch(() => false)) return;
  const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
  if (await survey.count()) await survey.click();
  const picker = page.getByRole('heading', { name: 'Choose survey template' });
  if (await picker.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  }
  await expect(createCategoryBtn(page)).toBeVisible({ timeout: 10_000 });
}

async function openCreateModal(page) {
  await openSurveyRail(page);
  await createCategoryBtn(page).click();
  await expect(createDialog(page)).toBeVisible({ timeout: 8_000 });
}

async function pickModifyCurrent(page) {
  const option = createDialog(page).getByText('Modify current template', { exact: true });
  await expect(option).toBeVisible();
  await option.click();
}

async function confirmCreate(page, name) {
  await categoryNameField(page).fill(name);
  await pickModifyCurrent(page);
  await expect(confirmCreateBtn(page)).toBeEnabled();
  await confirmCreateBtn(page).click();
  await expect(createDialog(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(railCategory(page, name)).toBeVisible({ timeout: 8_000 });
}

async function enterCategorySelectMode(page) {
  await openSurveyRail(page);
  if (await deleteCategoriesBtn(page).count() && await deleteCategoriesBtn(page).isVisible().catch(() => false)) {
    return;
  }
  await expect(categorySelectToggle(page)).toBeVisible({ timeout: 8_000 });
  await categorySelectToggle(page).click();
  await expect(deleteCategoriesBtn(page)).toBeVisible({ timeout: 8_000 });
}

async function selectCategory(page, name) {
  const deselect = page.getByRole('button', { name: `Deselect ${name}` });
  if (await deselect.count() && await deselect.first().isVisible().catch(() => false)) return;
  const select = page.getByRole('button', { name: `Select ${name}` });
  await expect(select).toBeVisible({ timeout: 8_000 });
  await select.click();
  await expect(page.getByRole('button', { name: `Deselect ${name}` })).toBeVisible({ timeout: 8_000 });
}

test('survey-rail Create category intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyTemplate(page);

  // Dialog chrome: name field + current-template vs new-template choice.
  await openCreateModal(page);
  await expect(createDialog(page).getByText('Create category', { exact: true }).first()).toBeVisible();
  await expect(categoryNameField(page)).toBeVisible();
  await expect(createDialog(page).getByText('Modify current template', { exact: true })).toBeVisible();
  await expect(createDialog(page).getByText('Save as new template', { exact: true })).toBeVisible();
  await createDialog(page).getByText('Save as new template', { exact: true }).click();
  await expect(createDialog(page).getByPlaceholder('Enter template name...')).toBeVisible();
  await expect(createDialog(page).getByPlaceholder('Enter template name...'))
    .toHaveValue(/KAL-436 Preservation Template \(Updated\)/);

  // Break: empty name — confirm stays disabled (not a create).
  await expect(confirmCreateBtn(page)).toBeDisabled();
  await categoryNameField(page).fill('   ');
  await expect(confirmCreateBtn(page)).toBeDisabled();

  // Break: duplicate name (case-insensitive vs existing Walls).
  await categoryNameField(page).fill('Walls');
  await expect(createDialog(page).getByText(/A category with this name already exists/)).toBeVisible();
  await expect(confirmCreateBtn(page)).toBeDisabled();
  await categoryNameField(page).fill('walls');
  await expect(createDialog(page).getByText(/A category with this name already exists/)).toBeVisible();
  await expect(confirmCreateBtn(page)).toBeDisabled();

  // Break: cancel — typed name is discarded; Walls stays the only extra row.
  await categoryNameField(page).fill(NEW_CATEGORY);
  await expect(createDialog(page).getByText(/A category with this name already exists/)).toHaveCount(0);
  await pickModifyCurrent(page);
  await expect(confirmCreateBtn(page)).toBeEnabled();
  await createDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(createDialog(page)).toHaveCount(0);
  await expect(railCategory(page, NEW_CATEGORY)).toHaveCount(0);
  await expect(railCategory(page, 'Walls')).toBeVisible();

  // Intended: create on the current module/template; it appears in the rail.
  await openCreateModal(page);
  await confirmCreate(page, NEW_CATEGORY);
  await expect(railCategory(page, 'Walls')).toBeVisible();

  // Product rule: clicking the new row arms it (selectedCategoryId + survey-marker).
  await railCategory(page, NEW_CATEGORY).click();
  const hostBtn = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: NEW_CATEGORY, exact: true });
  await expect(hostBtn).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => String(await hostBtn.getAttribute('class') || '')).toContain('btn-active');

  // Edge: create is not a history checkpoint — undo must not rewind the row.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await openSurveyRail(page);
  await expect(railCategory(page, NEW_CATEGORY)).toBeVisible();
  await expect(railCategory(page, 'Walls')).toBeVisible();

  // Edge: create then Delete selected categories still wipes the new row; Walls stays.
  await enterCategorySelectMode(page);
  await selectCategory(page, NEW_CATEGORY);
  await expect(deleteCategoriesBtn(page)).toBeEnabled();
  await deleteCategoriesBtn(page).click();
  const oneDialog = confirmDeleteDialog(page);
  await expect(oneDialog).toBeVisible({ timeout: 8_000 });
  await oneDialog.getByRole('button', { name: 'Delete category', exact: true }).click();
  await expect(railCategory(page, NEW_CATEGORY)).toHaveCount(0, { timeout: 8_000 });
  await expect(railCategory(page, 'Walls')).toBeVisible();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await expect(railCategory(page, NEW_CATEGORY)).toBeVisible({ timeout: 8_000 });
  await expect(railCategory(page, 'Walls')).toBeVisible();

  // Break: Pen-armed does not hide Create; confirm still adds a category.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await openCreateModal(page);
  await confirmCreate(page, PEN_CATEGORY);
  await expect(railCategory(page, NEW_CATEGORY)).toBeVisible();
  await expect(railCategory(page, 'Walls')).toBeVisible();

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — heading-row Create category is desktop-only.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  const walls390 = page.getByRole('button', { name: /Walls/ }).first();
  await expect(walls390).toBeVisible({ timeout: 15_000 });
  const mobile = {
    createCategoryCount: await page.locator('.survey-marker-category-create-button').count(),
    createDialogCount: await createDialog(page).count(),
  };
  expect(mobile.createCategoryCount, '390 has no Create category plus').toBe(0);
  expect(mobile.createDialogCount, '390 has no Create category dialog').toBe(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_RAIL_CREATE_CATEGORY_PROOF', JSON.stringify({
    created: NEW_CATEGORY,
    penCreated: PEN_CATEGORY,
    emptyDisabled: true,
    duplicateBlocked: true,
    cancelKeptWalls: true,
    appearedInRail: true,
    armedAfterClick: true,
    undoDidNotRewindCreate: true,
    deleteSelectedStillWorks: true,
    penArmedStillCreates: true,
    persist,
    mobile,
  }));
});
