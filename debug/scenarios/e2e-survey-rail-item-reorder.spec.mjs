import { test, expect } from '@playwright/test';

// Unique leftover after survey-rail category reorder:
// SortableRearrangeList inside an expanded category →
// reorderSurveyMarkersInCategory. Not category reorder. Not Create
// category. Not category Delete. Not item Delete as the GAP. Not
// Rename. Not overlay Delete. Not Move/Copy stub. Not checklist
// Y/N/N-A. Not Copy-to-space. UL-31 Continue pin stays parked.
// Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const KAL436 = /KAL-436 Preservation Template/;

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

function itemRow(page, name) {
  return rightRail(page).locator('[id^="highlight-item-"]').filter({
    has: page.getByRole('textbox', { name: `Rename ${name}` }),
  });
}

function itemHandle(page, name) {
  return itemRow(page, name).locator('[data-drag-rearrange-handle]');
}

function deleteSelectedBtn(page) {
  return page.getByRole('button', { name: 'Delete selected items' });
}

function confirmDialog(page) {
  return page.getByRole('dialog').filter({ hasText: /Delete \d+ items?/ });
}

async function railItemNames(page) {
  return rightRail(page).locator('[id^="highlight-item-"] .survey-marker-name-inline').evaluateAll((els) => (
    els.map((el) => (el.value || '').trim()).filter(Boolean)
  ));
}

async function storedItemNames(page) {
  return page.evaluate(() => {
    const rows = window.__e2eSurveyItemOrder?.get?.();
    return Array.isArray(rows) ? rows.map((row) => row.name) : [];
  });
}

async function storedItemOrders(page) {
  return page.evaluate(() => {
    const rows = window.__e2eSurveyItemOrder?.get?.();
    return Array.isArray(rows) ? rows.map((row) => ({
      name: row.name,
      id: row.id,
      surveyMarkerOrder: row.surveyMarkerOrder,
    })) : [];
  });
}

