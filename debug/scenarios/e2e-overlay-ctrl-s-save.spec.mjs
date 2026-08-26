import { test, expect } from '@playwright/test';

// Overlay leftover: Ctrl+S is a live viewer chord (handleSaveDocument
// app-state save), and sibling Action shortcuts (Ctrl+O Open document /
// Ctrl+F Search text) were already listed, but the catalog omitted
// Ctrl+S. Distinct from leftover-18, local ?testPdf= save/reload,
// inventing Open file / UL-03 for overlay Ctrl+O, and inventing
// clipboard overlay rows. Do not stamp file.id.

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

function attachSaveExportProbe(page) {
  const hits = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PDFSaveExport]')) hits.push(text);
  });
  return hits;
}

function saveExportCount(hits) {
  return hits.filter((text) => (
    text.includes('action start') || text.includes('action complete')
  ) && text.includes('app-state-save')).length;
}

function assertOverlayListsSave(text, label) {
  expect(text, `${label} lists Open document`).toContain('Open document');
  expect(text, `${label} lists Save document`).toContain('Save document');
  expect(text, `${label} lists Search text`).toContain('Search text');
  expect(text, `${label} must not invent Copy\/Cut\/Paste`).not.toMatch(/\b(Copy|Cut|Paste)\b/);
  expect(text, `${label} must not invent Open file`).not.toMatch(/Open file/i);
}

test('desktop overlay Ctrl+S Save document intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  const saveHits = attachSaveExportProbe(page);
  page.on('dialog', async (dialog) => {
    await dialog.dismiss().catch(() => {});
  });
  page.on('download', () => {});

  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const idsBefore = await userAnnotationIds(page);
  expect(idsBefore, 'fresh editor must invent 0 user marks').toEqual([]);

  // Intended — Ctrl+S fires the live app-state save. Overlay then lists
  // that live chord next to Search text.
  await blurInputs(page);
  const beforeSave = saveExportCount(saveHits);
  await page.keyboard.press('Control+s');
  await expect.poll(() => saveExportCount(saveHits), {
    timeout: 8_000,
    message: 'Ctrl+S must fire handleSaveDocument app-state-save',
  }).toBeGreaterThan(beforeSave);
  expect(await page.locator('[data-measure-overlay], [data-measurement-tool]').count(), 'Ctrl+S is not measure').toBe(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal).toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsSave(catalog, 'desktop overlay');

  // Break — Esc dismisses; zoom INPUT Ctrl+S does not steal; second ? toggles.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await page.keyboard.press('?');
  await expect(modal, 'second `?` toggles closed').toHaveCount(0);

  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await expect(zoomBtn).toBeVisible();
  await zoomBtn.click();
  const zoom = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoom).toBeVisible();
  await zoom.click();
  const beforeInputSave = saveExportCount(saveHits);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);
  expect(saveExportCount(saveHits), 'zoom % INPUT does not steal Ctrl+S').toBe(beforeInputSave);
  await blurInputs(page);

  // Edge — overlay / Save invent 0 marks; viewBox / file.id stay.
  expect(await userAnnotationIds(page), 'overlay Ctrl+S Save must invent 0 marks').toEqual(idsBefore);
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

  console.log('OVERLAY_CTRL_S_SAVE_DESKTOP_PROOF', JSON.stringify({
    listedSave: /Save document/.test(catalog),
    saveHits: saveExportCount(saveHits),
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 overlay Ctrl+S Save document intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  const saveHits = attachSaveExportProbe(page);
  page.on('dialog', async (dialog) => {
    await dialog.dismiss().catch(() => {});
  });

  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal, '390 overlay exists').toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsSave(catalog, '390 overlay');

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  const beforeSave = saveExportCount(saveHits);
  await page.keyboard.press('Control+s');
  await expect.poll(() => saveExportCount(saveHits), {
    timeout: 8_000,
    message: '390 Ctrl+S must fire handleSaveDocument app-state-save',
  }).toBeGreaterThan(beforeSave);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  assertOverlayListsSave(await modal.innerText(), '390 overlay after Ctrl+S');
  await page.keyboard.press('Escape');

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await userAnnotationIds(page)).toEqual([]);
  await assertNoErrorBoundary(page);

  console.log('OVERLAY_CTRL_S_SAVE_390_PROOF', JSON.stringify({
    listedSave: /Save document/.test(catalog),
    saveHits: saveExportCount(saveHits),
    viewBox,
    fileId: await fileId(page),
  }));
});
