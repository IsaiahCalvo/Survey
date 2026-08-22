import { test, expect } from '@playwright/test';

// Unique leftovers after Templates template-list + checklist item reorder:
// 1) list Search (`Search templates...` / `templateMatchesSearch`)
// 2) mobile content Search (`Search template...` / `templateContentSearch`)
// 3) Edit-modules `Search modules...` (`modSearch`)
// Distinct from PDF find, leftover-18, U-03 create/rename/delete.
// Move/Copy is a dead stub (Copy/Move only closeMoveModal). Do not invent
// Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces.
// UL-31 Continue pin parked. No file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const SEED_TEMPLATES = ['Security Walk-Through', 'MEP As-Built Markup'];
const CAMERAS_ITEMS = ['Is the camera cable pulled?', 'Is the camera installed?'];
const DOORS_ITEMS = ['Is the door roughed in?', 'Are the door devices installed?'];
const MEP_ITEMS = ['Tags updated?'];
const INSTALL_CATS = ['Cameras', 'Doors'];
const SECURITY_MODS = ['Installation Phase', 'Commissioning Phase'];

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function desktopSearch(page) {
  return page.locator('.templates-desktop-search input[placeholder="Search templates..."]');
}

function mobileListSearch(page) {
  return page.locator('.templates-mobile-search-actions input[placeholder="Search templates..."]');
}

function mobileContentSearch(page) {
  return page.locator('.templates-mobile-search-actions input[placeholder="Search template..."]');
}

function templatesList(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  });
}

function dirtyBar(page) {
  return page.locator('[data-entity-editor-actions]');
}

function editModulesModal(page) {
  return page.locator('.templates-module-edit-modal');
}

function moduleSearch(page) {
  return editModulesModal(page).locator('input[placeholder="Search modules..."]');
}

async function templateNames(page) {
  return templatesList(page).locator('[data-drag-rearrange-row]').evaluateAll((rows) => (
    rows.filter((row) => row.offsetParent).map((row) => {
      const title = row.querySelector('div[style*="font-weight"]');
      return (title?.textContent || '').trim();
    }).filter(Boolean)
  ));
}

async function mobileTemplateNames(page) {
  return page.locator('.templates-mobile-browser .templates-mobile-row strong').evaluateAll((nodes) => (
    nodes.filter((el) => el.offsetParent).map((el) => el.textContent.trim())
  ));
}

async function mobileCategoryNames(page) {
  return page.locator('.templates-mobile-category-row input.templates-mobile-inline-input').evaluateAll((inputs) => (
    inputs.filter((el) => el.offsetParent).map((el) => el.value)
  ));
}

async function mobileEntityNames(page) {
  return page.locator('.templates-mobile-entity-modal input.templates-mobile-inline-input').evaluateAll((inputs) => (
    inputs.filter((el) => el.offsetParent).map((el) => el.value)
  ));
}

async function moduleModalNames(page) {
  return editModulesModal(page).locator('[data-drag-rearrange-row] input').evaluateAll((inputs) => (
    inputs.filter((el) => el.offsetParent).map((el) => el.value)
  ));
}

async function fillSearch(input, value) {
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.click();
  await input.fill(value);
}

async function openTemplateFromList(page, name) {
  await templatesList(page).locator('[data-drag-rearrange-row]').filter({ hasText: name }).click();
  await expect(page.locator('.templates-editor-grid input.inline-edit.cat-title[title="Click to rename"]').first()).toHaveValue(name, { timeout: 8_000 });
}

