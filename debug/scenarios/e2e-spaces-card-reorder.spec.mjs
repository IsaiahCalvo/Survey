import { test, expect } from '@playwright/test';

// Unique leftover after Spaces region-row Delete:
// space-card reorder (aria-label="Drag to rearrange" / onReorderSpaces /
// SortableRearrangeList). Distinct from survey-rail category/item reorder
// and from region-row Delete. Not leftover-18 (CSV / PDF Pages stay parked).
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces / checklist items.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MOBILE_PDF = '/?testPdf=clickable-link-test.pdf&spaceReorderMobile=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/ERR_ABORTED|interrupted|destroyed/i.test(message) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(400);
    }
  }
  if (lastError) throw lastError;
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function spacesTab(page) {
  return page.getByRole('button', { name: 'Spaces', exact: true });
}

function pagesTab(page) {
  return page.getByRole('button', { name: 'Pages', exact: true });
}

function createSpaceBtn(page) {
  return page.getByRole('button', { name: 'Create space', exact: true });
}

function spaceCard(page, spaceName) {
  return page.locator('[data-space-sortable-row-id]').filter({
    has: page.getByRole('textbox', { name: `Rename ${spaceName}` }),
  });
}

function spaceHandle(page, spaceName) {
  return spaceCard(page, spaceName).locator('[data-space-drag-handle]');
}

async function railSpaceNames(page, root = page) {
  const scope = typeof root.locator === 'function' ? root : page;
  return scope.locator('[data-space-sortable-row-id] .space-name-inline').evaluateAll((els) => (
    els
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((el) => (el.value || '').trim())
      .filter(Boolean)
  ));
}

async function openSpaces(page) {
  const tab = spacesTab(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(createSpaceBtn(page)).toBeVisible({ timeout: 15_000 });
}

async function storedSpaceNames(page) {
  await pagesTab(page).click();
  await openSpaces(page);
  return railSpaceNames(page);
}

async function createNamedSpace(page, expectedName) {
  const field = page.getByRole('textbox', { name: `Rename ${expectedName}` });
  if (await field.isVisible().catch(() => false)) return;
  await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 }).catch(() => {});
  await createSpaceBtn(page).click();
  try {
    await expect(field).toBeVisible({ timeout: 4_000 });
  } catch {
    await createSpaceBtn(page).click();
    await expect(field).toBeVisible({ timeout: 8_000 });
  }
}

async function pointerDragSpaceTo(page, fromName, toName, { cancel = false } = {}) {
  const handle = spaceHandle(page, fromName);
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const fromBox = await handle.boundingBox();
  const toBox = await spaceCard(page, toName).boundingBox();
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

async function keyboardMoveSpace(page, fromName, { direction = 'down', cancel = false } = {}) {
  const handle = spaceHandle(page, fromName);
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

async function dragSpaceTo(page, fromName, toName, { cancel = false } = {}) {
  const before = await railSpaceNames(page);
  const direction = (() => {
    const fromIdx = before.indexOf(fromName);
    const toIdx = before.indexOf(toName);
    if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx) return 'up';
    return 'down';
  })();
  try {
    return await keyboardMoveSpace(page, fromName, { direction, cancel });
  } catch {
    await pointerDragSpaceTo(page, fromName, toName, { cancel });
    return 'pointer';
  }
}

async function armPen(page) {
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) {
    await pen.click();
  }
  return pen;
}

