import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Imported Polygon (non-cloud) Style dash + Color Opacity survived
// on-screen, but export wrote hex /C + /Border width only so Acrobat
// stayed solid and opaque. Distinct from leftover-18, PolyLine /BS /CA,
// Polygon Cloud Bump /AP, and Cloud stroke /CA. Do not invent a
// create-poly tool. Do not click swatch / hex / Transparent. Do not
// stamp file.id.

const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-polygon-dash-opacity-export.pdf';
const REIMPORT_TAB = /e2e-poly-vertices\.pdf|_e2e-polygon-dash-opacity-export\.pdf/;
const LIVE_OPACITY = 40;
const LIVE_DASH = [6, 4];

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = POLY_PDF,
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
  const rgba = text.match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
  if (rgba) return rgba[1] != null ? Number(rgba[1]) : 1;
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

function dashKey(value) {
  if (value == null) return 'solid';
  const arr = Array.isArray(value)
    ? value.map(Number)
    : String(value).split(/[,\s]+/).filter(Boolean).map(Number);
  if (!arr.length || arr.every((n) => !n)) return 'solid';
  if (arr[0] === 6 && arr[1] === 4) return 'dashed';
  if (arr[0] === 2 && arr[1] === 4) return 'dotted';
  return arr.join(',');
}

async function polySnapshot(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type]')];
    return groups.map((group) => {
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const annoId = group.getAttribute('data-anno-id') || '';
      const type = String(group.getAttribute('data-pdf-annotation-type') || '').toLowerCase();
      const shape = group.querySelector('[data-shape-kind="polygon"], [data-shape-kind="polyline"], [data-shape-kind="cloud-polygon"]');
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || (pdfId && window.__phase35GetAnnotationById?.(pdfId))
        || {};
      const data = object.data || {};
      const raw = shape?.getAttribute('points') || '';
      const storedPoints = Array.isArray(object.points) ? object.points.length : 0;
      return {
        id: pdfId || annoId,
        type,
        imported: object.isPdfImported === true || Boolean(pdfId),
        points: storedPoints || raw.trim().split(/\s+/).filter(Boolean).length,
        stroke: object.stroke ?? data.stroke ?? null,
        visualStroke: shape?.getAttribute('stroke') || '',
        strokeDashArray: object.strokeDashArray ?? data.strokeDashArray ?? null,
        visualDash: shape?.getAttribute('stroke-dasharray') || null,
        intensity: data.pdfCloudIntensity ?? object.pdfCloudIntensity ?? null,
        shapeKind: shape?.getAttribute('data-shape-kind') || null,
      };
    }).filter((row) => (
      row.type === 'polygon'
      || row.type === 'polyline'
      || row.shapeKind === 'polygon'
      || row.shapeKind === 'polyline'
      || row.shapeKind === 'cloud-polygon'
    ));
  });
}

async function waitImported(page) {
  let polys = [];
  await expect.poll(async () => {
    polys = await polySnapshot(page);
    const byKind = await page.locator('[data-shape-kind="polygon"], [data-shape-kind="polyline"]').count();
    return Math.max(polys.filter((row) => row.imported && row.points >= 3).length, byKind);
  }, { message: 'expected imported polygon + polyline', timeout: 45_000 }).toBeGreaterThanOrEqual(3);
  const polyA = polys.find((row) => (
    (row.type === 'polygon' || row.shapeKind === 'polygon')
    && row.shapeKind !== 'cloud-polygon'
    && row.points === 4
  )) || polys.find((row) => row.points === 4 && row.shapeKind !== 'cloud-polygon');
  expect(polyA?.id, 'polygon A').toBeTruthy();
  return { polyA };
}

async function listPolyGeom(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type]')];
    return groups.map((group) => {
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const type = String(group.getAttribute('data-pdf-annotation-type') || '').toLowerCase();
      const shape = group.querySelector('[data-shape-kind="polygon"], [data-shape-kind="polyline"], [data-shape-kind="cloud-polygon"]');
      const object = window.__phase35GetAnnotationById?.(pdfId) || {};
      const raw = shape?.getAttribute('points') || '';
      const transform = shape?.getAttribute('transform') || '';
      const match = /translate\(([-0-9.]+),\s*([-0-9.]+)\)/.exec(transform);
      const left = match ? Number(match[1]) : 0;
      const top = match ? Number(match[2]) : 0;
      let points = raw.trim().split(/\s+/).filter(Boolean).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
      if (!points.length && Array.isArray(object.points)) {
        points = object.points.map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }));
      }
      return {
        id: pdfId,
        type,
        points,
        world: points.map((point) => ({ x: point.x + left, y: point.y + top })),
      };
    }).filter((row) => row.points.length >= 3);
  });
}

async function pageToScreen(page, x, y) {
  const box = await pageBox(page);
  const raw = await pageViewBox(page);
  const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
  const W = parts[2] || 612;
  const H = parts[3] || 792;
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
}

