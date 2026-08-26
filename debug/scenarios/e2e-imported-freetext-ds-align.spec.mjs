import { test, expect } from '@playwright/test';

// Imported FreeText /DS text-align leftover-left.
// package2 13246R already has native /DS text-align:center and no /Q;
// import leftover-dropped that align so the textbox painted leftover-left
// until Text alignment was re-touched. Distinct from leftover-18, imported
// FreeText /RC color, Underline /QuadPoints, Highlight /CA, Square /
// Circle / Polygon stroke /CA, imported filled Ink /CA, package2 Ink
// /AP stroke union, imported-outline Width restroke, and inventing a
// richTextEditor. Do not invent a user-settable callout verticalAlign.
// Do not stamp file.id.

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

async function pageViewBox(page, pageNumber = 6) {
  return (await page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first().getAttribute('viewBox')) || '';
}

async function freetextSnapshot(page, pageNumber = 6) {
  return page.evaluate((pageNum) => {
    const fromStorage = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('annotationsByPage_')) continue;
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        const page = parsed?.[pageNum] || parsed?.[String(pageNum)];
        for (const object of page?.objects || []) {
          if (object?.pdfAnnotationType === 'FreeText' || object?.type === 'textbox') {
            fromStorage.push(object);
          }
        }
      }
    } catch { /* ignore */ }

    const groups = [...document.querySelectorAll(
      `[data-svg-annotation-layer="${pageNum}"] [data-pdf-annotation-type="FreeText"]`,
    )];
    return groups.map((group) => {
      const annoId = group.getAttribute('data-anno-id') || '';
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || fromStorage.find((row) => row?.pdfAnnotationId === pdfId || row?.id === annoId)
        || {};
      const painted = group.querySelector('[data-annotation-text-bounds] div, foreignObject div');
      return {
        id: pdfId || object.pdfAnnotationId || annoId,
        text: String(object.text || painted?.textContent || ''),
        textAlign: object.textAlign || '',
        visualAlign: painted ? (painted.style?.textAlign || getComputedStyle(painted).textAlign || '') : '',
        imported: object.isPdfImported === true,
      };
    });
  }, pageNumber);
}

test('desktop imported FreeText /DS text-align intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=package2-rev4.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();

  await goToPage(page, 6);
  let rows = [];
  await expect.poll(
    async () => {
      rows = await freetextSnapshot(page, 6);
      return rows.some((row) => row.id === '13246R' || row.text === 'Hello');
    },
    { timeout: 60_000, message: 'expected imported FreeText 13246R on page 6' },
  ).toBeTruthy();
  expect(await pageViewBox(page, 6)).toMatch(/^0 0 /);

  const target = rows.find((row) => row.id === '13246R' || row.text === 'Hello');
  expect(target, 'imported FreeText 13246R').toBeTruthy();
  const liveAlign = target.textAlign || target.visualAlign;
  expect(liveAlign, 'textAlign keeps /DS center, not leftover left').toBe('center');
  expect(target.visualAlign === 'center' || target.textAlign === 'center').toBeTruthy();
  expect(liveAlign, 'must not leftover-drop /DS text-align to left').not.toBe('left');

  await goToPage(page, 6);
  const afterJump = await freetextSnapshot(page, 6);
  expect(
    afterJump.filter((row) => row.id === '13246R' || row.text === 'Hello').length,
    'page jump must not invent extra 13246R',
  ).toBe(1);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 imported FreeText /DS text-align edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  await goToPage(page, 6);
  let rows = [];
  await expect.poll(
    async () => {
      rows = await freetextSnapshot(page, 6);
      return rows.some((row) => row.id === '13246R' || row.text === 'Hello');
    },
    { timeout: 60_000, message: 'expected 390 imported FreeText 13246R' },
  ).toBeTruthy();
  const target = rows.find((row) => row.id === '13246R' || row.text === 'Hello');
  expect(target, '390 imported FreeText 13246R').toBeTruthy();
  expect(target.textAlign || target.visualAlign).toBe('center');
  expect(await pageViewBox(page, 6)).toMatch(/^0 0 /);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Text', exact: true }).count()).toBe(0);
});
