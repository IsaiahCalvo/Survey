import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Highlighter first-stroke used Math.max(strokeWidth, 8) until Width
// patched the selected ink. Distinct from leftover-18, Pen as-is
// sourceWidth, highlighter Width catalog above 8, and highlightColor
// compose. Do not invent a floor of 8. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-highlighter-first-stroke-width.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-highlighter-first-stroke-width\.pdf/;
const LIVE_WIDTH = 4;

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
          || key.startsWith('pdfSidebar_')
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
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function dismissChrome(page) {
  await blurInputs(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function highlighterSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        sourceWidth: object.sourceWidth ?? null,
        strokeWidth: object.strokeWidth ?? null,
        multiply: object.globalCompositeOperation || null,
        imported: object.isPdfImported === true,
      };
    }).filter((row) => {
      if (row.tool !== 'highlighter') return false;
      return keepImported || row.imported !== true;
    });
  }, { pageNum: pageNumber, includeImported });
}

async function activateTool(page, categoryName, toolName) {
  const hostTool = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true }).first();
  if (!(await hostTool.isVisible().catch(() => false))) {
    const buttons = page.getByRole('button', { name: categoryName, exact: true });
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      if (await buttons.nth(i).isVisible().catch(() => false)) {
        await buttons.nth(i).click();
        break;
      }
    }
  }
  if (await hostTool.isVisible().catch(() => false)) {
    if ((await hostTool.getAttribute('aria-pressed')) !== 'true') await hostTool.click();
    return;
  }
  const mobile = page.getByRole('button', { name: toolName, exact: true });
  const count = await mobile.count();
  for (let i = 0; i < count; i += 1) {
    const btn = mobile.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const pressed = await btn.getAttribute('aria-pressed');
    if (pressed === 'true') return;
    await btn.click();
    return;
  }
  await expect(hostTool, `tool ${toolName}`).toBeVisible();
}

async function widthField(page) {
  return page.getByRole('textbox', { name: 'Width', exact: true }).first();
}

async function setWidthTyped(page, raw) {
  const field = await widthField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
  return field;
}

async function createFirstStrokeAfterWidth(page, width = LIVE_WIDTH) {
  const before = new Set((await highlighterSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Draw', 'Highlighter');
  expect((await highlighterSnapshot(page)).length, 'next-draw Width must run before any stroke').toBe(0);
  const field = await setWidthTyped(page, width);
  await expect(field).toHaveValue(String(width));
  expect((await highlighterSnapshot(page)).length, 'Width before first stroke must not invent ink').toBe(0);
  await activateTool(page, 'Draw', 'Highlighter');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.38, { steps: 12 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await highlighterSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created && created.sourceWidth === width ? created : null;
  }, { message: `first highlighter must stamp sourceWidth ${width} without touching Width again` }).not.toBeNull();
  await dismissChrome(page);
  return created;
}

async function exportAndSave(page, destName) {
  await page.keyboard.press('Escape');
  await dismissChrome(page);
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first();
  await expect(exportBtn).toBeVisible();
  await exportBtn.scrollIntoViewIfNeeded().catch(() => {});
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click({ force: true }),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const dest = path.join(FIXTURE_DIR, destName);
  await download.saveAs(dest);
  return dest;
}

function parseSurveySourceWidth(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.geometry?.sourceWidth ?? parsed?.sourceWidth ?? null;
  } catch {
    return null;
  }
}

async function exportedInkSourceWidths(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const metaRaw = dict.get(PDFName.of('SurveyAppAnnotation'));
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      sourceWidth: parseSurveySourceWidth(metaRaw?.decodeText ? metaRaw.decodeText() : null),
    };
  }).filter((row) => row.subtype === 'Ink');
}

async function wipeAnnotationKeys(page) {
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('annotationsByPage_')
        || key.startsWith('callouts_')
        || key.startsWith('surveyMarkers_')
        || key.startsWith('cloudRenderAnnotationsByPage_')
        || key.startsWith('toolPrefs_')
        || key.startsWith('pdfSidebar_')
      )) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  });
}

test('desktop first-stroke Width persist + export sourceWidth intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createFirstStrokeAfterWidth(page, LIVE_WIDTH);
  expect(created.tool).toBe('highlighter');
  expect(created.sourceWidth, 'first stroke must keep next-draw Width 4').toBe(4);
  expect(created.strokeWidth).toBe(0);
  expect(created.multiply).toBe('multiply');

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedInkSourceWidths(dest);
  const ink = exported.find((row) => row.sourceWidth === LIVE_WIDTH);
  expect(ink, `exported first stroke must write sourceWidth 4 (got ${JSON.stringify(exported)})`).toBeTruthy();

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await highlighterSnapshot(page, 1, { includeImported: true });
    return rows.find((row) => row.sourceWidth === LIVE_WIDTH) || null;
  }, { timeout: 20_000, message: 'reimport must keep sourceWidth 4' }).not.toBeNull();

  await unlink(dest).catch(() => {});

  await openEditor(page);
  await dismissChrome(page);
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  expect((await highlighterSnapshot(page)).length, 'empty export must not invent a highlighter').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('textbox', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 first-stroke Width edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await highlighterSnapshot(page)).length).toBe(0);

  const mobileHl = page.getByRole('button', { name: 'Highlighter', exact: true }).first();
  if (await mobileHl.isVisible().catch(() => false)) {
    const created = await createFirstStrokeAfterWidth(page, 1);
    expect(created.sourceWidth, '390 Width 1 must stamp as-is').toBe(1);
  } else {
    expect(await page.getByRole('button', { name: 'Highlighter', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('textbox', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Highlighter', exact: true }).count()).toBe(0);
});
