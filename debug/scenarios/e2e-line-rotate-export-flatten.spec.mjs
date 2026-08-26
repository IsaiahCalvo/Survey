import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'path';
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
// rotate, but Line /L + flatten used leftover endpoints so Acrobat / print
// stayed untilted. Native Line has no /AP — bake the tilt into /L. Distinct
// from leftover-18, Square / Circle / FreeText /AP /Matrix. Do not invent
// Line /AP or callout Rotation. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-line-rotate-export-flatten.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-line-rotate-export-flatten\.pdf/;
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

function isLineRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  return type === 'line' && tool !== 'arrow' && tool !== 'callout';
}

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
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

async function shapeSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const centerX = (Number(object.left) || 0) + (Number(object.width) || 0) / 2;
      const centerY = (Number(object.top) || 0) + (Number(object.height) || 0) / 2;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        angle: Number(object.angle ?? data.angle ?? 0),
        leftoverX1: centerX + (Number(object.x1) || 0),
        leftoverY1: centerY + (Number(object.y1) || 0),
        leftoverX2: centerX + (Number(object.x2) || 0),
        leftoverY2: centerY + (Number(object.y2) || 0),
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

async function createLine(page) {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Shapes', 'Line');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.16, box.y + box.height * 0.22);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.44, box.y + box.height * 0.40, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await shapeSnapshot(page)).filter((row) => !before.has(row.id) && isLineRow(row));
    created = rows[0] || null;
    return created;
  }, { message: 'expected a new line' }).not.toBeNull();
  await dismissChrome(page);
  return (await shapeSnapshot(page)).find((item) => item.id === created.id);
}

async function clickLineMidpoint(page, created) {
  const box = await pageBox(page);
  const vb = String(await pageViewBox(page)).split(/\s+/).map(Number);
  const [minX, minY, vbW, vbH] = vb;
  const midX = (Number(created.leftoverX1) + Number(created.leftoverX2)) / 2;
  const midY = (Number(created.leftoverY1) + Number(created.leftoverY2)) / 2;
  const x = box.x + ((midX - minX) / vbW) * box.width;
  const y = box.y + ((midY - minY) / vbH) * box.height;
  return { x, y };
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
  await expect.poll(async () => {
    const layer = page.locator('[data-svg-annotation-layer="1"]').first();
    const cls = String(await layer.getAttribute('class') || '');
    return !cls.includes('tool-crosshair');
  }, { timeout: 8_000, message: 'Select must drop the Line creation crosshair' }).toBeTruthy();
}

async function selectLine(page, created) {
  await selectMode(page);
  if (await page.locator('[data-rotation-handle="mtr"]').count()) return;
  // justDraggedAtRef swallows native dblclick for 400ms after a drag.
  await page.waitForTimeout(500);
  const hit = page.locator(
    `[data-svg-annotation-layer="1"] [data-anno-id="${created.id}"] [data-shape-hit-target="line"]`,
  ).first();
  if (await hit.count()) {
    // Single-click Line chrome is endpoints only. Live Rotation lives on
    // the bbox-edit overlay after double-click. force: true so a thin
    // leftover stroke still receives the event once Select is armed.
    await hit.dblclick({ force: true });
    if (await page.locator('[data-rotation-handle="mtr"]').count()) return;
    await page.evaluate((id) => {
      const el = document.querySelector(
        `[data-svg-annotation-layer="1"] [data-anno-id="${id}"] [data-shape-hit-target="line"]`,
      );
      if (!el) return;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    }, created.id);
    if (await page.locator('[data-rotation-handle="mtr"]').count()) return;
  }
  const mid = await clickLineMidpoint(page, created);
  await page.mouse.dblclick(mid.x, mid.y);
}

async function applyRotation(page, created, degrees = LIVE_ANGLE) {
  await selectLine(page, created);
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
    const row = (await shapeSnapshot(page)).find((item) => item.id === created.id);
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

function leftoverLFromGeometry(geometry, pageHeight = 792) {
  const left = Number(geometry?.left) || 0;
  const top = Number(geometry?.top) || 0;
  const width = Number(geometry?.width) || 0;
  const height = Number(geometry?.height) || 0;
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const x1 = centerX + (Number(geometry?.x1) || 0);
  const y1 = centerY + (Number(geometry?.y1) || 0);
  const x2 = centerX + (Number(geometry?.x2) || 0);
  const y2 = centerY + (Number(geometry?.y2) || 0);
  return [x1, pageHeight - y1, x2, pageHeight - y2];
}

async function exportedLineRotate(dest) {
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
    const L = dict.get(PDFName.of('L'));
    const ap = dict.get(PDFName.of('AP'));
    const nums = L && typeof L.asArray === 'function'
      ? L.asArray().map((n) => (n?.asNumber ? n.asNumber() : Number(n)))
      : [];
    const leftover = leftoverLFromGeometry(metadata?.geometry);
    return {
      subtype: subtypeText,
      angle: Number(metadata?.geometry?.angle ?? metadata?.style?.angle ?? 0),
      L: nums,
      leftoverL: leftover,
      hasAp: Boolean(ap),
      leftoverX1: Number(metadata?.geometry?.x1),
    };
  }).filter((row) => /Line/i.test(row.subtype));
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

test('desktop line rotate export /L persist + reimport intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createLine(page);
  expect(isLineRow(created)).toBe(true);
  const leftoverSpan = Math.hypot(created.leftoverX2 - created.leftoverX1, created.leftoverY2 - created.leftoverY1);
  expect(leftoverSpan, 'Line commit must pass the 3pt gate').toBeGreaterThan(3);

  await applyRotation(page, created, LIVE_ANGLE);
  const afterRotate = (await shapeSnapshot(page)).find((row) => row.id === created.id);
  expect(angleNear(afterRotate?.angle, LIVE_ANGLE), `live angle ${afterRotate?.angle}`).toBe(true);
  const leftoverAfter = Math.hypot(
    afterRotate.leftoverX2 - afterRotate.leftoverX1,
    afterRotate.leftoverY2 - afterRotate.leftoverY1,
  );
  expect(leftoverAfter, 'Rotation must keep leftover endpoints (not bake on commit)').toBeCloseTo(leftoverSpan, 1);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedLineRotate(dest);
  const row = exported.find((item) => angleNear(item.angle, LIVE_ANGLE));
  expect(row, `exported Line must keep 45° (got ${JSON.stringify(exported)})`).toBeTruthy();
  expect(row.angle, 'SurveyAppAnnotation geometry.angle must be 45').toBe(45);
  expect(row.hasAp, 'must not invent Line /AP').toBe(false);
  expect(row.L.length, 'export must write /L').toBe(4);
  const leftoverMatch = row.leftoverL.every((value, index) => Math.abs(value - row.L[index]) < 0.6);
  expect(leftoverMatch, `rotated /L ${row.L} must not stay leftover ${row.leftoverL}`).toBe(false);
  expect(Number.isFinite(row.leftoverX1), 'metadata must keep leftover x1').toBe(true);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await shapeSnapshot(page, 1, { includeImported: true });
    return rows.find((item) => isLineRow(item) && angleNear(item.angle, LIVE_ANGLE)) || null;
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
  expect((await shapeSnapshot(page)).filter(isLineRow).length, 'empty export must not invent a line').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 line rotate export /L edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await shapeSnapshot(page)).filter(isLineRow).length).toBe(0);

  const created = await createLine(page);
  expect(isLineRow(created)).toBe(true);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});
