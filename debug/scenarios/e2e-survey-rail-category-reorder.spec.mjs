import { test, expect } from '@playwright/test';

// Unique leftover after empty-module Create template:
// survey-rail SortableRearrangeList → handleReorderSurveyCategories.
// Desktop drag handle only (no up-down). Not Create category. Not
// category Delete as the GAP (compose-edge only). Not item reorder.
// Not Move/Copy stub. Not checklist Y/N/N-A. Not Copy-to-space.
// UL-31 Continue pin stays parked. Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const TWO_CAT_TEMPLATE = /Two Category Template/;
const KAL436_TEMPLATE = /KAL-436 Preservation Template/;

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

function categoryRow(page, name) {
  return rightRail(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator('.survey-marker-category-main-label', { hasText: new RegExp(`^${name}$`) }),
  });
}

function categoryHandle(page, name) {
  return categoryRow(page, name).locator('[data-drag-rearrange-handle]');
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

async function railCategoryNames(page) {
  return rightRail(page).locator('.survey-marker-category-main-label').evaluateAll((els) => (
    els.map((el) => (el.textContent || '').trim()).filter(Boolean)
  ));
}

async function storedCategoryNames(page) {
  return page.evaluate(() => {
    const rows = window.__e2eSurveyCategoryOrder?.get?.();
    return Array.isArray(rows) ? rows.map((row) => row.name) : [];
  });
}

async function storedCategoryIds(page) {
  return page.evaluate(() => {
    const rows = window.__e2eSurveyCategoryOrder?.get?.();
    return Array.isArray(rows) ? rows.map((row) => row.id) : [];
  });
}

async function enterSurveyTemplate(page, nameRe) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: nameRe }).click();
}

async function openSurveyRail(page, nameRe = TWO_CAT_TEMPLATE) {
  if (await categoryHandle(page, 'Walls').isVisible().catch(() => false)) return;
  const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
  if (await survey.count()) await survey.click();
  const picker = page.getByRole('heading', { name: 'Choose survey template' });
  if (await picker.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: nameRe }).click();
  }
  await expect(categoryRow(page, 'Walls')).toBeVisible({ timeout: 10_000 });
}

async function pointerDragCategoryTo(page, fromName, toName, { cancel = false } = {}) {
  const handle = categoryHandle(page, fromName);
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const fromBox = await handle.boundingBox();
  const toBox = await categoryRow(page, toName).boundingBox();
  expect(fromBox && toBox, `${fromName} → ${toName} drag geometry`).toBeTruthy();
  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const destX = toBox.x + Math.min(24, toBox.width / 2);
  const destY = toName === fromName
    ? startY + 80
    : (toBox.y > startY ? toBox.y + toBox.height + 12 : toBox.y + 8);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 12, { steps: 8 });
  await expect(page.locator('body')).toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  await page.mouse.move(destX, destY, { steps: 28 });
  if (cancel) {
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  }
  await page.mouse.up();
}

async function keyboardMoveCategory(page, fromName, { direction = 'down', cancel = false } = {}) {
  const handle = categoryHandle(page, fromName);
  await expect(handle).toBeVisible({ timeout: 8_000 });
  await handle.click();
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  await page.keyboard.press(direction === 'down' ? 'ArrowDown' : 'ArrowUp');
  if (cancel) {
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
    return 'keyboard';
  }
  await page.keyboard.press('Space');
  await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  return 'keyboard';
}

async function dragCategoryTo(page, fromName, toName, { cancel = false } = {}) {
  const before = await railCategoryNames(page);
  const direction = (() => {
    const fromIdx = before.indexOf(fromName);
    const toIdx = before.indexOf(toName);
    if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx) return 'up';
    return 'down';
  })();
  try {
    return await keyboardMoveCategory(page, fromName, { direction, cancel });
  } catch {
    await pointerDragCategoryTo(page, fromName, toName, { cancel });
    return 'pointer';
  }
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

