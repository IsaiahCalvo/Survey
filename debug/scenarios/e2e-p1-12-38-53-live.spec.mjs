import { test, expect } from '@playwright/test';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page) {
  await page.goto(LINK_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter((id) => id && !/^\d+R$/i.test(id));
    return [...new Set(ids)].filter((id) => window.__phase35GetAnnotationById?.(id)?.isPdfImported !== true);
  }, pageNumber);
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    const pressed = await sub.first().getAttribute('aria-pressed');
    if (pressed !== 'true') await sub.first().click();
    return;
  }
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0 || !(await tool.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : tool.first();
  const pressed = await target.getAttribute('aria-pressed');
  if (pressed !== 'true') await target.click();
}

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }) {
  const before = new Set(await userAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  let created = null;
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: 'expected a new rect' }).not.toBeNull();
  return created;
}

async function selectStroke(page, id, pageNumber = 1) {
  await page.keyboard.press('v');
  const target = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + Math.min(8, box.width / 2), box.y + Math.max(2, box.height / 2));
}

async function dismissMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

async function openFillPicker(page) {
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.count()) await fillTab.click();
}

async function openStrokePicker(page) {
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const borderTab = page.getByRole('button', { name: 'Border', exact: true }).first();
  await expect(borderTab).toBeVisible();
  await borderTab.click();
  await expect(page.locator('button[title="Match fill"]')).toBeVisible({ timeout: 8_000 });
}

async function setOpacityPercent(page, value) {
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true })
    .or(page.getByRole('textbox', { name: 'Opacity percentage', exact: true }));
  await expect(field).toBeVisible();
  await field.fill(String(value));
  await field.press('Enter');
}

async function matchFillSelected(page) {
  return page.locator('button[title="Match fill"]').first().evaluate((el) => {
    const style = el.getAttribute('style') || '';
    return style.includes('2px solid white') || getComputedStyle(el).borderTopWidth === '2px';
  });
}

async function historyState(page) {
  return page.evaluate(() => {
    const debug = window.__pdfHistoryDebug;
    const stacks = debug?.getStacks?.() || { undo: [], redo: [] };
    const state = debug?.state?.() || {};
    const timeline = debug?.getTimeline?.(40) || [];
    return {
      undoDepth: state.undoDepth ?? stacks.undo.length,
      redoDepth: state.redoDepth ?? stacks.redo.length,
      localUndoDepth: state.localAnnotationUndoDepth ?? 0,
      topUndoReason: stacks.undo[stacks.undo.length - 1]?.reason || null,
      lastLegacyUndo: [...timeline].reverse().find((event) => event.type === 'legacy_annotation_undo_applied') || null,
      lastUndoChoice: [...timeline].reverse().find((event) => event.type === 'undo_choice') || null,
    };
  });
}

async function pushHistory(page, reason) {
  await expect.poll(() => page.evaluate(() => typeof window.__test_addHistoryCheckpoint)).toBe('function');
  await page.evaluate((nextReason) => window.__test_addHistoryCheckpoint(nextReason), reason);
}

async function clickToolbarUndo(page) {
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
}

test('P1-12 excel: history is undoable; unknown reasons no-op; annotation stays isolated', async ({ page }) => {
  await openEditor(page);
  await expect.poll(() => page.evaluate(() => typeof window.__pdfHistoryDebug?.state)).toBe('function');

  const rectId = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.38, y1: 0.40 });
  await expect.poll(async () => (await userAnnotationIds(page)).includes(rectId)).toBeTruthy();
  const afterRect = await historyState(page);

  // Intended: excel-tagged push makes toolbar Undo a real pop.
  await pushHistory(page, 'excel:auto-sync');
  const afterExcel = await historyState(page);
  expect(afterExcel.topUndoReason).toBe('excel:auto-sync');
  expect(afterExcel.undoDepth).toBeGreaterThan(afterRect.undoDepth);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await clickToolbarUndo(page);
  await expect.poll(async () => (await historyState(page)).topUndoReason).not.toBe('excel:auto-sync');
  const afterExcelUndo = await historyState(page);
  expect(afterExcelUndo.undoDepth).toBe(afterRect.undoDepth);
  expect(afterExcelUndo.lastLegacyUndo?.reason).toBe('excel:auto-sync');
  expect((await userAnnotationIds(page)).includes(rectId), 'excel undo must not wipe the rect').toBeTruthy();

  // Edge: excel: prefix variant still pops; annotation undo stays a separate lane.
  await pushHistory(page, 'excel:manual-sync');
  await expect.poll(async () => (await historyState(page)).topUndoReason).toBe('excel:manual-sync');
  await clickToolbarUndo(page);
  await expect.poll(async () => (await historyState(page)).topUndoReason).not.toBe('excel:manual-sync');
  expect((await historyState(page)).lastLegacyUndo?.reason).toBe('excel:manual-sync');
  expect((await userAnnotationIds(page)).includes(rectId), 'excel:manual-sync undo stays isolated from the rect').toBeTruthy();

  await clickToolbarUndo(page);
  await expect.poll(async () => (await userAnnotationIds(page)).includes(rectId)).toBeFalsy();

  // Break: unknown / empty reasons stay ineligible and click no-ops safely.
  const afterAnnotationUndo = await historyState(page);
  await pushHistory(page, 'zoom:fit');
  const afterZoom = await historyState(page);
  expect(afterZoom.topUndoReason).toBe('zoom:fit');
  await clickToolbarUndo(page);
  const afterZoomUndo = await historyState(page);
  expect(afterZoomUndo.topUndoReason).toBe('zoom:fit');
  expect(afterZoomUndo.undoDepth).toBe(afterZoom.undoDepth);
  expect(afterZoomUndo.lastUndoChoice?.chosenSource === 'none'
    || afterZoomUndo.lastUndoChoice?.chosenSource === 'Yjs/CRDT history').toBeTruthy();

  await pushHistory(page, '');
  const afterEmpty = await historyState(page);
  expect(afterEmpty.topUndoReason === 'unspecified' || afterEmpty.topUndoReason === '').toBeTruthy();
  await clickToolbarUndo(page);
  const afterEmptyUndo = await historyState(page);
  expect(afterEmptyUndo.undoDepth).toBe(afterEmpty.undoDepth);
  expect(afterEmptyUndo.undoDepth).toBeGreaterThan(afterAnnotationUndo.undoDepth);

  console.log('P1_12_PROOF', JSON.stringify({
    excelAutoSyncPopped: true,
    unknownNoop: true,
    excelManualIsolated: true,
    annotationUndoAfterExcel: true,
  }));
});

