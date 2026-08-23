import { test, expect } from '@playwright/test';

// Search clear was an icon-only unnamed button (existing V-08
// search-previous had to xpath the X). Sibling Previous / Next match
// are already named. Search rail toggle / V-08 Next-Previous apply /
// Match case stay dedicated. This leftover is the clear *name* +
// type=button. Activity stays A-06. PromptModal lock / NewColumnsModal
// stay leftover-18. Do not click Create group apply. Do not click
// Add bookmarks apply. Do not click Create bookmark apply. Do not
// stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';
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

function clearSearch(page) {
  return page.getByRole('button', { name: 'Clear search', exact: true });
}

async function openSearch(page) {
  const field = page.getByPlaceholder('Search text in PDF...');
  if (!(await field.count()) || !(await field.isVisible().catch(() => false))) {
    const tab = page.getByRole('button', { name: 'Search text', exact: true }).first();
    await expect(tab).toBeVisible({ timeout: 15_000 });
    if ((await tab.getAttribute('aria-pressed')) !== 'true') {
      await tab.click();
    }
  }
  await expect(field).toBeVisible({ timeout: 10_000 });
  return field;
}

test('Search clear is named; click and focused Escape dismiss the query', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await clearSearch(page).count()).toBe(0);

  const field = await openSearch(page);
  expect(await clearSearch(page).count()).toBe(0);

  await field.fill('the');
  const clear = clearSearch(page);
  await expect(clear).toBeVisible({ timeout: 8_000 });
  await expect(clear).toHaveAttribute('type', 'button');
  await expect(clear).toHaveAttribute('aria-label', 'Clear search');

  await clear.click();
  await expect(clearSearch(page)).toHaveCount(0);
  await expect(field).toHaveValue('');

  await field.fill('page');
  await expect(clearSearch(page)).toBeVisible({ timeout: 8_000 });
  await field.focus();
  await page.keyboard.press('Escape');
  await expect(clearSearch(page)).toHaveCount(0);
  await expect(field).toHaveValue('');

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview + idle editor break/edge for Search clear name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await clearSearch(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await clearSearch(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Search text', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  const field = await openSearch(page);
  await field.fill('glyph');
  await expect(clearSearch(page)).toBeVisible({ timeout: 8_000 });
  await clearSearch(page).click();
  await expect(clearSearch(page)).toHaveCount(0);
  await expect(field).toHaveValue('');

  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: 'SE-011 Security Shop Drawings.pdf' })
    .getByRole('button', { name: 'More' })
    .first();
  expect(await ownerMore.count()).toBe(0);

  expect(await page.getByRole('dialog', { name: 'Add bookmark', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
