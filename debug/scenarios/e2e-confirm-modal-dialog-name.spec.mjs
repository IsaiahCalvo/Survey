import { test, expect } from '@playwright/test';

// ConfirmModal had role="dialog" + aria-modal but no aria-label /
// aria-labelledby. Sibling ConfirmDeleteModal / Rename / Share /
// Create project / Settings are named. Survey-rail Delete selected
// categories *apply* is already dedicated — this leftover is the
// dialog accessible name. HubPreview Documents Delete is immediate
// (no ConfirmModal). Do not invent leftover-18 delete-forever /
// Stripe / account-delete. Distinct from leftover-18 / X-01 /
// nameless-menu / rail-toggle / dismiss / Home `?` / Settings dialog
// name / keep-mount inert. Do not stamp file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const TWO_CAT_TEMPLATE = /Two Category Template/;
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

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

function deleteCategoriesBtn(page) {
  return page.getByRole('button', { name: 'Delete selected categories' });
}

function categorySelectToggle(page) {
  return rightRail(page).locator('.survey-marker-category-select-button');
}

function namedConfirm(page, title) {
  return page.getByRole('dialog', { name: title, exact: true });
}

async function enterTwoCategoryTemplate(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  await expect(categorySelectToggle(page)).toBeVisible({ timeout: 15_000 });
}

async function enterCategorySelectMode(page) {
  if (await deleteCategoriesBtn(page).isVisible().catch(() => false)) return;
  await expect(categorySelectToggle(page)).toBeVisible({ timeout: 8_000 });
  await categorySelectToggle(page).click();
  await expect(deleteCategoriesBtn(page)).toBeVisible({ timeout: 8_000 });
}

async function selectCategory(page, name) {
  const deselect = page.getByRole('button', { name: `Deselect ${name}` });
  if (await deselect.count() && await deselect.first().isVisible().catch(() => false)) return;
  const select = page.getByRole('button', { name: `Select ${name}` });
  await expect(select).toBeVisible({ timeout: 8_000 });
  await select.click();
  await expect(page.getByRole('button', { name: `Deselect ${name}` })).toBeVisible({ timeout: 8_000 });
}

test('survey-rail ConfirmModal is named; cancel keeps categories', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  await enterTwoCategoryTemplate(page);
  await enterCategorySelectMode(page);

  await expect(deleteCategoriesBtn(page)).toBeVisible();
  await expect(deleteCategoriesBtn(page)).toBeDisabled();
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);

  await selectCategory(page, 'Walls');
  await expect(deleteCategoriesBtn(page)).toBeEnabled();
  await deleteCategoriesBtn(page).click();

  const one = namedConfirm(page, 'Delete 1 category?');
  await expect(one).toBeVisible({ timeout: 8_000 });
  await expect(one).toHaveAttribute('aria-labelledby', 'confirm-modal-title');
  await expect(page.locator('#confirm-modal-title')).toHaveText('Delete 1 category?');
  await expect(one.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(one.getByRole('button', { name: 'Delete category', exact: true })).toBeVisible();

  await one.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(namedConfirm(page, 'Delete 1 category?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deselect Walls' })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ })).toBeVisible();

  await selectCategory(page, 'Windows');
  await deleteCategoriesBtn(page).click();
  const two = namedConfirm(page, 'Delete 2 categories?');
  await expect(two).toBeVisible({ timeout: 8_000 });
  await expect(two).toHaveAttribute('aria-labelledby', 'confirm-modal-title');
  await expect(page.locator('#confirm-modal-title')).toHaveText('Delete 2 categories?');
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(namedConfirm(page, 'Delete 2 categories?')).toHaveCount(0);
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ })).toBeVisible();

  await deleteCategoriesBtn(page).click();
  await expect(namedConfirm(page, 'Delete 2 categories?')).toBeVisible({ timeout: 8_000 });
  await namedConfirm(page, 'Delete 2 categories?').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(namedConfirm(page, 'Delete 2 categories?')).toHaveCount(0);

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview Delete + guest break/edge for ConfirmModal name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: SURVEY_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  expect(await deleteCategoriesBtn(page).count()).toBe(0);
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const desktopRows = page.locator('.documents-desktop-card [data-document-id]');
  await expect(desktopRows.first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Done', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await desktopRows.filter({ hasText: 'test.pdf' }).first().click();
  const deleteBtn = page.getByRole('button', { name: 'Delete', exact: true }).first();
  await expect(deleteBtn).toBeEnabled();
  const idsBefore = await desktopRows.evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-document-id')),
  );
  await deleteBtn.click();
  expect(await page.getByRole('dialog').count()).toBe(0);
  const idsAfter = await desktopRows.evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-document-id')),
  );
  expect(idsAfter.length).toBe(idsBefore.length - 1);
  expect(idsAfter.includes('d6')).toBe(false);
  expect(await namedConfirm(page, 'Delete forever?').count()).toBe(0);
  expect(await namedConfirm(page, 'Move this document to Archive?').count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  expect(await page.locator('[data-hub-keep-mount]').evaluate((host) => (
    host.hasAttribute('inert') || host.inert === true
  ))).toBe(true);
  expect(await fileId(page)).toBeNull();
});
