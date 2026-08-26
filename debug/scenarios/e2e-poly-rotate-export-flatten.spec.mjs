import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

const PDF_APP_ANNOTATION_METADATA_KEY = 'SurveyAppAnnotation';

function parsePdfAppAnnotationMetadata(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed?.app === 'SurveyApp' && parsed?.kind && parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

// Live Rotation already stamps fabric `angle` and metadata + screen already
// rotate, but Polygon / PolyLine /Vertices + flatten used leftover
// polygonWorldPoint so Acrobat / print stayed untilted. Native Polygon /
// PolyLine have no rotation /AP — bake the tilt into /Vertices. Distinct
// from leftover-18, Line /L bake, Square / Circle / FreeText /AP /Matrix.
// Do not invent a create-poly tool or Line /AP. Do not stamp file.id.

const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-poly-rotate-export-flatten.pdf';
const REIMPORT_TAB = /e2e-poly-vertices\.pdf|_e2e-poly-rotate-export-flatten\.pdf/;
const LIVE_ANGLE = 45;

function angleNear(angle, target, slack = 1.5) {
  const norm = ((Number(angle || 0) % 360) + 360) % 360;
  const want = ((Number(target) % 360) + 360) % 360;
  return Math.min(
    Math.abs(norm - want),
    Math.abs(norm - (want + 360)),
    Math.abs(norm - (want - 360)),
  ) < slack;
}

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = POLY_PDF,
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

async function listPolys(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type]')];
    return groups.map((group) => {
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const annoId = group.getAttribute('data-anno-id') || '';
      const type = String(group.getAttribute('data-pdf-annotation-type') || '').toLowerCase();
      const shape = group.querySelector('[data-shape-kind="polygon"], [data-shape-kind="polyline"]');
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || (pdfId && window.__phase35GetAnnotationById?.(pdfId))
        || {};
      const raw = shape?.getAttribute('points') || '';
      const transform = shape?.getAttribute('transform') || '';
      const match = /translate\(([-0-9.]+),\s*([-0-9.]+)\)/.exec(transform);
      const left = match ? Number(match[1]) : (Number(object.left) || 0);
      const top = match ? Number(match[2]) : (Number(object.top) || 0);
      const sx = Math.abs(Number(object.scaleX) || 1);
      const sy = Math.abs(Number(object.scaleY) || 1);
      let points = raw.trim().split(/\s+/).filter(Boolean).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
      if (!points.length && Array.isArray(object.points)) {
        points = object.points.map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }));
      }
      return {
        id: pdfId || annoId,
        type,
        angle: Number(object.angle || 0),
        points,
        leftoverWorld: points.map((point) => ({ x: left + sx * point.x, y: top + sy * point.y })),
        transform,
      };
    }).filter((row) => (row.type === 'polygon' || row.type === 'polyline') && row.points.length >= 3);
  });
}

async function pageToScreen(page, x, y) {
  const box = await pageBox(page);
  const raw = String(await pageViewBox(page) || '0 0 612 792').trim().split(/\s+/).map(Number);
  const W = raw[2] || 612;
  const H = raw[3] || 792;
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
}

async function clickCentroid(page, geom) {
  const xs = geom.leftoverWorld.map((p) => p.x);
  const ys = geom.leftoverWorld.map((p) => p.y);
  const screen = await pageToScreen(
    page,
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  );
  await page.mouse.click(screen.x, screen.y);
  return screen;
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const scoped = page.locator(
    'button.btn-icon[aria-label="Select"], button.mobile-pdf-tools__button[aria-label="Select"]',
  );
  if (await scoped.count() && await scoped.first().isVisible().catch(() => false)) {
    await scoped.first().click();
  } else {
    const fallback = page.getByRole('button', { name: 'Select', exact: true });
    if (await fallback.first().isVisible().catch(() => false)) await fallback.first().click();
  }
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function enterBboxEdit(page, geom) {
  await selectMode(page);
  let screen = null;
  await expect.poll(async () => {
    screen = await clickCentroid(page, geom);
    return page.locator('circle[data-handle^="vertex-"]').count();
  }, { timeout: 12_000, message: 'vertex-N chrome after Select click' }).toBe(geom.points.length);
  await page.waitForTimeout(600);
  await page.mouse.dblclick(screen.x, screen.y);
  if (!(await page.locator('[data-rotation-handle="mtr"]').first().isVisible().catch(() => false))) {
    const target = page.locator('[data-shape-hit-target="polygon"], [data-shape-kind="polygon"]').first();
    if (await target.isVisible().catch(() => false)) {
      const box = await target.boundingBox();
      if (box) await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    }
  }
  await expect(page.locator('[data-rotation-handle="mtr"]').first()).toBeVisible({ timeout: 8_000 });
}

async function applyRotation(page, geom, degrees = LIVE_ANGLE) {
  await enterBboxEdit(page, geom);
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, 'mtr geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const input = page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true });
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.click();
  await input.fill(String(degrees));
  await expect(input).toHaveValue(String(degrees));
  await input.press('Enter');
  await expect.poll(async () => {
    const row = (await listPolys(page)).find((item) => item.id === geom.id);
    return angleNear(row?.angle, degrees) ? degrees : Number(row?.angle);
  }, { timeout: 12_000, message: `Rotation must stamp ${degrees}` }).toBe(degrees);
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

function leftoverVerticesFromWorld(world, pageHeight = 792) {
  return world.flatMap((point) => [point.x, pageHeight - point.y]);
}

async function exportedPolyRotate(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const subtypeText = subtype?.decodeText ? subtype.decodeText() : String(subtype || '');
    const metadataRaw = dict.get(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY));
    const metadataText = metadataRaw?.decodeText?.() || '';
    const metadata = parsePdfAppAnnotationMetadata(metadataText);
    const V = dict.get(PDFName.of('Vertices'));
    const nums = V && typeof V.asArray === 'function'
      ? V.asArray().map((n) => (n?.asNumber ? n.asNumber() : Number(n)))
      : [];
    return {
      subtype: subtypeText,
      angle: Number(metadata?.geometry?.angle ?? metadata?.style?.angle ?? 0),
      vertices: nums,
      leftoverPts: metadata?.geometry?.points || null,
    };
  }).filter((row) => /Polygon|PolyLine/i.test(row.subtype));
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

