import { test, expect } from '@playwright/test';

// AFTER_CALLOUT_AP_FILL_IMPORT_HUNT
// Genuine hunt of imported-fixture leftovers after callout /AP fill
// (2bbfd646). No unique LIVE leftover proved. Do not invent 13246R /AP
// fill (native /GS0 ca 0). Do not invent Line /AP, callout Rotation,
// user-settable callout verticalAlign, or a richTextEditor.
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
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
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
  await expect(page.locator(`[data-svg-annotation-layer="${pageNumber}"]`)).toBeVisible({ timeout: 60_000 });
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page, pageNumber = 1) {
  return (await page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first().getAttribute('viewBox')) || '';
}

test('desktop import hunt after callout /AP fill: no unique leftover', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=package2-rev4.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();

  await goToPage(page, 6);
  let hello = null;
  await expect.poll(async () => {
    hello = await page.evaluate(() => {
      const fromStorage = [];
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith('annotationsByPage_')) continue;
          const parsed = JSON.parse(localStorage.getItem(key) || '{}');
          const page = parsed?.[6] || parsed?.['6'];
          for (const object of page?.objects || []) {
            if (object?.pdfAnnotationType === 'FreeText' || object?.type === 'textbox') {
              fromStorage.push(object);
            }
          }
        }
      } catch { /* ignore */ }
      const group = document.querySelector(
        '[data-svg-annotation-layer="6"] [data-pdf-annotation-id="13246R"]',
      );
      const pdfId = group?.getAttribute('data-pdf-annotation-id') || '';
      const annoId = group?.getAttribute('data-anno-id') || '';
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || fromStorage.find((row) => row?.pdfAnnotationId === pdfId || row?.text === 'Hello')
        || {};
      const painted = group?.querySelector('rect');
      const boxFill = painted ? String(painted.getAttribute('fill') || '') : '';
      return {
        id: pdfId || object.pdfAnnotationId || '',
        text: String(object.text || ''),
        align: object.textAlign || '',
        boxFill,
        inventedBlack: /rgba\(\s*0,\s*0,\s*0,\s*1\s*\)|#000000/i.test(boxFill),
      };
    });
    return hello.id === '13246R' || hello.text === 'Hello';
  }, { timeout: 60_000, message: 'expected imported FreeText 13246R' }).toBeTruthy();
  expect(hello.inventedBlack, `13246R /AP box fill is native ca 0 — do not invent black (boxFill=${hello.boxFill})`).toBe(false);
  expect(hello.align === 'center' || hello.align === '', `align stays center or unset, not leftover-left: ${hello.align}`).toBeTruthy();
  expect(hello.align, 'must not leftover-drop /DS text-align to left').not.toBe('left');
  expect(await pageViewBox(page, 6)).toMatch(/^0 0 /);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 import hunt edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  await goToPage(page, 6);
  await expect.poll(async () => page.locator(
    '[data-svg-annotation-layer="6"] [data-pdf-annotation-id="13246R"]',
  ).count(), { timeout: 60_000 }).toBe(1);
  expect(await pageViewBox(page, 6)).toMatch(/^0 0 /);
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Text', exact: true }).count()).toBe(0);
});
