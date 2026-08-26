import { test, expect } from '@playwright/test';

// package2 page 9 Ink /AP stroke union leftover-skipped the page.
// martinez union threw `depth` inside styledStrokeCommandsToPolygonSet so
// processPage dropped all 1520 annotations. Distinct from leftover-18,
// imported FreeText /RC, Square / Circle / Polygon stroke /CA, imported
// filled Ink /CA, imported-outline Width restroke, and inventing a
// create-ink tool. Do not stamp file.id.

const PACKAGE2 = '/?testPdf=package2-rev4.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = PACKAGE2,
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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function goToPage(page, pageNumber) {
  const edit = page.getByRole('button', { name: 'Edit page number', exact: true }).first();
  if (await edit.isVisible().catch(() => false)) {
    await edit.click();
    const input = page.locator('[data-page-number-input]').first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(String(pageNumber));
      await input.press('Enter');
    }
  }
  await page.evaluate((n) => {
    const el = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${n}"]`);
    el?.scrollIntoView({ block: 'start' });
  }, pageNumber);
  const layer = page.locator(`[data-svg-annotation-layer="${pageNumber}"]`);
  await expect(layer).toBeVisible({ timeout: 60_000 });
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page, pageNumber = 9) {
  return (await page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first().getAttribute('viewBox')) || '';
}

async function pageSnapshot(page, pageNumber = 9) {
  return page.evaluate((pageNum) => {
    const layer = document.querySelector(`[data-svg-annotation-layer="${pageNum}"]`);
    const inkGroups = [...(layer?.querySelectorAll('g[data-pdf-annotation-type="Ink"]') || [])];
    const squareGroups = [...(layer?.querySelectorAll('g[data-pdf-annotation-type="Square"]') || [])];
    const ids = inkGroups.map((group) => (
      group.getAttribute('data-pdf-annotation-id')
      || group.getAttribute('data-anno-id')
      || ''
    ));
    return {
      inkCount: inkGroups.length,
      squareCount: squareGroups.length,
      has4357: squareGroups.some((group) => group.getAttribute('data-pdf-annotation-id') === '4357R'),
      sampleInk: ids.find(Boolean) || null,
    };
  }, pageNumber);
}

test('desktop package2 page 9 Ink /AP stroke union intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=package2-rev4.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();

  await goToPage(page, 9);
  await expect.poll(
    async () => (await pageSnapshot(page, 9)).inkCount,
    { timeout: 60_000, message: 'expected imported Ink on page 9' },
  ).toBeGreaterThan(0);
  const snap = await pageSnapshot(page, 9);
  expect(snap.squareCount, 'Square 4357R family must survive leftover page skip').toBeGreaterThan(0);
  expect(await pageViewBox(page, 9)).toMatch(/^0 0 \d+ \d+$/);

  await goToPage(page, 9);
  const afterJump = await pageSnapshot(page, 9);
  expect(afterJump.inkCount, 'page jump must not invent extra Inks').toBe(snap.inkCount);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 package2 page 9 Ink /AP stroke union edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  await goToPage(page, 9);
  const snap = await pageSnapshot(page, 9);
  expect(snap.inkCount, '390 imported page 9 Ink').toBeGreaterThan(0);
  expect(await pageViewBox(page, 9)).toMatch(/^0 0 \d+ \d+$/);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Ink', exact: true }).count()).toBe(0);
});
