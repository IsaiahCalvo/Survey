import { test, expect } from '@playwright/test';

// Unique leftover after survey-rail Rename:
// survey-rail `aria-label="Delete selected categories"` + confirm →
// deleteCategory + marker wipe. Not item Delete selected. Not overlay
// Delete. Not E-04 rect. Not counter-series Delete. Not Rename.
// Category checkboxes (`Select Walls`), not item checkboxes.
// UL-31 Continue pin stays parked. Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

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

function keepCheckbox(page) {
  return page.locator('#chrome-sub-toolbar-host').getByRole('checkbox', { name: 'Keep active' });
}

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

function deleteCategoriesBtn(page) {
  return page.getByRole('button', { name: 'Delete selected categories' });
}

function confirmDialog(page) {
  return page.getByRole('dialog').filter({ hasText: /Delete \d+ categor(y|ies)\?/ });
}

function categorySelectToggle(page) {
  return rightRail(page).locator('.survey-marker-category-select-button');
}

function prevModule(page) {
  return rightRail(page).getByRole('button', { name: 'Previous module', exact: true });
}

function nextModule(page) {
  return rightRail(page).getByRole('button', { name: 'Next module', exact: true });
}

async function enterSurveyWalls(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
}

async function armCategory(page, name) {
  const hostBtn = () => page.locator('#chrome-sub-toolbar-host').getByRole('button', { name, exact: true });
  if (!(await hostBtn().count()) || !(await hostBtn().first().isVisible().catch(() => false))) {
    const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
    if (await survey.count()) await survey.click();
    const picker = page.getByRole('heading', { name: 'Choose survey template' });
    if (await picker.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
    }
  }
  const btn = (await hostBtn().count())
    ? hostBtn()
    : page.getByRole('button', { name, exact: true });
  await expect(btn.first()).toBeVisible({ timeout: 15_000 });
  if (!String(await btn.first().getAttribute('class') || '').includes('btn-active')) {
    await btn.first().click();
  }
}

async function dragOnLayer(page, { x0, y0, x1, y1 }) {
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  expect(box, 'annotation layer geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
  return box;
}

async function finishMarkerName(page, name) {
  const field = page.getByPlaceholder('Enter name');
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0, { timeout: 8_000 });
}

async function markerIds(page) {
  return page.locator('[data-survey-marker-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean),
  );
}

