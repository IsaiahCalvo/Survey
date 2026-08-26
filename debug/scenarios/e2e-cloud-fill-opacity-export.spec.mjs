import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Cloud Fill Opacity survived on-screen as rgba fill + Style Cloud /BE,
// but export skipped /AP so /IC stayed hex-only and a faded cloud reached
// Acrobat opaque. Flatten already applied /ca. Distinct from leftover-18,
// Cloud Bump persist, and plain Square fill/stroke /ca. Do not click
// swatch / hex / Transparent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-cloud-fill-opacity-export.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-cloud-fill-opacity-export\.pdf/;
const LIVE_OPACITY = 40;

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

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
  if (rgba) return rgba[1] != null ? Number(rgba[1]) : 1;
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

async function shapeSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const group = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id="${id}"]`,
      );
      const shape = group?.querySelector('rect, ellipse, circle, path');
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        fill: object.fill ?? data.fill ?? null,
        stroke: object.stroke ?? data.stroke ?? null,
        intensity: data.pdfCloudIntensity ?? object.pdfCloudIntensity ?? null,
        visualFill: shape?.getAttribute('fill') || '',
        imported: object.isPdfImported === true,
      };
    }).filter((row) => keepImported || row.imported !== true);
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

async function pickStyle(page, optionName) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(optionName), exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(String(optionName), { exact: true }).click();
}

async function applyNextDrawFillOpacity(page, pct = LIVE_OPACITY) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) await color.click();
  await expect(presets).toBeVisible({ timeout: 8_000 });
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.isVisible().catch(() => false)) await fillTab.click();
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

async function createCloudRect(page) {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Shapes', 'Rectangle');
  await pickStyle(page, 'Cloud');
  await applyNextDrawFillOpacity(page, LIVE_OPACITY);
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.22);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.40, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await shapeSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created;
  }, { message: 'expected a new cloud rectangle' }).not.toBeNull();
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

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

function annotAppearanceGs(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return {};
  const nRef = ap.get(PDFName.of('N'));
  const stream = nRef?.dict ? nRef : doc.context.lookup(nRef);
  if (!stream) return {};
  const streamDict = stream.dict || stream;
  const resources = lookupDict(doc, streamDict.lookup?.(PDFName.of('Resources')) || streamDict.get?.(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  if (!ext || typeof ext.entries !== 'function') return {};
  const result = {};
  for (const [, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const ca = gs.get?.(PDFName.of('ca'));
    const CA = gs.get?.(PDFName.of('CA'));
    if (ca != null) result.ca = ca.asNumber ? ca.asNumber() : Number(ca);
    if (CA != null) result.CA = CA.asNumber ? CA.asNumber() : Number(CA);
  }
  return result;
}

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

async function exportedSquareOpacity(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const be = dict.get(PDFName.of('BE'));
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      hasBe: !!be,
      ca: dictNumber(dict, 'CA'),
      gs: annotAppearanceGs(doc, dict),
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

test('desktop Cloud Fill Opacity export /BE + /ca intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createCloudRect(page);
  expect(created.type === 'rect' || created.tool === 'rect').toBeTruthy();
  expect(created.intensity, 'Style Cloud must stamp Bump').toBeTruthy();
  expect(parseAlpha(created.fill), 'next-draw Fill Opacity must stamp fill 0.4').toBeCloseTo(0.4, 2);
  expect(parseAlpha(created.stroke), 'Border opacity must stay independent (not faded by Fill)').toBeGreaterThan(0.98);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedSquareOpacity(dest);
  const squares = exported.filter((row) => row.subtype === 'Square');
  const square = squares.find((row) => row.hasBe && Math.abs(Number(row.gs.ca) - 0.4) < 0.02);
  expect(square, `exported live cloud must write Square /BE + AP /ca 0.4 (got ${JSON.stringify(squares)})`).toBeTruthy();
  expect(square.ca, 'faded fill must not share dict /CA with the border').toBeUndefined();
  expect(square.gs.ca, 'Square AP /ca must be live fill opacity').toBeCloseTo(0.4, 2);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await shapeSnapshot(page, 1, { includeImported: true });
    return rows.find((row) => (
      (row.type === 'rect' || row.tool === 'rect')
      && Number(row.intensity) > 0
      && Math.abs(parseAlpha(row.fill || row.visualFill) - 0.4) < 0.02
    )) || null;
  }, { timeout: 20_000, message: 'reimport must keep Cloud + fill rgba ~0.4' }).not.toBeNull();

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
  expect((await shapeSnapshot(page)).length, 'empty export must not invent a cloud').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 Cloud Fill Opacity export edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await shapeSnapshot(page)).length).toBe(0);

  const mobileRect = page.getByRole('button', { name: 'Rectangle', exact: true }).first();
  if (await mobileRect.isVisible().catch(() => false)) {
    const created = await createCloudRect(page);
    expect(parseAlpha(created.fill)).toBeCloseTo(0.4, 2);
    expect(created.intensity).toBeTruthy();
  } else {
    expect(await page.getByRole('button', { name: 'Rectangle', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Rectangle', exact: true }).count()).toBe(0);
});
