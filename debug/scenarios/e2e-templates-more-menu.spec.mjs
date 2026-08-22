import { test, expect } from '@playwright/test';

// Unique leftover after Templates existing-row rename:
// More overflow — template-row Copy / Rename / Share / Delete and
// entity Duplicate / Move/Copy / Share / Rename / Delete.
// Copy / Share / Delete were already proven via Select chrome — this
// slice is the More portal, not a replay of those Select buttons.
// Move/Copy is a dead stub (Copy/Move only closeMoveModal).
// Do not invent Print / stamp / measure / Group / Extract / Note-Link /
// Copy-to-Spaces / category Move/Copy. UL-31 Continue pin parked. No file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const CLOUD_BLOCK = 'Sharing needs a signed-in cloud account.';
const SECURITY_ENTITIES = ['GC', 'Subcontractor', '100% Complete'];
const MEP_ENTITIES = ['MEP', 'Architect'];
const TPL_MORE_ITEMS = ['Copy', 'Rename', 'Share', 'Delete'];
const ENT_MORE_ITEMS = ['Duplicate', 'Move/Copy', 'Share', 'Rename', 'Delete'];

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function dirtyBar(page) {
  return page.locator('[data-entity-editor-actions]');
}

async function expectNoDirty(page) {
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
}

async function expectDirty(page) {
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
}

async function clickSave(page) {
  await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expectNoDirty(page);
}

async function clickCancel(page) {
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectNoDirty(page);
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

function moreMenu(page) {
  return page.locator('.ed-tpl-menu[role="menu"]');
}

function shareDialog(page) {
  return page.getByRole('dialog', { name: 'Share template' });
}

function moveDialog(page) {
  return page.getByRole('dialog', { name: 'Move or copy items' });
}

function templateRow(page, name) {
  return templatesList(page).locator('[data-drag-rearrange-row]').filter({ hasText: name }).first();
}

function entityRow(page, role) {
  return entitiesRail(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator(`input[placeholder="Entity name"][value="${role}"]`),
  });
}

async function templateNames(page) {
  return templatesList(page).locator('[data-drag-rearrange-row]').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('div[style*="font-weight"]')?.textContent?.trim() || '').filter(Boolean)
  ));
}

async function entityNames(page) {
  return entitiesRail(page).locator('input[placeholder="Entity name"]').evaluateAll((inputs) => (
    inputs.filter((el) => el.offsetParent).map((el) => el.value)
  ));
}

async function openMore(page, row) {
  const more = row.getByRole('button', { name: 'More', exact: true });
  await expect(more).toBeVisible({ timeout: 8_000 });
  const opened = await more.evaluate((button) => {
    button.click();
    return true;
  });
  expect(opened, 'More click').toBe(true);
  await expect(moreMenu(page)).toBeVisible({ timeout: 8_000 });
}

async function menuLabels(page) {
  return moreMenu(page).getByRole('menuitem').evaluateAll((els) => (
    els.map((el) => (el.textContent || '').trim())
  ));
}

async function clickMenuItem(page, label) {
  const item = moreMenu(page).getByRole('menuitem', { name: label, exact: true });
  await expect(item).toBeVisible();
  await item.evaluate((button) => button.click());
}

async function focusedField(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { tag: null, value: '', templateTitle: false, entityId: null, placeholder: null };
    return {
      tag: el.tagName,
      value: el.value || '',
      templateTitle: el.hasAttribute('data-template-title'),
      entityId: el.getAttribute('data-entity-id'),
      placeholder: el.getAttribute('placeholder'),
    };
  });
}

async function visibleTemplateTitle(page) {
  return page.evaluate(() => {
    const field = [...document.querySelectorAll('input[data-template-title]')].find((el) => el.offsetParent);
    return field?.value || '';
  });
}

