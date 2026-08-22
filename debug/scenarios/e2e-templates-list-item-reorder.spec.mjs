import { test, expect } from '@playwright/test';

// Unique leftovers after Templates entity / category / module reorder + Share:
// 1) template-list reorder (SortableRearrangeList / reorderTemplates)
//    — preference persist via saveTemplateOrderPreference; not mutateTpl
// 2) checklist item reorder (SortableRearrangeList / reorderItems)
//    — scoped to a category in the open module; dirty via mutateTpl
// Distinct from entity/category/module reorder, survey-rail item reorder,
// U-03 create/rename/delete, Add checklist item, leftover-18 A-03.
// Move/Copy is a dead stub (Copy/Move only closeMoveModal). Do not invent
// Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces.
// UL-31 Continue pin parked. No file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const SEED_TEMPLATES = ['Security Walk-Through', 'MEP As-Built Markup'];
const CAMERAS_ITEMS = ['Is the camera cable pulled?', 'Is the camera installed?'];
const DOORS_ITEMS = ['Is the door roughed in?', 'Are the door devices installed?'];
const COMMISSIONING_ITEMS = ['Camera tested and online?'];
const MEP_ITEMS = ['Tags updated?'];

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function desktopGrid(page) {
  return page.locator('.templates-editor-grid');
}

function templatesList(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  });
}

function dirtyBar(page) {
  return page.locator('[data-entity-editor-actions]');
}

async function eatDragClick(page) {
  await page.mouse.click(12, 12).catch(() => {});
}

async function clickDirty(page, name) {
  const button = dirtyBar(page).getByRole('button', { name, exact: true }).first();
  await expect(button).toBeVisible({ timeout: 8_000 });
  await button.click();
  await page.waitForTimeout(80);
  const still = await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).count();
  if (still > 0) {
    await button.evaluate((el) => el.click());
    await page.waitForTimeout(80);
  }
}

function moduleTabButton(page, name) {
  return desktopGrid(page).locator(`[data-module-tab-id] button[title^="${name} ·"]`).filter({ hasText: new RegExp(`^${name}$`) });
}

async function templateNames(page) {
  return templatesList(page).locator('[data-drag-rearrange-row]').evaluateAll((rows) => (
    rows.filter((row) => row.offsetParent).map((row) => {
      const title = row.querySelector('div[style*="font-weight"]');
      return (title?.textContent || '').trim();
    }).filter(Boolean)
  ));
}

function templateRow(page, name) {
  return templatesList(page).locator('[data-drag-rearrange-row]').filter({ hasText: name });
}

function templateHandle(page, name) {
  return templateRow(page, name).locator('[data-drag-rearrange-handle]');
}

function categoryRow(page, name) {
  return desktopGrid(page).locator('[data-drag-rearrange-row]')
    .filter({ has: page.locator('button[title="Expand"], button[title="Collapse"]') })
    .filter({ has: page.locator(`input.inline-edit.cat-title[value="${name}"]`) });
}

async function expandCategory(page, name) {
  const row = categoryRow(page, name);
  await expect(row).toBeVisible({ timeout: 8_000 });
  const toggle = row.locator('button[title="Expand"], button[title="Collapse"]');
  if ((await toggle.getAttribute('title')) === 'Expand') {
    await toggle.click();
  }
  await expect(row.locator('button[title="Collapse"]')).toBeVisible();
}

async function itemNamesInCategory(page, name) {
  return page.evaluate((wanted) => {
    const titles = [...document.querySelectorAll('.templates-editor-grid input.inline-edit.cat-title')];
    const field = titles.find((el) => el.value === wanted && el.offsetParent);
    if (!field) return [];
    const card = field.closest('.card-line');
    if (!card) return [];
    return [...card.querySelectorAll('input.inline-edit[placeholder="Add checklist item"]')]
      .filter((el) => {
        const style = getComputedStyle(el);
        return el.offsetParent && style.visibility !== 'hidden' && Number(style.opacity) > 0;
      })
      .map((el) => el.value);
  }, name);
}