test('desktop imported Polygon rotate export /Vertices persist + reimport intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=e2e-poly-vertices.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count(), 'no create-poly tool').toBe(0);

  await expect(page.locator('[data-shape-kind="polygon"]').first()).toBeVisible({ timeout: 45_000 });
  let rows = [];
  await expect.poll(async () => {
    rows = await listPolys(page);
    return rows.filter((row) => row.type === 'polygon' && row.points.length === 4).length;
  }, { timeout: 45_000, message: 'expected imported 4-vertex polygon' }).toBeGreaterThan(0);
  const poly = rows.find((row) => row.type === 'polygon' && row.points.length === 4);
  expect(poly?.id, 'polygon A').toBeTruthy();
  const leftoverBefore = JSON.stringify(poly.leftoverWorld);

  await applyRotation(page, poly, LIVE_ANGLE);
  const afterRotate = (await listPolys(page)).find((row) => row.id === poly.id);
  expect(angleNear(afterRotate?.angle, LIVE_ANGLE), `live angle ${afterRotate?.angle}`).toBe(true);
  expect(JSON.stringify(afterRotate.leftoverWorld), 'Rotation must keep leftover points (not bake on commit)').toBe(leftoverBefore);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedPolyRotate(dest);
  const row = exported.find((item) => angleNear(item.angle, LIVE_ANGLE) && /Polygon/i.test(item.subtype));
  expect(row, `exported Polygon must keep 45° (got ${JSON.stringify(exported)})`).toBeTruthy();
  expect(row.angle, 'SurveyAppAnnotation geometry.angle must be 45').toBe(45);
  expect(row.vertices.length, 'export must write /Vertices').toBeGreaterThanOrEqual(8);
  const leftoverPdf = leftoverVerticesFromWorld(afterRotate.leftoverWorld);
  const leftoverMatch = leftoverPdf.every((value, index) => Math.abs(value - row.vertices[index]) < 0.8);
  expect(leftoverMatch, `rotated /Vertices ${row.vertices} must not stay leftover ${leftoverPdf}`).toBe(false);
  expect(row.leftoverPts?.[0]?.x, 'metadata must keep leftover points').toBeDefined();

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const next = await listPolys(page);
    return next.find((item) => item.type === 'polygon' && angleNear(item.angle, LIVE_ANGLE)) || null;
  }, { timeout: 20_000, message: 'reimport must keep 45°' }).not.toBeNull();

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
  const emptyRows = await listPolys(page);
  expect(
    emptyRows.filter((item) => item.type === 'polygon' && angleNear(item.angle, LIVE_ANGLE)).length,
    'empty export must not invent a rotated polygon',
  ).toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 imported Polygon rotate export edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count()).toBe(0);

  await expect(page.locator('[data-shape-kind="polygon"]').first()).toBeVisible({ timeout: 45_000 });
  let rows = [];
  await expect.poll(async () => {
    rows = await listPolys(page);
    return rows.filter((row) => row.type === 'polygon' && row.points.length === 4).length;
  }, { timeout: 45_000 }).toBeGreaterThan(0);
  expect(rows.find((row) => row.type === 'polygon')?.id).toBeTruthy();

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count()).toBe(0);
});
