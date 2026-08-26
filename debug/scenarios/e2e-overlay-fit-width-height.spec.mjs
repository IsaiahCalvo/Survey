import { test, expect } from '@playwright/test';

// Overlay leftover: Ctrl+1 Fit width and Ctrl+2 Fit height are live
// viewer chords, and sibling fit shortcuts (Ctrl+0 Fit page next to
// Zoom in/out) were already listed, but the catalog omitted the
// sibling chords. Distinct from leftover-18, V-04 Fit width keyboard,
// Ctrl+2 / Ctrl+M apply leftover, rail Zoom ±, UL-06 Zoom %, and
// inventing Open file / UL-03 for overlay Ctrl+O. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
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

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }, pageNumber);
}

function overlay(page) {
  return page.locator('[data-keyboard-shortcuts-modal="true"]');
}

async function zoomPercent(page) {
  const label = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (await label.count()) {
    return Number.parseInt((await label.innerText()).trim(), 10);
  }
  const input = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  if (await input.count()) {
    return Number.parseInt(await input.inputValue(), 10);
  }
  return null;
}

async function openFitMenu(page) {
  const trigger = page.getByRole('button', { name: 'Fit options', exact: true });
  await trigger.click();
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toBeVisible({ timeout: 5_000 });
}

async function closeFitMenu(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toHaveCount(0);
}

async function fitRowActive(page, name) {
  await openFitMenu(page);
  const active = await page.getByRole('button', { name, exact: true }).getAttribute('data-active');
  await closeFitMenu(page);
  return active;
}

function assertOverlayListsFitChords(text, label) {
  expect(text, `${label} lists Fit page`).toContain('Fit page');
  expect(text, `${label} lists Fit width`).toContain('Fit width');
  expect(text, `${label} lists Fit height`).toContain('Fit height');
  expect(text, `${label} must not invent Ctrl+M`).not.toMatch(/\bManual\b/i);
  expect(text, `${label} must not invent Copy\/Cut\/Paste`).not.toMatch(/\b(Copy|Cut|Paste)\b/);
  expect(text, `${label} must not invent Open file`).not.toMatch(/Open file/i);
}

test('desktop overlay Fit width / Fit height intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const idsBefore = await userAnnotationIds(page);
  expect(idsBefore, 'fresh editor must invent 0 user marks').toEqual([]);

  // Intended — Ctrl+1 / Ctrl+2 are live: they force Fit width / Fit height.
  // Overlay then lists those live chords next to Fit page.
  await blurInputs(page);
  await page.keyboard.press('Control+0');
  await expect.poll(async () => await zoomPercent(page), {
    timeout: 10_000,
    message: 'Ctrl+0 Fit page baseline',
  }).toBeGreaterThan(0);
  const pagePct = await zoomPercent(page);

  await blurInputs(page);
  await page.keyboard.press('Control+1');
  await expect.poll(async () => await zoomPercent(page), {
    timeout: 10_000,
    message: 'Ctrl+1 forces Fit width',
  }).not.toBe(pagePct);
  const widthPct = await zoomPercent(page);
  expect(widthPct, 'Ctrl+1 Fit width exceeds Fit page on a wide desktop').toBeGreaterThan(pagePct);
  expect(await fitRowActive(page, 'Fit width'), 'Ctrl+1 marks Fit width active').toBe('true');
  expect(await fitRowActive(page, 'Fit page'), 'Ctrl+1 leaves Fit page').toBe('false');

  await blurInputs(page);
  await page.keyboard.press('Control+2');
  await expect.poll(async () => await zoomPercent(page), {
    timeout: 10_000,
    message: 'Ctrl+2 forces Fit height',
  }).not.toBe(widthPct);
  expect(await fitRowActive(page, 'Fit height'), 'Ctrl+2 marks Fit height active').toBe('true');
  expect(await fitRowActive(page, 'Fit width'), 'Ctrl+2 leaves Fit width').toBe('false');

  await blurInputs(page);
  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal).toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsFitChords(catalog, 'desktop overlay');

  // Break — Esc dismisses; zoom INPUT Ctrl+1 does not steal; second ? toggles.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await page.keyboard.press('?');
  await expect(modal, 'second `?` toggles closed').toHaveCount(0);

  const heightPct = await zoomPercent(page);
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await expect(zoomBtn).toBeVisible();
  await zoomBtn.click();
  const zoom = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoom).toBeVisible();
  await zoom.click();
  await page.keyboard.press('Control+1');
  expect(await zoomPercent(page), 'zoom % INPUT does not steal Ctrl+1').toBe(heightPct);
  expect(await fitRowActive(page, 'Fit height'), 'zoom INPUT Ctrl+1 keeps Fit height').toBe('true');
  await blurInputs(page);

  // Edge — overlay / fit chords invent 0 marks; viewBox / file.id stay.
  expect(await userAnnotationIds(page), 'overlay Fit width / Fit height must invent 0 marks').toEqual(idsBefore);
  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  await blurInputs(page);
  await page.keyboard.press('?');
  expect(await overlay(page).count(), 'hubPreview must not mount the overlay').toBe(0);
  expect(await page.getByRole('button', { name: 'Fit width', exact: true }).count()).toBe(0);

  console.log('OVERLAY_FIT_WIDTH_HEIGHT_DESKTOP_PROOF', JSON.stringify({
    listedFitWidth: /Fit width/.test(catalog),
    listedFitHeight: /Fit height/.test(catalog),
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 overlay Fit width / Fit height intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal, '390 overlay exists').toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsFitChords(catalog, '390 overlay');

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('Control+1');
  await page.keyboard.press('Control+2');
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  assertOverlayListsFitChords(await modal.innerText(), '390 overlay after Ctrl+1 / Ctrl+2');
  await page.keyboard.press('Escape');

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await userAnnotationIds(page)).toEqual([]);
  await assertNoErrorBoundary(page);

  console.log('OVERLAY_FIT_WIDTH_HEIGHT_390_PROOF', JSON.stringify({
    listedFitWidth: /Fit width/.test(catalog),
    listedFitHeight: /Fit height/.test(catalog),
    viewBox,
    fileId: await fileId(page),
  }));
});
