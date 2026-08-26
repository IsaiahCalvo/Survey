import { test, expect } from '@playwright/test';

// Imported filled Ink /CA leftover-multiplied by /AP fillAlpha.
// clickable-link-test 67R native /CA is 0.34902 and /AP fillAlpha is
// 0.34902; import multiplied both so the fill painted 0.12 until
// Opacity was re-touched. Distinct from leftover-18, imported
// Ink/Polygon/PolyLine dash+opacity export, Square / Circle / Polygon
// stroke /CA, and imported-outline Width restroke.
// Do not invent a create-ink tool.
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

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([+-]?\d*\.?\d+)\s*\)/i);
  if (rgba) return Number(rgba[1]);
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

async function inkSnapshot(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type="Ink"]')];
    return groups.map((group) => {
      const painted = group.querySelector('path[data-shape-kind], path');
      const annoId = group.getAttribute('data-anno-id') || '';
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || (pdfId && window.__phase35GetAnnotationById?.(pdfId))
        || {};
      return {
        id: pdfId || object.pdfAnnotationId || annoId,
        fill: object.fill || painted?.getAttribute('fill') || '',
        stroke: object.stroke || painted?.getAttribute('stroke') || '',
        visualFill: painted?.getAttribute('fill') || '',
        visualStroke: painted?.getAttribute('stroke') || '',
        kind: painted?.getAttribute('data-shape-kind') || painted?.tagName || '',
      };
    });
  });
}

test('desktop imported Ink fill /CA intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const inks = await inkSnapshot(page);
  const ink67 = inks.find((row) => row.id === '67R');
  expect(ink67, 'imported Ink 67R').toBeTruthy();
  const fillA = parseAlpha(ink67.visualFill || ink67.fill);
  expect(fillA, 'fill keeps /CA ~0.35').toBeGreaterThan(0.34);
  expect(fillA, 'fill keeps /CA ~0.35').toBeLessThan(0.36);
  expect(fillA, 'fill must not leftover-multiply to 0.12').toBeGreaterThan(0.20);

  await openEditor(page);
  const afterReload = await inkSnapshot(page);
  expect(afterReload.filter((row) => row.id === '67R').length, 'reload must not invent extra 67R').toBe(1);
  expect(afterReload.length, 'reload must not invent extra Inks').toBe(inks.length);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 imported Ink fill /CA edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const inks = await inkSnapshot(page);
  const ink67 = inks.find((row) => row.id === '67R');
  expect(ink67, '390 imported Ink 67R').toBeTruthy();
  const fillA = parseAlpha(ink67.visualFill || ink67.fill);
  expect(fillA).toBeGreaterThan(0.34);
  expect(fillA).toBeLessThan(0.36);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Ink', exact: true }).count()).toBe(0);
});
