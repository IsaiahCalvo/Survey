import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

// AFTER_COUNTER_ELLIPSE_ROTATE_CLOUD_POLY_HUNT
// Genuine hunt after tip 096fc1b0 (class 17). Unused preferred surfaces:
// Ellipse rotate then Select/export persist (Square rotate was class 16),
// Cloud first-create after Textbox sibling (Cloud Bump remount after
// Line/Arrow was class 11; Cloud after Ellipse already rode in 7962b2b2),
// imported Line/Poly Select Width or dash export, Callout Select Fill
// after Ellipse. Distinct from leftover-18 and the seventeen exhausted
// classes. Do not invent Font family chrome, stamp renderer, Note/Link
// create, create-poly tool, leftover-18 hosts, or stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const HUB = '/?hubPreview=1';

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([+-]?\d*\.?\d+)\s*\)/i);
  if (rgba) return Number(rgba[1]);
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
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
  }
}

async function setWidth(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function setFillOpacity(page, pct) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await color.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.isVisible().catch(() => false)) await fillTab.click();
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
}

async function setStyle(page, label) {
  const style = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(style).toBeVisible({ timeout: 8_000 });
  await style.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  if (await popover.isVisible().catch(() => false)) {
    const option = popover.getByRole('option', { name: label, exact: true }).first();
    if (await option.count()) {
      await option.click({ force: true });
      return;
    }
    await popover.getByText(label, { exact: true }).first().click({ force: true });
    return;
  }
  const option = page.getByRole('option', { name: label, exact: true }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click({ force: true });
    return;
  }
  const menuitem = page.getByRole('menuitem', { name: label, exact: true }).first();
  if (await menuitem.isVisible().catch(() => false)) {
    await menuitem.click({ force: true });
    return;
  }
  await page.getByText(label, { exact: true }).first().click({ force: true });
}

async function setBump(page, raw) {
  const field = page.getByRole('textbox', { name: 'Cloud bump size', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function applyRotation(page, degrees) {
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
}

async function pageBox(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(box, 'page geometry').toBeTruthy();
  return box;
}

async function userShape(page, id) {
  return page.evaluate((want) => {
    const object = window.__phase35GetAnnotationById?.(want) || {};
    return {
      id: want,
      type: String(object.type || '').toLowerCase(),
      tool: String(object.tool || object.data?.tool || object.data?.type || '').toLowerCase(),
      angle: Number(object.angle) || 0,
      strokeWidth: Number(object.strokeWidth) || 0,
      dash: object.strokeDashArray || null,
      fill: object.fill || '',
      stroke: object.stroke || '',
      backgroundColor: object.backgroundColor || '',
      intensity: Number(object.data?.pdfCloudIntensity) || 0,
      pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || '',
      editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
    };
  }, id);
}

async function newUserId(page, beforeIds, match = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await page.evaluate((before) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((g) => g.getAttribute('data-anno-id'))
        .filter((id) => !before.includes(id))
        .map((id) => {
          const object = window.__phase35GetAnnotationById?.(id) || {};
          return {
            id,
            type: String(object.type || '').toLowerCase(),
            tool: String(object.tool || object.data?.tool || object.data?.type || '').toLowerCase(),
            imported: object.isPdfImported === true,
          };
        })
    ), beforeIds);
    const hit = rows.find((row) => !row.imported && match(row));
    created = hit?.id || null;
    return created;
  }).not.toBeNull();
  return created;
}

function isEllipseRow(row) {
  return /ellipse|circle/i.test(row.type) || /ellipse/i.test(row.tool);
}

function isCloudRow(row) {
  return /rect/i.test(row.type) || /rect|cloud/i.test(row.tool);
}

