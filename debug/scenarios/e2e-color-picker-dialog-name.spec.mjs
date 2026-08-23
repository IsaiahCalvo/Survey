import { test, expect } from '@playwright/test';

// Desktop CompactColorPicker had a visible Color heading but no
// role="dialog" / name. Style / Width already use role="option".
// Color popup *dismiss* stays dedicated. This leftover is the picker
// *name* + Color trigger type=button / aria-haspopup="dialog".
// Font color stays rich-text-only. Activity stays A-06. PromptModal
// lock / NewColumnsModal stay leftover-18. Do not apply C-01 swatches.
// Do not stamp file.id.

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

function namedColor(page) {
  return page.getByRole('dialog', { name: 'Color', exact: true });
}

async function armRectangle(page) {
  const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true }).first();
  await expect(rectangle).toBeVisible({ timeout: 15_000 });
  if ((await rectangle.getAttribute('aria-pressed')) !== 'true') {
    await rectangle.click();
  }
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
}

async function openColorDialog(page) {
  const trigger = page.locator('[data-annotation-color-trigger]').first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await expect(trigger).toHaveAttribute('type', 'button');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  await expect(namedColor(page)).toBeVisible({ timeout: 8_000 });
  return trigger;
}

test('Color picker is named; Escape dismisses; swatch apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedColor(page).count()).toBe(0);

  await armRectangle(page);
  expect(await namedColor(page).count()).toBe(0);

  const trigger = await openColorDialog(page);
  const dialog = namedColor(page);
  await expect(dialog).toHaveAttribute('aria-label', 'Color');
  await expect(dialog.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Color spectrum', exact: true })).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(namedColor(page)).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview + idle editor break/edge for Color picker name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await namedColor(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedColor(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  await armRectangle(page);
  await openColorDialog(page);
  await expect(namedColor(page)).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  await expect(namedColor(page)).toHaveCount(0);

  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: 'SE-011 Security Shop Drawings.pdf' })
    .getByRole('button', { name: 'More' })
    .first();
  expect(await ownerMore.count()).toBe(0);

  expect(await page.getByRole('dialog', { name: 'Add bookmark', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Clear search', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
