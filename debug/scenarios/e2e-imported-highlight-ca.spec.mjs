import { test, expect } from '@playwright/test';

// Imported Highlight /CA leftover-split onto hex fill + object.opacity.
// se011 4636R native /CA is 0.399994 and there is no /ca; import wrote
// leftover hex fill so Select read leftover 100 until Opacity was
// re-touched. Distinct from leftover-18, imported FreeText /RC, Square /
// Circle / Polygon stroke /CA, imported filled Ink /CA, package2 Ink /AP
// stroke union, and imported-outline Width restroke. Do not invent a
// richTextEditor. Do not stamp file.id.

const SE011 = '/?testPdf=se011.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = SE011,
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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await expect.poll(
    async () => page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-type="Highlight"]').count(),
    { timeout: 60_000, message: 'expected imported Highlight' },
  ).toBeGreaterThan(0);
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page, pageNumber = 1) {
  return (await page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first().getAttribute('viewBox')) || '';
}

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([+-]?\d*\.?\d+)\s*\)/i);
  if (rgba) return Number(rgba[1]);
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

async function highlightSnapshot(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-pdf-annotation-type="Highlight"]')];
    return groups.map((group) => {
      const painted = group.matches('rect, path')
        ? group
        : group.querySelector('rect[data-shape-kind="rect"], path[data-shape-kind="cloud-rect"]');
      const annoId = group.getAttribute('data-anno-id') || '';
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || (pdfId && window.__phase35GetAnnotationById?.(pdfId))
        || {};
      return {
        id: pdfId || object.pdfAnnotationId || annoId,
        fill: object.fill || painted?.getAttribute('fill') || '',
        opacity: object.opacity,
        visualFill: painted?.getAttribute('fill') || '',
        visualOpacity: painted?.getAttribute('opacity') || '',
      };
    });
  });
}

test('desktop imported Highlight /CA intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=se011.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toMatch(/^0 0 /);

  const highlights = await highlightSnapshot(page);
  const row = highlights.find((entry) => entry.id === '4636R');
  expect(row, 'imported Highlight 4636R').toBeTruthy();
  const fillA = parseAlpha(row.fill);
  expect(fillA, 'fill keeps /CA ~0.40').toBeGreaterThan(0.39);
  expect(fillA, 'fill keeps /CA ~0.40').toBeLessThan(0.41);
  expect(String(row.fill), 'fill must be rgba, not leftover hex').toMatch(/^rgba\(/);
  expect(row.opacity === 0.399994, 'must not leftover-split /CA onto object.opacity').toBe(false);
  const visualA = parseAlpha(row.visualFill);
  expect(visualA === 1 ? Number(row.visualOpacity || 1) : visualA).toBeGreaterThan(0.39);
  expect(visualA === 1 ? Number(row.visualOpacity || 1) : visualA).toBeLessThan(0.41);

  await openEditor(page);
  const afterReload = await highlightSnapshot(page);
  expect(afterReload.filter((entry) => entry.id === '4636R').length, 'reload must not invent extra 4636R').toBe(1);
  expect(afterReload.length, 'reload must not invent extra Highlights').toBe(highlights.length);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 imported Highlight /CA edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toMatch(/^0 0 /);

  const highlights = await highlightSnapshot(page);
  const row = highlights.find((entry) => entry.id === '4636R');
  expect(row, '390 imported Highlight 4636R').toBeTruthy();
  expect(parseAlpha(row.fill)).toBeGreaterThan(0.39);
  expect(parseAlpha(row.fill)).toBeLessThan(0.41);
  expect(await page.getByRole('button', { name: 'Highlight', exact: true }).count()).toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});