function isTextRow(row) {
  return /text|textbox|i-text/i.test(row.type) || /text/i.test(row.tool);
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
  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i += 1) {
    const annots = doc.getPage(i).node.lookup(PDFName.of('Annots'));
    if (!annots) continue;
    for (const ref of annots.asArray()) {
      const dict = lookup(ref);
      if (!dict || typeof dict.get !== 'function') continue;
      const subtype = String(dict.get(PDFName.of('Subtype'))?.decodeText?.() || dict.get(PDFName.of('Subtype')) || '').replace(/^\//, '');
      const ca = dict.get(PDFName.of('CA'));
      const border = dict.get(PDFName.of('Border'));
      const borderNums = border?.asArray?.()?.map((n) => (n?.asNumber ? n.asNumber() : Number(n))) || [];
      const bs = lookup(dict.get(PDFName.of('BS')));
      const bsW = bs?.get?.(PDFName.of('W'));
      const bsD = lookup(bs?.get?.(PDFName.of('D')));
      const dash = bsD?.asArray?.()?.map((n) => (n?.asNumber ? n.asNumber() : Number(n))) || [];
      const ap = dict.get(PDFName.of('AP'));
      const metaRaw = dict.get(PDFName.of('SurveyAppAnnotation'));
      const metaText = metaRaw?.decodeText?.() || '';
      let meta = null;
      try { meta = metaText ? JSON.parse(metaText) : null; } catch { meta = null; }
      let hasMatrix = false;
      let apCa = null;
      if (ap) {
        const apDict = lookup(ap);
        const n = apDict?.get ? lookup(apDict.get(PDFName.of('N'))) : null;
        const streamDict = n?.dict || n;
        const matrix = streamDict?.lookup?.(PDFName.of('Matrix')) || streamDict?.get?.(PDFName.of('Matrix'));
        hasMatrix = Boolean(matrix);
        const resources = streamDict?.lookup?.(PDFName.of('Resources')) || streamDict?.get?.(PDFName.of('Resources'));
        const resDict = lookup(resources);
        const gs = resDict?.lookup?.(PDFName.of('ExtGState')) || resDict?.get?.(PDFName.of('ExtGState'));
        const gsDict = lookup(gs);
        const gs0 = gsDict?.lookup?.(PDFName.of('GS0')) || gsDict?.get?.(PDFName.of('GS0'));
        const gs0Dict = lookup(gs0);
        const fillCa = gs0Dict?.get?.(PDFName.of('ca'));
        apCa = fillCa?.asNumber ? fillCa.asNumber() : (fillCa != null ? Number(fillCa) : null);
      }
      exported.push({
        subtype,
        ca: ca?.asNumber ? ca.asNumber() : (ca != null ? Number(ca) : null),
        borderW: borderNums[2] ?? null,
        bsW: bsW?.asNumber ? bsW.asNumber() : (bsW != null ? Number(bsW) : null),
        dash,
        apCa,
        hasMatrix,
        angle: Number(meta?.geometry?.angle ?? meta?.style?.angle ?? 0),
        fade: String(meta?.style?.fill || ''),
      });
    }
  }
  await unlink(dest).catch(() => {});
  return exported;
}

async function importedRows(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-pdf-annotation-id]')].map((group) => {
      const annoId = group.getAttribute('data-anno-id') || '';
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const object = window.__phase35GetAnnotationById?.(annoId) || window.__phase35GetAnnotationById?.(pdfId) || {};
      return {
        id: pdfId,
        annoId,
        type: String(object.type || '').toLowerCase(),
        pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || group.getAttribute('data-pdf-annotation-type') || '',
        strokeWidth: Number(object.strokeWidth) || 0,
        dash: object.strokeDashArray || null,
      };
    });
  });
}

async function pageToScreen(page, x, y) {
  const box = await pageBox(page);
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
  const W = parts[2] || 612;
  const H = parts[3] || 792;
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
}

