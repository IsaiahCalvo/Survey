import { test, expect } from '@playwright/test';

// Templates desktop Module Select already has a visible name
// "Select", but omitted type="button" (live type was null).
// Same a11y type class as New module / New entity / New
// category / New template / Add files / New project, new host
// (TemplatesEditor desktop Module header Select). Mobile
// sibling already typed. Do not click Select apply / do not
// switch modules as an apply. Do not click New module /
// New category / New entity / Edit color / Share / Delete /
// rename / module edits. Do not open Edit-modules.
// Do not stamp file.id.

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

function desktopModuleSelect(page) {
  return page.locator('.ed-scope p.micro').filter({ hasText: /^Module$/ })
    .locator('..')
    .getByRole('button', { name: 'Select', exact: true });
}

function mobileModuleSelect(page) {
  return page.locator('.templates-mobile-section-select').filter({ visible: true });
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

test('Module Select is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });

  const select = desktopModuleSelect(page);
  await expect(select).toBeVisible({ timeout: 8_000 });
  await expect(select).toHaveAttribute('type', 'button');
  await expect(select).toHaveText('Select');

  await expect(page.getByRole('button', { name: 'New module', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Entity name', exact: true }).first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'New category', exact: true }).first().count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'New entity', exact: true }).first().count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'Edit color', exact: true }).first().count()).toBeGreaterThan(0);

  await select.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(TEMPLATE).first()).toBeVisible();
  await expect(select).toHaveAttribute('type', 'button');
  await expect(select).toHaveText('Select');

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + projects + editor break/edge for Module Select type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopModuleSelect(page).count()).toBe(0);
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.click();
  const mobile = mobileModuleSelect(page);
  await expect(mobile.first()).toBeVisible({ timeout: 8_000 });
  await expect(mobile.first()).toHaveAttribute('type', 'button');
  await expect(mobile.first()).toHaveText('Select');

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await desktopModuleSelect(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search templates...', exact: true }).count()).toBeGreaterThan(0);
  await expect(desktopModuleSelect(page)).toHaveAttribute('type', 'button');
  await expect(page.getByRole('button', { name: 'New module', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Entity name', exact: true }).first()).toBeVisible();

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopModuleSelect(page).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopModuleSelect(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await desktopModuleSelect(page).count()).toBe(0);
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
  expect(await desktopModuleSelect(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
