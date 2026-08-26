import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

// IMPORTED_CALLOUT_DASH_SELECT_EXPORT_HUNT
// Unique leftover after tip a0cf8172 (class 21 Square / Circle dash).
// Class 18/19 used imported Line / Poly dash. This FreeTextCallout already
// has native /BS /S /D, but import leftover-omitted lineStyle so Select
// Width leftover-replaced export Line /BS with leftover-solid. Distinct
// from leftover-18 and the twenty-one exhausted classes. Do not invent
// Font family chrome, stamp renderer, Note/Link create, create-poly tool,
// Line /AP, leftover-18 hosts, or stamp file.id.

const CALLOUT_PDF = '/?testPdf=e2e-imported-callout-dash.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = CALLOUT_PDF,
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

async function setWidth(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function calloutSnapshot(page) {
  return page.evaluate(() => {
    const ids = [...new Set(
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = legacy.style || data.style || object.style || {};
      const box = document.querySelector(
        `[data-svg-annotation-layer="1"] g[data-callout-id="${id}"] [data-callout-part="textBox"]`,
      );
      return {
        id,
        pdfId: object.pdfAnnotationId || legacy.pdfAnnotationId || null,
        text: String(object.text || legacy.text || data.text || ''),
        lineStyle: style.lineStyle || '',
        lineThickness: Number(style.lineThickness) || 0,
        visualBoxDash: box?.getAttribute('stroke-dasharray') || '',
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
      };
    });
  });
}

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

function readBs(doc, dict) {
  const bsRef = dict.get(PDFName.of('BS'));
  if (!bsRef) return null;
  const bs = lookupDict(doc, bsRef);
  if (!bs || typeof bs.get !== 'function') return null;
  const style = bs.get(PDFName.of('S'));
  const dash = bs.get(PDFName.of('D'));
  const width = bs.get(PDFName.of('W'));
  return {
    style: style?.decodeText ? style.decodeText() : String(style || ''),
    dash: dash?.asArray?.()?.map((n) => (n?.asNumber ? n.asNumber() : Number(n))) || null,
    width: width?.asNumber ? width.asNumber() : Number(width),
  };
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
  const exported = [];
  for (let i = 0; i < doc.getPageCount(); i += 1) {
    const annots = doc.getPage(i).node.lookup(PDFName.of('Annots'));
    if (!annots) continue;
    for (const ref of annots.asArray()) {
      const dict = lookupDict(doc, ref);
      if (!dict || typeof dict.get !== 'function') continue;
      const subtype = String(dict.get(PDFName.of('Subtype'))?.decodeText?.() || dict.get(PDFName.of('Subtype')) || '').replace(/^\//, '');
      exported.push({
        subtype,
        bs: readBs(doc, dict),
        hasBs: dict.get(PDFName.of('BS')) != null,
        keys: typeof dict.keys === 'function' ? [...dict.keys()].map((k) => String(k)) : [],
      });
    }
  }
  await unlink(dest).catch(() => {});
  return exported;
}

test('imported Callout /BS /D Select Width intended + break', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { url: CALLOUT_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');

  await expect.poll(
    async () => (await calloutSnapshot(page)).length,
    { timeout: 45_000, message: 'expected imported dashed FreeTextCallout' },
  ).toBeGreaterThan(0);

  const imported = (await calloutSnapshot(page))[0];
  expect(imported, 'fixture FreeTextCallout /BS /D').toBeTruthy();
  expect(String(imported.lineStyle || ''), 'import must stamp dashed, not leftover solid').toMatch(/dashed/i);

  await dismissChrome(page);
  const textBox = page.locator(
    `[data-svg-annotation-layer="1"] g[data-callout-id="${imported.id}"] [data-callout-part="textBox"]`,
  ).first();
  await textBox.click({ force: true, timeout: 12_000 });
  await expect.poll(async () => (
    await page.getByRole('textbox', { name: 'Width', exact: true }).first().isVisible().catch(() => false)
  ), { timeout: 8_000 }).toBe(true);
  await setWidth(page, 8);
  await page.keyboard.press('Escape');

  const after = (await calloutSnapshot(page)).find((row) => row.id === imported.id) || (await calloutSnapshot(page))[0];
  expect(after.lineThickness, 'imported Callout Select Width 8 must ride').toBe(8);
  expect(String(after.lineStyle || ''), 'Select Width must keep dashed').toMatch(/dashed/i);

  const liveState = await page.evaluate(() => {
    const ids = [...new Set([
      ...[...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]')]
        .map((el) => el.getAttribute('data-anno-id')),
      ...[...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')]
        .map((el) => el.getAttribute('data-callout-id')),
      ...[...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-pdf-annotation-id]')]
        .map((el) => el.getAttribute('data-pdf-annotation-id')),
    ].filter(Boolean))];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = legacy.style || data.style || object.style || {};
      return {
        id,
        found: Boolean(object?.type || object?.id || legacy.id),
        type: object?.type || '',
        pdfType: object?.pdfAnnotationType || '',
        pdfId: object?.pdfAnnotationId || legacy.pdfAnnotationId || data.pdfAnnotationId || null,
        dash: object?.strokeDashArray || null,
        width: Number(object?.strokeWidth || style.lineThickness) || 0,
        lineStyle: style.lineStyle || '',
        edited: object?.pdfImportedEditState || data.pdfImportedEditState || null,
        imported: object?.isPdfImported === true || legacy.isPdfImported === true,
      };
    });
  });

  const exported = await exportAnnots(page, 'imported-callout-dash-select-hunt');
  const leftoverSolidLine = exported.find((row) => (
    row.subtype === 'Line' && !row.bs
  ));
  expect(
    leftoverSolidLine,
    `Select Width must not leftover-replace native dashed /BS with leftover-solid Line: ${JSON.stringify({ liveState, exported })}`,
  ).toBeFalsy();
  const dashed = exported.filter((row) => (
    Array.isArray(row.bs?.dash)
    && row.bs.dash[0] === 6
    && row.bs.dash[1] === 4
  ));
  expect(
    dashed.length,
    `export must keep Line /BS [6 4], not leftover-solid: ${JSON.stringify({ liveState, exported })}`,
  ).toBeGreaterThan(0);
  const lines = dashed.filter((row) => row.subtype === 'Line');
  const nativeBox = dashed.filter((row) => row.subtype === 'FreeText');
  if (lines.length >= 2) {
    for (const line of lines) {
      expect(line.bs.style).toBe('D');
      expect(Number(line.bs.width), 'export must keep Select Width 8, not leftover-drop').toBe(8);
    }
  } else {
    expect(nativeBox.length, 'unedited native FreeText /BS [6 4] must stay, not leftover-solid').toBeGreaterThan(0);
    expect(nativeBox[0].bs.style).toBe('D');
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 imported-callout-dash edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844, url: CALLOUT_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count(), 'must not invent 390 hex chrome').toBe(0);
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count(), 'must not invent Font family chrome').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});