function itemRow(page, text) {
  return desktopGrid(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator(`input.inline-edit[placeholder="Add checklist item"][value="${text}"]`),
  });
}

function itemHandle(page, text) {
  return itemRow(page, text).locator('[data-drag-rearrange-handle]');
}

async function pointerDragHandleTo(page, handle, dest, { cancel = false, axis = 'y' } = {}) {
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const fromBox = await handle.boundingBox();
  const toBox = await dest.boundingBox();
  expect(fromBox && toBox, 'drag geometry').toBeTruthy();
  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const destX = toBox.x + Math.min(24, toBox.width / 2);
  const destY = axis === 'x'
    ? toBox.y + toBox.height / 2
    : (toBox.y > startY ? toBox.y + toBox.height + 8 : toBox.y + 8);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(
    axis === 'x' ? startX + 12 : startX,
    axis === 'x' ? startY : startY + 12,
    { steps: 8 },
  );
  await expect(page.locator('body')).toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  await page.mouse.move(destX, destY, { steps: 28 });
  if (cancel) {
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  }
  await page.mouse.up();
}

async function keyboardMoveHandle(page, handle, { direction = 'down', cancel = false } = {}) {
  await expect(handle).toBeVisible({ timeout: 8_000 });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  const key = direction === 'up' ? 'ArrowUp' : 'ArrowDown';
  await page.keyboard.press(key);
  if (cancel) {
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
    return 'keyboard';
  }
  await page.keyboard.press('Space');
  await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  return 'keyboard';
}

async function dragByHandle(page, handle, dest, namesFn, fromName, toName, { cancel = false } = {}) {
  const before = await namesFn(page);
  const fromIdx = before.indexOf(fromName);
  const toIdx = before.indexOf(toName);
  const direction = toIdx >= 0 && fromIdx >= 0 && toIdx < fromIdx ? 'up' : 'down';
  try {
    await keyboardMoveHandle(page, handle, { direction, cancel });
    const after = await namesFn(page);
    const changed = JSON.stringify(after) !== JSON.stringify(before);
    if (cancel || changed) return 'keyboard';
  } catch { /* pointer fallback */ }
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.up().catch(() => {});
  await pointerDragHandleTo(page, handle, dest, { cancel });
  return 'pointer';
}

