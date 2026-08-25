import { test, expect } from '@playwright/test';

// Templates desktop checklist chrome already has visible names
// (`Add checklist item` / `Delete item`) but omitted type="button"
// (live type was null). 390 siblings already typed. Hosted on
// `?hubPreview=1&tab=templates`. Expand Cameras is setup only so
// the buttons become visible. Do NOT click Add checklist item /
// Delete item apply. Escape keeps the expanded list. Same a11y
// type class as Templates More / New template / Expand, new host
// (desktop checklist add + delete). Do not replay Templates More
// trigger type or Templates More menu name. Do not type MoreMenu
// menuitems. Do not open Edit-modules.
// Do not click Share / Delete / Duplicate / Move/Copy / Rename
// / New template apply / Restore / Delete forever / Open file
// / Upload / Sign out / Delete account.

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

function camerasCard(page) {
  return page.locator('.card-line').filter({
    has: page.locator(`input[aria-label="Click to rename"][value="${CATEGORY}"]`),
  }).first();
}

function addItem(page) {
  return camerasCard(page).getByRole('button', { name: 'Add checklist item', exact: true });
}

function deleteItem(page) {
  return camerasCard(page).getByRole('button', { name: 'Delete item', exact: true }).first();
}

function expandCameras(page) {
  return camerasCard(page).getByRole('button', { name: 'Expand', exact: true });
}

async function expectTyped(button, name) {
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
  const want = new Set(names);
  return page.evaluate((need) => (
    [...document.querySelectorAll('button')]
      .filter((node) => !node.getAttribute('type'))
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((name) => need.includes(name))
  ), [...want]);
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
  await expect(camerasCard(page)).toBeVisible({ timeout: 8_000 });
  const expand = expandCameras(page);
  await expect(expand).toBeVisible({ timeout: 8_000 });
  await expand.click();
  await expect(addItem(page)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByDisplayValue(ITEM).first()).toBeVisible({ timeout: 8_000 });
}

test('Templates checklist Add / Delete item are typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await setupExpandedCameras(page);

  await expectTyped(addItem(page), 'Add checklist item');
  await expectTyped(deleteItem(page), 'Delete item');
  expect(await implicitNamed(page, ['Add checklist item', 'Delete item'])).toEqual([]);
  expect(await addItem(page).count()).toBe(1);
  expect(await deleteItem(page).count()).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(addItem(page)).toBeVisible();
  await expect(page.getByDisplayValue(ITEM).first()).toBeVisible();
  await expectTyped(addItem(page), 'Add checklist item');
  await expectTyped(deleteItem(page), 'Delete item');
  await expect(camerasCard(page).getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();

  expect(await page.getByRole('dialog', { name: 'Move or copy items' }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for checklist chrome type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15_000 });
  const mobileExpand = page.getByRole('button', { name: `Expand ${CATEGORY}`, exact: true });
  await expect(mobileExpand).toBeVisible({ timeout: 8_000 });
  await mobileExpand.click();
  const mobileAdd = page.getByRole('button', { name: /Add checklist item/ }).first();
  await expect(mobileAdd).toBeVisible({ timeout: 8_000 });
  await expect(mobileAdd).toHaveAttribute('type', 'button');
  const mobileDelete = page.getByRole('button', { name: 'Delete item', exact: true }).first();
  await expect(mobileDelete).toBeVisible({ timeout: 8_000 });
  await expect(mobileDelete).toHaveAttribute('type', 'button');
  expect(await implicitNamed(page, ['Add checklist item', '+ Add checklist item', 'Delete item'])).toEqual([]);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No templates yet').first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'Add checklist item', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete item', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  await setupExpandedCameras(page);
  await expectTyped(addItem(page), 'Add checklist item');
  await expectTyped(deleteItem(page), 'Delete item');

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Add checklist item', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Add checklist item', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Add checklist item', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await page.getByRole('button', { name: 'Add checklist item', exact: true }).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.getByRole('button', { name: 'Add checklist item', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
