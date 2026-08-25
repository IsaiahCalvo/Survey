import { test, expect } from '@playwright/test';

// Survey sub-toolbar category chips already have visible names
// (Walls / Windows after Two Category Template) but omitted
// type="button" (live type was null). Hosted on
// `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` via Two
// Category Template (setup only so the survey dropdown arms and
// chips appear in #chrome-sub-toolbar-host). Same a11y type class
// as Draw/Shapes/Text sub-toolbar tools, new host (post-template
// survey chips). Survey category-main / arrow type and Survey
// Close type are exhausted — do not replay and do not click
// Create category confirm / Delete category / New entity /
// Y/N/N-A / the chips themselves (arming a category). Prove the
// type only: still named Walls / Windows, type=button does not
// empty accname or place a marker.
// Do not click Export annotated PDF / Invite / Send / Create
// project / Confirm / Save / Restore / Delete forever / Open file
// / Share / Upload / Sign out / Delete account / Subscription
// apply / Start trial / Version history / Templates New entity
// apply / Callout apply / Pen / Highlighter / Eraser create /
// Rectangle / Ellipse / Line / Arrow / Counter apply / Create
// bookmark group / Add bookmark apply / Create space.

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

function toolbarHost(page) {
  return page.locator('#chrome-sub-toolbar-host');
}

function toolbarChip(page, name) {
  return toolbarHost(page).getByRole('button', { name, exact: true });
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
  expect(accname).not.toBe('');
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function implicitChips(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('#chrome-sub-toolbar-host button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((name) => name === 'Walls' || name === 'Windows')
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
  await expect(page.locator('#chrome-right-host .survey-marker-category-create-button')).toBeVisible({ timeout: 15_000 });
}

test('Survey toolbar category chips are typed; category arm / Create category are not applied', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await toolbarChip(page, 'Walls').count()).toBe(0);

  await enterTwoCategoryTemplate(page);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Close Survey panel', exact: true })).toHaveAttribute('type', 'button');
  await expect(page.locator('#chrome-right-host button.survey-marker-category-main').first()).toHaveAttribute('type', 'button');
  await expectTypedNamed(toolbarChip(page, 'Walls'), 'Walls');
  await expectTypedNamed(toolbarChip(page, 'Windows'), 'Windows');
  expect(await implicitChips(page)).toEqual([]);
  await expect(toolbarHost(page).getByRole('combobox', { name: 'Survey module', exact: true })).toBeVisible();
  expect(await page.locator('[data-survey-marker-id]').count()).toBe(0);

  await page.keyboard.press('Escape');
  await expectTypedNamed(toolbarChip(page, 'Walls'), 'Walls');
  await expectTypedNamed(toolbarChip(page, 'Windows'), 'Windows');
  expect(await implicitChips(page)).toEqual([]);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-survey-marker-id]').count()).toBe(0);
  await expect(page.locator('#chrome-right-host .survey-marker-category-main-label', { hasText: /^Walls$/ })).toBeVisible();

  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Bold', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);

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

test('390 + hubPreview + guest break/edge for Survey toolbar category chips', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: SURVEY_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
  const mains390 = page.locator('button.survey-marker-category-main');
  await expect(mains390.first()).toBeVisible({ timeout: 15_000 });
  expect(await mains390.first().getAttribute('type')).toBe('button');
  const chip390 = toolbarChip(page, 'Walls');
  const chip390Count = await chip390.count();
  if (chip390Count > 0) {
    await expectTypedNamed(chip390.first(), 'Walls');
    await expectTypedNamed(toolbarChip(page, 'Windows').first(), 'Windows');
    expect(await implicitChips(page)).toEqual([]);
  }
  await page.keyboard.press('Escape');
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-survey-marker-id]').count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const auth = page.getByRole('dialog', { name: 'Welcome back', exact: true });
  await expect(auth).toBeVisible({ timeout: 15_000 });
  expect(await toolbarChip(page, 'Walls').count()).toBe(0);
  await expect(auth.getByRole('button', { name: 'Sign in', exact: true })).toHaveAttribute('type', 'submit');
  await expect(auth.getByRole('button', { name: 'Continue with Google', exact: true })).toHaveAttribute('type', 'button');
  await page.keyboard.press('Escape');
  await expect(auth).toHaveCount(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await toolbarChip(page, 'Walls').count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await toolbarChip(page, 'Walls').count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await toolbarChip(page, 'Walls').count()).toBe(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await toolbarChip(page, 'Walls').count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await toolbarChip(page, 'Walls').count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
