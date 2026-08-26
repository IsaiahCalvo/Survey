import { test, expect } from '@playwright/test';

// AFTER_OVERLAY_HOLD_TO_PAN_HUNT
// Genuine hunt of remaining overlay vs live-handler leftovers after
// tip efedf1f2 / product 162aa1f5. No unique LIVE leftover.
// Do not replay Hold to pan, the z-order family, or the nine
// exhausted hunts. Do not invent clipboard overlay rows, Open file /
// UL-03, Duplicate / Backspace / Y / G alias rows, Ctrl+P, or
// Electron-only Export. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const LIVE_CATALOG = [
  'Hold to pan',
  'Fit width',
  'Fit height',
  'Manual lock',
  'Save document',
  'Undo',
  'Redo',
  'Delete selected',
  'Bring to front',
  'Bring forward',
  'Send backward',
  'Send to back',
  'Find next',
  'Find previous',
  'Partial erase',
  'Select annotations',
];

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('pdfSidebar_')
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

function overlay(page) {
  return page.locator('[data-keyboard-shortcuts-modal="true"]');
}

function assertCatalogComplete(text, label) {
  for (const row of LIVE_CATALOG) {
    expect(text, `${label} lists ${row}`).toContain(row);
  }
  expect(text, `${label} must not invent Duplicate`).not.toMatch(/\bDuplicate\b/);
  expect(text, `${label} must not invent Backspace`).not.toMatch(/\bBackspace\b/);
  expect(text, `${label} must not invent Copy\/Cut\/Paste`).not.toMatch(/\b(Copy|Cut|Paste)\b/);
  expect(text, `${label} must not invent Open file`).not.toMatch(/Open file/i);
  expect(text, `${label} must not invent Print`).not.toMatch(/\bPrint\b/);
  expect(text, `${label} must not invent Export`).not.toMatch(/\bExport\b/);
}

function subTool(page, name) {
  return page.locator('#chrome-sub-toolbar-host').getByRole('button', { name, exact: true });
}

async function subToolArmed(page, name) {
  const btn = subTool(page, name);
  if (!(await btn.count())) return false;
  if (!(await btn.first().isVisible().catch(() => false))) return false;
  const cls = await btn.first().getAttribute('class');
  return String(cls || '').includes('btn-active');
}

async function selectArmed(page) {
  const buttons = page.getByRole('button', { name: 'Select', exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const cls = await button.getAttribute('class');
    if (String(cls || '').includes('btn-active')) return true;
  }
  return false;
}

test('desktop remaining overlay chords already listed + break + edge', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('v');
  await expect.poll(async () => selectArmed(page), {
    message: 'V must arm Select annotations',
  }).toBe(true);

  for (const key of ['r', 'o', 'i', 's', 'n', 'w', 'f', 'd', 'g', 'm', 'u']) {
    await page.keyboard.press(key);
  }
  expect(await subToolArmed(page, 'Rectangle'), 'bare R must not arm Rectangle').toBe(false);
  expect(await subToolArmed(page, 'Ellipse'), 'bare O must not arm Ellipse').toBe(false);
  expect(await subToolArmed(page, 'Pen'), 'bare leftover letters must not arm Pen').toBe(false);
  expect(await selectArmed(page), 'bare leftover letters must keep Select').toBe(true);

  await page.keyboard.press('p');
  await expect.poll(async () => subToolArmed(page, 'Pen'), {
    message: 'live P must still arm Pen',
  }).toBe(true);

  const downloads = [];
  page.on('download', (download) => downloads.push(download.url()));
  await page.keyboard.press('Control+Shift+E');
  await page.waitForTimeout(400);
  expect(downloads, 'web Ctrl+Shift+E must not invent Export').toEqual([]);

  await blurInputs(page);
  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal).toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertCatalogComplete(catalog, 'desktop overlay');

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null), 'must not stamp file.id').toBeNull();

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await blurInputs(page);
  await page.keyboard.press('?');
  expect(await overlay(page).count(), 'hubPreview must not mount the overlay').toBe(0);

  console.log('AFTER_OVERLAY_HOLD_TO_PAN_HUNT_DESKTOP', JSON.stringify({
    listedHoldToPan: /Hold to pan/.test(catalog),
    inventedExport: downloads.length,
    fileId: null,
  }));
});

test('390 remaining overlay chords already listed + viewBox / file.id', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal, '390 overlay exists').toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertCatalogComplete(catalog, '390 overlay');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null), 'must not stamp file.id').toBeNull();

  console.log('AFTER_OVERLAY_HOLD_TO_PAN_HUNT_390', JSON.stringify({
    listedHoldToPan: /Hold to pan/.test(catalog),
    fileId: null,
  }));
});
