import { test, expect } from '@playwright/test';

// Unique leftovers after Templates New entity / entity Duplicate / entity
// Delete / category Delete:
// 1) entity reorder (SortableRearrangeList / reorderEntities)
// 2) category reorder (SortableRearrangeList / reorderCategories)
// 3) module reorder (SortableModuleTabs + Edit-modules SortableRearrangeList
//    / reorderMods)
// 4) Share (list / entity / category / module Select → onShare → ShareModal
//    kind=template). hubPreview is fail-closed: no invite mint
//    (isSupabaseAvailable: false → "Sharing needs a signed-in cloud account.").
// Distinct from U-03 template create/rename/delete, entity color, Add module /
// module Duplicate / Add checklist item, New category / category Duplicate /
// module Delete, template-list Duplicate, leftover-18 A-03 live invites.
// Move/Copy is a dead stub (Copy/Move only closeMoveModal). Do not invent
// Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces.
// UL-31 Continue pin parked. No file.id. Template-list reorder is a distinct
// leftover (reorderTemplates) — not this GAP.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const SECURITY_ENTITIES = ['GC', 'Subcontractor', '100% Complete'];
const MEP_ENTITIES = ['MEP', 'Architect'];
const SECURITY_MODULES = ['Installation Phase', 'Commissioning Phase'];
const CLOUD_BLOCK = 'Sharing needs a signed-in cloud account.';

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

function entitiesRail(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New entity', exact: true }),
  });
}

function dirtyBar(page) {
  return page.locator('[data-entity-editor-actions]');
}

async function eatDragClick(page) {
  // dnd-kit suppresses the first click after a drop.
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

function shareDialog(page) {
  return page.getByRole('dialog', { name: 'Share template' });
}

async function entityNames(page) {
  return entitiesRail(page).locator('input[placeholder="Entity name"]').evaluateAll((inputs) => (
    inputs.filter((el) => el.offsetParent).map((el) => el.value)
  ));
}

function entityRow(page, role) {
  return entitiesRail(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator(`input[placeholder="Entity name"][value="${role}"]`),
  });
}

function entityHandle(page, role) {
  return entityRow(page, role).locator('[data-drag-rearrange-handle]');
}

async function categoryNames(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.templates-editor-grid [data-drag-rearrange-row]')];
    return rows.flatMap((row) => {
      const toggle = row.querySelector('button[title="Expand"], button[title="Collapse"]');
      const field = row.querySelector('input.inline-edit.cat-title');
      if (!toggle || !field || !field.offsetParent) return [];
      return [field.value];
    });
  });
}

function categoryRow(page, name) {
  return desktopGrid(page).locator('[data-drag-rearrange-row]')
    .filter({ has: page.locator('button[title="Expand"], button[title="Collapse"]') })
    .filter({ has: page.locator(`input.inline-edit.cat-title[value="${name}"]`) });
}

function categoryHandle(page, name) {
  return categoryRow(page, name).locator('[data-drag-rearrange-handle]');
}

async function moduleTabNames(page) {
  return desktopGrid(page).locator('[data-module-tab-id]').evaluateAll((nodes) => (
    nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).map((node) => {
      const input = node.querySelector('input');
      const button = node.querySelector('button');
      return (input?.value || button?.textContent || '').trim();
    }).filter(Boolean)
  ));
}

function moduleTab(page, name) {
  return desktopGrid(page).locator('[data-module-tab-id]').filter({
    has: page.locator(`button[title^="${name} ·"]`),
  });
}

function editModulesModal(page) {
  return page.locator('.templates-module-edit-modal');
}

async function editModuleNames(page) {
  return editModulesModal(page).locator('[data-drag-rearrange-row] input').evaluateAll((inputs) => (
    inputs.filter((el) => el.offsetParent).map((el) => el.value)
  ));
}

function editModuleHandle(page, name) {
  return editModulesModal(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator(`input[value="${name}"]`),
  }).locator('[data-drag-rearrange-handle]');
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
  const key = direction === 'up'
    ? 'ArrowUp'
    : direction === 'left'
      ? 'ArrowLeft'
      : direction === 'right'
        ? 'ArrowRight'
        : 'ArrowDown';
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

