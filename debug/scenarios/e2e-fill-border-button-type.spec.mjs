import { test, expect } from '@playwright/test';

// Color picker Fill / Border tabs already have visible names from
// their labels, but omitted type="button" (live type was null).
// C-01 swatch / hex / Transparent / Fill / Border *apply* stay
// parked — inspect type only. Distinct from Color dialog name,
// Opacity slider name, Invite User role name, and leftover-18.
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

function colorPicker(page) {
  return page.locator('[data-annotation-color-picker]');
}

function fillTab(page) {
  return colorPicker(page).getByRole('button', { name: 'Fill', exact: true });
}

function borderTab(page) {
  return colorPicker(page).getByRole('button', { name: 'Border', exact: true });
}

async function armRectangle(page) {
  const rectangle = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true });
  if (!(await rectangle.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  }
  await expect(rectangle).toBeVisible({ timeout: 15_000 });
  const pressed = await rectangle.getAttribute('aria-pressed');
  const cls = String(await rectangle.getAttribute('class') || '');
  const active = cls.includes('is-active') || cls.includes('btn-active');
  if (pressed !== 'true' && !active) {
    await rectangle.click();
  }
  await expect(rectangle).toHaveClass(/btn-active|is-active/);
}

async function openColorDialog(page) {
  const trigger = page.locator('[data-annotation-color-trigger]').first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  await expect(namedColor(page)).toBeVisible({ timeout: 8_000 });
  return trigger;
}

test('Fill / Border are type=button; Escape dismisses; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedColor(page).count()).toBe(0);
  expect(await fillTab(page).count()).toBe(0);
  expect(await borderTab(page).count()).toBe(0);

  await armRectangle(page);
  expect(await fillTab(page).count()).toBe(0);
  expect(await borderTab(page).count()).toBe(0);

  const trigger = await openColorDialog(page);
  const fill = fillTab(page);
  const border = borderTab(page);
  await expect(fill).toBeVisible({ timeout: 8_000 });
  await expect(border).toBeVisible({ timeout: 8_000 });
  await expect(fill).toHaveAttribute('type', 'button');
  await expect(border).toHaveAttribute('type', 'button');
  await expect(namedColor(page)).toHaveAttribute('aria-label', 'Color');
  await expect(page.getByRole('slider', { name: 'Opacity', exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(namedColor(page)).toHaveCount(0);
  await expect(fillTab(page)).toHaveCount(0);
  await expect(borderTab(page)).toHaveCount(0);
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

test('390 + hubPreview + idle editor break/edge for Fill / Border type=button', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await namedColor(page).count()).toBe(0);
  expect(await fillTab(page).count()).toBe(0);
  expect(await borderTab(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedColor(page).count()).toBe(0);
  expect(await fillTab(page).count()).toBe(0);
  expect(await borderTab(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  await armRectangle(page);
  await openColorDialog(page);
  await expect(fillTab(page)).toHaveAttribute('type', 'button');
  await expect(borderTab(page)).toHaveAttribute('type', 'button');
  await page.keyboard.press('Escape');
  await expect(namedColor(page)).toHaveCount(0);
  await expect(fillTab(page)).toHaveCount(0);

  expect(await page.getByRole('dialog', { name: 'Add bookmark', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Clear search', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('combobox', { name: 'Share link role', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