async function enterSurveyWalls(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
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
      await page.getByRole('button', { name: KAL436 }).click();
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
  if (await itemHandle(page, 'item-a').isVisible().catch(() => false)) return;
  if (await itemHandle(page, 'item-b').isVisible().catch(() => false)) return;
  const notes = page.getByRole('button', { name: /item notes/ });
  if (await notes.count() && await notes.first().isVisible().catch(() => false)) return;
  const arrow = rightRail(page).locator('.survey-marker-category-arrow').first();
  await expect(arrow).toBeVisible({ timeout: 10_000 });
  await arrow.click();
  await expect(rightRail(page).locator('[id^="highlight-item-"]').first()).toBeVisible({ timeout: 8_000 });
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

async function exitItemSelectMode(page) {
  const done = rightRail(page).locator('.survey-marker-inline-select-row').getByRole('button', { name: 'Done', exact: true });
  if (await done.count() && await done.first().isVisible().catch(() => false)) {
    await done.first().click();
  }
}

async function selectRailItem(page, name) {
  const deselect = page.getByRole('button', { name: `Deselect ${name}` });
  if (await deselect.count() && await deselect.first().isVisible().catch(() => false)) return;
  const select = page.getByRole('button', { name: `Select ${name}` });
  await expect(select).toBeVisible({ timeout: 8_000 });
  await select.click();
  await expect(page.getByRole('button', { name: `Deselect ${name}` })).toBeVisible({ timeout: 8_000 });
}

async function pointerDragItemTo(page, fromName, toName, { cancel = false } = {}) {
  const handle = itemHandle(page, fromName);
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const fromBox = await handle.boundingBox();
  const toBox = await itemRow(page, toName).boundingBox();
  expect(fromBox && toBox, `${fromName} → ${toName} drag geometry`).toBeTruthy();
  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const destX = toBox.x + Math.min(24, toBox.width / 2);
  const destY = toName === fromName
    ? startY + 48
    : (toBox.y > startY ? toBox.y + toBox.height + 8 : toBox.y + 6);
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

async function keyboardMoveItem(page, fromName, { direction = 'down', cancel = false } = {}) {
  const handle = itemHandle(page, fromName);
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

async function dragItemTo(page, fromName, toName, { cancel = false } = {}) {
  const before = await railItemNames(page);
  const direction = (() => {
    const fromIdx = before.indexOf(fromName);
    const toIdx = before.indexOf(toName);
    if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx) return 'up';
    return 'down';
  })();
  try {
    return await keyboardMoveItem(page, fromName, { direction, cancel });
  } catch {
    await pointerDragItemTo(page, fromName, toName, { cancel });
    return 'pointer';
  }
}

test('survey-rail item reorder intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  const markerA = await placeMarker(page, 'item-a', { x0: 0.22, y0: 0.34, x1: 0.46, y1: 0.54 });
  const markerB = await placeMarker(page, 'item-b', { x0: 0.56, y0: 0.28, x1: 0.78, y1: 0.46 });
  expect((await markerIds(page)).length, 'A+B placed').toBe(2);

  await expandWallsMarkers(page);
  await expect(itemHandle(page, 'item-a')).toBeVisible({ timeout: 8_000 });
  await expect(itemHandle(page, 'item-b')).toBeVisible();
  expect(await rightRail(page).getByRole('button', { name: /Move (up|down)/i }).count(), 'no item up-down').toBe(0);

  const initialNames = await railItemNames(page);
  expect(initialNames.slice().sort(), 'both named items on the rail').toEqual(['item-a', 'item-b']);
  const firstName = initialNames[0];
  const secondName = initialNames[1];
  expect(firstName && secondName && firstName !== secondName, 'two distinct rail items').toBeTruthy();
  const firstId = firstName === 'item-a' ? markerA : markerB;
  const secondId = secondName === 'item-a' ? markerA : markerB;

  await expect.poll(async () => storedItemNames(page)).toEqual(initialNames);

  // Break: Escape mid-drag cancels; first stays first.
  const cancelMethod = await dragItemTo(page, firstName, secondName, { cancel: true });
  await expect.poll(async () => railItemNames(page)).toEqual(initialNames);
  await expect.poll(async () => storedItemNames(page)).toEqual(initialNames);

  // Intended: drop first onto second so the first is no longer first.
  const intendedMethod = await dragItemTo(page, firstName, secondName);
  const swapped = [secondName, firstName];
  await expect.poll(async () => railItemNames(page)).toEqual(swapped);
  await expect.poll(async () => storedItemNames(page)).toEqual(swapped);
  const afterSwap = await storedItemOrders(page);
  expect(afterSwap.map((row) => row.name), 'stored names after swap').toEqual(swapped);
  expect(afterSwap.map((row) => row.surveyMarkerOrder), '1-based surveyMarkerOrder').toEqual([1, 2]);
  expect(afterSwap.map((row) => row.id), 'ids follow the new rail order').toEqual([secondId, firstId]);

  // Edge: reorder is a history checkpoint — undo restores prior order; both stay.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await expandWallsMarkers(page);
  await expect.poll(async () => ({
    rail: await railItemNames(page),
    stored: await storedItemNames(page),
    a: (await markerIds(page)).includes(markerA),
    b: (await markerIds(page)).includes(markerB),
  }), { message: 'undo restores prior item order and keeps both markers' }).toEqual({
    rail: initialNames,
    stored: initialNames,
    a: true,
    b: true,
  });

  // Break: Pen-armed still reorders (first under second again).
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await expandWallsMarkers(page);
  const penMethod = await dragItemTo(page, firstName, secondName);
  await expect.poll(async () => railItemNames(page)).toEqual(swapped);
  await expect.poll(async () => storedItemNames(page)).toEqual(swapped);

  // Edge: Delete selected items still targets the selected id after reorder.
  await enterItemSelectMode(page);
  await selectRailItem(page, secondName);
  await expect(deleteSelectedBtn(page)).toBeEnabled();
  await deleteSelectedBtn(page).click();
  const oneDialog = confirmDialog(page);
  await expect(oneDialog).toBeVisible({ timeout: 8_000 });
  await oneDialog.getByRole('button', { name: 'Delete 1 item', exact: true }).click();
  await expect.poll(async () => ({
    ids: await markerIds(page),
    rail: await railItemNames(page),
    stored: await storedItemNames(page),
  }), { message: 'delete after reorder wipes the selected id only' }).toEqual({
    ids: [firstId],
    rail: [firstName],
    stored: [firstName],
  });
  expect((await markerIds(page)).includes(secondId), 'deleted the reordered-first id').toBe(false);

  await exitItemSelectMode(page);

  // Break: single-item category — handle stays, self-drag is a no-op.
  await expandWallsMarkers(page);
  await expect(itemHandle(page, firstName)).toBeVisible();
  await dragItemTo(page, firstName, firstName);
  await expect.poll(async () => railItemNames(page)).toEqual([firstName]);
  await expect.poll(async () => storedItemNames(page)).toEqual([firstName]);
  expect((await markerIds(page)).includes(firstId), 'self-drag keeps the remaining marker').toBe(true);

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
  await page.getByRole('button', { name: KAL436 }).click();
  const walls390 = page.getByRole('button', { name: /Walls/ }).first();
  await expect(walls390).toBeVisible({ timeout: 15_000 });
  const mobile = {
    handleCount: await page.locator('[data-drag-rearrange-handle]').count(),
    upDownCount: await page.getByRole('button', { name: /Move (up|down)/i }).count(),
  };
  expect(mobile.handleCount, '390 has no item drag handle').toBe(0);
  expect(mobile.upDownCount, '390 has no item up-down').toBe(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_RAIL_ITEM_REORDER_PROOF', JSON.stringify({
    initialNames,
    intended: swapped,
    intendedMethod,
    cancelMethod,
    penMethod,
    cancelKeptFirst: true,
    penArmedReordered: true,
    undoRestoredOrder: true,
    deleteSelectedAfterReorder: true,
    singleItemNoOp: true,
    persist,
    mobile,
  }));
});
