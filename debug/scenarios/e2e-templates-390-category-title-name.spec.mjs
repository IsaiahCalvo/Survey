import { test, expect } from '@playwright/test';

// 390 Templates category title <input> lacked the desktop
// `Click to rename` name (no title / aria-label). Desktop sibling
// already named. 390 template title already `Tap to rename`.
// Hosted on `?hubPreview=1&tab=templates` at 390 after template
// open — no apply. Do NOT fill / rename. Escape keeps the title.
// Same a11y name class as 390 template title / Projects Tap to
// rename, new host (390 category title). Do not replay desktop
// Templates Click to rename, Projects Tap to rename, Templates
// checklist item field name, Templates Fill/Border type,
// Templates checklist chrome type, Templates More trigger type,
// or Templates More menu name. Do not type MoreMenu menuitems.
// Do not open Edit-modules. Do not click Share / Delete /
// Duplicate / Move/Copy / Rename / New template apply / New
// entity apply / New category apply / Restore / Delete forever /
// Open file / Upload / Sign out / Delete account.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=templates';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const TEMPLATE = 'Security Walk-Through';
const CATEGORY = 'Cameras';
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

function mobileCategoryTitle(page) {
  return page.locator('.templates-mobile-detail input[data-mobile-category-id]');
}

function desktopCategoryTitle(page) {
  return page.locator('input.inline-edit.cat-title:not([data-template-title])');
}

async function expectNamedMobileCategory(field) {
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(field).toHaveAttribute('aria-label', 'Tap to rename');
  await expect(field).toHaveAttribute('title', 'Tap to rename');
  const accname = await field.evaluate((node) => (
    node.getAttribute('aria-label')
    || node.getAttribute('title')
    || node.getAttribute('placeholder')
    || ''
  ));
  expect(accname).toBe('Tap to rename');
  expect(accname).not.toBe('');
  const form = await field.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function setupMobileTemplate(page) {
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15_000 });
  const mobileRow = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.evaluate((row) => row.click());
  await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });
  const camerasField = page.locator(`.templates-mobile-detail input[data-mobile-category-id][value="${CATEGORY}"]`).first();
  await expect(camerasField).toBeVisible({ timeout: 8_000 });
  await expectNamedMobileCategory(camerasField);
  return camerasField;
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

test('390 Templates category title is named Tap to rename; apply is not taken', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  expect(await mobileCategoryTitle(page).count()).toBe(0);

  const field = await setupMobileTemplate(page);
  expect(await mobileCategoryTitle(page).count()).toBeGreaterThan(0);
  const beforeValue = await field.inputValue();
  expect(beforeValue).toBe(CATEGORY);

  await field.focus();
  await page.keyboard.press('Escape');
  await expectNamedMobileCategory(field);
  await expect(field).toHaveValue(CATEGORY);
  expect(await field.getAttribute('aria-label')).toBe('Tap to rename');
  expect(await field.getAttribute('aria-label')).not.toBe('');

  expect(await page.getByRole('dialog', { name: 'Move or copy items' }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('desktop sibling + empty + guest + tabs + editor break/edge for 390 category title name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 15_000 });
  await page.getByText(TEMPLATE).first().click();
  const desktopField = desktopCategoryTitle(page).first();
  await expect(desktopField).toBeVisible({ timeout: 8_000 });
  await expect(desktopField).toHaveAttribute('aria-label', 'Click to rename');
  await expect(desktopField).toHaveAttribute('title', 'Click to rename');
  const camerasDesktop = page.locator(`input.inline-edit.cat-title:not([data-template-title])[value="${CATEGORY}"]`).first();
  await expect(camerasDesktop).toBeVisible({ timeout: 8_000 });
  await expect(camerasDesktop).toHaveAttribute('aria-label', 'Click to rename');
  const desktopBefore = await camerasDesktop.inputValue();
  await camerasDesktop.focus();
  await page.keyboard.press('Escape');
  await expect(camerasDesktop).toHaveAttribute('aria-label', 'Click to rename');
  await expect(camerasDesktop).toHaveValue(desktopBefore);
  expect(await mobileCategoryTitle(page).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No templates yet').first()).toBeVisible();
  expect(await mobileCategoryTitle(page).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  const guestField = await setupMobileTemplate(page);
  await expectNamedMobileCategory(guestField);
  expect(await mobileCategoryTitle(page).count()).toBeGreaterThan(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await mobileCategoryTitle(page).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await mobileCategoryTitle(page).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await mobileCategoryTitle(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await mobileCategoryTitle(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await mobileCategoryTitle(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
