import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

// IMPORTED_ARROW_LE_SELECT_EXPORT_HUNT
// Unique leftover after tip 3b5bbbc4 (class 19). Class 19 used a headless
// imported Line. This Line already has native /LE OpenArrow, but import
// leftover-omitted arrowheadStyle so Select Width leftover-remapped
// export /LE to ClosedArrow. Distinct from leftover-18 and the nineteen
// exhausted classes. Do not invent Font family chrome, stamp renderer,
// Note/Link create, create-poly tool, leftover-18 hosts, or stamp file.id.

const ARROW_PDF = '/?testPdf=e2e-imported-arrow-le.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = ARROW_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
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
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
  }
}

async function waitForImports(page) {
  await expect.poll(
    async () => page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-id]').count(),
    { timeout: 45_000 },
  ).toBeGreaterThan(0);
}

async function setWidth(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function selectImportedByPdfId(page, pdfId) {
  await dismissChrome(page);
  await expect.poll(() => page.evaluate(() => typeof window.__fix19SelectAnnotation)).toBe('function');
  const selected = await page.evaluate((id) => window.__fix19SelectAnnotation?.(id), pdfId);
  if (!selected) {
    await page.keyboard.press('v');
    const group = page.locator(
      `[data-svg-annotation-layer="1"] [data-pdf-annotation-id="${pdfId}"]`,
    ).first();
    await expect(group).toBeVisible({ timeout: 8_000 });
    const box = await group.boundingBox();
    expect(box, `imported ${pdfId} geometry`).toBeTruthy();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

async function readImported(page, pdfId) {
  return page.evaluate((want) => {
    const group = document.querySelector(
      `[data-svg-annotation-layer="1"] [data-pdf-annotation-id="${want}"]`,
    );
    const annoId = group?.getAttribute('data-anno-id') || '';
    const candidates = [annoId, want].filter(Boolean);
    let object = null;
    for (const id of candidates) {
      const hit = window.__phase35GetAnnotationById?.(id);
      if (hit && (hit.type || hit.pdfAnnotationId || hit.data)) {
        object = hit;
        break;
      }
    }
    return {
      pdfId: want,
      annoId,
      found: Boolean(object),
      type: String(object?.type || ''),
      tool: String(object?.tool || object?.data?.tool || object?.data?.type || ''),
      arrowheadStyle: object?.data?.arrowheadStyle || object?.arrowheadStyle || '',
      pdfLineEndings: object?.data?.pdfLineEndings || null,
      strokeWidth: Number(object?.strokeWidth) || 0,
      editState: object?.pdfImportedEditState || object?.data?.pdfImportedEditState || null,
    };
  }, pdfId);
}

async function exportAnnots(page, tag) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first();
  await expect(exportBtn).toBeVisible();
  const dest = path.join(os.tmpdir(), `${tag}-${Date.now()}.pdf`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click({ force: true }),
  ]);
  await download.saveAs(dest);
  const doc = await PDFDocument.load(await readFile(dest));
  const lookup = (value) => {
    if (!value) return null;
    if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
    return doc.context.lookup(value) || null;
  };
  const exported = [];
  for (let i = 0; i < doc.getPageCount(); i += 1) {
    const annots = doc.getPage(i).node.lookup(PDFName.of('Annots'));
    if (!annots) continue;
    for (const ref of annots.asArray()) {
      const dict = lookup(ref);
      if (!dict || typeof dict.get !== 'function') continue;
      const subtype = String(dict.get(PDFName.of('Subtype'))?.decodeText?.() || dict.get(PDFName.of('Subtype')) || '').replace(/^\//, '');
      const border = dict.get(PDFName.of('Border'));
      const borderNums = border?.asArray?.()?.map((n) => (n?.asNumber ? n.asNumber() : Number(n))) || [];
      const bs = lookup(dict.get(PDFName.of('BS')));
      const bsW = bs?.get?.(PDFName.of('W'));
      const le = dict.get(PDFName.of('LE'));
      const leArr = le?.asArray?.()?.map((n) => String(n).replace(/^\//, '')) || [];
      exported.push({
        subtype,
        borderW: borderNums[2] ?? null,
        bsW: bsW?.asNumber ? bsW.asNumber() : (bsW != null ? Number(bsW) : null),
        le: leArr,
      });
    }
  }
  await unlink(dest).catch(() => {});
  return exported;
}

test('imported Arrow /LE Select Width intended + break', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { url: ARROW_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  await waitForImports(page);

  const pdfId = await page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-id]').first().getAttribute('data-pdf-annotation-id');
  expect(pdfId, 'fixture Line /LE').toBeTruthy();
  await selectImportedByPdfId(page, pdfId);
  await expect.poll(async () => (
    await page.getByRole('textbox', { name: 'Width', exact: true }).first().isVisible().catch(() => false)
  ), { timeout: 8_000 }).toBe(true);
  const imported = await readImported(page, pdfId);
  if (imported.found) {
    expect(imported.tool, 'imported OpenArrow Line must map to Arrow').toMatch(/arrow/i);
    expect(imported.arrowheadStyle, 'import must stamp openTriangle, not leftover solidTriangle').toBe('openTriangle');
    expect(imported.pdfLineEndings, 'import must keep native /LE OpenArrow').toEqual(['None', 'OpenArrow']);
  }
  await setWidth(page, 8);
  await page.keyboard.press('Escape');
  const after = await readImported(page, pdfId);
  expect(after.strokeWidth, 'imported Arrow Select Width 8 must ride').toBe(8);
  expect(after.arrowheadStyle, 'Select Width must keep openTriangle').toBe('openTriangle');
  expect(after.editState, 'Select Width must stamp edited so export replaces native leftover /LE').toBe('edited');

  const lineExport = await exportAnnots(page, 'imported-arrow-le-select-hunt');
  const lineOuts = lineExport.filter((row) => row.subtype === 'Line');
  expect(lineOuts.length, 'Select must not leftover-duplicate native Line').toBe(1);
  expect(Number(lineOuts[0].bsW ?? lineOuts[0].borderW), 'export must keep Select Width 8, not leftover-drop').toBe(8);
  expect(lineOuts[0].le, 'export must keep /LE OpenArrow, not leftover ClosedArrow').toEqual(['None', 'OpenArrow']);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 imported-arrow-le edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844, url: ARROW_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count(), 'must not invent 390 hex chrome').toBe(0);
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count(), 'must not invent Font family chrome').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});
