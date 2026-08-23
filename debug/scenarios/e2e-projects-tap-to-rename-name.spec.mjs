import { test, expect } from '@playwright/test';

// Projects mobile drill rename already had a visible title tooltip,
// but omitted aria-label (accname was title-only). Same a11y name
// class as desktop Click to rename / Templates Tap to rename, new
// host (ProjectsFolderTree 390 drill). Do not apply rename / Add
// files / New project / Upload / Pin / Lock / Delete / Share /
// Send. Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const PROJECT = 'Tower 5 — Security';
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

function projectsTapRename(page) {
  return page.locator('.projects-mobile-title-input[aria-label="Tap to rename"]').filter({ visible: true });
}

function clickToRename(page) {
  return page.getByRole('textbox', { name: 'Click to rename', exact: true });
}

function tapToRename(page) {
  return page.getByRole('textbox', { name: 'Tap to rename', exact: true });
}

function mobileProjectRow(page) {
  return page.locator('.projects-mobile-row, .projects-mobile-browser [data-project-id], .projects-mobile-layout [data-project-id]')
    .filter({ hasText: PROJECT }).first();
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

test('Projects Tap to rename is named; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await clickToRename(page).count()).toBe(0);
  const row = mobileProjectRow(page);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  const tap = projectsTapRename(page);
  await expect(tap).toBeVisible({ timeout: 10_000 });
  await expect(tap).toHaveAttribute('aria-label', 'Tap to rename');
  await expect(tap).toHaveAttribute('title', 'Tap to rename');
  await expect(tap).toHaveValue(PROJECT);
  await expect(tapToRename(page).first()).toBeVisible();

  await tap.focus();
  await page.keyboard.press('Escape');
  await expect(tap).toHaveValue(PROJECT);
  await expect(tap).toHaveAttribute('aria-label', 'Tap to rename');

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('desktop + empty + guest + templates + editor break/edge for Projects Tap to rename', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectsTapRename(page).count()).toBe(0);
  expect(await tapToRename(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);
  await expect(clickToRename(page).first()).toBeVisible();

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await projectsTapRename(page).count()).toBe(0);
  expect(await tapToRename(page).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search projects...', exact: true }).count()).toBeGreaterThan(0);
  const guestRow = mobileProjectRow(page);
  await expect(guestRow).toBeVisible({ timeout: 15_000 });
  await guestRow.click();
  await expect(projectsTapRename(page)).toBeVisible({ timeout: 10_000 });
  await expect(projectsTapRename(page)).toHaveValue(PROJECT);
  await expect(projectsTapRename(page)).toHaveAttribute('aria-label', 'Tap to rename');

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectsTapRename(page).count()).toBe(0);
  expect(await tapToRename(page).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { width: 390, height: 844, url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectsTapRename(page).count()).toBe(0);
  const mobileTpl = page.locator('.templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileTpl).toBeVisible({ timeout: 15_000 });
  await mobileTpl.click();
  await expect(page.locator('.templates-mobile-title-input[aria-label="Tap to rename"]')).toHaveValue(TEMPLATE);

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
  expect(await tapToRename(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
