import { test, expect } from '@playwright/test';

// CreateCategoryModal had role="dialog" + aria-modal but no aria-label /
// aria-labelledby. Sibling ConfirmModal / Settings / Share / Create
// project / Rename / Auth are named. Survey-rail Create category
// *apply* and ConfirmModal *name* are already dedicated — this leftover
// is the CreateCategoryModal accessible name. PromptModal lock stays
// leftover-18 / X-01 (hub Lock does not open a prompt). Do not replay
// ConfirmModal name or category Delete content. Do not stamp file.id.

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

function createCategoryBtn(page) {
  return rightRail(page).locator('.survey-marker-category-create-button');
}

function namedCreate(page) {
  return page.getByRole('dialog', { name: 'Create category', exact: true });
}

async function enterTwoCategoryTemplate(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  await expect(createCategoryBtn(page)).toBeVisible({ timeout: 15_000 });
}

test('CreateCategoryModal is named; cancel / empty / duplicate keep Walls', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  await enterTwoCategoryTemplate(page);
  expect(await namedCreate(page).count()).toBe(0);

  await createCategoryBtn(page).click();
  const dialog = namedCreate(page);
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await expect(dialog).toHaveAttribute('aria-labelledby', 'create-category-modal-title');
  await expect(page.locator('#create-category-modal-title')).toHaveText('Create category');
  await expect(dialog.getByPlaceholder('Enter category name...')).toBeVisible();
  await expect(dialog.getByText('Modify current template', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Save as new template', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create category', exact: true })).toBeDisabled();

  await dialog.getByPlaceholder('Enter category name...').fill('   ');
  await dialog.getByText('Modify current template', { exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Create category', exact: true })).toBeDisabled();

  await dialog.getByPlaceholder('Enter category name...').fill('Walls');
  await expect(dialog.getByText(/A category with this name already exists/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create category', exact: true })).toBeDisabled();

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(namedCreate(page)).toHaveCount(0);
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ })).toBeVisible();

  await createCategoryBtn(page).click();
  await expect(namedCreate(page)).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  await expect(namedCreate(page)).toHaveCount(0);

  expect(await page.getByRole('dialog', { name: 'Delete 1 category?', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview + idle editor break/edge for CreateCategoryModal name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: SURVEY_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  expect(await page.locator('.survey-marker-category-create-button').count()).toBe(0);
  expect(await namedCreate(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Delete 1 category?', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCreate(page).count()).toBe(0);
  await page.getByRole('button', { name: 'More' }).first().click();
  const lockItem = page.getByRole('menuitem', { name: /Lock document|Unlock document/ });
  if (await lockItem.count()) {
    await lockItem.first().click();
  }
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await namedCreate(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await namedCreate(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await namedCreate(page).count()).toBe(0);
  expect(await page.locator('[data-hub-keep-mount]').evaluate((host) => (
    host.hasAttribute('inert') || host.inert === true
  ))).toBe(true);
  expect(await fileId(page)).toBeNull();
});
