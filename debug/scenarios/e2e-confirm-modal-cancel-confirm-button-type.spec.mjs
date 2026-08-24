import { test, expect } from '@playwright/test';

// ConfirmModal Cancel / Confirm already have visible names
// but omitted type="button" (live type was null). Hosted on
// `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` via
// Two Category Template → category Select → Walls → Delete
// selected categories (setup only). Same a11y type class as
// Rename Cancel/Save / Settings Sign out, new host
// (ConfirmModal Cancel / Confirm). Dialog name is exhausted —
// do not replay ConfirmModal name. Prove the type only: still
// named Cancel / Delete category, type=button does not empty
// accname or auto-submit. Escape / Cancel / Close dismisses
// without applying Confirm. Do NOT click Confirm / Delete
// category. Do not click Restore / Delete forever / Open file
// / Share / Upload / Sign out / Delete account / Select apply
// / Create project. Do not take Select-gated All / None /
// Duplicate / Move/Copy / Restore / Delete forever themselves.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
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

function confirmCancel(page, title) {
  return namedConfirm(page, title).getByRole('button', { name: 'Cancel', exact: true });
}

function confirmApply(page, title, label) {
  return namedConfirm(page, title).getByRole('button', { name: label, exact: true });
}

function confirmClose(page, title) {
  return namedConfirm(page, title).getByRole('button', { name: 'Close', exact: true });
}

async function expectTypedNamed(button, name) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toBe(name);
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
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

async function expectImplicitTyped(dialog) {
  const implicit = await dialog.evaluate((node) => (
    [...node.querySelectorAll('button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'Cancel')).toBe(false);
  expect(implicit.some((name) => name === 'Close')).toBe(false);
  expect(implicit.some((name) => /Delete categor/.test(name) || name === 'Confirm')).toBe(false);
}

test('Confirm Cancel / Confirm are typed; Confirm apply not clicked', async ({ page }) => {
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
  await expectTypedNamed(confirmCancel(page, 'Delete 1 category?'), 'Cancel');
  await expectTypedNamed(confirmApply(page, 'Delete 1 category?', 'Delete category'), 'Delete category');
  await expectTypedNamed(confirmClose(page, 'Delete 1 category?'), 'Close');
  await expectImplicitTyped(one);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await confirmCancel(page, 'Delete 1 category?').click();
  await expect(namedConfirm(page, 'Delete 1 category?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deselect Walls' })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ })).toBeVisible();

  await selectCategory(page, 'Windows');
  await deleteCategoriesBtn(page).click();
  const two = namedConfirm(page, 'Delete 2 categories?');
  await expect(two).toBeVisible({ timeout: 8_000 });
  await expectTypedNamed(confirmCancel(page, 'Delete 2 categories?'), 'Cancel');
  await expectTypedNamed(confirmApply(page, 'Delete 2 categories?', 'Delete categories'), 'Delete categories');
  await expectImplicitTyped(two);

  await page.keyboard.press('Escape');
  await expect(namedConfirm(page, 'Delete 2 categories?')).toHaveCount(0);
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ })).toBeVisible();

  await deleteCategoriesBtn(page).click();
  await expect(namedConfirm(page, 'Delete 2 categories?')).toBeVisible({ timeout: 8_000 });
  await confirmClose(page, 'Delete 2 categories?').click();
  await expect(namedConfirm(page, 'Delete 2 categories?')).toHaveCount(0);
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ })).toBeVisible();

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview Delete + guest break/edge for Confirm Cancel/Confirm type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: SURVEY_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  expect(await deleteCategoriesBtn(page).count()).toBe(0);
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Cancel', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete category', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  expect(await namedConfirm(page, 'Delete forever?').count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Rename document', exact: true }).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  expect(await namedConfirm(page, 'Delete forever?').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedConfirm(page, 'Delete 1 category?').count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-hub-keep-mount]').evaluate((host) => (
    host.hasAttribute('inert') || host.inert === true
  ))).toBe(true);
  expect(await fileId(page)).toBeNull();
});
