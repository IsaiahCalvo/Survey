import { test, expect } from '@playwright/test';

// Survey category-main / category-arrow already have visible names
// (Walls / Windows after Two Category Template) but omitted
// type="button" (live type was null). Hosted on
// `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` via Two
// Category Template (setup only so the category rows appear). Same
// a11y type class as Create category plus / Close Survey panel,
// new host (post-template category row). CreateCategoryModal type
// and Survey Close type are exhausted — do not replay and do not
// click Create category confirm / Delete category / New entity /
// Y/N/N-A. Prove the type only: still named Walls / Windows,
// type=button does not empty accname or auto-create/delete.
// Opening a category arrow to confirm it still expands is OK when
// the arrow is present (count > 0). Do not click Export annotated
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

function createCategoryBtn(page) {
  return rightRail(page).locator('.survey-marker-category-create-button');
}

function categoryMain(page, name) {
  return rightRail(page).locator('button.survey-marker-category-main').filter({
    has: page.locator('.survey-marker-category-main-label', { hasText: new RegExp(`^${name}$`) }),
  });
}

function categoryArrows(page) {
  return rightRail(page).locator('button.survey-marker-category-arrow');
}

async function expectTypedNamed(button, nameIncludes) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toContain(nameIncludes);
  expect(accname.length).toBeGreaterThan(0);
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function implicitCategory(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('button.survey-marker-category-main, button.survey-marker-category-arrow')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
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

test('Survey category-main / arrow are typed; Create category / Delete are not applied', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  await enterTwoCategoryTemplate(page);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  await expect(createCategoryBtn(page)).toHaveAttribute('type', 'button');
  await expect(page.getByRole('button', { name: 'Close Survey panel', exact: true })).toHaveAttribute('type', 'button');
  await expectTypedNamed(categoryMain(page, 'Walls'), 'Walls');
  await expectTypedNamed(categoryMain(page, 'Windows'), 'Windows');
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();
  await expect(rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ })).toBeVisible();
  expect(await implicitCategory(page)).toEqual([]);

  const arrows = categoryArrows(page);
  const arrowCount = await arrows.count();
  if (arrowCount > 0) {
    await expect(arrows.first()).toHaveAttribute('type', 'button');
    const expandedBefore = await rightRail(page).locator('.survey-marker-item, [class*="survey-marker-category-items"]').count();
    await arrows.first().click();
    await expect(arrows.first()).toHaveAttribute('type', 'button');
    await arrows.first().click();
    expect(await rightRail(page).locator('.survey-marker-item, [class*="survey-marker-category-items"]').count())
      .toBe(expandedBefore);
  }

  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Delete .*categor/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Bold', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expectTypedNamed(categoryMain(page, 'Walls'), 'Walls');
  await expectTypedNamed(categoryMain(page, 'Windows'), 'Windows');
  expect(await implicitCategory(page)).toEqual([]);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  expect(await rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Walls$/ }).count()).toBe(1);
  expect(await rightRail(page).locator('.survey-marker-category-main-label', { hasText: /^Windows$/ }).count()).toBe(1);

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

test('390 + hubPreview + guest break/edge for Survey category-main / arrow type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: SURVEY_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  const mains390 = page.locator('button.survey-marker-category-main');
  await expect(mains390.first()).toBeVisible({ timeout: 15_000 });
  expect(await mains390.count()).toBeGreaterThan(0);
  for (const name of ['Walls', 'Windows']) {
    const btn = mains390.filter({
      has: page.locator('.survey-marker-category-main-label', { hasText: new RegExp(`^${name}$`) }),
    }).first();
    await expectTypedNamed(btn, name);
  }
  expect(await implicitCategory(page)).toEqual([]);
  const arrows390 = page.locator('button.survey-marker-category-arrow');
  const arrow390Count = await arrows390.count();
  if (arrow390Count > 0) {
    await expect(arrows390.first()).toHaveAttribute('type', 'button');
    await arrows390.first().click();
    await expect(arrows390.first()).toHaveAttribute('type', 'button');
  }
  expect(await page.locator('.survey-marker-category-create-button').count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  expect(await page.locator('.survey-marker-category-main-label', { hasText: /^Walls$/ }).count()).toBeGreaterThan(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('button.survey-marker-category-main').count()).toBe(0);
  expect(await page.locator('button.survey-marker-category-arrow').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.locator('button.survey-marker-category-main').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('button.survey-marker-category-main').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('button.survey-marker-category-main').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('button.survey-marker-category-main').count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await page.locator('button.survey-marker-category-main').count()).toBe(0);
  expect(await page.locator('button.survey-marker-category-arrow').count()).toBe(0);
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