async function selectImportedPoly(page, id) {
  await dismissChrome(page);
  await page.keyboard.press('v');
  await expect.poll(async () => {
    const geom = await page.evaluate((want) => {
      const group = document.querySelector(`[data-svg-annotation-layer="1"] [data-pdf-annotation-id="${want}"]`);
      if (!group) return null;
      const object = window.__phase35GetAnnotationById?.(want)
        || window.__phase35GetAnnotationById?.(group.getAttribute('data-anno-id') || '')
        || {};
      const shape = group.querySelector('[data-shape-kind="polygon"], [data-shape-kind="polyline"], [data-shape-kind="cloud-polygon"], polyline, polygon, path');
      const raw = shape?.getAttribute('points') || '';
      const transform = shape?.getAttribute('transform') || '';
      const match = /translate\(([-0-9.]+),\s*([-0-9.]+)\)/.exec(transform);
      const left = match ? Number(match[1]) : (Number(object.left) || 0);
      const top = match ? Number(match[2]) : (Number(object.top) || 0);
      let points = raw.trim().split(/\s+/).filter(Boolean).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
      if (!points.length && Array.isArray(object.points)) {
        points = object.points.map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }));
      }
      const world = points.map((point) => ({ x: point.x + left, y: point.y + top }));
      return world.length ? world : null;
    }, id);
    if (!geom) return 0;
    const a = geom[0];
    const b = geom[1] || a;
    const screen = await pageToScreen(page, (a.x + b.x) / 2, (a.y + b.y) / 2);
    await page.mouse.click(screen.x, screen.y);
    const widthOn = await page.getByRole('textbox', { name: 'Width', exact: true }).first().isVisible().catch(() => false);
    const styleOn = await page.getByRole('button', { name: 'Style', exact: true }).first().isVisible().catch(() => false);
    return (widthOn || styleOn) ? 1 : 0;
  }, { timeout: 12_000, message: `expected Width/Style on imported ${id}` }).toBe(1);
}

