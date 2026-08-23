import { test, expect } from '@playwright/test';

// Templates desktop Category drag-title buttons already have a
// visible name (`${name} · drag to reorder · double-click to
// rename`) but omitted type="button" (live type was null).
// Same a11y type class as Entity Select / Template-list Select /
// Category Select / Module Select / New module / New entity /
// New category / New template / Add files / New project, new
// host (TemplatesEditor SortableModuleTab). Shared desktop +
// 390. Do not drag-apply reorder. Do not double-click to
// rename apply. Do not click New module / New category / New
// entity / Edit color / Select apply. Do not open
// Edit-modules. Do not stamp file.id.

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

function desktopDragTitles(page) {
  return page.locator('.ed-scope button[title$="· drag to reorder · double-click to rename"]').filter({ visible: true });
}

function mobileDragTitles(page) {
  return page.locator('.templates-mobile-module-tabs button[title$="· drag to reorder · double-click to rename"]').filter({ visible: true });
}

function namedDragTitle(page, name = DRAG_TITLE) {
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

test('Category drag-title is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });

  const tab = desktopDragTitles(page).first();
  await expect(tab).toBeVisible({ timeout: 8_000 });
  await expect(tab).toHaveAttribute('type', 'button');
  await expect(tab).toHaveAttribute('aria-label', DRAG_TITLE);
  await expect(tab).toHaveAttribute('title', DRAG_TITLE);
  await expect(namedDragTitle(page).first()).toBeVisible();
  expect(await desktopDragTitles(page).count()).toBeGreaterThan(1);

  await expect(page.getByRole('button', { name: 'New module', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Entity name', exact: true }).first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'New category', exact: true }).first().count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'New entity', exact: true }).first().count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'Edit color', exact: true }).first().count()).toBeGreaterThan(0);
  await expect(page.locator('.ed-scope p.micro').filter({ hasText: /^Module$/ })
    .locator('..')
    .getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('type', 'button');
  await expect(page.locator('.ed-scope p.micro').filter({ hasText: /^Categories$/ })
    .locator('..')
    .getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('type', 'button');
  await expect(page.locator('.ed-scope aside').first()
    .getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('type', 'button');
  await expect(page.locator('.ed-scope aside').filter({
    has: page.getByRole('button', { name: 'New entity', exact: true }),
  }).getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('type', 'button');

  await tab.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(TEMPLATE).first()).toBeVisible();
  await expect(tab).toHaveAttribute('type', 'button');
  await expect(tab).toHaveAttribute('aria-label', DRAG_TITLE);
  await expect(namedDragTitle(page).first()).toBeVisible();

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + projects + editor break/edge for Category drag-title type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopDragTitles(page).count()).toBe(0);
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.click();
  const mobile = mobileDragTitles(page).first();
  await expect(mobile).toBeVisible({ timeout: 10_000 });
  await expect(mobile).toHaveAttribute('type', 'button');
  await expect(mobile).toHaveAttribute('aria-label', DRAG_TITLE);
  await expect(namedDragTitle(page).first()).toBeVisible();

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await desktopDragTitles(page).count()).toBe(0);
  expect(await namedDragTitle(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search templates...', exact: true }).count()).toBeGreaterThan(0);
  await expect(desktopDragTitles(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(desktopDragTitles(page).first()).toHaveAttribute('type', 'button');
  await expect(desktopDragTitles(page).first()).toHaveAttribute('aria-label', DRAG_TITLE);
  await expect(page.getByRole('button', { name: 'New module', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Entity name', exact: true }).first()).toBeVisible();

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopDragTitles(page).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopDragTitles(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await desktopDragTitles(page).count()).toBe(0);
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
  expect(await desktopDragTitles(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
