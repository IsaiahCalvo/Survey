import { test, expect } from '@playwright/test';

// Templates More *menu* exposes a name (items were already menuitems).
// Unique leftover after Archive Show and sort menu name (`d14be7cf` / `9cdcd522`).
// Live hubPreview Templates More opened role="menu" with no aria-label —
// getByRole('menu', { name: /actions$/ }) was 0 while Share menuitem
// was 1. Same a11y *name* class as Documents More / Archive Show and
// sort, but a new compile-visible host (.ed-tpl-menu). Official
// annotationContextMenuitem leftover vs spec Enter is not stale vs
// live source (source already has Enter; spec-only). Distinct from
// leftover-18 / X-01 persist / nameless-menu hosts already proved /
// unnamed-dialog family / remapped-after-CW / dismiss / rail-toggle /
// Documents More name / Archive Show and sort / Templates More overflow
// apply / leftover-18 module Move/Copy apply.
// Do not click Delete. Do not apply Move/Copy. Do not name Activity.
// Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=templates';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const TEMPLATE = 'Security Walk-Through';
const ENTITY = 'GC';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function templateMenu(page) {
  return page.getByRole('menu', { name: `${TEMPLATE} actions`, exact: true });
}

function entityMenu(page) {
  return page.getByRole('menu', { name: `${ENTITY} actions`, exact: true });
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

function templateRow(page, name) {
  return templatesList(page).locator('[data-drag-rearrange-row]').filter({ hasText: name }).first();
}

function entityRow(page, role) {
  return entitiesRail(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator(`input[placeholder="Entity name"][value="${role}"]`),
  });
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

test('desktop Templates More menu is named + Share; Escape dismisses', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await templatesList(page).getByRole('button', { name: 'More' }).count()).toBe(0);
  expect(await templateMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await templateMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });
  expect(await templateMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);

  await templateRow(page, TEMPLATE).getByRole('button', { name: 'More' }).click();
  await expect(templateMenu(page)).toBeVisible();
  for (const name of ['Copy', 'Rename', 'Share', 'Delete']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(templateMenu(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Share template' })).toHaveCount(0);

  await templateRow(page, TEMPLATE).getByRole('button', { name: 'More' }).click();
  await expect(templateMenu(page)).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expect(templateMenu(page)).toHaveCount(0);
  const share = page.getByRole('dialog', { name: 'Share template' });
  await expect(share).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);

  await entityRow(page, ENTITY).getByRole('button', { name: 'More' }).click();
  await expect(entityMenu(page)).toBeVisible();
  for (const name of ['Duplicate', 'Move/Copy', 'Share', 'Rename', 'Delete']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await expect(entityMenu(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Move or copy items' })).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + editor break for Templates More menu name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  expect(await templateMenu(page).count()).toBe(0);
  await mobileRow.getByRole('button', { name: 'More', exact: true }).click();
  await expect(templateMenu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(templateMenu(page)).toHaveCount(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await templateMenu(page).count()).toBe(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  expect(await templateMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await templateMenu(page).count()).toBe(0);
  await page.locator('.archive-desktop-search .archive-filter-button').click();
  await expect(page.getByRole('menu', { name: 'Show and sort', exact: true })).toBeVisible();
  expect(await templateMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
  await expect(team).toBeVisible({ timeout: 10_000 });
  await team.getByRole('button', { name: 'More', exact: true }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(1);
  expect(await templateMenu(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(await templateMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menu', { name: 'Eraser Type', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
