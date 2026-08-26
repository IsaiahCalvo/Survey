import { test, expect } from '@playwright/test';

// Imported Polygon stroke /CA leftover-painted from fill /ca.
// clickable-link-test 63R native /CA is 1 and /ca is ~0.30; import
// preferred leftover /ca so the border painted 0.30 until Border was
// re-touched. Distinct from leftover-18, imported Ink/Polygon/PolyLine
// dash+opacity export, Square / Circle stroke /CA, and imported-outline
// Width restroke. Do not invent a create-poly tool.
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
    async () => page.locator('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type="Polygon"]').count(),
    { timeout: 45_000, message: 'expected imported Polygon groups' },
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

async function polygonSnapshot(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type="Polygon"]')];
    return groups.map((group) => {
      const painted = group.querySelector('polygon[data-shape-kind="polygon"], path[data-shape-kind="cloud-polygon"]');
      const annoId = group.getAttribute('data-anno-id') || '';
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || (pdfId && window.__phase35GetAnnotationById?.(pdfId))
        || {};
      return {
        id: pdfId || annoId,
        fill: object.fill || painted?.getAttribute('fill') || '',
        stroke: object.stroke || painted?.getAttribute('stroke') || '',
        visualFill: painted?.getAttribute('fill') || '',
        visualStroke: painted?.getAttribute('stroke') || '',
        kind: painted?.getAttribute('data-shape-kind') || '',
      };
    });
  });
}

test('desktop imported Polygon stroke /CA intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const polygons = await polygonSnapshot(page);
  const polygon63 = polygons.find((row) => row.id === '63R');
  expect(polygon63, 'imported Polygon 63R').toBeTruthy();
  const fillA = parseAlpha(polygon63.visualFill || polygon63.fill);
  const strokeA = parseAlpha(polygon63.visualStroke || polygon63.stroke);
  expect(fillA, 'fill keeps leftover /ca ~0.30').toBeGreaterThan(0.29);
  expect(fillA, 'fill keeps leftover /ca ~0.30').toBeLessThan(0.32);
  expect(strokeA, 'stroke keeps /CA 1, not leftover /ca 0.30').toBeGreaterThan(0.99);
  expect(strokeA, 'stroke must not leftover-paint fill /ca').not.toBeCloseTo(fillA, 2);

  await openEditor(page);
  const afterReload = await polygonSnapshot(page);
  expect(afterReload.filter((row) => row.id === '63R').length, 'reload must not invent extra 63R').toBe(1);
  expect(afterReload.length, 'reload must not invent extra Polygons').toBe(polygons.length);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 imported Polygon stroke /CA edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const polygons = await polygonSnapshot(page);
  const polygon63 = polygons.find((row) => row.id === '63R');
  expect(polygon63, '390 imported Polygon 63R').toBeTruthy();
  expect(parseAlpha(polygon63.visualStroke || polygon63.stroke)).toBeGreaterThan(0.99);
  expect(parseAlpha(polygon63.visualFill || polygon63.fill)).toBeLessThan(0.32);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count()).toBe(0);
});
