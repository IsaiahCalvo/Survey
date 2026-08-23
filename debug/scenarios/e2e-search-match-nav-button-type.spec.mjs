import { test, expect } from '@playwright/test';

// Search Previous / Next match already have names from their
// aria-labels, but omitted type="button" (live type was null).
// V-08 Next-Previous *apply* stay parked — inspect type only.
// Distinct from Search clear name, Search rail toggle, Fill /
// Border type, and leftover-18. Do not stamp file.id.

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

function prevMatch(page) {
  return page.getByRole('button', { name: 'Previous match (Shift+Enter)', exact: true });
}

function nextMatch(page) {
  return page.getByRole('button', { name: 'Next match (Enter)', exact: true });
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

test('Previous / Next match are type=button; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await prevMatch(page).count()).toBe(0);
  expect(await nextMatch(page).count()).toBe(0);

  const field = await openSearch(page);
  expect(await prevMatch(page).count()).toBe(0);
  expect(await nextMatch(page).count()).toBe(0);

  await field.fill('the');
  await expect(prevMatch(page)).toBeVisible({ timeout: 15_000 });
  await expect(nextMatch(page)).toBeVisible({ timeout: 8_000 });
  await expect(prevMatch(page)).toHaveAttribute('type', 'button');
  await expect(nextMatch(page)).toHaveAttribute('type', 'button');
  await expect(page.getByRole('button', { name: 'Clear search', exact: true })).toHaveAttribute('type', 'button');

  await field.focus();
  await page.keyboard.press('Escape');
  await expect(prevMatch(page)).toHaveCount(0);
  await expect(nextMatch(page)).toHaveCount(0);
  await expect(field).toHaveValue('');

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview + idle editor break/edge for Search match nav type=button', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await prevMatch(page).count()).toBe(0);
  expect(await nextMatch(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await prevMatch(page).count()).toBe(0);
  expect(await nextMatch(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  const field = await openSearch(page);
  await field.fill('glyph');
  await expect(prevMatch(page)).toHaveAttribute('type', 'button', { timeout: 15_000 });
  await expect(nextMatch(page)).toHaveAttribute('type', 'button');
  await field.focus();
  await page.keyboard.press('Escape');
  await expect(prevMatch(page)).toHaveCount(0);
  await expect(nextMatch(page)).toHaveCount(0);

  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