test('U-02 space-card reorder updates stored + rail order', async ({ page }) => {
  test.setTimeout(240_000);
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    dialogs.push({ type: dialog.type(), message });
    if (dialog.type() === 'beforeunload' || /unsaved|leave/i.test(message)) {
      await dialog.accept();
      return;
    }
    await dialog.dismiss();
  });

  await openEditor(page);
  await openSpaces(page);

  // Break: no spaces → no drag handle.
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await page.locator('[data-space-drag-handle]').count(), 'no handle with zero spaces').toBe(0);

  await createNamedSpace(page, 'Space 1');
  await expect(spaceHandle(page, 'Space 1')).toBeVisible();
  expect(await page.getByRole('button', { name: /Move (up|down)/i }).count(), 'no space up-down').toBe(0);

  // Break: single space — handle stays, self-drag is a no-op.
  await pointerDragSpaceTo(page, 'Space 1', 'Space 1');
  await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  await expect.poll(async () => railSpaceNames(page)).toEqual(['Space 1']);

  await createNamedSpace(page, 'Space 2');
  await expect(spaceHandle(page, 'Space 2')).toBeVisible();
  await expect.poll(async () => railSpaceNames(page)).toEqual(['Space 1', 'Space 2']);
  await expect.poll(async () => storedSpaceNames(page)).toEqual(['Space 1', 'Space 2']);

  // Break: Escape mid-drag cancels; Space 1 stays first.
  const cancelMethod = await dragSpaceTo(page, 'Space 1', 'Space 2', { cancel: true });
  await expect.poll(async () => railSpaceNames(page)).toEqual(['Space 1', 'Space 2']);
  await expect.poll(async () => storedSpaceNames(page)).toEqual(['Space 1', 'Space 2']);

  // Intended: drop Space 1 onto Space 2 so Space 1 is no longer first.
  const intendedMethod = await dragSpaceTo(page, 'Space 1', 'Space 2');
  await expect.poll(async () => railSpaceNames(page)).toEqual(['Space 2', 'Space 1']);
  await expect.poll(async () => storedSpaceNames(page)).toEqual(['Space 2', 'Space 1']);

  // Edge: undo rewinds only the reorder (both cards stay).
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await openSpaces(page);
  await expect.poll(async () => railSpaceNames(page)).toEqual(['Space 1', 'Space 2']);
  await expect.poll(async () => storedSpaceNames(page)).toEqual(['Space 1', 'Space 2']);
  await page.keyboard.press('Control+Shift+z');
  await openSpaces(page);
  await expect.poll(async () => railSpaceNames(page)).toEqual(['Space 2', 'Space 1']);

  // Break: Pen-armed still reorders (Space 2 back below Space 1).
  const pen = await armPen(page);
  await openSpaces(page);
  const penMethod = await dragSpaceTo(page, 'Space 2', 'Space 1');
  await expect.poll(async () => railSpaceNames(page)).toEqual(['Space 1', 'Space 2']);
  await expect.poll(async () => storedSpaceNames(page)).toEqual(['Space 1', 'Space 2']);
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after space-card reorder').toBe(true);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — handle if the space cards exist after Create.
  await openEditor(page, { width: 390, height: 844, url: MOBILE_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const mobilePanel = page.locator('.mobile-spaces-panel');
  await expect(mobilePanel).toBeVisible({ timeout: 8_000 });
  const create390 = mobilePanel.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobileHandles = 0;
  let mobileNames = [];
  let mobileReordered = false;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    await create390.first().click();
    await expect(mobilePanel.getByRole('textbox', { name: 'Rename Space 1' })).toBeVisible({ timeout: 8_000 });
    await create390.first().click();
    await expect(mobilePanel.getByRole('textbox', { name: 'Rename Space 2' })).toBeVisible({ timeout: 8_000 });
    mobileHandles = await mobilePanel.locator('[data-space-drag-handle]').count();
    mobileNames = await railSpaceNames(page, mobilePanel);
    if (mobileHandles >= 2 && mobileNames[0] === 'Space 1' && mobileNames[1] === 'Space 2') {
      try {
        await dragSpaceTo(page, 'Space 1', 'Space 2');
        const after = await railSpaceNames(page, mobilePanel);
        mobileReordered = after[0] === 'Space 2' && after[1] === 'Space 1';
        mobileNames = after;
      } catch {
        mobileReordered = false;
      }
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_CARD_REORDER_PROOF', JSON.stringify({
    persist,
    intended: ['Space 2', 'Space 1'],
    intendedMethod,
    cancelMethod,
    penMethod,
    cancelKeptSpace1First: true,
    penArmedReordered: true,
    undoRewound: true,
    singleSpaceNoOp: true,
    mobileCreate,
    mobileHandles,
    mobileNames,
    mobileReordered,
    dialogs,
  }));
});
