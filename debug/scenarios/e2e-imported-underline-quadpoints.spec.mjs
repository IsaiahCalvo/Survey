import { test, expect } from '@playwright/test';

// Imported Underline / StrikeOut leftover /Rect vs native /QuadPoints.
// se011 4638R / 4640R already have native /QuadPoints (word AABB); leftover
// /Rect is padded ~10pt each side so the painted bar was leftover-wide
// until the markup was deleted. Distinct from leftover-18, imported
// Highlight /CA, FreeText /RC, Square / Circle / Polygon stroke /CA,
// imported filled Ink /CA, package2 Ink /AP stroke union, and
// imported-outline Width restroke. Do not invent a richTextEditor.
// Do not stamp file.id.

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
    async () => page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-type="StrikeOut"]').count(),
    { timeout: 60_000, message: 'expected imported StrikeOut' },
  ).toBeGreaterThan(0);
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page, pageNumber = 1) {
  return (await page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first().getAttribute('viewBox')) || '';
}

async function markupSnapshot(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll(
      '[data-svg-annotation-layer="1"] [data-pdf-annotation-type="StrikeOut"], [data-svg-annotation-layer="1"] [data-pdf-annotation-type="Underline"]',
    )];
    return groups.map((group) => {
      const painted = group.matches('rect')
        ? group
        : group.querySelector('rect[data-shape-kind="rect"]');
      const bbox = painted?.getBBox?.();
      return {
        id: group.getAttribute('data-pdf-annotation-id') || '',
        type: group.getAttribute('data-pdf-annotation-type') || '',
        visualWidth: painted ? Number(painted.getAttribute('width') || bbox?.width || 0) : 0,
      };
    });
  });
}

test('desktop imported Underline / StrikeOut /QuadPoints intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=se011.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toMatch(/^0 0 /);

  const rows = await markupSnapshot(page);
  const strike = rows.find((entry) => entry.id === '4638R');
  expect(strike, 'imported StrikeOut 4638R').toBeTruthy();
  expect(strike.visualWidth, '4638R keeps /QuadPoints ~180, not leftover /Rect 200').toBeGreaterThan(179);
  expect(strike.visualWidth, '4638R keeps /QuadPoints ~180, not leftover /Rect 200').toBeLessThan(181);

  const underline = rows.find((entry) => entry.id === '4640R');
  expect(underline, 'imported Underline 4640R').toBeTruthy();
  expect(underline.visualWidth, '4640R keeps /QuadPoints ~252, not leftover /Rect 272').toBeGreaterThan(251);
  expect(underline.visualWidth, '4640R keeps /QuadPoints ~252, not leftover /Rect 272').toBeLessThan(253);

  await openEditor(page);
  const afterReload = await markupSnapshot(page);
  expect(afterReload.filter((entry) => entry.id === '4638R').length, 'reload must not invent extra 4638R').toBe(1);
  expect(afterReload.filter((entry) => entry.id === '4640R').length, 'reload must not invent extra 4640R').toBe(1);
  expect(afterReload.length, 'reload must not invent extra markup').toBe(rows.length);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 imported Underline / StrikeOut /QuadPoints edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toMatch(/^0 0 /);

  const rows = await markupSnapshot(page);
  const strike = rows.find((entry) => entry.id === '4638R');
  expect(strike, '390 imported StrikeOut 4638R').toBeTruthy();
  expect(strike.visualWidth).toBeGreaterThan(179);
  expect(strike.visualWidth).toBeLessThan(181);
  expect(await page.getByRole('button', { name: 'Underline', exact: true }).count()).toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});
