import { test, expect } from '@playwright/test';

// Templates desktop category Expand already had a visible title tooltip,
// but omitted aria-label (accname was title-only). Same a11y name class
// as Templates Click to rename, new host (desktop category disclosure).
// Mobile already names Expand ${c.name}. Do not apply Expand as a write
// beyond toggle, and do not apply New template / Share / Delete / Edit
// modules / Move/Copy / rename. Do not stamp file.id.

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

function desktopExpand(page) {
  return page.locator('.ed-scope button[aria-label="Expand"]').filter({ visible: true });
}

function desktopCollapse(page) {
  return page.locator('.ed-scope button[aria-label="Collapse"]').filter({ visible: true });
}

function namedExpand(page) {
  return page.getByRole('button', { name: 'Expand', exact: true });
}

function namedCollapse(page) {
  return page.getByRole('button', { name: 'Collapse', exact: true });
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

test('Templates Expand is named; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });

  const expand = desktopExpand(page).first();
  await expect(expand).toBeVisible({ timeout: 8_000 });
  await expect(expand).toHaveAttribute('aria-label', 'Expand');
  await expect(expand).toHaveAttribute('title', 'Expand');
  await expect(expand).toHaveAttribute('type', 'button');
  await expect(namedExpand(page).first()).toBeVisible();

  await expand.click();
  const collapse = desktopCollapse(page).first();
  await expect(collapse).toBeVisible({ timeout: 8_000 });
  await expect(collapse).toHaveAttribute('aria-label', 'Collapse');
  await expect(collapse).toHaveAttribute('title', 'Collapse');
  await expect(namedCollapse(page).first()).toBeVisible();
  await collapse.click();
  await expect(desktopExpand(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(desktopExpand(page).first()).toHaveAttribute('aria-label', 'Expand');

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + projects + editor break/edge for Templates Expand', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopExpand(page).count()).toBe(0);
  expect(await namedExpand(page).count()).toBe(0);
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.click();
  const mobileExpand = page.getByRole('button', { name: /^Expand / }).first();
  await expect(mobileExpand).toBeVisible({ timeout: 10_000 });
  await expect(mobileExpand).toHaveAttribute('aria-label', /Expand /);
  expect(await desktopExpand(page).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const projectRow = page.locator('.projects-mobile-row, .projects-mobile-browser [data-project-id], .projects-mobile-layout [data-project-id]')
    .filter({ hasText: PROJECT }).first();
  const projectVisible = await projectRow.isVisible().catch(() => false);
  let tapRename = 0;
  let tapRenameLabel = null;
  if (projectVisible) {
    await projectRow.click();
    const tap = page.locator('input[title="Tap to rename"]').filter({ visible: true });
    tapRename = await tap.count();
    tapRenameLabel = tapRename ? await tap.first().getAttribute('aria-label') : null;
  }
  expect(tapRename === 0 || tapRenameLabel == null || tapRenameLabel === 'Tap to rename').toBeTruthy();

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await desktopExpand(page).count()).toBe(0);
  expect(await namedExpand(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search templates...', exact: true }).count()).toBeGreaterThan(0);
  await expect(desktopExpand(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(desktopExpand(page).first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopExpand(page).count()).toBe(0);
  expect(await namedExpand(page).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopExpand(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedExpand(page).count()).toBe(0);
  expect(await namedCollapse(page).count()).toBe(0);
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
  expect(await namedExpand(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
