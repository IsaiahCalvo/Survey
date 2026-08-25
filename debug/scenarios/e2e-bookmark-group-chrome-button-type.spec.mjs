import { test, expect } from '@playwright/test';

// Bookmarks Expand group / Collapse group / Add bookmark to group
// already have visible names but omitted type="button" (live type
// was null). Hosted on `?testPdf=Package 2 - Rev 4 -- IC.pdf` where
// the PDF outline already seeds groups — do NOT create a bookmark
// group and do NOT apply Add bookmark / Add bookmark to group.
// Expand/collapse only to confirm type. Same a11y type class as
// CreateCategory Cancel / Confirm Cancel, new host (BookmarksPanel
// group chevron + add-to-group plus). Create bookmark group /
// Add bookmarks to group / Add bookmark dialogs are exhausted —
// do not open them. Do not replay CreateCategoryModal type,
// Draw/Shapes/Text sub-toolbar types, Edit text type, category
// chrome types, Zoom/page-nav type, Undo/Redo type.

const OUTLINE_PDF = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SE011_PDF = '/?testPdf=se011.pdf';
const HUB = '/?hubPreview=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
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

async function openBookmarks(page) {
  const tab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible({ timeout: 8_000 });
}

async function openMobileBookmarks(page) {
  const dock = page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true });
  await expect(dock).toBeVisible({ timeout: 15_000 });
  const hubClose = page.getByRole('button', { name: 'Close document hub' });
  if (!(await hubClose.isVisible().catch(() => false))) {
    await dock.click();
  }
  await expect(hubClose).toBeVisible({ timeout: 15_000 });
  const bookmarksTab = page.locator('.mobile-pdf-hub-tab').filter({ hasText: 'Bookmarks' })
    .or(page.getByRole('button', { name: 'Bookmarks', exact: true }));
  await expect(bookmarksTab.first()).toBeVisible({ timeout: 15_000 });
  await bookmarksTab.first().click();
  await expect(page.getByRole('button', { name: /Add bookmark|Cancel new bookmark/ })).toBeVisible({ timeout: 15_000 });
}

function expandOrCollapse(page) {
  return page.getByRole('button', { name: /^(Expand group|Collapse group)$/ });
}

function enabledChevron(page) {
  return page.locator('button[aria-label="Expand group"]:not([disabled]), button[aria-label="Collapse group"]:not([disabled])');
}

function addToGroup(page) {
  return page.getByRole('button', { name: 'Add bookmark to group', exact: true });
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

test('outline groups Expand / Add-to-group are typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: OUTLINE_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);

  await openBookmarks(page);
  await expect(addToGroup(page).first()).toBeVisible({ timeout: 20_000 });
  expect(await page.getByRole('dialog', { name: 'Create bookmark group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Add bookmark', exact: true }).count()).toBe(0);

  const collapse = page.getByRole('button', { name: 'Collapse group', exact: true });
  const expand = page.getByRole('button', { name: 'Expand group', exact: true });
  expect((await collapse.count()) + (await expand.count())).toBeGreaterThan(0);
  expect(await addToGroup(page).count()).toBeGreaterThan(0);

  const firstChevron = enabledChevron(page).first();
  await expect(firstChevron).toBeVisible({ timeout: 8_000 });
  const beforeName = await firstChevron.getAttribute('aria-label');
  await expectTypedNamed(firstChevron, beforeName);
  await expectTypedNamed(addToGroup(page).first(), 'Add bookmark to group');
  expect(await implicitNamed(page, ['Expand group', 'Collapse group', 'Add bookmark to group'])).toEqual([]);

  await firstChevron.click();
  const afterName = beforeName === 'Collapse group' ? 'Expand group' : 'Collapse group';
  await expect(firstChevron).toHaveAttribute('aria-label', afterName);
  await expectTypedNamed(firstChevron, afterName);
  await firstChevron.click();
  await expect(firstChevron).toHaveAttribute('aria-label', beforeName);
  await expectTypedNamed(firstChevron, beforeName);
  await expectTypedNamed(addToGroup(page).first(), 'Add bookmark to group');
  expect(await implicitNamed(page, ['Expand group', 'Collapse group', 'Add bookmark to group'])).toEqual([]);

  expect(await page.getByRole('dialog', { name: 'Create bookmark group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true }).count()).toBe(0);
  expect(await page.getByText('New bookmark').count()).toBe(0);
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
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', viewBox);
});

test('390 + empty outline + hubPreview + guest break/edge for group chrome type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await openMobileBookmarks(page);
  expect(await expandOrCollapse(page).count()).toBe(0);
  expect(await addToGroup(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await openBookmarks(page);
  expect(await expandOrCollapse(page).count()).toBe(0);
  expect(await addToGroup(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  await openPage(page, { url: SE011_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await openBookmarks(page);
  const se011Chevron = expandOrCollapse(page).first();
  await expect(se011Chevron).toBeVisible({ timeout: 8_000 });
  const se011Name = await se011Chevron.getAttribute('aria-label');
  await expectTypedNamed(se011Chevron, se011Name);
  expect(await addToGroup(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await expandOrCollapse(page).count()).toBe(0);
  expect(await addToGroup(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await expandOrCollapse(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await expandOrCollapse(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await expandOrCollapse(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await expandOrCollapse(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
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
