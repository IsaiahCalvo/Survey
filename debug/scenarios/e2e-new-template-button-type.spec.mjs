import { test, expect } from '@playwright/test';

// Templates New template already has a visible name from innerText,
// but omitted type="button" (live type was null). Same a11y type
// class as Add files / New project / Invite-open Edit, new host
// (TemplatesEditor desktop + mobile create). EmptyState sibling
// already types New template. Do not click New template apply /
// Share / Delete / Edit modules / Move/Copy / rename. Do not
// stamp file.id.

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

function desktopNewTemplate(page) {
  return page.locator('.templates-editor-grid aside .btn-ink').filter({ hasText: 'New template' });
}

function mobileNewTemplate(page) {
  return page.locator('.templates-mobile-create-button');
}

function namedNewTemplate(page) {
  return page.getByRole('button', { name: 'New template', exact: true });
}

function desktopExpand(page) {
  return page.locator('.ed-scope button[aria-label="Expand"]').filter({ visible: true });
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

test('New template is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });

  const create = desktopNewTemplate(page);
  await expect(create).toBeVisible({ timeout: 8_000 });
  await expect(create).toHaveAttribute('type', 'button');
  await expect(create).toHaveText(/New template/);
  await expect(namedNewTemplate(page).first()).toBeVisible();
  await expect(namedNewTemplate(page).first()).toHaveAttribute('type', 'button');

  await expect(desktopExpand(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(desktopExpand(page).first()).toHaveAttribute('aria-label', 'Expand');
  await expect(desktopExpand(page).first()).toHaveAttribute('type', 'button');

  await create.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(TEMPLATE).first()).toBeVisible();
  expect(await page.getByRole('textbox', { name: 'Click to rename', exact: true }).first().inputValue()).toBe(TEMPLATE);

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + projects + editor break/edge for New template type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopNewTemplate(page).count()).toBe(0);
  const mobile = mobileNewTemplate(page);
  await expect(mobile).toBeVisible({ timeout: 8_000 });
  await expect(mobile).toHaveAttribute('type', 'button');
  await expect(namedNewTemplate(page).first()).toHaveAttribute('type', 'button');

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
  await expect(namedNewTemplate(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(namedNewTemplate(page).first()).toHaveAttribute('type', 'button');
  expect(await desktopExpand(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search templates...', exact: true }).count()).toBeGreaterThan(0);
  await expect(desktopNewTemplate(page)).toHaveAttribute('type', 'button');
  await expect(desktopExpand(page).first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopNewTemplate(page).count()).toBe(0);
  expect(await namedNewTemplate(page).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopNewTemplate(page).count()).toBe(0);
  expect(await namedNewTemplate(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedNewTemplate(page).count()).toBe(0);
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
  expect(await namedNewTemplate(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
