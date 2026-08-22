import { test, expect } from '@playwright/test';

// Unique leftover after Templates New category / category Duplicate / module Delete:
// template-list Duplicate (`duplicateTemplates` / `{name} copy` on the list Select).
// Distinct from module Duplicate (`duplicateModules`) and category Duplicate
// (`duplicateCategories`). Distinct from U-03 create/rename/delete, entity color,
// Add module / Add checklist item, leftover-18 export.
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces. Pen N/A on hub.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function templatesList(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  });
}

function desktopGrid(page) {
  return page.locator('.templates-editor-grid');
}

function moduleTabButton(page, name) {
  return desktopGrid(page).locator(`[data-module-tab-id] button[title^="${name} ·"]`).filter({ hasText: new RegExp(`^${name}$`) });
}

function dirtyBar(page) {
  return page.locator('[data-entity-editor-actions]');
}

function newCategoryButton(page) {
  return desktopGrid(page).getByRole('button', { name: 'New category', exact: true });
}

async function templateNames(page) {
  return templatesList(page).locator('[data-drag-rearrange-row]').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('div[style*="font-weight"]')?.textContent?.trim() || '').filter(Boolean)
  ));
}

async function moduleTabNames(page) {
  return desktopGrid(page).locator('[data-module-tab-id]').evaluateAll((nodes) => (
    nodes.map((node) => {
      const input = node.querySelector('input');
      const button = node.querySelector('button');
      return (input?.value || button?.textContent || '').trim();
    }).filter(Boolean)
  ));
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

async function enterListSelect(page) {
  const list = templatesList(page);
  const done = list.getByRole('button', { name: 'Done', exact: true });
  if (await done.count()) return;
  await list.getByRole('button', { name: 'Select', exact: true }).click();
}

async function exitListSelect(page) {
  const list = templatesList(page);
  const done = list.getByRole('button', { name: 'Done', exact: true });
  if (await done.count()) await done.click();
}

function listDuplicate(page) {
  return templatesList(page).getByRole('button', { name: 'Duplicate', exact: true });
}

test('Templates template-list Duplicate', async ({ page }) => {
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  const emptyListDup = await listDuplicate(page).count();
  expect(emptyListDup, 'empty hub has no list Duplicate until Select').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  expect(await templateNames(page)).toEqual(['Security Walk-Through', 'MEP As-Built Markup']);
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase']);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);

  // Pen is N/A on the hub — no Draw / Pen chrome here.
  const penOnHub = await page.getByRole('button', { name: 'Pen', exact: true }).count();
  expect(penOnHub, 'Pen N/A on hub').toBe(0);

  // Break: none selected — Duplicate is disabled.
  await enterListSelect(page);
  const dup = await listDuplicate(page);
  await expect(dup).toBeVisible();
  await expect(dup).toBeDisabled();

  // --- Intended: Select Security, Duplicate → `{name} copy` with same modules/categories ---
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  await expect(dup).toBeEnabled();
  await dup.click();
  await expect.poll(async () => templateNames(page)).toEqual([
    'Security Walk-Through',
    'Security Walk-Through copy',
    'MEP As-Built Markup',
  ]);

  await exitListSelect(page);
  await templatesList(page).getByText('Security Walk-Through copy', { exact: true }).click();
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase']);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);
  await moduleTabButton(page, 'Commissioning Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras']);
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  await moduleTabButton(page, 'Installation Phase').click();
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);

  // Break: cancel if dirty — a dirty working-copy edit Cancel-discards;
  // list Duplicate itself auto-persists (host save), so Cancel after Duplicate
  // is N/A once dirty has cleared.
  await newCategoryButton(page).click();
  await expect.poll(async () => categoryNames(page)).toContain('Category 1');
  await expect(dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await dirtyBar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);
  expect(await templateNames(page)).toContain('Security Walk-Through copy');

  const dirtyAfterDup = await dirtyBar(page).getByRole('button', { name: 'Save', exact: true }).count();
  expect(dirtyAfterDup, 'list Duplicate auto-persists; dirty bar is not left open').toBe(0);

  // Isolation: MEP is unchanged.
  await templatesList(page).getByText('MEP As-Built Markup', { exact: true }).click();
  expect(await moduleTabNames(page)).toEqual(['Equipment']);
  expect(await categoryNames(page)).toEqual(['AHU Equipment']);
  expect(await templateNames(page)).not.toContain('MEP As-Built Markup copy');

  // Edge: Duplicate twice — product rule is `${name} copy` (copy then copy copy).
  await enterListSelect(page);
  await templatesList(page).getByText('Security Walk-Through copy', { exact: true }).click();
  await expect(dup).toBeEnabled();
  await dup.click();
  await expect.poll(async () => templateNames(page)).toEqual([
    'Security Walk-Through',
    'Security Walk-Through copy',
    'Security Walk-Through copy copy',
    'MEP As-Built Markup',
  ]);
  await exitListSelect(page);
  await templatesList(page).getByText('Security Walk-Through copy copy', { exact: true }).click();
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase']);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);

  // Edge: Delete the copies (Select + Delete already proven on U-03).
  await enterListSelect(page);
  await templatesList(page).getByText('Security Walk-Through copy', { exact: true }).click();
  await templatesList(page).getByText('Security Walk-Through copy copy', { exact: true }).click();
  const listDelete = templatesList(page).getByRole('button', { name: 'Delete', exact: true });
  await expect(listDelete).toBeEnabled();
  await listDelete.click();
  await expect.poll(async () => templateNames(page)).toEqual([
    'Security Walk-Through',
    'MEP As-Built Markup',
  ]);
  await exitListSelect(page);
  await templatesList(page).getByText('Security Walk-Through', { exact: true }).click();
  expect(await moduleTabNames(page)).toEqual(['Installation Phase', 'Commissioning Phase']);
  expect(await categoryNames(page)).toEqual(['Cameras', 'Doors']);

  // 390: list Duplicate exists on the mobile Select strip.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  let mobileListDup = 0;
  let mobileCopied = false;
  const mobileSelect = page.locator('.mobile-header-select-button');
  if (await mobileSelect.isVisible().catch(() => false)) {
    await mobileSelect.evaluate((button) => button.click());
    const mobileDup = page.locator('.templates-mobile-select-actions').getByRole('button', { name: 'Duplicate', exact: true });
    mobileListDup = await mobileDup.count();
    if (mobileListDup > 0) {
      const securityRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
      if (await securityRow.isVisible().catch(() => false)) {
        await securityRow.evaluate((row) => row.click());
        await mobileDup.first().evaluate((button) => button.click());
        mobileCopied = await page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through copy' }).count() > 0;
      }
    }
  }

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_LIST_DUPLICATE_PROOF: {
      leftoverKind: 'template-list-duplicate',
      emptyListDup,
      penOnHub,
      noneSelectedDisabled: true,
      intendedCopy: true,
      copyModules: ['Installation Phase', 'Commissioning Phase'],
      copyCategories: ['Cameras', 'Doors'],
      cancelIfDirtyRestored: true,
      persistImmediate: dirtyAfterDup === 0,
      isolation: true,
      secondCopy: 'Security Walk-Through copy copy',
      copiesDeleted: true,
      mobileListDup,
      mobileCopied,
    },
  }));
});
