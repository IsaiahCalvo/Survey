import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Imported Polygon Style Cloud Bump 8 survived on-screen as cloud-polygon,
// but export keyed on cloudBorder / fabricObj.cloudIntensity and skipped
// /AP so Acrobat's native /BE (I is only 0–2) clamped the scallops to 2.
// Distinct from leftover-18, Square Cloud Bump /AP, Cloud Bump persist,
// and Cloud Fill Opacity /ca. Do not invent a create-poly tool. Do not
// click swatch / hex / Transparent. Do not stamp file.id.

const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-polygon-cloud-bump-export.pdf';
const REIMPORT_TAB = /e2e-poly-vertices\.pdf|_e2e-polygon-cloud-bump-export\.pdf/;
const LIVE_BUMP = 8;

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

function bumpField(page) {
  return page.getByRole('textbox', { name: 'Cloud bump size', exact: true });
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
        intensity: data.pdfCloudIntensity ?? object.pdfCloudIntensity ?? null,
        shapeKind: shape?.getAttribute('data-shape-kind') || null,
        points: storedPoints || raw.trim().split(/\s+/).filter(Boolean).length,
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
    const byKind = await page.locator('[data-shape-kind="polygon"], [data-shape-kind="polyline"], [data-shape-kind="cloud-polygon"]').count();
    return Math.max(polys.filter((row) => row.imported && row.points >= 3).length, byKind);
  }, { message: 'expected imported polygon + polyline', timeout: 45_000 }).toBeGreaterThanOrEqual(3);
  const polyA = polys.find((row) => (row.type === 'polygon' || row.shapeKind === 'polygon' || row.shapeKind === 'cloud-polygon') && row.points === 4)
    || polys.find((row) => row.points === 4);
  expect(polyA?.id, 'polygon A').toBeTruthy();
  return { polyA };
}

async function pageToScreen(page, x, y) {
  const box = await pageBox(page);
  const raw = await pageViewBox(page);
  const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
  const W = parts[2] || 612;
  const H = parts[3] || 792;
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
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
  }, { timeout: 12_000, message: `expected Style on selected poly ${id}` }).toBe(1);
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

async function setBump(page, raw = LIVE_BUMP) {
  const field = bumpField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
  await expect(field).toHaveValue(String(raw));
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

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

function dictBeIntensity(doc, dict) {
  const be = lookupDict(doc, dict.get(PDFName.of('BE')));
  if (!be) return undefined;
  const value = be.get(PDFName.of('I'));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

async function exportedPolygonBump(dest) {
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
      hasBe: !!dict.get(PDFName.of('BE')),
      intensity: dictBeIntensity(doc, dict),
      hasAp: dict.get(PDFName.of('AP')) != null,
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

test('desktop imported Polygon Cloud Bump export /BE + /AP intended + break', async ({ page }) => {
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
  await pickStyle(page, 'Cloud');
  await setBump(page, LIVE_BUMP);
  await expect.poll(async () => {
    const row = (await polySnapshot(page)).find((item) => item.id === polyA.id);
    return row && Number(row.intensity) === LIVE_BUMP && row.shapeKind === 'cloud-polygon'
      ? LIVE_BUMP
      : 0;
  }, { message: 'selected-patch Bump 8 must stamp pdfCloudIntensity + cloud-polygon' }).toBe(LIVE_BUMP);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedPolygonBump(dest);
  const polygons = exported.filter((row) => String(row.subtype).includes('Polygon'));
  const cloudy = polygons.find((row) => row.hasBe && Number(row.intensity) === LIVE_BUMP);
  expect(cloudy, `exported live polygon must write Polygon /BE /I 8 (got ${JSON.stringify(polygons)})`).toBeTruthy();
  expect(cloudy.hasAp, 'Bump 8 must attach /AP so Acrobat does not clamp /BE/I to 2').toBe(true);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await polySnapshot(page);
    return rows.find((row) => (
      row.type === 'polygon'
      && Number(row.intensity) === LIVE_BUMP
      && row.shapeKind === 'cloud-polygon'
    )) || null;
  }, { timeout: 20_000, message: 'reimport must keep Cloud + Bump 8' }).not.toBeNull();

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
  expect(emptyRows.every((row) => row.intensity == null), 'empty export must not invent Cloud Bump').toBe(true);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await bumpField(page).count()).toBe(0);
});

test('390 imported Polygon Cloud Bump export edge: viewBox, file.id, no invent', async ({ page }) => {
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
    if (await bumpField(page).isVisible().catch(() => false) || await mobileStyle.isVisible().catch(() => false)) {
      await mobileStyle.click().catch(() => {});
      const listbox = page.getByRole('listbox', { name: 'Border style' });
      if (await listbox.isVisible().catch(() => false)) {
        await listbox.getByRole('option', { name: 'Cloud', exact: true }).click().catch(() => {});
      }
      if (await bumpField(page).isVisible().catch(() => false)) {
        await setBump(page, LIVE_BUMP);
        await expect.poll(async () => {
          const row = (await polySnapshot(page)).find((item) => item.id === polyA.id);
          return Number(row?.intensity) || 0;
        }).toBe(LIVE_BUMP);
      }
    }
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await bumpField(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count()).toBe(0);
});