test('survey-rail category reorder intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyTemplate(page, TWO_CAT_TEMPLATE);
  await expect(categoryRow(page, 'Walls')).toBeVisible({ timeout: 15_000 });
  await expect(categoryRow(page, 'Windows')).toBeVisible();
  await expect.poll(async () => railCategoryNames(page)).toEqual(['Walls', 'Windows']);
  await expect.poll(async () => storedCategoryNames(page)).toEqual(['Walls', 'Windows']);
  await expect.poll(async () => storedCategoryIds(page)).toEqual([
    'kal436-two-cat-walls',
    'kal436-two-cat-windows',
  ]);
  await expect(categoryHandle(page, 'Walls')).toBeVisible();
  await expect(categoryHandle(page, 'Windows')).toBeVisible();
  expect(await rightRail(page).getByRole('button', { name: /Move (up|down)/i }).count(), 'no category up-down').toBe(0);

  // Break: Escape mid-drag cancels; Walls stays first.
  await dragCategoryTo(page, 'Walls', 'Windows', { cancel: true });
  await expect.poll(async () => railCategoryNames(page)).toEqual(['Walls', 'Windows']);
  await expect.poll(async () => storedCategoryNames(page)).toEqual(['Walls', 'Windows']);

  // Intended: drop Walls onto Windows so Walls is no longer first.
  await dragCategoryTo(page, 'Walls', 'Windows');
  await expect.poll(async () => railCategoryNames(page)).toEqual(['Windows', 'Walls']);
  await expect.poll(async () => storedCategoryNames(page)).toEqual(['Windows', 'Walls']);
  await expect.poll(async () => storedCategoryIds(page)).toEqual([
    'kal436-two-cat-windows',
    'kal436-two-cat-walls',
  ]);

  // Edge: reorder is not a history checkpoint — undo must not rewind order.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await openSurveyRail(page);
  await expect.poll(async () => railCategoryNames(page)).toEqual(['Windows', 'Walls']);
  await expect.poll(async () => storedCategoryNames(page)).toEqual(['Windows', 'Walls']);

  // Break: Pen-armed still reorders (Windows back below Walls).
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await openSurveyRail(page);
  await dragCategoryTo(page, 'Windows', 'Walls');
  await expect.poll(async () => railCategoryNames(page)).toEqual(['Walls', 'Windows']);
  await expect.poll(async () => storedCategoryNames(page)).toEqual(['Walls', 'Windows']);

  // Edge: Delete selected categories still targets the selected id after reorder.
  await enterCategorySelectMode(page);
  await selectCategory(page, 'Windows');
  await expect(deleteCategoriesBtn(page)).toBeEnabled();
  await deleteCategoriesBtn(page).click();
  const oneDialog = confirmDeleteDialog(page);
  await expect(oneDialog).toBeVisible({ timeout: 8_000 });
  await oneDialog.getByRole('button', { name: 'Delete category', exact: true }).click();
  await expect(categoryRow(page, 'Windows')).toHaveCount(0, { timeout: 8_000 });
  await expect.poll(async () => railCategoryNames(page)).toEqual(['Walls']);
  await expect.poll(async () => storedCategoryNames(page)).toEqual(['Walls']);
  await expect.poll(async () => storedCategoryIds(page)).toEqual(['kal436-two-cat-walls']);

  // Break: single-category list — handle stays, self-drag is a no-op.
  await expect(categoryHandle(page, 'Walls')).toBeVisible();
  await dragCategoryTo(page, 'Walls', 'Walls');
  await expect.poll(async () => railCategoryNames(page)).toEqual(['Walls']);
  await expect.poll(async () => storedCategoryIds(page)).toEqual(['kal436-two-cat-walls']);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — no drag handle and no up-down (desktop-only reorder).
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  const walls390 = page.getByRole('button', { name: /Walls/ }).first();
  await expect(walls390).toBeVisible({ timeout: 15_000 });
  const windows390 = page.getByRole('button', { name: /Windows/ }).first();
  await expect(windows390).toBeVisible();
  const mobile = {
    handleCount: await page.locator('[data-drag-rearrange-handle]').count(),
    upDownCount: await page.getByRole('button', { name: /Move (up|down)/i }).count(),
    kal436AlsoSingle: false,
  };
  expect(mobile.handleCount, '390 has no category drag handle').toBe(0);
  expect(mobile.upDownCount, '390 has no category up-down').toBe(0);

  await page.getByRole('button', { name: 'Choose survey template' }).click();
  await page.getByRole('button', { name: KAL436_TEMPLATE }).click();
  await expect(page.getByRole('button', { name: /Walls/ }).first()).toBeVisible({ timeout: 15_000 });
  mobile.kal436AlsoSingle = (await page.locator('[data-drag-rearrange-handle]').count()) === 0;
  expect(mobile.kal436AlsoSingle, '390 KAL-436 also has no handle').toBe(true);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_RAIL_CATEGORY_REORDER_PROOF', JSON.stringify({
    intended: ['Windows', 'Walls'],
    cancelKeptWallsFirst: true,
    penArmedReordered: true,
    undoDidNotRewind: true,
    deleteSelectedWindows: true,
    singleCategoryNoOp: true,
    persist,
    mobile,
  }));
});
