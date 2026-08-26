import { test, expect } from '@playwright/test';

// Imported filled Ink leftover-omitted sourceWidth.
// clickable-link-test 67R already has native /BS/W 18; filled-outline
// import leftover-omitted sourceWidth (strokeWidth stays 0) so Select
// Width leftover-stayed 3 until Width was re-touched. Distinct from
// leftover-18, imported filled Ink /CA, package2 Ink /AP stroke union,
// Square / Circle / Polygon stroke /CA, imported-outline Width restroke,
// and inventing a create-ink tool. Stamp /BS/W only — do not restroke.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
      localStorage.removeItem('lastReviewTool');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await expect.poll(() => page.evaluate(() => typeof window.__fix19SelectAnnotation)).toBe('function');
  await expect.poll(
    async () => page.locator('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type="Ink"]').count(),
    { timeout: 45_000, message: 'expected imported Ink groups' },
  ).toBeGreaterThan(0);
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function inkSnapshot(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type="Ink"]')];
    return groups.map((group) => {
      const annoId = group.getAttribute('data-anno-id') || '';
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || (pdfId && window.__phase35GetAnnotationById?.(pdfId))
        || {};
      return {
        id: pdfId || object.pdfAnnotationId || annoId,
        sourceWidth: object.sourceWidth ?? null,
        strokeWidth: object.strokeWidth ?? null,
        paperInkGeometry: object.paperInkGeometry ?? null,
      };
    });
  });
}

async function selectImportedInk(page, pdfId) {
  const selected = await page.evaluate((id) => window.__fix19SelectAnnotation?.(id), pdfId);
  expect(selected, `select ${pdfId}`).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Color', exact: true }).first()).toBeVisible({ timeout: 12_000 });
  return selected;
}

test('desktop imported Ink sourceWidth intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const inks = await inkSnapshot(page);
  const ink67 = inks.find((row) => row.id === '67R');
  expect(ink67, 'imported Ink 67R').toBeTruthy();
  expect(ink67.sourceWidth, 'import stamps /BS/W 18').toBe(18);
  expect(ink67.strokeWidth, 'filled outline leftover strokeWidth stays 0').toBe(0);
  expect(ink67.paperInkGeometry).toBe('v1');

  await selectImportedInk(page, '67R');
  const widthField = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(widthField).toBeVisible({ timeout: 8_000 });
  await expect(widthField, 'Select Width keeps /BS/W 18, not leftover 3').toHaveValue('18');

  await openEditor(page);
  const afterReload = await inkSnapshot(page);
  expect(afterReload.filter((row) => row.id === '67R').length, 'reload must not invent extra 67R').toBe(1);
  expect(afterReload.length, 'reload must not invent extra Inks').toBe(inks.length);
  expect(afterReload.find((row) => row.id === '67R')?.sourceWidth).toBe(18);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 imported Ink sourceWidth edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const inks = await inkSnapshot(page);
  const ink67 = inks.find((row) => row.id === '67R');
  expect(ink67, '390 imported Ink 67R').toBeTruthy();
  expect(ink67.sourceWidth).toBe(18);

  await selectImportedInk(page, '67R');
  const widthField = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(widthField).toBeVisible({ timeout: 8_000 });
  await expect(widthField, '390 Select Width keeps /BS/W 18').toHaveValue('18');

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Ink', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Width', exact: true }).count()).toBe(0);
});
