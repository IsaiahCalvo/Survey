import { test, expect } from '@playwright/test';

// Search panel query input was placeholder-only (no aria-label).
// Sibling Clear search / Previous match / Next match are already
// named. Search rail toggle / Search Previous-Next type / Search
// clear name stay dedicated. Do NOT apply Previous / Next. Do NOT
// replay Bookmarks drag grip name. Do NOT stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
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
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
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

function namedField(page) {
  return page.getByRole('textbox', { name: 'Search text in PDF', exact: true });
}

async function expectNamedField(field) {
  await expect(field).toBeVisible({ timeout: 10_000 });
  await expect(field).toHaveAttribute('aria-label', 'Search text in PDF');
  const accname = await field.evaluate((node) => (
    node.getAttribute('aria-label')
    || node.getAttribute('title')
    || node.getAttribute('placeholder')
    || ''
  ));
  expect(accname).toBe('Search text in PDF');
  expect(accname).not.toBe('Search text in PDF...');
  expect(accname).not.toBe('Search text');
  const form = await field.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function openDesktopSearch(page) {
  const tab = page.getByRole('button', { name: 'Search text', exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  const field = namedField(page);
  await expectNamedField(field);
  return field;
}

async function openMobileSearch(page) {
  const dock = page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true });
  await expect(dock).toBeVisible({ timeout: 15_000 });
  const hubClose = page.getByRole('button', { name: 'Close document hub' });
  if (!(await hubClose.isVisible().catch(() => false))) {
    await dock.click();
  }
  await expect(hubClose).toBeVisible({ timeout: 15_000 });
  const searchTab = page.locator('.mobile-pdf-hub-tab').filter({ hasText: 'Search' })
    .or(page.getByRole('button', { name: 'Search text', exact: true }));
  await expect(searchTab.first()).toBeVisible({ timeout: 15_000 });
  await searchTab.first().click();
  const field = namedField(page);
  await expectNamedField(field);
  return field;
}

test('desktop Search text field is named; query apply is not taken', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);

  expect(await namedField(page).count()).toBe(0);

  const field = await openDesktopSearch(page);
  await expect(field).toHaveAttribute('placeholder', 'Search text in PDF...');
  expect(await namedField(page).count()).toBe(1);

  expect(await page.getByRole('button', { name: 'Clear search', exact: true }).count()).toBe(0);

  await field.focus();
  await page.keyboard.press('Escape');
  await expectNamedField(field);
  expect(await namedField(page).count()).toBe(1);
  expect(await page.getByRole('button', { name: 'Clear search', exact: true }).count()).toBe(0);

  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Bold', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Drag to reorder', exact: true }).count()).toBe(0);

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

test('390 + hubPreview + guest + idle editor break/edge for Search text field name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);
  const mobileField = await openMobileSearch(page);
  await expect(mobileField).toHaveAttribute('placeholder', 'Search text');
  await expectNamedField(mobileField);
  expect(await namedField(page).count()).toBe(1);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Search text', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await namedField(page).count()).toBe(0);
  const searchPdfField = await openDesktopSearch(page);
  await expectNamedField(searchPdfField);
  expect(await namedField(page).count()).toBe(1);

  await openPage(page, { url: SE011_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const se011Field = await openDesktopSearch(page);
  await expectNamedField(se011Field);
  expect(await namedField(page).count()).toBe(1);
  expect(await page.locator('[data-hub-keep-mount][inert]').count()).toBeGreaterThan(0);
  expect(await fileId(page)).toBeNull();
});
