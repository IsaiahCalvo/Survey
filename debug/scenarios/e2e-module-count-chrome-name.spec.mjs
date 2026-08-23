import { test, expect } from '@playwright/test';

// Templates module sortable wrappers already exposed count-suffixed
// innerText (`Installation Phase 2` / `Commissioning Phase 1`) via
// dnd-kit role="button" but omitted aria-label (accname was
// unnamed / innerText-only). Same a11y name class as Category
// drag titles, new host (SortableModuleTab wrapper, desktop
// showCounts). Do not apply module edits. Do not drag-apply
// reorder. Do not click New category / New entity / Edit color
// apply / New template / rename. Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=templates';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const TEMPLATE = 'Security Walk-Through';
const PROJECT = 'Tower 5 — Security';
const MODULE = 'Installation Phase';
const COUNT_LABEL = `${MODULE} 2`;
const SIBLING_LABEL = 'Commissioning Phase 1';
const DRAG_TITLE = `${MODULE} · drag to reorder · double-click to rename`;
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

function desktopCountChrome(page) {
  return page.locator('.ed-scope [data-module-tab-id][aria-label$=" 2"], .ed-scope [data-module-tab-id][aria-label$=" 1"]').filter({ visible: true });
}

function namedCountChrome(page, name = COUNT_LABEL) {
  return page.getByRole('button', { name, exact: true });
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

test('Module count chrome is named; module edits not applied', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });

  const tab = page.locator(`.ed-scope [data-module-tab-id][aria-label="${COUNT_LABEL}"]`).first();
  await expect(tab).toBeVisible({ timeout: 8_000 });
  await expect(tab).toHaveAttribute('aria-label', COUNT_LABEL);
  await expect(namedCountChrome(page).first()).toBeVisible();
  await expect(namedCountChrome(page, SIBLING_LABEL).first()).toBeVisible();
  expect(await desktopCountChrome(page).count()).toBeGreaterThan(1);
  await expect(page.getByRole('button', { name: DRAG_TITLE, exact: true }).first()).toBeVisible();

  await tab.focus();
  await page.keyboard.press('Escape');
  await expect(tab).toHaveAttribute('aria-label', COUNT_LABEL);
  await expect(namedCountChrome(page).first()).toBeVisible();
  await expect(namedCountChrome(page, SIBLING_LABEL).first()).toBeVisible();

  expect(await page.getByRole('button', { name: 'New category', exact: true }).first().count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'New entity', exact: true }).first().count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'Edit color', exact: true }).first().count()).toBeGreaterThan(0);
  await expect(page.getByRole('textbox', { name: 'Entity name', exact: true }).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + projects + editor break/edge for Module count chrome', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCountChrome(page).count()).toBe(0);
  expect(await namedCountChrome(page, SIBLING_LABEL).count()).toBe(0);
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.click();
  expect(await namedCountChrome(page).count()).toBe(0);
  expect(await namedCountChrome(page, SIBLING_LABEL).count()).toBe(0);
  const mobileTab = page.locator('.templates-mobile-module-tabs [data-module-tab-id]').first();
  await expect(mobileTab).toBeVisible({ timeout: 10_000 });
  await expect(mobileTab).toHaveAttribute('aria-label', MODULE);
  await mobileTab.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.templates-mobile-module-tabs [data-module-tab-id]').first()).toHaveAttribute('aria-label', MODULE);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await namedCountChrome(page).count()).toBe(0);
  expect(await desktopCountChrome(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search templates...', exact: true }).count()).toBeGreaterThan(0);
  await expect(namedCountChrome(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(`.ed-scope [data-module-tab-id][aria-label="${COUNT_LABEL}"]`).first()).toHaveAttribute('aria-label', COUNT_LABEL);
  await expect(page.getByRole('textbox', { name: 'Click to rename', exact: true }).first()).toBeVisible();

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCountChrome(page).count()).toBe(0);
  expect(await namedCountChrome(page, SIBLING_LABEL).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCountChrome(page).count()).toBe(0);
  expect(await namedCountChrome(page, SIBLING_LABEL).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedCountChrome(page).count()).toBe(0);
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
  expect(await namedCountChrome(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