async function selectPoly(page, id) {
  await dismissChrome(page);
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
  await expect.poll(async () => {
    const rows = await listPolyGeom(page);
    const geom = rows.find((row) => row.id === id);
    if (!geom) return 0;
    const xs = geom.world.map((p) => p.x);
    const ys = geom.world.map((p) => p.y);
    const screen = await pageToScreen(
      page,
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    );
    await page.mouse.click(screen.x, screen.y);
    return page.getByRole('button', { name: 'Style', exact: true }).first().isVisible()
      .then((ok) => (ok ? 1 : 0))
      .catch(() => 0);
  }, { timeout: 12_000, message: `expected Style on selected polygon ${id}` }).toBe(1);
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

async function applyColorOpacity(page, pct = LIVE_OPACITY) {
  await page.keyboard.press('v');
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  const picker = page.locator('[data-annotation-color-picker]');
  if (!(await picker.isVisible().catch(() => false))) await color.click();
  await expect(picker).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible({ timeout: 8_000 });
  const borderTab = picker.getByRole('button', { name: 'Border', exact: true }).first();
  await expect(borderTab).toBeVisible({ timeout: 8_000 });
  await borderTab.click();
  await expect(page.locator('button[title="Match fill"]')).toBeVisible({ timeout: 8_000 });
  const field = picker.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeEnabled({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await expect(field).toHaveValue(String(pct));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toHaveCount(0, { timeout: 8_000 }).catch(() => {});
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

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

function readBsDash(doc, dict) {
  const raw = dict.get(PDFName.of('BS'));
  if (!raw) return null;
  const bs = lookupDict(doc, raw) || raw;
  const style = bs.get(PDFName.of('S'));
  const dash = bs.get(PDFName.of('D'));
  return {
    style: style?.decodeText ? style.decodeText() : String(style || ''),
    dash: dash && typeof dash.asArray === 'function'
      ? dash.asArray().map((n) => (n?.asNumber ? n.asNumber() : Number(n)))
      : null,
  };
}

async function exportedPolygonStyle(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      ca: dictNumber(dict, 'CA'),
      bs: readBsDash(doc, dict),
      hasBe: !!dict.get(PDFName.of('BE')),
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

test('desktop imported Polygon dash + Color Opacity export /BS + /CA intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=e2e-poly-vertices.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count(), 'no create-poly tool').toBe(0);

  await expect(page.locator('[data-shape-kind="polygon"]').first()).toBeVisible({ timeout: 45_000 });
  const { polyA } = await waitImported(page);
  await selectPoly(page, polyA.id);
  await pickStyle(page, 'Dashed');
  await applyColorOpacity(page, LIVE_OPACITY);
  await expect.poll(async () => {
    const row = (await polySnapshot(page)).find((item) => item.id === polyA.id);
    const dashed = dashKey(row?.strokeDashArray) === 'dashed' || dashKey(row?.visualDash) === 'dashed';
    const faded = Math.abs(parseAlpha(row?.stroke || row?.visualStroke) - 0.4) < 0.02;
    const notCloud = row?.shapeKind !== 'cloud-polygon' && row?.intensity == null;
    return dashed && faded && notCloud ? 1 : 0;
  }, { message: 'selected-patch Dashed + Color Opacity 40 must stamp strokeDashArray + rgba 0.4 (non-cloud)' }).toBe(1);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedPolygonStyle(dest);
  const polygons = exported.filter((row) => String(row.subtype).includes('Polygon') && !row.hasBe);
  const live = polygons.find((row) => (
    row.bs?.dash?.[0] === LIVE_DASH[0]
    && row.bs?.dash?.[1] === LIVE_DASH[1]
    && Math.abs((row.ca ?? -1) - 0.4) < 0.001
  ));
  expect(live, `exported live polygon must write Polygon /BS [6,4] + /CA 0.4 (got ${JSON.stringify(polygons)})`).toBeTruthy();

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await polySnapshot(page);
    return rows.find((row) => (
      (row.type === 'polygon' || row.shapeKind === 'polygon')
      && row.shapeKind !== 'cloud-polygon'
      && (dashKey(row.strokeDashArray) === 'dashed' || dashKey(row.visualDash) === 'dashed')
      && Math.abs(parseAlpha(row.stroke || row.visualStroke) - 0.4) < 0.05
    )) || null;
  }, { timeout: 20_000, message: 'reimport must keep Dashed + Color Opacity 0.4' }).not.toBeNull();

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
  const emptyRows = await polySnapshot(page);
  expect(
    emptyRows.every((row) => (
      (row.type !== 'polygon' && row.shapeKind !== 'polygon')
      || (dashKey(row.strokeDashArray) === 'solid' && parseAlpha(row.stroke || row.visualStroke) >= 0.99)
    )),
    'empty export must not invent dash or fade',
  ).toBe(true);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Style', exact: true }).count()).toBe(0);
});

test('390 imported Polygon dash + Color Opacity export edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count()).toBe(0);

  await expect(page.locator('[data-shape-kind="polygon"]').first()).toBeVisible({ timeout: 45_000 });
  const { polyA } = await waitImported(page);
  expect(polyA.id).toBeTruthy();
  const mobileStyle = page.getByRole('button', { name: /^Border style:/ }).first();
  if (await mobileStyle.isVisible().catch(() => false)) {
    await selectPoly(page, polyA.id);
    if (await mobileStyle.isVisible().catch(() => false)) {
      await mobileStyle.click().catch(() => {});
      const listbox = page.getByRole('listbox', { name: 'Border style' });
      if (await listbox.isVisible().catch(() => false)) {
        await listbox.getByRole('option', { name: 'Dashed', exact: true }).click().catch(() => {});
      }
    }
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count()).toBe(0);
});