async function placeMarker(page, categoryName, name, coords) {
  const before = new Set(await markerIds(page));
  await armCategory(page, categoryName);
  await dragOnLayer(page, coords);
  await finishMarkerName(page, name);
  let created = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected committed survey-marker ${name} in ${categoryName}` }).not.toBeNull();
  return created;
}

async function openSurveyRail(page) {
  const toggle = categorySelectToggle(page);
  if (await toggle.count() && await toggle.first().isVisible().catch(() => false)) return;
  const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
  if (await survey.count()) await survey.click();
  const picker = page.getByRole('heading', { name: 'Choose survey template' });
  if (await picker.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  }
  await expect(categorySelectToggle(page)).toBeVisible({ timeout: 10_000 });
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

async function goToOtherModule(page) {
  await openSurveyRail(page);
  await expect(nextModule(page)).toBeEnabled({ timeout: 8_000 });
  await nextModule(page).click();
  await expect(page.getByRole('button', { name: 'Doors', exact: true }).first()).toBeVisible({ timeout: 8_000 });
}

async function goToExistingModule(page) {
  await openSurveyRail(page);
  if (await prevModule(page).isEnabled().catch(() => false)) {
    await prevModule(page).click();
  }
  await expect(categorySelectToggle(page)).toBeVisible({ timeout: 8_000 });
}

test('survey-rail Delete selected categories intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  const markerWalls = await placeMarker(page, 'Walls', 'cat-walls', { x0: 0.22, y0: 0.34, x1: 0.46, y1: 0.54 });
  expect((await markerIds(page)).includes(markerWalls), 'Walls marker placed').toBe(true);

  await goToOtherModule(page);
  await page.getByRole('button', { name: 'Doors', exact: true }).first().click();
  const markerDoors = await placeMarker(page, 'Doors', 'cat-doors', { x0: 0.56, y0: 0.28, x1: 0.78, y1: 0.46 });
  expect((await markerIds(page)).includes(markerDoors), 'Doors marker placed').toBe(true);
  // Overlay filters other-module markers; Walls stays in store, not in this DOM.
  expect((await markerIds(page)).includes(markerWalls), 'Other module hides Walls overlay').toBe(false);

  await goToExistingModule(page);
  await expect.poll(async () => (await markerIds(page)).includes(markerWalls), {
    timeout: 8_000,
    message: 'Existing module shows Walls marker again',
  }).toBe(true);

  await enterCategorySelectMode(page);

  // Break: none selected — button is present and disabled (not hidden).
  await expect(deleteCategoriesBtn(page)).toBeVisible();
  await expect(deleteCategoriesBtn(page)).toBeDisabled();
  expect((await markerIds(page)).includes(markerWalls), 'disabled delete does not remove').toBe(true);
  await expect(page.getByRole('button', { name: 'Walls', exact: true }).first()).toBeVisible();

  // Select Walls (category checkbox, not item Select).
  await selectCategory(page, 'Walls');
  await expect(deleteCategoriesBtn(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Select cat-walls' })).toHaveCount(0);

  // Break: cancel confirm — category and markers stay.
  await deleteCategoriesBtn(page).click();
  const cancelDialog = confirmDialog(page);
  await expect(cancelDialog).toBeVisible({ timeout: 8_000 });
  await expect(cancelDialog).toContainText('Delete 1 category?');
  await cancelDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmDialog(page)).toHaveCount(0);
  expect((await markerIds(page)).includes(markerWalls), 'cancel keeps Walls marker').toBe(true);
  await expect(page.getByRole('button', { name: 'Walls', exact: true }).first()).toBeVisible();

  // Intended: confirm deletes Walls + its markers; Doors stays (other module).
  await expect(deleteCategoriesBtn(page)).toBeEnabled();
  await deleteCategoriesBtn(page).click();
  const oneDialog = confirmDialog(page);
  await expect(oneDialog).toBeVisible({ timeout: 8_000 });
  await oneDialog.getByRole('button', { name: 'Delete category', exact: true }).click();
  await expect.poll(async () => (await markerIds(page)).includes(markerWalls), {
    timeout: 8_000,
    message: 'confirm wipes Walls marker',
  }).toBe(false);
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toHaveCount(0);

  // Edge: last remaining category in Existing is allowed (Walls was the only one).
  await expect(categorySelectToggle(page)).toBeVisible();

  await goToOtherModule(page);
  await expect.poll(async () => (await markerIds(page)).includes(markerDoors), {
    timeout: 8_000,
    message: 'Doors marker stays after Walls category-delete',
  }).toBe(true);
  await goToExistingModule(page);

  // Edge: undo restores category + markers if product supports it.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerWalls), {
    timeout: 8_000,
    message: 'undo restores Walls marker',
  }).toBe(true);
  await expect(page.getByRole('button', { name: 'Walls', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await goToOtherModule(page);
  await expect.poll(async () => (await markerIds(page)).includes(markerDoors), {
    timeout: 8_000,
    message: 'undo keeps Doors marker',
  }).toBe(true);
  await goToExistingModule(page);

  // Break: Pen-armed does not hide or auto-delete; rail confirm still works.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await enterCategorySelectMode(page);
  await selectCategory(page, 'Walls');
  await expect(deleteCategoriesBtn(page)).toBeEnabled();
  expect((await markerIds(page)).includes(markerWalls), 'Pen-armed does not delete').toBe(true);
  await deleteCategoriesBtn(page).click();
  const penDialog = confirmDialog(page);
  await expect(penDialog).toBeVisible({ timeout: 8_000 });
  await penDialog.getByRole('button', { name: 'Delete category', exact: true }).click();
  await expect.poll(async () => (await markerIds(page)).includes(markerWalls), {
    timeout: 8_000,
    message: 'Pen-armed rail confirm still wipes Walls',
  }).toBe(false);
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toHaveCount(0);
  await goToOtherModule(page);
  await expect.poll(async () => (await markerIds(page)).includes(markerDoors), {
    timeout: 8_000,
    message: 'Doors stays after Pen-armed category-delete',
  }).toBe(true);
  await goToExistingModule(page);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerWalls)).toBe(true);
  await expect(page.getByRole('button', { name: 'Walls', exact: true }).first()).toBeVisible();

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — category Select / Delete selected categories is desktop-only.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  const walls390 = page.getByRole('button', { name: /Walls/ }).first();
  await expect(walls390).toBeVisible({ timeout: 15_000 });
  await walls390.evaluate((el) => el.click());
  const mobile = {
    deleteCategoriesCount: await deleteCategoriesBtn(page).count(),
    categorySelectCount: await page.locator('.survey-marker-category-select-button').count(),
  };
  expect(mobile.deleteCategoriesCount, '390 has no Delete selected categories').toBe(0);
  expect(mobile.categorySelectCount, '390 has no category Select toolbar').toBe(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_RAIL_DELETE_CATEGORIES_PROOF', JSON.stringify({
    markerWalls,
    markerDoors,
    noneSelectedDisabled: true,
    cancelKeptBoth: true,
    confirmedWipedWalls: true,
    doorsStayed: true,
    lastRemainingAllowed: true,
    undoRestoredWalls: true,
    penArmedStillDeletes: true,
    persist,
    mobile,
  }));
});