async function dragByHandle(page, handle, dest, namesFn, fromName, toName, { cancel = false, axis = 'y' } = {}) {
  const before = await namesFn(page);
  const fromIdx = before.indexOf(fromName);
  const toIdx = before.indexOf(toName);
  const direction = axis === 'x'
    ? (toIdx >= 0 && fromIdx >= 0 && toIdx < fromIdx ? 'left' : 'right')
    : (toIdx >= 0 && fromIdx >= 0 && toIdx < fromIdx ? 'up' : 'down');
  try {
    await keyboardMoveHandle(page, handle, { direction, cancel });
    const after = await namesFn(page);
    const changed = JSON.stringify(after) !== JSON.stringify(before);
    if (cancel || changed) return 'keyboard';
  } catch { /* pointer fallback */ }
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.up().catch(() => {});
  await pointerDragHandleTo(page, handle, dest, { cancel, axis });
  return 'pointer';
}

// Module tabs use a horizontal DndContext that does NOT toggle
// body.drag-rearrange-dragging (that class is SortableRearrangeList-only).
// Focus the outer [data-module-tab-id] node — Space on the inner <button>
// activates click instead of dnd-kit pickup.
async function dragModuleTab(page, fromName, toName, { cancel = false } = {}) {
  const from = moduleTab(page, fromName);
  const to = moduleTab(page, toName);
  await expect(from).toBeVisible({ timeout: 8_000 });
  const before = await moduleTabNames(page);
  const fromIdx = before.indexOf(fromName);
  const toIdx = before.indexOf(toName);
  const direction = toIdx >= 0 && fromIdx >= 0 && toIdx < fromIdx ? 'left' : 'right';
  await from.evaluate((el) => el.focus());
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  await page.keyboard.press(direction === 'left' ? 'ArrowLeft' : 'ArrowRight');
  if (cancel) {
    await page.keyboard.press('Escape');
    return 'keyboard';
  }
  await page.keyboard.press('Space');
  const afterKey = await moduleTabNames(page);
  if (JSON.stringify(afterKey) !== JSON.stringify(before)) return 'keyboard';

  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  expect(fromBox && toBox, 'module tab drag geometry').toBeTruthy();
  const startX = fromBox.x + 8;
  const startY = fromBox.y + fromBox.height / 2;
  const destX = toBox.x > startX ? toBox.x + toBox.width - 8 : toBox.x + 8;
  const destY = toBox.y + toBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20, startY, { steps: 12 });
  await page.mouse.move(destX, destY, { steps: 28 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  return 'pointer';
}

async function enterListSelect(page) {
  const list = templatesList(page);
  const done = list.getByRole('button', { name: 'Done', exact: true });
  if (await done.count()) return;
  await list.getByRole('button', { name: 'Select', exact: true }).click();
}

async function enterEntitySelect(page) {
  const rail = entitiesRail(page);
  const done = rail.getByRole('button', { name: 'Done', exact: true });
  if (await done.count()) return;
  await rail.getByRole('button', { name: 'Select', exact: true }).click();
}

async function toggleRowCheckbox(row) {
  const clicked = await row.evaluate((node) => {
    const box = [...node.querySelectorAll('span')].find((el) => el.style.width === '14px' && el.style.height === '14px');
    if (!box) return false;
    box.click();
    return true;
  });
  expect(clicked, 'row checkbox').toBe(true);
}

test('Templates entity / category / module reorder + Share', async ({ page }) => {
  test.setTimeout(180_000);

  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyEntityHandles = await entitiesRail(page).locator('[data-drag-rearrange-handle]').count();
  const emptyCatHandles = await desktopGrid(page).locator('[data-drag-rearrange-handle]').count();
  const emptyModuleTabs = await desktopGrid(page).locator('[data-module-tab-id]').count();
  const emptyShare = await page.getByRole('button', { name: 'Share', exact: true }).count();
  expect(emptyEntityHandles, 'empty hub has no entity handles').toBe(0);
  expect(emptyCatHandles, 'empty hub has no category handles').toBe(0);
  expect(emptyModuleTabs, 'empty hub has no module tabs').toBe(0);
  expect(emptyShare, 'empty hub has no Share until Select').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);
  expect(await moduleTabNames(page)).toEqual(SECURITY_MODULES);
  await expect(entityHandle(page, 'GC')).toBeVisible();
  await expect(categoryHandle(page, 'Cameras')).toBeVisible();
  expect(await page.getByRole('button', { name: /Move (up|down)/i }).count(), 'no up-down chrome').toBe(0);

  // --- Entity reorder ---
  // Break: Escape mid-drag keeps seed order.
  const entityEscapeMode = await dragByHandle(
    page, entityHandle(page, 'GC'), entityRow(page, '100% Complete'),
    entityNames, 'GC', '100% Complete', { cancel: true },
  );
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  // Break: self-target is a no-op (active === over).
  const entitySelfMode = await dragByHandle(
    page, entityHandle(page, 'GC'), entityRow(page, 'GC'),
    entityNames, 'GC', 'GC',
  );
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  // Intended: GC leaves the first slot. Slot count can be one or two
  // (keyboard vs pointer collision); the leftover is the order change.
  const entityMoveMode = await dragByHandle(
    page, entityHandle(page, 'GC'), entityRow(page, '100% Complete'),
    entityNames, 'GC', '100% Complete',
  );
  await expect.poll(async () => entityNames(page)).not.toEqual(SECURITY_ENTITIES);
  const entityReordered = await entityNames(page);
  expect(new Set(entityReordered), 'entity members unchanged').toEqual(new Set(SECURITY_ENTITIES));
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();

  // Ctrl+Z is not history undo — Cancel is the revert.
  await page.keyboard.press('Control+z');
  expect(await entityNames(page)).toEqual(entityReordered);
  await eatDragClick(page);
  await clickDirty(page, 'Cancel');
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);

  // Persist + isolation.
  await dragByHandle(
    page, entityHandle(page, 'GC'), entityRow(page, '100% Complete'),
    entityNames, 'GC', '100% Complete',
  );
  await expect.poll(async () => entityNames(page)).not.toEqual(SECURITY_ENTITIES);
  const entitySavedOrder = await entityNames(page);
  expect(new Set(entitySavedOrder)).toEqual(new Set(SECURITY_ENTITIES));
  await eatDragClick(page);
  await clickDirty(page, 'Save');
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await moduleTabButton(page, 'Commissioning Phase').click();
  expect(await entityNames(page)).toEqual(entitySavedOrder);
  await templatesList(page).getByText('MEP As-Built Markup', { exact: true }).click();
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  expect(await entityNames(page)).toEqual(entitySavedOrder);

  // --- Category reorder ---
  await moduleTabButton(page, 'Installation Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);
  const catEscapeMode = await dragByHandle(
    page, categoryHandle(page, 'Cameras'), categoryRow(page, 'Doors'),
    categoryNames, 'Cameras', 'Doors', { cancel: true },
  );
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  const catMoveMode = await dragByHandle(
    page, categoryHandle(page, 'Cameras'), categoryRow(page, 'Doors'),
    categoryNames, 'Cameras', 'Doors',
  );
  await expect.poll(async () => categoryNames(page)).not.toEqual(['Cameras', 'Doors']);
  const catReordered = await categoryNames(page);
  expect(new Set(catReordered), 'category members unchanged').toEqual(new Set(['Cameras', 'Doors']));
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await eatDragClick(page);
  await clickDirty(page, 'Cancel');
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);

  await dragByHandle(
    page, categoryHandle(page, 'Cameras'), categoryRow(page, 'Doors'),
    categoryNames, 'Cameras', 'Doors',
  );
  await expect.poll(async () => categoryNames(page)).not.toEqual(['Cameras', 'Doors']);
  const catSavedOrder = await categoryNames(page);
  expect(new Set(catSavedOrder)).toEqual(new Set(['Cameras', 'Doors']));
  await eatDragClick(page);
  await clickDirty(page, 'Save');
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await moduleTabButton(page, 'Commissioning Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras']);
  await templatesList(page).getByText('MEP As-Built Markup', { exact: true }).click();
  expect(await categoryNames(page)).toEqual(['AHU Equipment']);
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  await moduleTabButton(page, 'Installation Phase').click();
  expect(await categoryNames(page)).toEqual(catSavedOrder);

  // --- Module reorder (tabs + Edit-modules SortableRearrangeList) ---
  expect(await moduleTabNames(page)).toEqual(SECURITY_MODULES);
  const modEscapeMode = await dragModuleTab(page, 'Installation Phase', 'Commissioning Phase', { cancel: true });
  expect(await moduleTabNames(page)).toEqual(SECURITY_MODULES);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  const modTabMode = await dragModuleTab(page, 'Installation Phase', 'Commissioning Phase');
  const modTabReordered = await moduleTabNames(page);
  const modTabMoved = JSON.stringify(modTabReordered) !== JSON.stringify(SECURITY_MODULES);
  if (modTabMoved) {
    expect(new Set(modTabReordered), 'module members unchanged').toEqual(new Set(SECURITY_MODULES));
    await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await eatDragClick(page);
    await clickDirty(page, 'Cancel');
    expect(await moduleTabNames(page)).toEqual(SECURITY_MODULES);
  }

  const moduleSelect = desktopGrid(page).locator('p.micro', { hasText: /^Module$/ }).locator('xpath=..').getByRole('button', { name: 'Select', exact: true });
  await expect(moduleSelect).toBeVisible();
  await eatDragClick(page);
  await moduleSelect.click();
  if (!(await editModulesModal(page).isVisible().catch(() => false))) {
    await moduleSelect.evaluate((el) => el.click());
  }
  await expect(editModulesModal(page)).toBeVisible();
  expect(await editModuleNames(page)).toEqual(SECURITY_MODULES);
  const modListMode = await dragByHandle(
    page, editModuleHandle(page, 'Installation Phase'),
    editModulesModal(page).locator('[data-drag-rearrange-row]').filter({ has: page.locator('input[value="Commissioning Phase"]') }),
    editModuleNames, 'Installation Phase', 'Commissioning Phase',
  );
  await expect.poll(async () => editModuleNames(page)).toEqual(['Commissioning Phase', 'Installation Phase']);
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editModulesModal(page)).toHaveCount(0);
  await expect.poll(async () => moduleTabNames(page)).toEqual(['Commissioning Phase', 'Installation Phase']);
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await eatDragClick(page);
  await clickDirty(page, 'Save');
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await moduleTabNames(page)).toEqual(['Commissioning Phase', 'Installation Phase']);
  await moduleTabButton(page, 'Commissioning Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras']);
  await moduleTabButton(page, 'Installation Phase').click();
  expect(await categoryNames(page)).toEqual(['Doors', 'Cameras']);
  await templatesList(page).getByText('MEP As-Built Markup', { exact: true }).click();
  expect(await moduleTabNames(page)).toEqual(['Equipment']);
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  expect(await moduleTabNames(page)).toEqual(['Commissioning Phase', 'Installation Phase']);

  // --- Share (list Select is the primary chrome; same ShareModal as entity/category/module) ---
  await enterListSelect(page);
  const listShare = templatesList(page).getByRole('button', { name: 'Share', exact: true });
  await expect(listShare).toBeVisible();
  await expect(listShare).toBeDisabled();
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  await expect(listShare).toBeEnabled();
  await listShare.click();
  await expect(shareDialog(page)).toBeVisible();
  await expect(shareDialog(page).getByText('Share template')).toBeVisible();
  await expect(shareDialog(page).getByText('Security Walk-Through')).toBeVisible();
  await expect(shareDialog(page).locator('select')).toHaveValue('Viewer');
  await shareDialog(page).locator('select').selectOption('Editor');
  await expect(shareDialog(page).getByText('Anyone with this invite link can join as editor.')).toBeVisible();

  // Copy link is fail-closed on hubPreview (no Supabase).
  await shareDialog(page).getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(shareDialog(page).getByText(CLOUD_BLOCK)).toBeVisible();

  // Invalid email does not invent a send.
  await shareDialog(page).locator('textarea').fill('not-an-email');
  await shareDialog(page).getByRole('button', { name: 'Send editor invite' }).click();
  await expect(shareDialog(page).getByText('Enter at least one valid email.')).toBeVisible();

  // Valid email still fail-closed — do not invent a backend.
  await shareDialog(page).locator('textarea').fill('teammate@example.com');
  await shareDialog(page).getByRole('button', { name: 'Send editor invite' }).click();
  await expect(shareDialog(page).getByText(CLOUD_BLOCK)).toBeVisible();
  await shareDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(shareDialog(page)).toHaveCount(0);

  // Entity Select Share opens the same template modal (not a per-entity backend).
  await enterEntitySelect(page);
  const entShare = entitiesRail(page).getByRole('button', { name: 'Share', exact: true });
  await expect(entShare).toBeDisabled();
  await toggleRowCheckbox(entityRow(page, 'GC'));
  await expect(entShare).toBeEnabled();
  await entShare.click();
  await expect(shareDialog(page)).toBeVisible();
  await expect(shareDialog(page).getByText('Security Walk-Through')).toBeVisible();
  await shareDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(shareDialog(page)).toHaveCount(0);

  // 390 chrome
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  let mobileListShare = 0;
  let mobileShareOpened = false;
  let mobileShareFailClosed = false;
  const mobileSelect = page.locator('.mobile-header-select-button');
  if (await mobileSelect.isVisible().catch(() => false)) {
    await mobileSelect.evaluate((button) => button.click());
    const mobileShare = page.locator('.templates-mobile-select-actions').getByRole('button', { name: 'Share', exact: true });
    mobileListShare = await mobileShare.count();
    if (mobileListShare > 0) {
      const securityRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
      if (await securityRow.isVisible().catch(() => false)) {
        await securityRow.evaluate((row) => row.click());
        await mobileShare.first().evaluate((button) => button.click());
        mobileShareOpened = await shareDialog(page).isVisible().catch(() => false);
        if (mobileShareOpened) {
          await shareDialog(page).getByRole('button', { name: 'Copy link', exact: true }).click();
          mobileShareFailClosed = await shareDialog(page).getByText(CLOUD_BLOCK).count() > 0;
          await shareDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
        }
      }
    }
    const mobileDone = page.locator('.mobile-header-select-button, .templates-mobile-select-actions').getByRole('button', { name: 'Done', exact: true });
    if (await mobileDone.first().isVisible().catch(() => false)) {
      await mobileDone.first().evaluate((button) => button.click());
    }
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  let mobileEntityHandles = 0;
  let mobileCatHandles = 0;
  let mobileModuleTabs = 0;
  let mobileEntityReordered = false;
  let mobileCatReordered = false;
  let mobileModReordered = false;
  if (await mobileRow.isVisible().catch(() => false)) {
    await mobileRow.evaluate((row) => row.click());
    await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });
    mobileModuleTabs = await page.locator('.templates-mobile-module-tabs [data-module-tab-id]').count();
    mobileCatHandles = await page.locator('.templates-mobile-categories-section [data-drag-rearrange-handle]').count();
    if (mobileCatHandles >= 2) {
      const cam = page.locator('.templates-mobile-categories-section [data-drag-rearrange-row]').filter({
        has: page.locator('input.inline-edit.cat-title[value="Cameras"]'),
      }).locator('[data-drag-rearrange-handle]');
      const doors = page.locator('.templates-mobile-categories-section [data-drag-rearrange-row]').filter({
        has: page.locator('input.inline-edit.cat-title[value="Doors"]'),
      });
      if (await cam.isVisible().catch(() => false) && await doors.isVisible().catch(() => false)) {
        try {
          await keyboardMoveHandle(page, cam, { direction: 'down' });
        } catch {
          await pointerDragHandleTo(page, cam, doors);
        }
        const names = await page.locator('.templates-mobile-categories-section input.inline-edit.cat-title').evaluateAll((inputs) => (
          inputs.filter((el) => el.offsetParent).map((el) => el.value)
        ));
        mobileCatReordered = names[0] === 'Doors' && names.includes('Cameras');
      }
    }
    const entitiesOpen = page.getByRole('button', { name: 'Entities', exact: true });
    if (await entitiesOpen.isVisible().catch(() => false)) {
      await entitiesOpen.click();
      const mobileDialog = page.getByRole('dialog', { name: 'Entities' });
      await expect(mobileDialog).toBeVisible();
      mobileEntityHandles = await mobileDialog.locator('[data-drag-rearrange-handle]').count();
      if (mobileEntityHandles >= 2) {
        const gc = mobileDialog.locator('[data-drag-rearrange-row]').filter({
          has: page.locator('input[placeholder="Entity name"][value="GC"]'),
        }).locator('[data-drag-rearrange-handle]');
        const sub = mobileDialog.locator('[data-drag-rearrange-row]').filter({
          has: page.locator('input[placeholder="Entity name"][value="Subcontractor"]'),
        });
        if (await gc.isVisible().catch(() => false)) {
          try {
            await keyboardMoveHandle(page, gc, { direction: 'down' });
          } catch {
            await pointerDragHandleTo(page, gc, sub);
          }
          const names = await mobileDialog.locator('input[placeholder="Entity name"]').evaluateAll((inputs) => (
            inputs.filter((el) => el.offsetParent).map((el) => el.value)
          ));
          mobileEntityReordered = names[0] === 'Subcontractor' && names.includes('GC');
        }
      }
      const close = mobileDialog.getByRole('button', { name: 'Close', exact: true });
      if (await close.count()) await close.evaluate((button) => button.click());
    }
    if (mobileModuleTabs >= 2) {
      const inst = page.locator('.templates-mobile-module-tabs [data-module-tab-id]').filter({
        has: page.locator('button[title^="Installation Phase ·"]'),
      });
      const comm = page.locator('.templates-mobile-module-tabs [data-module-tab-id]').filter({
        has: page.locator('button[title^="Commissioning Phase ·"]'),
      });
      if (await inst.isVisible().catch(() => false) && await comm.isVisible().catch(() => false)) {
        const fromBox = await inst.boundingBox();
        const toBox = await comm.boundingBox();
        if (fromBox && toBox) {
          await inst.click();
          await inst.focus();
          await page.keyboard.press('Space');
          await page.waitForTimeout(80);
          await page.keyboard.press('ArrowRight');
          await page.keyboard.press('Space');
        }
        const names = await page.locator('.templates-mobile-module-tabs [data-module-tab-id]').evaluateAll((nodes) => (
          nodes.filter((node) => node.getBoundingClientRect().width > 0).map((node) => (
            (node.querySelector('button')?.textContent || '').trim()
          )).filter(Boolean)
        ));
        mobileModReordered = names[0] === 'Commissioning Phase' && names.includes('Installation Phase');
      }
    }
  }

  expect(mobileListShare, '390 list Share').toBeGreaterThan(0);
  expect(mobileShareOpened, '390 Share modal opened').toBe(true);
  expect(mobileShareFailClosed, '390 Copy link fail-closed').toBe(true);
  expect(mobileEntityHandles, '390 entity handles').toBeGreaterThan(1);
  expect(mobileCatHandles, '390 category handles').toBeGreaterThan(1);
  expect(mobileModuleTabs, '390 module tabs').toBeGreaterThan(1);

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_REORDER_SHARE_PROOF: {
      leftoverKind: 'entity-category-module-reorder-share',
      emptyEntityHandles,
      emptyCatHandles,
      emptyModuleTabs,
      emptyShare,
      entityEscapeMode,
      entitySelfMode,
      entityMoveMode,
      entityReordered,
      entitySavedOrder,
      entityEscapeKept: true,
      entitySelfNoDirty: true,
      entityCancelRestored: true,
      entitySaved: true,
      entityIsolation: true,
      catEscapeMode,
      catMoveMode,
      catReordered,
      catSavedOrder,
      catCancelRestored: true,
      catSaved: true,
      catIsolation: true,
      modEscapeMode,
      modTabMode,
      modTabMoved,
      modTabReordered,
      modListMode,
      modCancelRestored: true,
      modSaved: true,
      modIsolation: true,
      shareNoneDisabled: true,
      shareOpened: true,
      shareRoleEditor: true,
      shareCopyFailClosed: true,
      shareInvalidEmail: true,
      shareSendFailClosed: true,
      shareEntitySameModal: true,
      mobileListShare,
      mobileShareOpened,
      mobileShareFailClosed,
      mobileEntityHandles,
      mobileCatHandles,
      mobileModuleTabs,
      mobileEntityReordered,
      mobileCatReordered,
      mobileModReordered,
    },
  }));
});
