import { test, expect } from '@playwright/test';

// CreateCategoryModal Cancel / Create category already have visible
// names but omitted type="button" (live type was null). Hosted on
// `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` via Two
// Category Template → rail Create category (setup only). Same a11y
// type class as Confirm Cancel/Confirm / Rename Cancel/Save, new
// host (CreateCategoryModal Cancel / Create category). Dialog name
// is exhausted — do not replay CreateCategoryModal name. Rail plus
// and empty-module start-adding siblings are already typed. Prove
// the type only: still named Cancel / Create category, type=button
// does not empty accname or auto-submit. Escape / Cancel dismisses
// without applying Create category. Do NOT click the dialog Create
// category confirm. Do not click Restore / Delete forever / Open
// file / Share / Upload / Sign out / Delete account / Select apply
// / Create project. Font color / Bold / Italic stay 0 without
// richTextEditor. Do not replay Draw / Shapes / Text sub-toolbar
// type, Edit text type, Zoom/page-nav type, Export/Draw/Shapes/Text
// category type, or Undo/Redo type.

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

function createCategoryBtn(page) {
  return rightRail(page).locator('.survey-marker-category-create-button');
}

function namedCreate(page) {
  return page.getByRole('dialog', { name: 'Create category', exact: true });
}

function dialogCancel(page) {
  return namedCreate(page).getByRole('button', { name: 'Cancel', exact: true });
}

function dialogApply(page) {
  return namedCreate(page).getByRole('button', { name: 'Create category', exact: true });
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

async function expectImplicitTyped(dialog) {
  const implicit = await dialog.evaluate((node) => (
    [...node.querySelectorAll('button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'Cancel')).toBe(false);
  expect(implicit.some((name) => name === 'Create category')).toBe(false);
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
  await expect(createCategoryBtn(page)).toBeVisible({ timeout: 15_000 });
}

test('CreateCategory Cancel / Create category are typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  await enterTwoCategoryTemplate(page);
  expect(await namedCreate(page).count()).toBe(0);
  await expect(createCategoryBtn(page)).toHaveAttribute('type', 'button');
  await expect(createCategoryBtn(page)).toHaveAttribute('aria-label', 'Create category');

  await createCategoryBtn(page).click();
  const dialog = namedCreate(page);
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await expect(dialog).toHaveAttribute('aria-labelledby', 'create-category-modal-title');
  await expectTypedNamed(dialogCancel(page), 'Cancel');
  await expectTypedNamed(dialogApply(page), 'Create category');
  await expect(dialogApply(page)).toBeDisabled();
  await expectImplicitTyped(dialog);
  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Bold', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);

  await dialogCancel(page).click();
  await expect(namedCreate(page)).toHaveCount(0);
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ })).toBeVisible();

  await createCategoryBtn(page).click();
  await expect(namedCreate(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedNamed(dialogCancel(page), 'Cancel');
  await expectTypedNamed(dialogApply(page), 'Create category');
  await page.keyboard.press('Escape');
  await expect(namedCreate(page)).toHaveCount(0);
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

test('390 + hubPreview + guest break/edge for CreateCategory type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: SURVEY_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  expect(await page.locator('.survey-marker-category-create-button').count()).toBe(0);
  expect(await namedCreate(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Cancel', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCreate(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await namedCreate(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCreate(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCreate(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCreate(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedCreate(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Bold', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count()).toBe(0);
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
