import { test, expect } from '@playwright/test';

// Templates entity rename already had a visible placeholder,
// but omitted aria-label (accname was placeholder-only). Same
// a11y name class as Click to rename / Tap to rename, new host
// (TemplatesEditor entity rail + 390 Entities dialog). Do not
// apply rename / New category / New entity / Edit color / Share
// / Delete / Edit modules / Move/Copy. Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=templates';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const TEMPLATE = 'Security Walk-Through';
const PROJECT = 'Tower 5 — Security';
const ENTITY = 'GC';
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

function desktopEntityName(page) {
  return page.locator('.ed-scope input.inline-edit[placeholder="Entity name"][aria-label="Entity name"]').filter({ visible: true });
}

function mobileEntityName(page) {
  return page.locator('.templates-mobile-entity-modal input[placeholder="Entity name"][aria-label="Entity name"]').filter({ visible: true });
}

function namedEntityName(page) {
  return page.getByRole('textbox', { name: 'Entity name', exact: true });
}

function clickToRename(page) {
  return page.getByRole('textbox', { name: 'Click to rename', exact: true });
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

test('Entity name is named; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });

  const field = desktopEntityName(page).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(field).toHaveAttribute('aria-label', 'Entity name');
  await expect(field).toHaveAttribute('placeholder', 'Entity name');
  await expect(field).toHaveValue(ENTITY);
  await expect(namedEntityName(page).first()).toBeVisible();

  await field.focus();
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue(ENTITY);
  await expect(field).toHaveAttribute('aria-label', 'Entity name');

  expect(await page.getByRole('button', { name: 'New category', exact: true }).first().count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'New entity', exact: true }).first().count()).toBeGreaterThan(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + projects + editor break/edge for Entity name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopEntityName(page).count()).toBe(0);
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const mobileDialog = page.getByRole('dialog', { name: 'Entities', exact: true });
  await expect(mobileDialog).toBeVisible({ timeout: 10_000 });
  const mobile = mobileEntityName(page).first();
  await expect(mobile).toBeVisible({ timeout: 8_000 });
  await expect(mobile).toHaveAttribute('aria-label', 'Entity name');
  await expect(mobile).toHaveAttribute('placeholder', 'Entity name');
  await expect(mobile).toHaveValue(ENTITY);
  await mobile.focus();
  await page.keyboard.press('Escape');
  await expect(mobile).toHaveValue(ENTITY);
  await expect(mobile).toHaveAttribute('aria-label', 'Entity name');

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await desktopEntityName(page).count()).toBe(0);
  expect(await namedEntityName(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search templates...', exact: true }).count()).toBeGreaterThan(0);
  await expect(desktopEntityName(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(desktopEntityName(page).first()).toHaveValue(ENTITY);
  await expect(clickToRename(page).first()).toBeVisible();

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopEntityName(page).count()).toBe(0);
  expect(await namedEntityName(page).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopEntityName(page).count()).toBe(0);
  expect(await namedEntityName(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedEntityName(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await namedEntityName(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
