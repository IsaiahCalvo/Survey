import { test, expect } from '@playwright/test';

// Unique leftover after place-time Entity dialog:
// empty-module `onRequestCreateTemplate` start-adding —
// "No categories available for this space." → CreateCategoryModal.
// Not the heading-row plus (Create category leftover). Not rail Entity.
// Not Jump / Set location. Not checklist Y/N/N-A. Not Copy-to-space.
// UL-31 Continue pin stays parked. Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const EMPTY_TEMPLATE = /Empty Module Template/;
const NEW_TEMPLATE = 'E2E Empty Template';
const NEW_CATEGORY = 'E2E-First';
const CURRENT_CATEGORY = 'E2E-Cat';
const PEN_CATEGORY = 'E2E-Pen';

async function openEditor(page, { width = 1440, height = 900, url = SURVEY_PDF } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url);
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

function emptyStateCopy(page) {
  return rightRail(page).getByText('No categories available for this space.');
}

function emptyCreateBtn(page) {
  return rightRail(page).locator('.survey-marker-empty-module-create-button');
}

function headingPlus(page) {
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

function templateNameField(page) {
  return createDialog(page).getByPlaceholder('Enter template name...');
}

function railCategory(page, name) {
  return rightRail(page).locator('.survey-marker-category-main').filter({
    has: page.locator('.survey-marker-category-main-label', { hasText: new RegExp(`^${name}$`) }),
  });
}

async function enterEmptyModuleTemplate(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: EMPTY_TEMPLATE }).click();
  await expect(emptyStateCopy(page)).toBeVisible({ timeout: 15_000 });
  await expect(emptyCreateBtn(page)).toBeVisible({ timeout: 8_000 });
}

async function openSurveyRailOnEmpty(page) {
  if (await emptyCreateBtn(page).isVisible().catch(() => false)) return;
  if (await emptyStateCopy(page).isVisible().catch(() => false)) return;
  const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
  if (await survey.count()) await survey.click();
  const picker = page.getByRole('heading', { name: 'Choose survey template' });
  if (await picker.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: EMPTY_TEMPLATE }).click();
  }
}

async function openEmptyCreateModal(page) {
  await openSurveyRailOnEmpty(page);
  await expect(emptyCreateBtn(page)).toBeVisible({ timeout: 8_000 });
  await emptyCreateBtn(page).click();
  await expect(createDialog(page)).toBeVisible({ timeout: 8_000 });
}

async function pickModifyCurrent(page) {
  const option = createDialog(page).getByText('Modify current template', { exact: true });
  await expect(option).toBeVisible();
  await option.click();
}

async function pickSaveAsNew(page) {
  const option = createDialog(page).getByText('Save as new template', { exact: true });
  await expect(option).toBeVisible();
  await option.click();
}

