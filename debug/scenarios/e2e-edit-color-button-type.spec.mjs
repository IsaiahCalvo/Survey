import { test, expect } from '@playwright/test';

// Templates Edit color already has a visible name from aria-label,
// but omitted type="button" on the desktop host (live type was
// null). Same a11y type class as New entity / New category /
// New template / Add files / New project, new host
// (TemplatesEditor desktop entity color chip). Mobile sibling
// already typed. Do not click Edit color apply / New entity /
// New category / Share / Delete / rename. Do not stamp file.id.

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

function desktopEditColor(page) {
  return page.locator('.ed-scope button[title="Edit color"]').filter({ visible: true });
}

function mobileEditColor(page) {
  return page.locator('.templates-mobile-entity-row button[title="Edit color"]').filter({ visible: true });
}

function namedEditColor(page) {
  return page.getByRole('button', { name: 'Edit color', exact: true });
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

test('Edit color is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });

  const chip = desktopEditColor(page).first();
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await expect(chip).toHaveAttribute('type', 'button');
  await expect(chip).toHaveAttribute('aria-label', 'Edit color');
  await expect(namedEditColor(page).first()).toBeVisible();
  await expect(namedEditColor(page).first()).toHaveAttribute('type', 'button');

  await expect(page.getByRole('textbox', { name: 'Entity name', exact: true }).first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'New category', exact: true }).first().count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'New entity', exact: true }).first().count()).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'New category', exact: true }).first()).toHaveAttribute('type', 'button');
  await expect(page.getByRole('button', { name: 'New entity', exact: true }).first()).toHaveAttribute('type', 'button');

  await chip.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(TEMPLATE).first()).toBeVisible();
  await expect(chip).toHaveAttribute('type', 'button');
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + projects + editor break/edge for Edit color type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopEditColor(page).count()).toBe(0);
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const mobileDialog = page.getByRole('dialog', { name: 'Entities', exact: true });
  await expect(mobileDialog).toBeVisible({ timeout: 10_000 });
  const mobile = mobileEditColor(page);
  await expect(mobile.first()).toBeVisible({ timeout: 8_000 });
  await expect(mobile.first()).toHaveAttribute('type', 'button');
  await expect(namedEditColor(page).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 15_000 });
  // Empty templates mounts no entity rows, so Edit color is 0.
  // Do not click New entity apply to invent a host.
  expect(await desktopEditColor(page).count()).toBe(0);
  expect(await namedEditColor(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'New entity', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search templates...', exact: true }).count()).toBeGreaterThan(0);
  await expect(desktopEditColor(page).first()).toHaveAttribute('type', 'button');
  await expect(page.getByRole('textbox', { name: 'Entity name', exact: true }).first()).toBeVisible();

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopEditColor(page).count()).toBe(0);
  expect(await namedEditColor(page).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopEditColor(page).count()).toBe(0);
  expect(await namedEditColor(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedEditColor(page).count()).toBe(0);
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
  expect(await namedEditColor(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
