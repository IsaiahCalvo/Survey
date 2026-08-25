import { test, expect } from '@playwright/test';

// Templates desktop entity color Fill / Border tabs already have
// visible names (`Fill` / `Border`) but omitted type="button"
// (live type was null). 390 siblings already typed. Hosted on
// `?hubPreview=1&tab=templates`. Edit color is setup only so the
// tabs become visible. Do NOT click swatch / hex / Transparent
// (C-01). Do NOT click Add checklist item / Delete item apply.
// Escape dismisses the color panel. Same a11y type class as
// Templates More / checklist chrome, new host (desktop Fill +
// Border). Do not replay Templates checklist item chrome type,
// Templates More trigger type, or Templates More menu name. Do
// not type MoreMenu menuitems. Do not open Edit-modules.
// Do not click Share / Delete / Duplicate / Move/Copy / Rename
// / New template apply / New entity apply / Restore / Delete
// forever / Open file / Upload / Sign out / Delete account.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=templates';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const TEMPLATE = 'Security Walk-Through';
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

function fillTab(page) {
  return page.locator('[data-entity-color-panel]').getByRole('button', { name: 'Fill', exact: true }).first();
}

function borderTab(page) {
  return page.locator('[data-entity-color-panel]').getByRole('button', { name: 'Border', exact: true }).first();
}

function editColor(page) {
  return page.getByRole('button', { name: 'Edit color', exact: true }).first();
}

async function expectTyped(button, name) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toBe(name);
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function implicitNamed(page, names) {
  const want = new Set(names);
  return page.evaluate((need) => (
    [...document.querySelectorAll('button')]
      .filter((node) => !node.getAttribute('type'))
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((name) => need.includes(name))
  ), [...want]);
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

async function setupOpenColor(page) {
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 15_000 });
  await page.getByText(TEMPLATE).first().click();
  await expect(editColor(page)).toBeVisible({ timeout: 8_000 });
  await editColor(page).click();
  await expect(fillTab(page)).toBeVisible({ timeout: 8_000 });
  await expect(borderTab(page)).toBeVisible({ timeout: 8_000 });
}

test('Templates entity color Fill / Border are typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await setupOpenColor(page);

  await expectTyped(fillTab(page), 'Fill');
  await expectTyped(borderTab(page), 'Border');
  expect(await implicitNamed(page, ['Fill', 'Border'])).toEqual([]);
  expect(await fillTab(page).count()).toBeGreaterThan(0);
  expect(await borderTab(page).count()).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-entity-color-panel]')).toHaveCount(0);
  await expect(editColor(page)).toBeVisible();
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Border', exact: true }).count()).toBe(0);

  expect(await page.getByRole('dialog', { name: 'Move or copy items' }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for color layer type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15_000 });
  const mobileRow = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.evaluate((row) => row.click());
  await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });
  const entities = page.getByRole('button', { name: 'Entities', exact: true }).first();
  await expect(entities).toBeVisible({ timeout: 8_000 });
  await entities.click();
  await expect(page.getByRole('dialog', { name: 'Entities', exact: true })).toBeVisible({ timeout: 8_000 });
  const mobileEdit = page.locator('.templates-mobile-entity-modal').getByRole('button', { name: 'Edit color', exact: true }).first();
  await expect(mobileEdit).toBeVisible({ timeout: 8_000 });
  await mobileEdit.click();
  const mobileFill = page.locator('[data-entity-color-panel]').getByRole('button', { name: 'Fill', exact: true }).first();
  const mobileBorder = page.locator('[data-entity-color-panel]').getByRole('button', { name: 'Border', exact: true }).first();
  await expect(mobileFill).toBeVisible({ timeout: 8_000 });
  await expect(mobileFill).toHaveAttribute('type', 'button');
  await expect(mobileBorder).toBeVisible({ timeout: 8_000 });
  await expect(mobileBorder).toHaveAttribute('type', 'button');
  expect(await implicitNamed(page, ['Fill', 'Border'])).toEqual([]);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No templates yet').first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Border', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  await setupOpenColor(page);
  await expectTyped(fillTab(page), 'Fill');
  await expectTyped(borderTab(page), 'Border');

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
