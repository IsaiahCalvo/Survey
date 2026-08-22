import { test, expect } from '@playwright/test';

// Unique leftover after overlay Delete Survey Marker + Select Backspace/Delete:
// survey-rail `aria-label="Delete selected items"` + confirm →
// handleDeleteSurveyMarkerItem. Not overlay Delete. Not E-04 rect Backspace.
// Not counter-series Delete. Not U-01 stamp. Not handle drag. Not Keep /
// notes / module nav as the GAP. UL-31 Continue pin stays parked.
// Leftover-18 parked. No file.id.

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

function deleteSelectedBtn(page) {
  return page.getByRole('button', { name: 'Delete selected items' });
}

function confirmDialog(page) {
  return page.getByRole('dialog').filter({ hasText: /Delete \d+ items?/ });
}

async function enterSurveyWalls(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
}

async function armWalls(page) {
  const hostWalls = () => page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (!(await hostWalls().count()) || !(await hostWalls().first().isVisible().catch(() => false))) {
    const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
    if (await survey.count()) await survey.click();
    const picker = page.getByRole('heading', { name: 'Choose survey template' });
    if (await picker.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
    }
  }
  const walls = (await hostWalls().count())
    ? hostWalls()
    : page.getByRole('button', { name: 'Walls', exact: true });
  await expect(walls.first()).toBeVisible({ timeout: 15_000 });
  if (!String(await walls.first().getAttribute('class') || '').includes('btn-active')) {
    await walls.first().click();
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

async function placeMarker(page, name, coords) {
  const before = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, coords);
  await finishMarkerName(page, name);
  let created = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected committed survey-marker ${name}` }).not.toBeNull();
  return created;
}

async function expandWallsMarkers(page) {
  const notes = page.getByRole('button', { name: /item notes/ });
  if (await notes.count() && await notes.first().isVisible().catch(() => false)) return;
  const arrow = rightRail(page).locator('.survey-marker-category-arrow').first();
  await expect(arrow).toBeVisible({ timeout: 10_000 });
  await arrow.click();
  await expect(page.getByRole('button', { name: /item notes/ }).first()).toBeVisible({ timeout: 8_000 });
}

async function enterItemSelectMode(page) {
  await expandWallsMarkers(page);
  const done = rightRail(page).locator('.survey-marker-inline-select-row').getByRole('button', { name: 'Done', exact: true });
  if (await done.count() && await done.first().isVisible().catch(() => false)) return;
  const select = rightRail(page).locator('.survey-marker-inline-select-row').getByRole('button', { name: 'Select', exact: true });
  await expect(select).toBeVisible({ timeout: 8_000 });
  await select.click();
  await expect(deleteSelectedBtn(page)).toBeVisible({ timeout: 8_000 });
}

async function selectRailItem(page, name) {
  const deselect = page.getByRole('button', { name: `Deselect ${name}` });
  if (await deselect.count() && await deselect.first().isVisible().catch(() => false)) return;
  const select = page.getByRole('button', { name: `Select ${name}` });
  await expect(select).toBeVisible({ timeout: 8_000 });
  await select.click();
  await expect(page.getByRole('button', { name: `Deselect ${name}` })).toBeVisible({ timeout: 8_000 });
}

test('survey-rail Delete selected items intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  const markerA = await placeMarker(page, 'rail-a', { x0: 0.22, y0: 0.34, x1: 0.46, y1: 0.54 });
  const markerB = await placeMarker(page, 'rail-b', { x0: 0.56, y0: 0.28, x1: 0.78, y1: 0.46 });
  expect((await markerIds(page)).length, 'A+B placed').toBe(2);

  await enterItemSelectMode(page);

  // Break: none selected — button is present and disabled (not hidden).
  await expect(deleteSelectedBtn(page)).toBeVisible();
  await expect(deleteSelectedBtn(page)).toBeDisabled();
  expect((await markerIds(page)).length, 'disabled delete does not remove').toBe(2);

  // Select A.
  await selectRailItem(page, 'rail-a');
  await expect(deleteSelectedBtn(page)).toBeEnabled();

  // Break: cancel confirm — nothing deleted.
  await deleteSelectedBtn(page).click();
  const cancelDialog = confirmDialog(page);
  await expect(cancelDialog).toBeVisible({ timeout: 8_000 });
  await expect(cancelDialog).toContainText('Delete 1 item?');
  await cancelDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmDialog(page)).toHaveCount(0);
  expect((await markerIds(page)).includes(markerA), 'cancel keeps A').toBe(true);
  expect((await markerIds(page)).includes(markerB), 'cancel keeps B').toBe(true);

  // Edge: notes dialog open — full-viewport overlay covers the rail control.
  await page.getByRole('button', { name: 'Add item notes' }).first().click();
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible({ timeout: 8_000 });
  const notesOverlayBlocks = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (node) => node.getAttribute('aria-label') === 'Delete selected items',
    );
    if (!btn) return { present: false, covered: true };
    const box = btn.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      present: true,
      covered: !btn.contains(top) && top !== btn,
      topTag: top?.tagName || null,
    };
  });
  expect(notesOverlayBlocks.present, 'rail Delete still in DOM under notes').toBe(true);
  expect(notesOverlayBlocks.covered, 'notes overlay covers rail Delete').toBe(true);
  expect((await markerIds(page)).includes(markerA), 'notes open does not delete A').toBe(true);
  expect((await markerIds(page)).includes(markerB), 'notes open does not delete B').toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toHaveCount(0);

  // Intended: confirm deletes the selected marker; the other stays.
  await expect(deleteSelectedBtn(page)).toBeEnabled();
  await deleteSelectedBtn(page).click();
  const oneDialog = confirmDialog(page);
  await expect(oneDialog).toBeVisible({ timeout: 8_000 });
  await oneDialog.getByRole('button', { name: 'Delete 1 item', exact: true }).click();
  await expect.poll(async () => (await markerIds(page)).includes(markerA), {
    timeout: 8_000,
    message: 'confirm removes selected marker A',
  }).toBe(false);
  expect((await markerIds(page)).includes(markerB), 'B stays after A rail-delete').toBe(true);

  // Undo restores A if product supports it.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerA), {
    timeout: 8_000,
    message: 'undo restores rail-deleted A',
  }).toBe(true);

  // Break: Pen-armed does not hide or auto-delete; rail confirm still works.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await enterItemSelectMode(page);
  await selectRailItem(page, 'rail-a');
  await expect(deleteSelectedBtn(page)).toBeEnabled();
  expect((await markerIds(page)).includes(markerA), 'Pen-armed does not delete').toBe(true);
  expect((await markerIds(page)).includes(markerB), 'Pen-armed leaves B').toBe(true);
  await deleteSelectedBtn(page).click();
  const penDialog = confirmDialog(page);
  await expect(penDialog).toBeVisible({ timeout: 8_000 });
  await penDialog.getByRole('button', { name: 'Delete 1 item', exact: true }).click();
  await expect.poll(async () => (await markerIds(page)).includes(markerA), {
    timeout: 8_000,
    message: 'Pen-armed rail confirm still deletes A',
  }).toBe(false);
  expect((await markerIds(page)).includes(markerB), 'B stays after Pen-armed rail-delete').toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerA)).toBe(true);

  // Edge: multi-select All then delete both.
  await enterItemSelectMode(page);
  const allBtn = rightRail(page).locator('.survey-marker-select-toolbar').getByRole('button', { name: 'All', exact: true });
  await expect(allBtn).toBeVisible({ timeout: 8_000 });
  await allBtn.click();
  await expect(page.getByRole('button', { name: 'Deselect rail-a' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deselect rail-b' })).toBeVisible();
  await deleteSelectedBtn(page).click();
  const twoDialog = confirmDialog(page);
  await expect(twoDialog).toBeVisible({ timeout: 8_000 });
  await expect(twoDialog).toContainText('Delete 2 items?');
  await twoDialog.getByRole('button', { name: 'Delete 2 items', exact: true }).click();
  await expect.poll(async () => (await markerIds(page)).length, {
    timeout: 8_000,
    message: 'All + confirm removes both markers',
  }).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).length).toBe(2);
  expect((await markerIds(page)).includes(markerA), 'undo restores A after multi-delete').toBe(true);
  expect((await markerIds(page)).includes(markerB), 'undo restores B after multi-delete').toBe(true);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — item Select / Delete selected items is desktop-only (`!mobileMode`).
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  const walls390 = page.getByRole('button', { name: /Walls/ }).first();
  await expect(walls390).toBeVisible({ timeout: 15_000 });
  await walls390.evaluate((el) => el.click());
  const mobile = {
    deleteSelectedCount: await deleteSelectedBtn(page).count(),
    selectToolbarCount: await page.locator('.survey-marker-inline-select-row').count(),
  };
  expect(mobile.deleteSelectedCount, '390 has no Delete selected items').toBe(0);
  expect(mobile.selectToolbarCount, '390 has no item Select toolbar').toBe(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_RAIL_DELETE_SELECTED_PROOF', JSON.stringify({
    markerA,
    markerB,
    noneSelectedDisabled: true,
    cancelKeptBoth: true,
    notesCoveredRail: notesOverlayBlocks,
    confirmedDeletedA: true,
    undoRestoredA: true,
    penArmedStillDeletes: true,
    multiDeletedBoth: true,
    persist,
    mobile,
  }));
});