test('Ellipse rotate-Select + Cloud after Textbox + imported Poly Width intended + break', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { url: LINK_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  await waitForImports(page);

  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Shapes', 'Ellipse');
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await activateTool(page, 'Shapes', 'Ellipse');
  const box = await pageBox(page);
  let beforeIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.32, { steps: 10 });
  await page.mouse.up();
  const ellipseId = await newUserId(page, beforeIds, isEllipseRow);
  await dismissChrome(page);
  await page.keyboard.press('v');
  const ellipseEl = page.locator(
    `[data-shape-id="${ellipseId}"], [data-svg-annotation-layer="1"] [data-anno-id="${ellipseId}"]`,
  ).first();
  await expect(ellipseEl).toBeVisible({ timeout: 8_000 });
  const ellipseBox = await ellipseEl.boundingBox();
  await page.mouse.click(ellipseBox.x + ellipseBox.width / 2, ellipseBox.y + ellipseBox.height / 2);
  await expect(page.locator('[data-rotation-handle="mtr"]').first()).toBeVisible({ timeout: 8_000 });
  await applyRotation(page, 45);
  await expect.poll(async () => (await userShape(page, ellipseId)).angle).toBeCloseTo(45, 0);
  await setFillOpacity(page, 30);
  await page.keyboard.press('Escape');
  const afterSelect = await userShape(page, ellipseId);
  expect(afterSelect.angle, 'Ellipse Select Fill after Rotation must keep 45, not leftover-drop angle').toBeCloseTo(45, 0);
  expect(parseAlpha(afterSelect.fill), 'Ellipse Select Fill after Rotation must ride').toBeCloseTo(0.3, 1);
  const ellipseExport = await exportAnnots(page, 'ellipse-rotate-select-hunt');
  const rotated = ellipseExport.find((row) => (
    /Circle/i.test(row.subtype)
    && row.hasMatrix
    && Math.abs((Number(row.angle) || 0) - 45) < 1.5
  ));
  expect(rotated, 'export must keep Circle /AP /Matrix + angle 45 after rotate then Select Fill').toBeTruthy();
  expect(rotated.apCa, 'export /AP /ca after Ellipse rotate then Select').toBeCloseTo(0.3, 1);
  expect(parseAlpha(rotated.fade), 'export metadata fill after Ellipse rotate then Select').toBeCloseTo(0.3, 1);

  await openEditor(page, { url: LINK_PDF });
  await waitForImports(page);
  await dismissChrome(page);
  await activateTool(page, 'Text', 'Text');
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const textBox = await pageBox(page);
  beforeIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(textBox.x + textBox.width * 0.16, textBox.y + textBox.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(textBox.x + textBox.width * 0.40, textBox.y + textBox.height * 0.28, { steps: 10 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('Hi', { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  const textId = await newUserId(page, beforeIds, isTextRow);
  const text = await userShape(page, textId);
  expect(parseAlpha(text.backgroundColor || text.fill), 'sibling Textbox Fill 40').toBeCloseTo(0.4, 1);

  await activateTool(page, 'Shapes', 'Rectangle');
  await setStyle(page, 'Cloud');
  await setBump(page, 8);
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await dismissChrome(page);
  beforeIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(textBox.x + textBox.width * 0.50, textBox.y + textBox.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(textBox.x + textBox.width * 0.74, textBox.y + textBox.height * 0.34, { steps: 10 });
  await page.mouse.up();
  const cloudId = await newUserId(page, beforeIds, isCloudRow);
  const cloud = await userShape(page, cloudId);
  expect(cloud.intensity, 'Cloud first-create Bump 8 after Textbox sibling').toBe(8);
  expect(parseAlpha(cloud.fill), 'Cloud first-create Fill 40 after Textbox sibling').toBeCloseTo(0.4, 2);
  expect(cloud.dash, 'Cloud first-create must not leftover-stamp Textbox dash').toBeNull();

  await openEditor(page, { url: POLY_PDF });
  await assertNoErrorBoundary(page);
  await expect.poll(async () => (await importedRows(page)).length, { timeout: 45_000 }).toBeGreaterThan(0);
  const rows = await importedRows(page);
  const polyLine = rows.find((row) => /polyline/i.test(row.type) || /PolyLine/i.test(row.pdfType));
  const polygon = rows.find((row) => /polygon/i.test(row.type) || /Polygon/i.test(row.pdfType));
  const target = polyLine || polygon;
  expect(target, 'imported Line/Poly fixture must be live').toBeTruthy();
  await selectImportedPoly(page, target.id);
  const widthOn = await page.getByRole('textbox', { name: 'Width', exact: true }).first().isVisible().catch(() => false);
  const styleOn = await page.getByRole('button', { name: 'Style', exact: true }).first().isVisible().catch(() => false);
  expect(widthOn || styleOn, 'Select Width/Style on imported Line/Poly must ride').toBe(true);
  if (widthOn) await setWidth(page, 8);
  if (styleOn) await setStyle(page, 'Dashed');
  await page.keyboard.press('Escape');
  const afterPoly = await userShape(page, target.annoId || target.id);
  if (widthOn) expect(afterPoly.strokeWidth, 'imported Line/Poly Select Width 8 must ride').toBe(8);
  if (styleOn) expect(afterPoly.dash, 'imported Line/Poly Select Dashed must ride').toEqual([6, 4]);
  expect(afterPoly.editState, 'Select Width/dash must stamp edited so export replaces native leftover Border').toBe('edited');
  const polyExport = await exportAnnots(page, 'imported-poly-width-dash-hunt');
  const linePolys = polyExport.filter((row) => /PolyLine|Polygon|Line/i.test(row.subtype));
  const exportedPoly = linePolys.find((row) => {
    const w = Number(row.bsW ?? row.borderW);
    const dashed = Array.isArray(row.dash) && row.dash[0] === 6 && row.dash[1] === 4;
    return (widthOn && w === 8) || (styleOn && dashed);
  }) || linePolys.find((row) => /PolyLine/i.test(row.subtype) && target.pdfType === 'PolyLine')
    || linePolys.find((row) => /Polygon/i.test(row.subtype) && /Polygon/i.test(target.pdfType))
    || linePolys[0];
  expect(exportedPoly, `export must keep Line/Poly subtype after Select Width/dash (got ${JSON.stringify(linePolys)})`).toBeTruthy();
  if (widthOn) {
    const exportW = Number(exportedPoly.bsW ?? exportedPoly.borderW);
    expect(exportW, `export must keep Select Width 8, not leftover-drop (got ${JSON.stringify(linePolys)})`).toBe(8);
  }
  if (styleOn) {
    expect(exportedPoly.dash, `export must keep Select Dashed, not leftover-drop (got ${JSON.stringify(linePolys)})`).toEqual([6, 4]);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 ellipse-rotate-cloud-poly edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count(), 'must not invent 390 hex chrome').toBe(0);
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count(), 'must not invent Font family chrome').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});