test('empty-module Create template start-adding intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterEmptyModuleTemplate(page);

  // Empty-state start-adding is a different control than the heading plus.
  await expect(headingPlus(page)).toBeVisible();
  await expect(emptyCreateBtn(page)).toBeVisible();
  await expect(emptyCreateBtn(page)).toHaveAttribute('aria-label', 'Create category for empty module');

  await openEmptyCreateModal(page);
  await expect(createDialog(page).getByText('Create category', { exact: true }).first()).toBeVisible();
  await expect(categoryNameField(page)).toBeVisible();
  await expect(createDialog(page).getByText('Modify current template', { exact: true })).toBeVisible();
  await expect(createDialog(page).getByText('Save as new template', { exact: true })).toBeVisible();

  // Break: empty / whitespace category name — confirm stays disabled.
  await expect(confirmCreateBtn(page)).toBeDisabled();
  await categoryNameField(page).fill('   ');
  await pickModifyCurrent(page);
  await expect(confirmCreateBtn(page)).toBeDisabled();

  // Break: duplicate template name (product rejects on Save as new).
  await categoryNameField(page).fill(NEW_CATEGORY);
  await pickSaveAsNew(page);
  await expect(templateNameField(page)).toBeVisible();
  await templateNameField(page).fill('Empty Module Template');
  await expect(createDialog(page).getByText(/A template with this name already exists/)).toBeVisible();
  await expect(confirmCreateBtn(page)).toBeDisabled();
  await templateNameField(page).fill('KAL-436 Preservation Template');
  await expect(createDialog(page).getByText(/A template with this name already exists/)).toBeVisible();
  await expect(confirmCreateBtn(page)).toBeDisabled();

  // Break: cancel — typed names discarded; empty-state stays.
  await templateNameField(page).fill(NEW_TEMPLATE);
  await expect(createDialog(page).getByText(/A template with this name already exists/)).toHaveCount(0);
  await createDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(createDialog(page)).toHaveCount(0);
  await expect(emptyStateCopy(page)).toBeVisible();
  await expect(railCategory(page, NEW_CATEGORY)).toHaveCount(0);

  // Intended: Save as new template — named template appears; empty-state goes away.
  await openEmptyCreateModal(page);
  await categoryNameField(page).fill(NEW_CATEGORY);
  await pickSaveAsNew(page);
  await templateNameField(page).fill(NEW_TEMPLATE);
  await expect(confirmCreateBtn(page)).toBeEnabled();
  await confirmCreateBtn(page).click();
  await expect(createDialog(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(rightRail(page).getByRole('heading', { name: NEW_TEMPLATE })).toBeVisible({ timeout: 8_000 });
  await expect(railCategory(page, NEW_CATEGORY)).toBeVisible({ timeout: 8_000 });
  await expect(emptyStateCopy(page)).toHaveCount(0);
  await expect(emptyCreateBtn(page)).toHaveCount(0);

  // New template is in the picker (local, no cloud persist).
  await page.getByRole('button', { name: 'Close Survey panel' }).click();
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: NEW_TEMPLATE })).toBeVisible();

  // Original empty module is still empty — modify current so the empty-state goes away.
  await page.getByRole('button', { name: EMPTY_TEMPLATE }).click();
  await expect(emptyStateCopy(page)).toBeVisible({ timeout: 15_000 });
  await openEmptyCreateModal(page);
  await categoryNameField(page).fill(CURRENT_CATEGORY);
  await pickModifyCurrent(page);
  await expect(confirmCreateBtn(page)).toBeEnabled();
  await confirmCreateBtn(page).click();
  await expect(createDialog(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(railCategory(page, CURRENT_CATEGORY)).toBeVisible({ timeout: 8_000 });
  await expect(emptyStateCopy(page)).toHaveCount(0);
  await expect(emptyCreateBtn(page)).toHaveCount(0);

  // Edge: create is not a history checkpoint — undo must not rewind the row.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await expect(railCategory(page, CURRENT_CATEGORY)).toBeVisible();

  // Break: Pen-armed still starts adding from a fresh empty module (reload seed).
  await openEditor(page);
  await enterEmptyModuleTemplate(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await openEmptyCreateModal(page);
  await categoryNameField(page).fill(PEN_CATEGORY);
  await pickModifyCurrent(page);
  await expect(confirmCreateBtn(page)).toBeEnabled();
  await confirmCreateBtn(page).click();
  await expect(createDialog(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(railCategory(page, PEN_CATEGORY)).toBeVisible({ timeout: 8_000 });
  await expect(emptyStateCopy(page)).toHaveCount(0);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — empty-state copy exists; start-adding + dialog are desktop-only.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: EMPTY_TEMPLATE }).click();
  await expect(page.getByText('No categories available for this space.')).toBeVisible({ timeout: 15_000 });
  const mobile = {
    emptyCreateCount: await page.locator('.survey-marker-empty-module-create-button').count(),
    createDialogCount: await createDialog(page).count(),
  };
  expect(mobile.emptyCreateCount, '390 has no empty-module Create button').toBe(0);
  expect(mobile.createDialogCount, '390 has no Create category dialog').toBe(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_EMPTY_CREATE_TEMPLATE_PROOF', JSON.stringify({
    newTemplate: NEW_TEMPLATE,
    newTemplateCategory: NEW_CATEGORY,
    currentCategory: CURRENT_CATEGORY,
    penCategory: PEN_CATEGORY,
    emptyDisabled: true,
    duplicateTemplateBlocked: true,
    cancelKeptEmpty: true,
    templateAppeared: true,
    emptyStateGone: true,
    undoDidNotRewindCreate: true,
    penArmedStillCreates: true,
    persist,
    mobile,
  }));
});
