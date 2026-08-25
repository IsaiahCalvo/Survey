import { test, expect } from '@playwright/test';

// Survey header Close Survey panel already has a visible name but
// omitted type="button" (live type was null). Hosted on
// `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` via Two
// Category Template (setup only so the header Close appears). Same
// a11y type class as Settings Close / Access Close / Collapse Survey
// panel, new host (expanded Survey header X). Collapse / Expand /
// mobile backdrop / picker Close siblings are already typed. Create
// category rail plus + CreateCategoryModal type are exhausted — do
// not replay and do not click Create category confirm. Prove the
// type only: still named Close Survey panel, type=button does not
// empty accname or auto-submit. Close dismisses without applying
// Create category / Export / Sync. Do not click Export annotated
// PDF / Invite / Send / Create project / Confirm / Save / Restore /
// Delete forever / Open file / Share / Upload / Sign out / Delete
// account / Subscription apply / Start trial / Version history /
// Templates New entity apply / Callout apply / Pen / Highlighter /
// Eraser create / Rectangle / Ellipse / Line / Arrow / Counter
// apply / Create bookmark group / Add bookmark apply / Create space.

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

function headerClose(page) {
  return rightRail(page).getByRole('button', { name: 'Close Survey panel', exact: true });
}

function createCategoryBtn(page) {
  return rightRail(page).locator('.survey-marker-category-create-button');
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

async function implicitNamed(page, names) {
  return page.evaluate((wanted) => (
    [...document.querySelectorAll('button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((name) => wanted.includes(name))
  ), names);
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
  expect(await headerClose(page).count()).toBe(0);
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  await expect(createCategoryBtn(page)).toBeVisible({ timeout: 15_000 });
}

test('Survey Close is typed; Create category / Export are not applied', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  await enterTwoCategoryTemplate(page);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  await expect(createCategoryBtn(page)).toHaveAttribute('type', 'button');
  await expectTypedNamed(headerClose(page), 'Close Survey panel');
  await expect(page.getByRole('button', { name: 'Collapse Survey panel', exact: true })).toHaveAttribute('type', 'button');
  expect(await implicitNamed(page, ['Close Survey panel', 'Collapse Survey panel'])).toEqual([]);
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ })).toBeVisible();
  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Bold', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expectTypedNamed(headerClose(page), 'Close Survey panel');
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);

  await headerClose(page).click();
  await expect(headerClose(page)).toHaveCount(0);
  await expect(createCategoryBtn(page)).toHaveCount(0);
  expect(await rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
});

test('390 + hubPreview + guest break/edge for Survey Close type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: SURVEY_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  const pickerClose = page.getByRole('button', { name: 'Close Survey panel', exact: true });
  await expect(pickerClose.first()).toHaveAttribute('type', 'button');
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  const sheetClose = page.locator('.mobile-survey-sheet-header-actions, .mobile-pdf-sheet')
    .getByRole('button', { name: 'Close Survey panel', exact: true })
    .first();
  await expectTypedNamed(sheetClose, 'Close Survey panel');
  expect(await implicitNamed(page, ['Close Survey panel'])).toEqual([]);
  expect(await page.locator('.survey-marker-category-create-button').count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  await sheetClose.click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toHaveCount(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Close Survey panel', exact: true }).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.getByRole('button', { name: 'Close Survey panel', exact: true }).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Close Survey panel', exact: true }).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Close Survey panel', exact: true }).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Close Survey panel', exact: true }).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await page.getByRole('button', { name: 'Close Survey panel', exact: true }).count()).toBe(0);
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