test('Templates template-list reorder + checklist item reorder', async ({ page }) => {
  test.setTimeout(180_000);

  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyListHandles = await templatesList(page).locator('[data-drag-rearrange-handle]').count();
  const emptyItemHandles = await desktopGrid(page).locator('input.inline-edit[placeholder="Add checklist item"]').count();
  expect(emptyListHandles, 'empty hub has no template-list handles').toBe(0);
  expect(emptyItemHandles, 'empty hub has no checklist item fields').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  expect(await templateNames(page)).toEqual(SEED_TEMPLATES);
  await expect(templateHandle(page, 'Security Walk-Through')).toBeVisible();
  await expect(templateHandle(page, 'MEP As-Built Markup')).toBeVisible();
  expect(await page.getByRole('button', { name: /Move (up|down)/i }).count(), 'no up-down chrome').toBe(0);

  // --- Template-list reorder (preference persist; no dirty bar) ---
  const listEscapeMode = await dragByHandle(
    page, templateHandle(page, 'Security Walk-Through'), templateRow(page, 'MEP As-Built Markup'),
    templateNames, 'Security Walk-Through', 'MEP As-Built Markup', { cancel: true },
  );
  expect(await templateNames(page)).toEqual(SEED_TEMPLATES);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  const listSelfMode = await dragByHandle(
    page, templateHandle(page, 'Security Walk-Through'), templateRow(page, 'Security Walk-Through'),
    templateNames, 'Security Walk-Through', 'Security Walk-Through',
  );
  expect(await templateNames(page)).toEqual(SEED_TEMPLATES);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  const listMoveMode = await dragByHandle(
    page, templateHandle(page, 'Security Walk-Through'), templateRow(page, 'MEP As-Built Markup'),
    templateNames, 'Security Walk-Through', 'MEP As-Built Markup',
  );
  await expect.poll(async () => templateNames(page)).not.toEqual(SEED_TEMPLATES);
  const listReordered = await templateNames(page);
  expect(new Set(listReordered), 'template members unchanged').toEqual(new Set(SEED_TEMPLATES));
  expect(listReordered[0]).toBe('MEP As-Built Markup');
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  await expandCategory(page, 'Cameras');
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(CAMERAS_ITEMS);
  await templatesList(page).getByText('MEP As-Built Markup', { exact: true }).click();
  await expandCategory(page, 'AHU Equipment');
  expect(await itemNamesInCategory(page, 'AHU Equipment')).toEqual(MEP_ITEMS);
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => templateNames(page)).toEqual(listReordered);
  const listReloadPersisted = true;

  // --- Checklist item reorder (dirty via mutateTpl; Cancel / Save) ---
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  await moduleTabButton(page, 'Installation Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(CAMERAS_ITEMS);
  await expect(itemHandle(page, CAMERAS_ITEMS[0])).toBeVisible();

  const itemEscapeMode = await dragByHandle(
    page, itemHandle(page, CAMERAS_ITEMS[0]), itemRow(page, CAMERAS_ITEMS[1]),
    () => itemNamesInCategory(page, 'Cameras'), CAMERAS_ITEMS[0], CAMERAS_ITEMS[1], { cancel: true },
  );
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(CAMERAS_ITEMS);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  const itemSelfMode = await dragByHandle(
    page, itemHandle(page, CAMERAS_ITEMS[0]), itemRow(page, CAMERAS_ITEMS[0]),
    () => itemNamesInCategory(page, 'Cameras'), CAMERAS_ITEMS[0], CAMERAS_ITEMS[0],
  );
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(CAMERAS_ITEMS);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  const itemMoveMode = await dragByHandle(
    page, itemHandle(page, CAMERAS_ITEMS[0]), itemRow(page, CAMERAS_ITEMS[1]),
    () => itemNamesInCategory(page, 'Cameras'), CAMERAS_ITEMS[0], CAMERAS_ITEMS[1],
  );
  await expect.poll(async () => itemNamesInCategory(page, 'Cameras')).toEqual([CAMERAS_ITEMS[1], CAMERAS_ITEMS[0]]);
  const itemReordered = await itemNamesInCategory(page, 'Cameras');
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();

  await page.keyboard.press('Control+z');
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(itemReordered);
  await eatDragClick(page);
  await clickDirty(page, 'Cancel');
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(CAMERAS_ITEMS);
  expect(await templateNames(page), 'Cancel does not rewind list preference').toEqual(listReordered);

  await expandCategory(page, 'Cameras');
  await dragByHandle(
    page, itemHandle(page, CAMERAS_ITEMS[0]), itemRow(page, CAMERAS_ITEMS[1]),
    () => itemNamesInCategory(page, 'Cameras'), CAMERAS_ITEMS[0], CAMERAS_ITEMS[1],
  );
  await expect.poll(async () => itemNamesInCategory(page, 'Cameras')).toEqual([CAMERAS_ITEMS[1], CAMERAS_ITEMS[0]]);
  const itemSavedOrder = await itemNamesInCategory(page, 'Cameras');
  await eatDragClick(page);
  await clickDirty(page, 'Save');
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expandCategory(page, 'Cameras');
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(itemSavedOrder);

  await expandCategory(page, 'Doors');
  expect(await itemNamesInCategory(page, 'Doors')).toEqual(DOORS_ITEMS);
  await moduleTabButton(page, 'Commissioning Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(COMMISSIONING_ITEMS);
  const commissioningHandles = await itemHandle(page, COMMISSIONING_ITEMS[0]).count();
  await templatesList(page).getByText('MEP As-Built Markup', { exact: true }).click();
  await expandCategory(page, 'AHU Equipment');
  expect(await itemNamesInCategory(page, 'AHU Equipment')).toEqual(MEP_ITEMS);
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  await moduleTabButton(page, 'Installation Phase').click();
  await expandCategory(page, 'Cameras');
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(itemSavedOrder);

  // 390 chrome — Space on a list row opens the template (role=button),
  // so list reorder is pointer-only. Item handles live in the detail.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.templates-mobile-browser')).toBeVisible({ timeout: 15_000 });

  const mobileListHandles = await page.locator('.templates-mobile-browser [data-drag-rearrange-handle]').count();
  let mobileListReordered = false;
  let mobileItemHandles = 0;
  let mobileItemReordered = false;
  const mobileSecurity = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  const mobileMep = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: 'MEP As-Built Markup' }).first();
  if (mobileListHandles >= 2 && await mobileSecurity.isVisible().catch(() => false)) {
    const before = await page.locator('.templates-mobile-browser .templates-mobile-row strong').evaluateAll((nodes) => (
      nodes.filter((el) => el.offsetParent).map((el) => el.textContent.trim())
    ));
    const secHandle = mobileSecurity.locator('[data-drag-rearrange-handle]');
    await pointerDragHandleTo(page, secHandle, mobileMep);
    const after = await page.locator('.templates-mobile-browser .templates-mobile-row strong').evaluateAll((nodes) => (
      nodes.filter((el) => el.offsetParent).map((el) => el.textContent.trim())
    ));
    mobileListReordered = JSON.stringify(after) !== JSON.stringify(before) && after.includes('Security Walk-Through');
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.templates-mobile-browser')).toBeVisible({ timeout: 15_000 });
  const mobileRow = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  if (await mobileRow.isVisible().catch(() => false)) {
    await mobileRow.evaluate((row) => row.click());
    await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });
    const camToggle = page.getByRole('button', { name: /Expand Cameras/ });
    if (await camToggle.isVisible().catch(() => false)) {
      await camToggle.click();
    }
    const mobileItemRows = page.locator('.templates-mobile-items [data-drag-rearrange-row]');
    mobileItemHandles = await page.locator('.templates-mobile-items [data-drag-rearrange-handle]').count();
    if (mobileItemHandles >= 2) {
      // Desktop Save may already have swapped the seed order — drag the
      // first live row, not a stale CAMERAS_ITEMS[0] that is now last.
      const firstHandle = mobileItemRows.nth(0).locator('[data-drag-rearrange-handle]');
      const secondRow = mobileItemRows.nth(1);
      if (await firstHandle.isVisible().catch(() => false)) {
        const before = await page.locator('.templates-mobile-items input.templates-mobile-inline-input').evaluateAll((inputs) => (
          inputs.filter((el) => el.offsetParent).map((el) => el.value)
        ));
        try {
          await keyboardMoveHandle(page, firstHandle, { direction: 'down' });
        } catch {
          await pointerDragHandleTo(page, firstHandle, secondRow);
        }
        const after = await page.locator('.templates-mobile-items input.templates-mobile-inline-input').evaluateAll((inputs) => (
          inputs.filter((el) => el.offsetParent).map((el) => el.value)
        ));
        mobileItemReordered = JSON.stringify(after) !== JSON.stringify(before);
      }
    }
  }

  expect(mobileListHandles, '390 template-list handles').toBeGreaterThan(1);
  expect(mobileListReordered, '390 template-list reorder').toBe(true);
  expect(mobileItemHandles, '390 checklist item handles').toBeGreaterThan(1);
  expect(mobileItemReordered, '390 checklist item reorder').toBe(true);

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_LIST_ITEM_REORDER_PROOF: {
      leftoverKind: 'template-list-and-checklist-item-reorder',
      emptyListHandles,
      emptyItemHandles,
      listEscapeMode,
      listSelfMode,
      listMoveMode,
      listReordered,
      listReloadPersisted,
      listNoDirty: true,
      listIsolation: true,
      itemEscapeMode,
      itemSelfMode,
      itemMoveMode,
      itemReordered,
      itemSavedOrder,
      itemCancelRestored: true,
      itemSaved: true,
      itemDoorsIsolated: true,
      itemCommissioningIsolated: true,
      itemMepIsolated: true,
      commissioningHandles,
      mobileListHandles,
      mobileListReordered,
      mobileItemHandles,
      mobileItemReordered,
    },
  }));
});
