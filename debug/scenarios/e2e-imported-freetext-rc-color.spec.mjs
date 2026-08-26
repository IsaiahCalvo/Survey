import { test, expect } from '@playwright/test';

// Imported FreeText /RC leftover-painted from /DS.
// se011 4631R native /RC is #1172E8 and /DS is #9643FC; import preferred
// leftover /DS so the callout text painted purple until Color was
// re-touched. Distinct from leftover-18, imported Ink/Polygon/PolyLine
// dash+opacity export, Square / Circle / Polygon stroke /CA, imported
// filled Ink /CA, imported-outline Width restroke, and inventing a
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
}

async function goToPage(page, pageNumber) {
  const edit = page.getByRole('button', { name: 'Edit page number', exact: true }).first();
  if (await edit.isVisible().catch(() => false)) {
    await edit.click();
  }
  const input = page.locator('[data-page-number-input]').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(String(pageNumber));
  await input.press('Enter');
  const layer = page.locator(`[data-svg-annotation-layer="${pageNumber}"]`);
  await layer.scrollIntoViewIfNeeded().catch(() => {});
  await expect(layer).toBeVisible({ timeout: 45_000 });
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page, pageNumber = 3) {
  return (await page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first().getAttribute('viewBox')) || '';
}

function normalizeHex(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const rgb = text.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!rgb) return text;
  const hex = (value) => Math.max(0, Math.min(255, Math.round(Number(value))))
    .toString(16)
    .padStart(2, '0');
  return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
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
      return {
        id,
        pdfId: object.pdfAnnotationId || legacy.pdfAnnotationId || null,
        text: String(object.text || legacy.text || data.text || painted?.textContent || ''),
        fontColor: style.fontColor || style.textColor || '',
        visualColor: painted ? (painted.style?.color || getComputedStyle(painted).color || '') : '',
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
      };
    });
  }, pageNumber);
}

test('desktop imported FreeText /RC color intended + break', async ({ page }) => {
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
  const target = rows.find((row) => row.pdfId === '4631R' || row.text.includes('wetrheynetrynrthrt')) || rows[0];
  expect(target, 'imported FreeText 4631R').toBeTruthy();
  const fill = normalizeHex(target.fontColor);
  const visual = normalizeHex(target.visualColor);
  expect(fill, 'fontColor keeps /RC #1172E8, not leftover /DS #9643FC').toBe('#1172e8');
  expect(visual === '#1172e8' || visual === '#1272e8' || fill === '#1172e8').toBeTruthy();
  expect(fill, 'must not leftover-paint /DS purple').not.toBe('#9643fc');

  await goToPage(page, 3);
  const afterJump = await calloutSnapshot(page, 3);
  expect(
    afterJump.filter((row) => row.pdfId === '4631R' || row.text.includes('wetrheynetrynrthrt')).length,
    'page jump must not invent extra 4631R',
  ).toBe(1);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 imported FreeText /RC color edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  await goToPage(page, 3);
  const rows = await calloutSnapshot(page, 3);
  const target = rows.find((row) => row.pdfId === '4631R' || row.text.includes('wetrheynetrynrthrt')) || rows[0];
  expect(target, '390 imported FreeText 4631R').toBeTruthy();
  expect(normalizeHex(target.fontColor)).toBe('#1172e8');
  expect(await pageViewBox(page, 3)).toMatch(/^0 0 1224 792$/);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
});
