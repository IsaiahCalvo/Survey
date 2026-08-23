import { test, expect } from '@playwright/test';

// Templates header / category rename already had a visible title tooltip,
// but omitted aria-label (accname was title-only). Same a11y name class
// as Share-open Click to rename, new host (TemplatesEditor). Do not
// apply rename / New template / Share / Delete / Edit modules /
// Move/Copy. Projects Click to rename / Drag to rearrange stay
// dedicated. Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=templates';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const TEMPLATE = 'Security Walk-Through';
const PROJECT = 'Tower 5 — Security';
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

function templatesRename(page) {
  return page.locator('.ed-scope input[data-template-title][aria-label="Click to rename"]').filter({ visible: true });
}

function templatesTapRename(page) {
  return page.locator('.templates-mobile-title-input[aria-label="Tap to rename"]').filter({ visible: true });
}

function clickToRename(page) {
  return page.getByRole('textbox', { name: 'Click to rename', exact: true });
}

function tapToRename(page) {
  return page.getByRole('textbox', { name: 'Tap to rename', exact: true });
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

test('Templates Click to rename is named; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });

  const rename = templatesRename(page);
  await expect(rename).toBeVisible({ timeout: 8_000 });
  await expect(rename).toHaveAttribute('aria-label', 'Click to rename');
  await expect(rename).toHaveAttribute('title', 'Click to rename');
  await expect(rename).toHaveValue(TEMPLATE);
  await expect(clickToRename(page).first()).toBeVisible();

  await rename.focus();
  await page.keyboard.press('Escape');
  await expect(rename).toHaveValue(TEMPLATE);
  await expect(rename).toHaveAttribute('aria-label', 'Click to rename');

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + projects + editor break/edge for Templates Click to rename', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await templatesRename(page).count()).toBe(0);
  expect(await tapToRename(page).count()).toBe(0);
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.click();
  const tap = templatesTapRename(page);
  await expect(tap).toBeVisible({ timeout: 10_000 });
  await expect(tap).toHaveAttribute('aria-label', 'Tap to rename');
  await expect(tap).toHaveAttribute('title', 'Tap to rename');
  await expect(tap).toHaveValue(TEMPLATE);
  await tap.focus();
  await page.keyboard.press('Escape');
  await expect(tap).toHaveValue(TEMPLATE);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await templatesRename(page).count()).toBe(0);
  expect(await tapToRename(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search templates...', exact: true }).count()).toBeGreaterThan(0);
  await expect(templatesRename(page)).toBeVisible({ timeout: 8_000 });
  await expect(templatesRename(page)).toHaveValue(TEMPLATE);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await templatesRename(page).count()).toBe(0);
  expect(await tapToRename(page).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await templatesRename(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await clickToRename(page).count()).toBe(0);
  expect(await tapToRename(page).count()).toBe(0);
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
  expect(await clickToRename(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
