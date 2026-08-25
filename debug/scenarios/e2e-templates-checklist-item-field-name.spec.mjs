import { test, expect } from '@playwright/test';

// Templates desktop checklist item <input> was placeholder-only
// (`Add checklist item`) with no aria-label. Sibling Add / Delete
// item chrome already typed + named. Hosted on
// `?hubPreview=1&tab=templates`. Expand Cameras is setup only so
// the fields become visible. Do NOT click Add checklist item /
// Delete item apply. Do NOT fill / rename. Escape keeps the
// expanded list. Same a11y name class as Search text field /
// Manage Team search / Entity name, new host (checklist item
// field). Do not replay Templates entity color Fill / Border
// type, Templates checklist item chrome type, Templates More
// trigger type, or Templates More menu name. Do not type
// MoreMenu menuitems. Do not open Edit-modules.
// Do not click Share / Delete / Duplicate / Move/Copy / Rename
// / New template apply / New entity apply / Restore / Delete
// forever / Open file / Upload / Sign out / Delete account.

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
const ITEM = 'Is the camera installed?';
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

async function expandCategory(page, name) {
  const clicked = await page.evaluate((wanted) => {
    const titles = [...document.querySelectorAll('input.inline-edit.cat-title')];
    const field = titles.find((el) => el.value === wanted && el.offsetParent);
    if (!field) return false;
    const row = field.closest('[data-drag-rearrange-row]');
    const toggle = row?.querySelector('button[title="Expand"], button[title="Collapse"]');
    if (!toggle) return false;
    if (toggle.getAttribute('title') === 'Expand') toggle.click();
    return true;
  }, name);
  expect(clicked, `expand ${name}`).toBe(true);
}

function namedField(page) {
  return page.getByRole('textbox', { name: 'Checklist item', exact: true });
}

function seedItem(page) {
  return page.locator(`input[placeholder="Add checklist item"][value="${ITEM}"]`).first();
}

async function expectNamedField(field) {
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(field).toHaveAttribute('aria-label', 'Checklist item');
  await expect(field).toHaveAttribute('placeholder', 'Add checklist item');
  const accname = await field.evaluate((node) => (
    node.getAttribute('aria-label')
    || node.getAttribute('title')
    || node.getAttribute('placeholder')
    || ''
  ));
  expect(accname).toBe('Checklist item');
  expect(accname).not.toBe('Add checklist item');
  const form = await field.evaluate((node) => Boolean(node.closest('form')));
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

async function setupExpandedCameras(page) {
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 15_000 });
  await page.getByText(TEMPLATE).first().click();
  await expandCategory(page, CATEGORY);
  await expect(seedItem(page)).toBeVisible({ timeout: 8_000 });
  const field = namedField(page).first();
  await expectNamedField(field);
  return field;
}

test('Templates checklist item field is named; apply is not taken', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  expect(await namedField(page).count()).toBe(0);

  const field = await setupExpandedCameras(page);
  expect(await namedField(page).count()).toBeGreaterThan(0);
  await expect(seedItem(page)).toHaveAttribute('aria-label', 'Checklist item');

  await page.keyboard.press('Escape');
  await expectNamedField(field);
  await expect(seedItem(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse', exact: true }).first()).toBeVisible();
  expect(await namedField(page).count()).toBeGreaterThan(0);

  expect(await page.getByRole('dialog', { name: 'Move or copy items' }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for checklist item field name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15_000 });
  const mobileRow = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.evaluate((row) => row.click());
  await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });
  const camerasToggle = page.locator('.templates-mobile-category-toggle[aria-label*="Cameras"]').first();
  await expect(camerasToggle).toBeVisible({ timeout: 8_000 });
  if ((await camerasToggle.getAttribute('aria-label') || '').startsWith('Expand')) {
    await camerasToggle.evaluate((button) => button.click());
  }
  const mobileField = page.locator('.templates-mobile-detail').getByRole('textbox', { name: 'Checklist item', exact: true }).first();
  await expectNamedField(mobileField);
  expect(await page.locator('.templates-mobile-detail').getByRole('textbox', { name: 'Checklist item', exact: true }).count()).toBeGreaterThan(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No templates yet').first()).toBeVisible();
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  await setupExpandedCameras(page);
  expect(await namedField(page).count()).toBeGreaterThan(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedField(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await namedField(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