async function expectNoDirty(page) {
  await expect(dirtyBar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
}

function categoryRow(page, name) {
  return page.locator('.templates-editor-grid [data-drag-rearrange-row]')
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

async function openDesktopEditModules(page) {
  const select = page.locator('p.micro', { hasText: /^Module$/ }).locator('xpath=following-sibling::button[1]');
  await expect(select).toBeVisible({ timeout: 8_000 });
  await select.click();
  await expect(editModulesModal(page)).toBeVisible({ timeout: 8_000 });
}

test('Templates list Search + mobile content Search + Edit-modules Search modules', async ({ page }) => {
  test.setTimeout(180_000);

  // --- Empty hub: search chrome exists, no rows, empty copy stays "yet" ---
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 30_000 });
  await expect(desktopSearch(page)).toBeVisible();
  expect(await templateNames(page)).toEqual([]);
  await fillSearch(desktopSearch(page), 'xyzzy');
  await expect(page.getByText('No templates yet').first()).toBeVisible();
  await expect(page.getByText('No templates match your search.')).toHaveCount(0);
  await expectNoDirty(page);
  const emptySearchVisible = true;

  // --- Seed list Search (desktop) ---
  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  expect(await templateNames(page)).toEqual(SEED_TEMPLATES);
  await expect(desktopSearch(page)).toBeVisible();
  await expect(page.locator('.templates-mobile-search-actions')).toBeHidden();
  await expectNoDirty(page);

  await fillSearch(desktopSearch(page), '');
  expect(await templateNames(page)).toEqual(SEED_TEMPLATES);
  await fillSearch(desktopSearch(page), '   ');
  expect(await templateNames(page), 'whitespace-only query is empty').toEqual(SEED_TEMPLATES);

  await fillSearch(desktopSearch(page), 'security');
  await expect.poll(async () => templateNames(page)).toEqual(['Security Walk-Through']);
  const nameMatch = await templateNames(page);

  await fillSearch(desktopSearch(page), 'SECURITY');
  await expect.poll(async () => templateNames(page)).toEqual(['Security Walk-Through']);
  const caseMatch = true;

  await fillSearch(desktopSearch(page), 'ahu');
  await expect.poll(async () => templateNames(page)).toEqual(['MEP As-Built Markup']);
  const categoryMatch = await templateNames(page);

  await fillSearch(desktopSearch(page), 'architect');
  await expect.poll(async () => templateNames(page)).toEqual(['MEP As-Built Markup']);
  const entityMatch = await templateNames(page);

  await fillSearch(desktopSearch(page), 'camera cable');
  await expect.poll(async () => templateNames(page)).toEqual(['Security Walk-Through']);
  const itemMatch = await templateNames(page);

  await fillSearch(desktopSearch(page), 'xyzzy');
  await expect.poll(async () => templateNames(page)).toEqual([]);
  await expect(page.getByText('No templates match your search.')).toBeVisible();
  const noMatch = true;

  await fillSearch(desktopSearch(page), 'mep');
  await expect.poll(async () => templateNames(page)).toEqual(['MEP As-Built Markup']);
  await expect(page.locator('.templates-editor-grid input.inline-edit.cat-title[value="AHU Equipment"]')).toBeVisible();
  const selectedFollowsVisible = true;

  await desktopSearch(page).click();
  await page.keyboard.press('Escape');
  expect(await desktopSearch(page).inputValue(), 'Escape blurs and does not clear').toBe('mep');
  expect(await templateNames(page)).toEqual(['MEP As-Built Markup']);
  const escapeKeepsQuery = true;

  await fillSearch(desktopSearch(page), '');
  await expect.poll(async () => templateNames(page)).toEqual(SEED_TEMPLATES);
  const clearRestores = true;
  await expectNoDirty(page);

  await fillSearch(desktopSearch(page), 'security');
  await expect.poll(async () => templateNames(page)).toEqual(['Security Walk-Through']);
  await openTemplateFromList(page, 'Security Walk-Through');
  const firstClickOpensFiltered = true;
  await fillSearch(desktopSearch(page), '');
  await expect.poll(async () => templateNames(page)).toEqual(SEED_TEMPLATES);

  await openTemplateFromList(page, 'Security Walk-Through');
  await expandCategory(page, 'Cameras');
  expect(await itemNamesInCategory(page, 'Cameras')).toEqual(CAMERAS_ITEMS);
  await expandCategory(page, 'Doors');
  expect(await itemNamesInCategory(page, 'Doors')).toEqual(DOORS_ITEMS);
  await openTemplateFromList(page, 'MEP As-Built Markup');
  await expandCategory(page, 'AHU Equipment');
  expect(await itemNamesInCategory(page, 'AHU Equipment')).toEqual(MEP_ITEMS);
  await openTemplateFromList(page, 'Security Walk-Through');
  await expectNoDirty(page);
  const listIsolation = true;

  // --- Edit-modules Search modules (desktop) ---
  await openDesktopEditModules(page);
  expect(await moduleModalNames(page)).toEqual(SECURITY_MODS);
  await fillSearch(moduleSearch(page), 'install');
  await expect.poll(async () => moduleModalNames(page)).toEqual(['Installation Phase']);
  await fillSearch(moduleSearch(page), 'INSTALLATION');
  await expect.poll(async () => moduleModalNames(page)).toEqual(['Installation Phase']);
  await fillSearch(moduleSearch(page), 'xyzzy');
  await expect.poll(async () => moduleModalNames(page)).toEqual([]);
  await expect(editModulesModal(page).getByText('No modules match your search.')).toBeVisible();
  await fillSearch(moduleSearch(page), 'PHASE');
  await expect.poll(async () => moduleModalNames(page)).toEqual(SECURITY_MODS);
  await moduleSearch(page).click();
  await page.keyboard.press('Escape');
  expect(await moduleSearch(page).inputValue(), 'module Escape does not clear').toBe('PHASE');
  await fillSearch(moduleSearch(page), '');
  await expect.poll(async () => moduleModalNames(page)).toEqual(SECURITY_MODS);
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editModulesModal(page)).toHaveCount(0);
  await openDesktopEditModules(page);
  expect(await moduleSearch(page).inputValue(), 'close modal clears modSearch').toBe('');
  expect(await moduleModalNames(page)).toEqual(SECURITY_MODS);
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expectNoDirty(page);
  const moduleSearchDesktop = true;

  // --- 390 list Search ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.templates-mobile-browser')).toBeVisible({ timeout: 15_000 });
  await expect(mobileListSearch(page)).toBeVisible();
  expect(await mobileTemplateNames(page)).toEqual(SEED_TEMPLATES);

  await fillSearch(mobileListSearch(page), 'mep');
  await expect.poll(async () => mobileTemplateNames(page)).toEqual(['MEP As-Built Markup']);
  await fillSearch(mobileListSearch(page), 'XYZZY');
  await expect.poll(async () => mobileTemplateNames(page)).toEqual([]);
  await expect(page.locator('.templates-mobile-browser').getByText('No templates match your search')).toBeVisible();
  await fillSearch(mobileListSearch(page), 'WALK');
  await expect.poll(async () => mobileTemplateNames(page)).toEqual(['Security Walk-Through']);
  await mobileListSearch(page).click();
  await page.keyboard.press('Escape');
  expect(await mobileListSearch(page).inputValue()).toBe('WALK');
  await fillSearch(mobileListSearch(page), '');
  await expect.poll(async () => mobileTemplateNames(page)).toEqual(SEED_TEMPLATES);
  await expectNoDirty(page);
  const mobileListSearchOk = true;

  // --- 390 content Search (open template) ---
  const mobileRow = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  await mobileRow.evaluate((row) => row.click());
  await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });
  await expect(mobileContentSearch(page)).toBeVisible();
  expect(await mobileContentSearch(page).inputValue(), 'open template clears content search').toBe('');
  expect(await mobileCategoryNames(page)).toEqual(INSTALL_CATS);

  await fillSearch(mobileContentSearch(page), 'doors');
  await expect.poll(async () => mobileCategoryNames(page)).toEqual(['Doors']);
  await fillSearch(mobileContentSearch(page), 'CABLE');
  await expect.poll(async () => mobileCategoryNames(page)).toEqual(['Cameras']);
  await fillSearch(mobileContentSearch(page), 'xyzzy');
  await expect.poll(async () => mobileCategoryNames(page)).toEqual([]);
  await expect(page.getByText('No categories match this view.')).toBeVisible();
  await mobileContentSearch(page).click();
  await page.keyboard.press('Escape');
  expect(await mobileContentSearch(page).inputValue()).toBe('xyzzy');
  await fillSearch(mobileContentSearch(page), '');
  await expect.poll(async () => mobileCategoryNames(page)).toEqual(INSTALL_CATS);
  await expectNoDirty(page);

  await fillSearch(mobileContentSearch(page), 'gc');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.locator('.templates-mobile-entity-modal')).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => mobileEntityNames(page)).toEqual(['GC']);
  await page.locator('.templates-mobile-entity-modal').getByRole('button', { name: 'Close', exact: true }).click();
  await fillSearch(mobileContentSearch(page), 'architect');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect.poll(async () => mobileEntityNames(page)).toEqual([]);
  await expect(page.getByText('No entities match this view.')).toBeVisible();
  await page.locator('.templates-mobile-entity-modal').getByRole('button', { name: 'Close', exact: true }).click();
  await fillSearch(mobileContentSearch(page), '');
  await expectNoDirty(page);
  const mobileContentSearchOk = true;

  await page.locator('.templates-mobile-back-button').click();
  await expect(page.locator('.templates-mobile-browser')).toBeVisible({ timeout: 8_000 });
  const mepRow = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: 'MEP As-Built Markup' }).first();
  await mepRow.evaluate((row) => row.click());
  await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 8_000 });
  expect(await mobileContentSearch(page).inputValue(), 'opening another template resets content search').toBe('');
  expect(await mobileCategoryNames(page)).toEqual(['AHU Equipment']);
  await expectNoDirty(page);
  const contentIsolation = true;

  // --- 390 Edit-modules Search ---
  await page.locator('.templates-mobile-section-select').filter({ hasText: 'Select' }).first().click();
  await expect(editModulesModal(page)).toBeVisible({ timeout: 8_000 });
  expect(await moduleModalNames(page)).toEqual(['Equipment']);
  await fillSearch(moduleSearch(page), 'equip');
  await expect.poll(async () => moduleModalNames(page)).toEqual(['Equipment']);
  await fillSearch(moduleSearch(page), 'xyzzy');
  await expect.poll(async () => moduleModalNames(page)).toEqual([]);
  await expect(editModulesModal(page).getByText('No modules match your search.')).toBeVisible();
  await fillSearch(moduleSearch(page), '');
  await expect.poll(async () => moduleModalNames(page)).toEqual(['Equipment']);
  await editModulesModal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expectNoDirty(page);
  const moduleSearchMobile = true;

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_SEARCH_PROOF: {
      leftoverKind: 'templates-list-and-content-and-module-search',
      emptySearchVisible,
      nameMatch,
      caseMatch,
      categoryMatch,
      entityMatch,
      itemMatch,
      noMatch,
      selectedFollowsVisible,
      escapeKeepsQuery,
      clearRestores,
      firstClickOpensFiltered,
      listIsolation,
      moduleSearchDesktop,
      mobileListSearchOk,
      mobileContentSearchOk,
      contentIsolation,
      moduleSearchMobile,
      noDirty: true,
    },
  }));
});
