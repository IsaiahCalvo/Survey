import { test, expect } from '@playwright/test';

// Imported FreeTextCallout leftover-omitted /LE.
// se011 4631R already has native /LE OpenArrow (Acrobat writes a single
// name, not an array). Import leftover-dropped that ending so the
// callout leader leftover-painted solidTriangle until Arrowhead was
// re-touched. Distinct from leftover-18, imported FreeText /RC color,
// FreeText /DS align, Square / Circle / Polygon stroke /CA, imported
// filled Ink /CA + sourceWidth, package2 Ink /AP stroke union,
// imported-outline Width restroke, inventing Line /AP, and inventing a
// user-settable callout verticalAlign. Do not stamp file.id.

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
  const pageDiv = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  await pageDiv.scrollIntoViewIfNeeded().catch(() => {});
  await page.evaluate((n) => {
    const el = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${n}"]`);
    el?.scrollIntoView({ block: 'start' });
  }, pageNumber);
  const layer = page.locator(`[data-svg-annotation-layer="${pageNumber}"]`);
  await expect(layer).toBeVisible({ timeout: 45_000 });
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page, pageNumber = 3) {
  return (await page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first().getAttribute('viewBox')) || '';
}

async function calloutSnapshot(page, pageNumber = 3) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = legacy.style || data.style || object.style || {};
      const painted = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"] [data-callout-part="text"]`,
      );
      const visible = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] g[data-callout-id="${id}"]`,
      );
      const head = visible
        ? [...visible.querySelectorAll('polygon, polyline, circle')]
          .find((el) => !el.getAttribute('data-callout-part'))
        : null;
      return {
        id,
        pdfId: object.pdfAnnotationId || legacy.pdfAnnotationId || null,
        text: String(object.text || legacy.text || data.text || painted?.textContent || ''),
        arrowheadStyle: style.arrowheadStyle || '',
        headTag: head?.tagName?.toLowerCase() || '',
        headFill: head ? (head.getAttribute('fill') || '') : '',
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
      };
    });
  }, pageNumber);
}

function isTarget(row) {
  return row.pdfId === '4631R' || String(row.text || '').includes('wetrheynetrynrthrt');
}

test('desktop imported FreeTextCallout /LE arrowhead intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=se011.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();

  await goToPage(page, 3);
  await expect.poll(
    async () => (await calloutSnapshot(page, 3)).length,
    { timeout: 45_000, message: 'expected imported FreeText callout on page 3' },
  ).toBeGreaterThan(0);
  expect(await pageViewBox(page, 3)).toMatch(/^0 0 1224 792$/);

  const rows = await calloutSnapshot(page, 3);
  const target = rows.find(isTarget) || rows[0];
  expect(target, 'imported FreeTextCallout 4631R').toBeTruthy();
  expect(target.arrowheadStyle, 'keeps /LE OpenArrow as openTriangle, not leftover solidTriangle')
    .toBe('openTriangle');
  expect(target.arrowheadStyle, 'must not leftover-paint solidTriangle').not.toBe('solidTriangle');
  expect(target.headTag, 'open triangle paints a polygon').toBe('polygon');
  expect(target.headFill, 'open triangle fill is none, not leftover solid').toBe('none');

  const textBox = page.locator(
    `[data-svg-annotation-layer="3"] g[data-callout-id="${target.id}"] [data-callout-part="textBox"]`,
  ).first();
  await textBox.click({ force: true, timeout: 12_000 });
  const arrowhead = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
  await expect(arrowhead).toBeVisible({ timeout: 12_000 });
  await expect(arrowhead, 'Select Arrowhead keeps Open triangle, not leftover Solid triangle')
    .toHaveText('Open triangle');

  await goToPage(page, 3);
  const afterJump = await calloutSnapshot(page, 3);
  expect(
    afterJump.filter(isTarget).length,
    'page jump must not invent extra 4631R',
  ).toBe(1);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Arrowhead', exact: true }).count()).toBe(0);
});

test('390 imported FreeTextCallout /LE arrowhead edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  await goToPage(page, 3);
  const rows = await calloutSnapshot(page, 3);
  const target = rows.find(isTarget) || rows[0];
  expect(target, '390 imported FreeTextCallout 4631R').toBeTruthy();
  expect(target.arrowheadStyle).toBe('openTriangle');
  expect(target.headFill).toBe('none');
  expect(await pageViewBox(page, 3)).toMatch(/^0 0 1224 792$/);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Arrowhead', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
});