async function typeIntoFocused(page, next, key = 'Enter') {
  await page.keyboard.press('Control+a');
  if (next === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(next);
  await page.keyboard.press(key);
}

test('Templates More menu overflow (template-row + entity)', async ({ page }) => {
  test.setTimeout(180_000);

  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyTplMore = await templatesList(page).getByRole('button', { name: 'More', exact: true }).count();
  const emptyEntMore = await entitiesRail(page).getByRole('button', { name: 'More', exact: true }).count();
  expect(emptyTplMore, 'empty hub has no template More').toBe(0);
  expect(emptyEntMore, 'empty hub has no entity More').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  expect(await templateNames(page)).toEqual(['Security Walk-Through', 'MEP As-Built Markup']);
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);
  const penOnHub = await page.getByRole('button', { name: 'Pen', exact: true }).count();
  expect(penOnHub, 'Pen N/A on hub').toBe(0);

  // --- Dismiss: Escape + outside click; one menu at a time ---
  await openMore(page, templateRow(page, 'Security Walk-Through'));
  expect(await menuLabels(page)).toEqual(TPL_MORE_ITEMS);
  await page.keyboard.press('Escape');
  await expect(moreMenu(page)).toHaveCount(0);

  await openMore(page, templateRow(page, 'Security Walk-Through'));
  await page.mouse.click(16, 16);
  await expect(moreMenu(page)).toHaveCount(0);

  await openMore(page, templateRow(page, 'Security Walk-Through'));
  // First gesture on another More is consumed by DismissBarrier (closes,
  // does not open the second menu). Second gesture opens entity More.
  await entityRow(page, 'GC').getByRole('button', { name: 'More', exact: true }).evaluate((button) => button.click());
  await expect(moreMenu(page)).toHaveCount(0);
  await openMore(page, entityRow(page, 'GC'));
  expect(await moreMenu(page).count()).toBe(1);
  expect(await menuLabels(page)).toEqual(ENT_MORE_ITEMS);
  await page.keyboard.press('Escape');
  await expect(moreMenu(page)).toHaveCount(0);

  // ========== TEMPLATE-ROW MORE ==========
  // Copy (overflow, not Select Duplicate)
  await openMore(page, templateRow(page, 'Security Walk-Through'));
  await clickMenuItem(page, 'Copy');
  await expect(moreMenu(page)).toHaveCount(0);
  await expect.poll(async () => templateNames(page)).toEqual([
    'Security Walk-Through',
    'Security Walk-Through copy',
    'MEP As-Built Markup',
  ]);
  await expectNoDirty(page);
  await templateRow(page, 'Security Walk-Through copy').click();
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);
  await templateRow(page, 'MEP As-Built Markup').click();
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  expect(await templateNames(page)).not.toContain('MEP As-Built Markup copy');
  const tplCopyIsolation = true;

  // Rename focuses the title (product: used to only select)
  await openMore(page, templateRow(page, 'MEP As-Built Markup'));
  await clickMenuItem(page, 'Rename');
  await expect.poll(async () => {
    const focus = await focusedField(page);
    return focus.templateTitle ? focus.value : '';
  }).toBe('MEP As-Built Markup');
  await typeIntoFocused(page, 'gone-tpl', 'Escape');
  await expect.poll(async () => visibleTemplateTitle(page)).toBe('MEP As-Built Markup');
  await expectNoDirty(page);

  await openMore(page, templateRow(page, 'MEP As-Built Markup'));
  await clickMenuItem(page, 'Rename');
  await expect.poll(async () => (await focusedField(page)).templateTitle).toBe(true);
  await typeIntoFocused(page, 'MEP Hunt');
  await expect.poll(async () => visibleTemplateTitle(page)).toBe('MEP Hunt');
  await expectDirty(page);
  await clickCancel(page);
  expect(await templateNames(page)).toEqual([
    'Security Walk-Through',
    'Security Walk-Through copy',
    'MEP As-Built Markup',
  ]);

  await openMore(page, templateRow(page, 'MEP As-Built Markup'));
  await clickMenuItem(page, 'Rename');
  await expect.poll(async () => (await focusedField(page)).templateTitle).toBe(true);
  await typeIntoFocused(page, 'E2E MEP');
  await expectDirty(page);
  await clickSave(page);
  expect(await templateNames(page)).toEqual([
    'Security Walk-Through',
    'Security Walk-Through copy',
    'E2E MEP',
  ]);
  expect(await templateNames(page)).toContain('Security Walk-Through');
  const tplRenameSaved = true;

  // Share fail-closed (More path, not Select)
  await templateRow(page, 'Security Walk-Through').click();
  await openMore(page, templateRow(page, 'Security Walk-Through'));
  await clickMenuItem(page, 'Share');
  await expect(shareDialog(page)).toBeVisible({ timeout: 8_000 });
  await shareDialog(page).getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(shareDialog(page).getByText(CLOUD_BLOCK)).toBeVisible();
  await shareDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(shareDialog(page)).toHaveCount(0);
  const tplShareFailClosed = true;

  // Delete the copy via More (not Select trash)
  await openMore(page, templateRow(page, 'Security Walk-Through copy'));
  await clickMenuItem(page, 'Delete');
  await expect.poll(async () => templateNames(page)).toEqual([
    'Security Walk-Through',
    'E2E MEP',
  ]);
  expect(await templateNames(page)).toContain('Security Walk-Through');
  expect(await templateNames(page)).toContain('E2E MEP');
  const tplDeleteIsolation = true;

  // ========== ENTITY MORE ==========
  await templateRow(page, 'Security Walk-Through').click();
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);

  // Duplicate via More
  await openMore(page, entityRow(page, 'GC'));
  await clickMenuItem(page, 'Duplicate');
  await expect.poll(async () => entityNames(page)).toEqual([
    'GC', 'GC copy', 'Subcontractor', '100% Complete',
  ]);
  await expectDirty(page);
  await clickCancel(page);
  expect(await entityNames(page)).toEqual(SECURITY_ENTITIES);

  await openMore(page, entityRow(page, 'GC'));
  await clickMenuItem(page, 'Duplicate');
  await expect.poll(async () => entityNames(page)).toContain('GC copy');
  await clickSave(page);
  await templateRow(page, 'E2E MEP').click();
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  await templateRow(page, 'Security Walk-Through').click();
  expect(await entityNames(page)).toEqual(['GC', 'GC copy', 'Subcontractor', '100% Complete']);
  const entDupIsolation = true;

  // Move/Copy dead stub
  await openMore(page, entityRow(page, 'GC'));
  await clickMenuItem(page, 'Move/Copy');
  await expect(moveDialog(page)).toBeVisible();
  await moveDialog(page).getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(moveDialog(page)).toHaveCount(0);
  expect(await entityNames(page)).toEqual(['GC', 'GC copy', 'Subcontractor', '100% Complete']);
  await expectNoDirty(page);

  await openMore(page, entityRow(page, 'GC'));
  await clickMenuItem(page, 'Move/Copy');
  await moveDialog(page).getByRole('button', { name: 'Move', exact: true }).click();
  await expect(moveDialog(page)).toHaveCount(0);
  expect(await entityNames(page)).toEqual(['GC', 'GC copy', 'Subcontractor', '100% Complete']);
  await templateRow(page, 'E2E MEP').click();
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  await templateRow(page, 'Security Walk-Through').click();

  await openMore(page, entityRow(page, 'GC'));
  await clickMenuItem(page, 'Move/Copy');
  await moveDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(moveDialog(page)).toHaveCount(0);
  const moveStubNoop = true;

  // Share fail-closed
  await openMore(page, entityRow(page, 'GC'));
  await clickMenuItem(page, 'Share');
  await expect(shareDialog(page)).toBeVisible({ timeout: 8_000 });
  await shareDialog(page).getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(shareDialog(page).getByText(CLOUD_BLOCK)).toBeVisible();
  await shareDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(shareDialog(page)).toHaveCount(0);
  const entShareFailClosed = true;

  // Rename focuses GC (product: used to only setOpenColor(null))
  await openMore(page, entityRow(page, 'GC'));
  await clickMenuItem(page, 'Rename');
  await expect.poll(async () => {
    const focus = await focusedField(page);
    return focus.placeholder === 'Entity name' ? focus.value : '';
  }).toBe('GC');
  await typeIntoFocused(page, 'gone-entity', 'Escape');
  expect(await entityNames(page)).toEqual(['GC', 'GC copy', 'Subcontractor', '100% Complete']);
  await expectNoDirty(page);

  await openMore(page, entityRow(page, 'GC'));
  await clickMenuItem(page, 'Rename');
  await expect.poll(async () => (await focusedField(page)).value).toBe('GC');
  await typeIntoFocused(page, 'General');
  await expect.poll(async () => entityNames(page)).toEqual(['General', 'GC copy', 'Subcontractor', '100% Complete']);
  await expectDirty(page);
  await clickCancel(page);
  expect(await entityNames(page)).toEqual(['GC', 'GC copy', 'Subcontractor', '100% Complete']);

  await openMore(page, entityRow(page, 'GC'));
  await clickMenuItem(page, 'Rename');
  await expect.poll(async () => (await focusedField(page)).value).toBe('GC');
  await typeIntoFocused(page, 'E2E More GC');
  await expectDirty(page);
  await clickSave(page);
  expect(await entityNames(page)).toEqual(['E2E More GC', 'GC copy', 'Subcontractor', '100% Complete']);
  await templateRow(page, 'E2E MEP').click();
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  await templateRow(page, 'Security Walk-Through').click();
  expect(await entityNames(page)).toEqual(['E2E More GC', 'GC copy', 'Subcontractor', '100% Complete']);
  const entRenameSaved = true;
  const entRenameIsolation = true;

  // Delete via More (not Select trash)
  await openMore(page, entityRow(page, 'GC copy'));
  await clickMenuItem(page, 'Delete');
  await expect.poll(async () => entityNames(page)).toEqual(['E2E More GC', 'Subcontractor', '100% Complete']);
  const confirmOpen = await page.locator('[data-testid="archive-confirm-modal"]').count();
  expect(confirmOpen, 'entity More Delete has no confirm').toBe(0);
  await expectDirty(page);
  await clickSave(page);
  await templateRow(page, 'E2E MEP').click();
  expect(await entityNames(page)).toEqual(MEP_ENTITIES);
  const entDeleteIsolation = true;

  // ========== 390 ==========
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  const mobileTplMore = mobileRow.getByRole('button', { name: 'More', exact: true });
  expect(await mobileTplMore.count(), '390 template More').toBe(1);

  await mobileTplMore.evaluate((button) => button.click());
  await expect(moreMenu(page)).toBeVisible();
  expect(await menuLabels(page)).toEqual(TPL_MORE_ITEMS);
  await page.keyboard.press('Escape');
  await expect(moreMenu(page)).toHaveCount(0);

  await mobileTplMore.evaluate((button) => button.click());
  await clickMenuItem(page, 'Copy');
  const mobileCopied = await page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through copy' }).count() > 0;

  await mobileTplMore.evaluate((button) => button.click());
  await clickMenuItem(page, 'Rename');
  await expect.poll(async () => {
    const focus = await focusedField(page);
    return focus.templateTitle ? focus.value : '';
  }).toBe('Security Walk-Through');
  const mobileTplRenameFocus = true;
  await page.keyboard.press('Escape');
  // More → Rename opens the 390 detail so the title can take focus.
  await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const entitiesDialog = page.getByRole('dialog', { name: 'Entities' });
  await expect(entitiesDialog).toBeVisible();
  const mobileGcRow = entitiesDialog.locator('[data-drag-rearrange-row]').filter({
    has: page.locator('input[placeholder="Entity name"][value="GC"]'),
  });
  const mobileEntMore = mobileGcRow.getByRole('button', { name: 'More', exact: true });
  expect(await mobileEntMore.count(), '390 entity More').toBe(1);
  await mobileEntMore.evaluate((button) => button.click());
  await expect(moreMenu(page)).toBeVisible();
  expect(await menuLabels(page)).toEqual(ENT_MORE_ITEMS);

  await clickMenuItem(page, 'Rename');
  await expect.poll(async () => {
    const focus = await focusedField(page);
    return focus.placeholder === 'Entity name' ? focus.value : '';
  }).toBe('GC');
  const mobileEntRenameFocus = true;

  await mobileEntMore.evaluate((button) => button.click());
  await clickMenuItem(page, 'Move/Copy');
  await expect(moveDialog(page)).toBeVisible();
  await moveDialog(page).getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(moveDialog(page)).toHaveCount(0);
  const mobileGcCopy = await entitiesDialog.locator('input[placeholder="Entity name"][value="GC copy"]').count();
  expect(mobileGcCopy, '390 Move/Copy stub does not mint').toBe(0);
  const mobileMoveStub = true;

  await mobileEntMore.evaluate((button) => button.click());
  await clickMenuItem(page, 'Share');
  await expect(shareDialog(page)).toBeVisible({ timeout: 8_000 });
  await shareDialog(page).getByRole('button', { name: 'Copy link', exact: true }).click();
  const mobileShareFailClosed = await shareDialog(page).getByText(CLOUD_BLOCK).count() > 0;
  await shareDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_MORE_MENU_PROOF: {
      leftoverKind: 'templates-more-menu',
      emptyTplMore,
      emptyEntMore,
      penOnHub,
      tplItems: TPL_MORE_ITEMS,
      entItems: ENT_MORE_ITEMS,
      escapeDismiss: true,
      outsideDismiss: true,
      oneMenu: true,
      tplCopyIsolation,
      tplRenameSaved,
      tplShareFailClosed,
      tplDeleteIsolation,
      entDupIsolation,
      moveStubNoop,
      entShareFailClosed,
      entRenameSaved,
      entRenameIsolation,
      entDeleteIsolation,
      mobileTplMore: 1,
      mobileCopied,
      mobileTplRenameFocus,
      mobileEntMore: 1,
      mobileEntRenameFocus,
      mobileMoveStub,
      mobileShareFailClosed,
    },
  }));
});