test('P1-38 Match Fill ring follows fill opacity ±1, not >= 99', async ({ page }) => {
  await openEditor(page);
  const rectId = await createRect(page, { x0: 0.24, y0: 0.26, x1: 0.46, y1: 0.46 });
  await selectStroke(page, rectId);

  await openFillPicker(page);
  await page.locator('button[title="#00FFFF"]').first().click();
  await setOpacityPercent(page, 50);
  await dismissMenus(page);

  // Break: same-session Border tab, fill 50 / stroke still ~100 → ring off.
  await selectStroke(page, rectId);
  await openStrokePicker(page);
  expect(await matchFillSelected(page), 'mismatched opacities must leave Match Fill unselected').toBeFalsy();

  // Intended: Match Fill copies the translucent fill; ring on at 50, not only 99+.
  await page.locator('button[title="Match fill"]').first().click();
  await expect.poll(async () => matchFillSelected(page), {
    message: 'Match Fill ring should be on when stroke matches fill at 50%',
  }).toBeTruthy();
  await dismissMenus(page);

  // Edge: fill 51 / stroke 50 → on; fill 48 / stroke 50 → off.
  await selectStroke(page, rectId);
  await openFillPicker(page);
  await setOpacityPercent(page, 51);
  await dismissMenus(page);
  await selectStroke(page, rectId);
  await openStrokePicker(page);
  expect(await matchFillSelected(page), '±1 (50 vs 51) must keep the ring on').toBeTruthy();
  await dismissMenus(page);

  await selectStroke(page, rectId);
  await openFillPicker(page);
  await setOpacityPercent(page, 48);
  await dismissMenus(page);
  await selectStroke(page, rectId);
  await openStrokePicker(page);
  expect(await matchFillSelected(page), '50 vs 48 is outside ±1 so the ring must be off').toBeFalsy();
  await dismissMenus(page);

  console.log('P1_38_PROOF', JSON.stringify({
    mismatchOff: true,
    matchAt50On: true,
    plusOneOn: true,
    outsideMinusTwoOff: true,
  }));
});

test('P1-53 pending+N is Saving, not Offline; real offline stays Offline', async ({ page }) => {
  await openEditor(page);
  await expect.poll(() => page.evaluate(() => typeof window.__test_setSyncChipPreview)).toBe('function');

  const chip = page.locator('[data-sync-chip-preview]');

  // Intended: pending + queue depth is pending/syncing, not Offline.
  await page.evaluate(() => window.__test_setSyncChipPreview({
    status: { stage: 'pending' },
    queueSize: 3,
  }));
  await expect(chip).toBeVisible();
  await expect(chip.getByText('Saving...')).toBeVisible();
  await expect(chip.getByText(/Offline/)).toHaveCount(0);
  await chip.getByRole('button').click();
  await expect(page.locator('[data-sync-message]')).toContainText(/saved locally and backing up now/i);

  // Edge: pending+0 is the same Saving label; not Offline.
  await page.evaluate(() => window.__test_setSyncChipPreview({
    status: { stage: 'pending' },
    queueSize: 0,
  }));
  await expect(chip.getByText('Saving...')).toBeVisible();
  await expect(chip.getByText(/Offline/)).toHaveCount(0);

  // Break: real offline / queued+N still Offline.
  await page.evaluate(() => window.__test_setSyncChipPreview({
    status: { stage: 'idle' },
    queueSize: 3,
  }));
  await expect(chip.getByText('Offline · 3 saved locally')).toBeVisible();
  await expect(chip.getByText('Saving...')).toHaveCount(0);

  await page.evaluate(() => window.__test_setSyncChipPreview({
    status: { stage: 'error', error: 'network offline' },
    queueSize: 2,
  }));
  await expect(chip.getByText('Offline · 2 saved locally')).toBeVisible();

  console.log('P1_53_PROOF', JSON.stringify({
    pendingPlus3Saving: true,
    pendingPlus0Saving: true,
    idlePlus3Offline: true,
    errorPlus2Offline: true,
  }));
});
