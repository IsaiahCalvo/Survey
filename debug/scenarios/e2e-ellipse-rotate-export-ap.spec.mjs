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

// Live Rotation already stamps fabric `angle` and Survey reimport
// already keeps it via metadata, but live circle /AP + flatten stayed
// axis-aligned so Acrobat / print ignored the tilt. Distinct from
// leftover-18, Square / rect Rotation /AP /Matrix, and textbox
// FreeText /AP /Matrix. Do not click swatch / hex / Transparent. Do
// not invent a richTextEditor, callout Rotation, Line /AP, or Square
// / Circle /BS. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-ellipse-rotate-export-ap.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-ellipse-rotate-export-ap\.pdf/;
const LIVE_OPACITY = 40;
const LIVE_ANGLE = 45;

function parseFill(raw) {
  const text = String(raw || '').trim();
  if (!text || text === 'transparent') return { hex: null, opacity: 0 };
  const rgba = text.match(/^rgba?\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
  if (rgba) {
    const opacity = rgba[4] != null ? Number(rgba[4]) : 1;
    const hex = `#${[rgba[1], rgba[2], rgba[3]].map((n) => (
      Math.round(Math.max(0, Math.min(255, Number(n)))).toString(16).padStart(2, '0')
    )).join('')}`.toUpperCase();
    return { hex: opacity > 0 ? hex : null, opacity: Number.isFinite(opacity) ? opacity : 1 };
  }
  if (/^#?[0-9a-fA-F]{6}$/.test(text)) {
    return { hex: `#${text.replace('#', '')}`.toUpperCase(), opacity: 1 };
  }
  return { hex: null, opacity: 0 };
}

function angleNear(angle, target, slack = 1.5) {
  const norm = ((Number(angle || 0) % 360) + 360) % 360;
  const want = ((Number(target) % 360) + 360) % 360;
  return Math.min(
    Math.abs(norm - want),
    Math.abs(norm - (want + 360)),
    Math.abs(norm - (want - 360)),
  ) < slack;
}

function isEllipseRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  return type === 'ellipse' || type === 'circle' || tool === 'ellipse';
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
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        fill: object.fill ?? data.fill ?? null,
        angle: Number(object.angle ?? data.angle ?? 0),
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

async function createEllipse(page, { applyFill = true } = {}) {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Shapes', 'Ellipse');
  if (applyFill) {
    await applyNextDrawFillOpacity(page, LIVE_OPACITY);
    await activateTool(page, 'Shapes', 'Ellipse');
  }
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.32, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await shapeSnapshot(page)).filter((row) => !before.has(row.id) && isEllipseRow(row));
    created = rows[0] || null;
    return created;
  }, { message: 'expected a new ellipse' }).not.toBeNull();
  await dismissChrome(page);
  return (await shapeSnapshot(page)).find((item) => item.id === created.id);
}

async function selectEllipse(page, createdId) {
  await page.keyboard.press('v');
  const target = page.locator(
    `[data-shape-id="${createdId}"], [data-svg-annotation-layer="1"] [data-anno-id="${createdId}"]`,
  ).first();
  await expect(target).toBeVisible({ timeout: 8_000 });
  const box = await target.boundingBox();
  expect(box, `bbox for ${createdId}`).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function applyRotation(page, createdId, degrees = LIVE_ANGLE) {
  await selectEllipse(page, createdId);
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
    const row = (await shapeSnapshot(page)).find((item) => item.id === createdId);
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

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

function readApMatrix(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return null;
  const nRef = ap.get(PDFName.of('N'));
  const stream = nRef?.dict ? nRef : doc.context.lookup(nRef);
  if (!stream) return null;
  const streamDict = stream.dict || stream;
  const matrix = streamDict.lookup?.(PDFName.of('Matrix')) || streamDict.get?.(PDFName.of('Matrix'));
  if (!matrix || typeof matrix.asArray !== 'function') return null;
  return matrix.asArray().map((n) => (n?.asNumber ? n.asNumber() : Number(n)));
}

async function exportedCircleRotate(dest) {
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
    const rect = dict.get(PDFName.of('Rect'));
    return {
      subtype: subtypeText,
      angle: Number(metadata?.geometry?.angle ?? metadata?.style?.angle ?? 0),
      fade: String(metadata?.style?.fill || ''),
      matrix: readApMatrix(doc, dict),
      rectH: rect && typeof rect.asArray === 'function'
        ? (() => {
          const nums = rect.asArray().map((n) => (n?.asNumber ? n.asNumber() : Number(n)));
          return nums[3] - nums[1];
        })()
        : 0,
    };
  }).filter((row) => /Circle/i.test(row.subtype));
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

test('desktop ellipse rotate export /AP persist + reimport intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createEllipse(page);
  expect(isEllipseRow(created)).toBe(true);
  expect(parseFill(created.fill).opacity, 'Fill Opacity must stamp 0.4').toBeCloseTo(0.4, 2);

  await applyRotation(page, created.id, LIVE_ANGLE);
  const afterRotate = (await shapeSnapshot(page)).find((row) => row.id === created.id);
  expect(angleNear(afterRotate?.angle, LIVE_ANGLE), `live angle ${afterRotate?.angle}`).toBe(true);
  expect(parseFill(afterRotate?.fill).opacity, 'Rotation must not drop fade').toBeCloseTo(0.4, 2);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedCircleRotate(dest);
  const row = exported.find((item) => angleNear(item.angle, LIVE_ANGLE));
  expect(row, `exported Circle must keep 45° (got ${JSON.stringify(exported)})`).toBeTruthy();
  expect(row.angle, 'SurveyAppAnnotation geometry.angle must be 45').toBe(45);
  expect(row.fade, 'reimport metadata must keep faded fill').toMatch(/0\.4/);
  expect(row.matrix, 'rotated Circle /AP must write /Matrix').toBeTruthy();
  expect(Math.abs(Math.abs(row.matrix[0]) - Math.SQRT1_2) < 0.02, `Matrix a ${row.matrix}`).toBe(true);
  expect(row.rectH, 'rotated /Rect height must exceed leftover box').toBeGreaterThan(40);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await shapeSnapshot(page, 1, { includeImported: true });
    return rows.find((item) => (
      isEllipseRow(item)
      && angleNear(item.angle, LIVE_ANGLE)
      && Math.abs(parseFill(item.fill).opacity - 0.4) < 0.02
    )) || null;
  }, { timeout: 20_000, message: 'reimport must keep 45° + faded fill' }).not.toBeNull();

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
  expect((await shapeSnapshot(page)).filter(isEllipseRow).length, 'empty export must not invent an ellipse').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 ellipse rotate export /AP edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await shapeSnapshot(page)).filter(isEllipseRow).length).toBe(0);

  const created = await createEllipse(page, { applyFill: false });
  expect(isEllipseRow(created)).toBe(true);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});
