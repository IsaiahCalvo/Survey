import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Imported stroked Ink Color Opacity survived on-screen and flatten
// already applied borderOpacity, but export wrote hex /C + AP ExtGState
// only so Acrobat / reimport stayed opaque. Distinct from leftover-18,
// filled paper-ink flatten /CA, Pen first-stroke opacity, and Polygon
// /IC /AP /ca. Do not invent a create-ink tool. Do not click swatch /
// hex / Transparent. Do not stamp file.id.

const INK_PDF = '/?testPdf=kal405-ink-dots.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-ink-stroke-opacity-export.pdf';
const REIMPORT_TAB = /kal405-ink-dots\.pdf|_e2e-ink-stroke-opacity-export\.pdf/;
const LIVE_OPACITY = 40;
const STROKE_ID = 'kal405-control-normal-stroke';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = INK_PDF,
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
  await page.keyboard.press('Escape').catch(() => {});
  await blurInputs(page);
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
  if (rgba) return rgba[1] != null ? Number(rgba[1]) : 1;
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

async function inkSnapshot(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')];
    return groups.map((group) => {
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const annoId = group.getAttribute('data-anno-id') || '';
      const type = String(group.getAttribute('data-pdf-annotation-type') || '').toLowerCase();
      const shape = group.querySelector('path');
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || (pdfId && window.__phase35GetAnnotationById?.(pdfId))
        || {};
      const data = object.data || {};
      return {
        id: pdfId || annoId,
        annoId,
        type,
        objectType: String(object.type || '').toLowerCase(),
        imported: object.isPdfImported === true || Boolean(pdfId || object.pdfAnnotationId),
        stroke: object.stroke ?? data.stroke ?? null,
        fill: object.fill ?? data.fill ?? null,
        visualStroke: shape?.getAttribute('stroke') || '',
        strokeWidth: object.strokeWidth ?? null,
        paperInk: Boolean(object.paperInkGeometry),
      };
    }).filter((row) => (
      row.type === 'ink'
      || row.objectType === 'path'
      || row.id.includes('kal405')
    ));
  });
}

function isStrokedImport(row) {
  if (!row?.imported) return false;
  if (row.paperInk) return false;
  if (Number(row.strokeWidth) > 0) return true;
  const paint = row.stroke || row.visualStroke;
  return Boolean(paint && paint !== 'transparent' && paint !== 'none');
}

async function waitImportedStroke(page) {
  let rows = [];
  await expect.poll(async () => {
    rows = await inkSnapshot(page);
    return rows.filter(isStrokedImport).length;
  }, { message: 'expected imported stroked Ink', timeout: 45_000 }).toBeGreaterThanOrEqual(1);
  const stroke = rows.find((row) => row.id === STROKE_ID || row.annoId === STROKE_ID)
    || rows.find(isStrokedImport);
  expect(stroke?.id || stroke?.annoId, `imported stroked Ink (got ${JSON.stringify(rows)})`).toBeTruthy();
  return stroke;
}

async function selectInk(page, id) {
  await dismissChrome(page);
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
  await expect.poll(async () => {
    const group = page.locator(`[data-svg-annotation-layer="1"] > g[data-pdf-annotation-id="${id}"], [data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
    if (!(await group.count())) return 0;
    const box = await group.boundingBox();
    if (!box) return 0;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return page.getByRole('button', { name: 'Color', exact: true }).first().isVisible()
      .then((ok) => (ok ? 1 : 0))
      .catch(() => 0);
  }, { timeout: 12_000, message: `expected Color on selected Ink ${id}` }).toBe(1);
}

async function applyColorOpacity(page, pct = LIVE_OPACITY) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) await color.click();
  await expect(presets).toBeVisible({ timeout: 8_000 });
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
  await page.keyboard.press('Escape');
  await expect(presets).toHaveCount(0, { timeout: 8_000 }).catch(() => {});
  await dismissChrome(page);
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

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

async function exportedInkStyle(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const nm = dict.get(PDFName.of('NM'));
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      nm: nm?.decodeText ? nm.decodeText() : String(nm || ''),
      ca: dictNumber(dict, 'CA'),
    };
  });
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

test('desktop imported Ink Color Opacity export /CA intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=kal405-ink-dots.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 400 320');
  expect(await page.getByRole('button', { name: 'Ink', exact: true }).count(), 'no create-ink tool').toBe(0);

  const stroke = await waitImportedStroke(page);
  const strokeKey = stroke.id || stroke.annoId;
  await selectInk(page, strokeKey);
  await applyColorOpacity(page, LIVE_OPACITY);
  await expect.poll(async () => {
    const row = (await inkSnapshot(page)).find((item) => item.id === strokeKey || item.annoId === strokeKey);
    return Math.abs(parseAlpha(row?.stroke || row?.visualStroke) - 0.4) < 0.02 ? 1 : 0;
  }, { message: 'selected-patch Color Opacity 40 must stamp rgba 0.4' }).toBe(1);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedInkStyle(dest);
  const inks = exported.filter((row) => String(row.subtype).includes('Ink'));
  const live = inks.find((row) => Math.abs((row.ca ?? -1) - 0.4) < 0.001);
  expect(live, `exported live Ink must write dict /CA 0.4 (got ${JSON.stringify(inks)})`).toBeTruthy();

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();

  await expect.poll(async () => {
    const rows = await inkSnapshot(page);
    return rows.find((row) => (
      (row.type === 'ink' || row.objectType === 'path')
      && Math.abs(parseAlpha(row.stroke || row.visualStroke || row.fill) - 0.4) < 0.05
    )) || null;
  }, { timeout: 20_000, message: 'reimport must keep Color Opacity 0.4' }).not.toBeNull();

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
  const emptyRows = await inkSnapshot(page);
  const emptyStroke = emptyRows.find((row) => row.id === STROKE_ID || row.annoId === STROKE_ID)
    || emptyRows.find(isStrokedImport);
  expect(
    parseAlpha(emptyStroke?.stroke || emptyStroke?.visualStroke) >= 0.99,
    `empty export must not invent fade on the control stroke (got ${JSON.stringify(emptyStroke)})`,
  ).toBe(true);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 imported Ink Color Opacity export edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 400 320');
  expect(await page.getByRole('button', { name: 'Ink', exact: true }).count()).toBe(0);

  const stroke = await waitImportedStroke(page);
  expect(stroke.id).toBeTruthy();
  const emptyRows = await inkSnapshot(page);
  const emptyStroke = emptyRows.find((row) => row.id === STROKE_ID || row.annoId === STROKE_ID)
    || emptyRows.find(isStrokedImport);
  expect(
    parseAlpha(emptyStroke?.stroke || emptyStroke?.visualStroke) >= 0.99,
    `390 must not invent fade on the control stroke (got ${JSON.stringify(emptyStroke)})`,
  ).toBe(true);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Ink', exact: true }).count()).toBe(0);
});
