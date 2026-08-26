import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

// AFTER_SQUIGGLY_CARET_ROTATE_INKDASH_HUNT
// Genuine hunt after tip 410a31df: leftover-omitted EDITED_IMPORT
// writers (Caret / Stamp / Redact / Text note), Polygon first-create,
// Square rotate then Select persist, Ink dash+opacity first-create.
// Distinct from leftover-18, Squiggly Select Color /CA (410a31df),
// StrikeOut/Underline Select Fill /CA (7962b2b2), and the fifteen
// exhausted classes. Do not invent Font family chrome, stamp renderer,
// Note/Link create, create-poly tool, leftover-18 hosts, or stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const NOTE_PDF = '/?testPdf=e2e-sticky-note.pdf';
const MIXED = '/?testPdf=kal412-mixed-import-e2e.pdf';
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
  await page.keyboard.press('Escape');
}

async function userShapes(page) {
  return page.evaluate(() => {
    const ids = [...new Set(
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || '').toLowerCase(),
        fill: object.fill || '',
        stroke: object.stroke || '',
        angle: Number(object.angle) || 0,
        dash: object.strokeDashArray || null,
        sourceWidth: Number(object.sourceWidth || object.data?.sourceWidth) || 0,
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true);
  });
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
  if (!(await style.isVisible().catch(() => false))) return false;
  await style.click();
  const option = page.getByRole('option', { name: label, exact: true }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    return true;
  }
  const menuitem = page.getByRole('menuitem', { name: label, exact: true }).first();
  if (await menuitem.isVisible().catch(() => false)) {
    await menuitem.click();
    return true;
  }
  await page.getByText(label, { exact: true }).first().click();
  return true;
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

async function inventory(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-pdf-annotation-id], [data-svg-annotation-layer="1"] [data-pdf-annotation-type]')];
    const rows = groups.map((group) => {
      const annoId = group.getAttribute('data-anno-id') || '';
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const object = window.__phase35GetAnnotationById?.(annoId) || window.__phase35GetAnnotationById?.(pdfId) || {};
      return {
        id: pdfId || object.pdfAnnotationId || annoId,
        pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || group.getAttribute('data-pdf-annotation-type') || '',
        fabricType: String(object.type || '').toLowerCase(),
        note: object.data?.type === 'note',
        fill: object.fill || '',
        stroke: object.stroke || '',
        angle: Number(object.angle) || 0,
        dash: object.strokeDashArray || null,
        editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
      };
    });
    const tools = [...document.querySelectorAll('#chrome-sub-toolbar-host button, [role="button"]')]
      .map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim())
      .filter(Boolean);
    return {
      rows,
      caret: rows.filter((row) => /caret/i.test(row.pdfType)).length,
      stamp: rows.filter((row) => /stamp/i.test(row.pdfType)).length,
      redact: rows.filter((row) => /redact/i.test(row.pdfType)).length,
      text: rows.filter((row) => row.pdfType === 'Text' || row.note).length,
      polygonTool: tools.some((name) => /^polygon$/i.test(name)),
      noteTool: tools.some((name) => /^note$/i.test(name)),
    };
  });
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
      const subtype = String(dict.get(PDFName.of('Subtype'))?.decodeText?.() || dict.get(PDFName.of('Subtype')) || '');
      const ca = dict.get(PDFName.of('CA'));
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
        subtype: subtype.replace(/^\//, ''),
        ca: ca?.asNumber ? ca.asNumber() : (ca != null ? Number(ca) : null),
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

async function userShape(page, id) {
  return page.evaluate((want) => {
    const object = window.__phase35GetAnnotationById?.(want) || {};
    return {
      id: want,
      type: String(object.type || '').toLowerCase(),
      angle: Number(object.angle) || 0,
      fill: object.fill || '',
      stroke: object.stroke || '',
      dash: object.strokeDashArray || null,
      sourceWidth: Number(object.sourceWidth || object.data?.sourceWidth) || 0,
      pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || '',
      editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
    };
  }, id);
}

test('Caret/Stamp/Redact/Text-note/rotate-Select/Ink-dash hunt intended + break', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { url: NOTE_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  const noteInv = await inventory(page);
  expect(noteInv.noteTool, 'must not invent Note create').toBe(false);
  expect(noteInv.text, 'imported Text note 6R must be live').toBeGreaterThan(0);

  await page.keyboard.press('v');
  const noteEl = page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-id="6R"], [data-svg-annotation-layer="1"] [data-pdf-annotation-type="Text"]').first();
  await expect(noteEl).toBeVisible({ timeout: 8_000 });
  const noteBox = await noteEl.boundingBox();
  await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
  const colorOn = await page.getByRole('button', { name: 'Color', exact: true }).first().isVisible().catch(() => false);
  expect(colorOn, 'Select Color on imported Text note must ride').toBe(true);
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  const afterNote = await page.evaluate(() => {
    const group = document.querySelector('[data-svg-annotation-layer="1"] [data-pdf-annotation-id="6R"]')
      || document.querySelector('[data-svg-annotation-layer="1"] [data-pdf-annotation-type="Text"]');
    const annoId = group?.getAttribute('data-anno-id') || '6R';
    const object = window.__phase35GetAnnotationById?.(annoId) || {};
    return {
      fill: object.fill || '',
      editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
      pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || '',
    };
  });
  expect(parseAlpha(afterNote.fill), 'Select Fill on Text note must ride, not leftover-drop').toBeCloseTo(0.4, 1);
  expect(afterNote.editState, 'Select Fill stamps edited').toBe('edited');
  const noteExport = await exportAnnots(page, 'note-color-hunt');
  const fadedText = noteExport.find((row) => (
    row.subtype === 'Text' && Number.isFinite(row.ca) && Math.abs(row.ca - 0.4) < 0.05
  ));
  expect(fadedText, 'export must keep Text subtype + /CA after Select Fill').toBeTruthy();
  expect(noteExport.some((row) => (
    row.subtype === 'Square' && Number.isFinite(row.ca) && Math.abs(row.ca - 0.4) < 0.05
  )), 'Select Fill must not leftover-export Text note as Square').toBe(false);

  await openEditor(page, { url: MIXED });
  await assertNoErrorBoundary(page);
  const mixed = await inventory(page);
  expect(mixed.stamp, 'Stamp stays unsupported (do not invent stamp renderer)').toBe(0);
  expect(mixed.redact, 'Redact stays unsupported (do not invent redact writer)').toBe(0);
  expect(mixed.caret, 'no live Caret fixture').toBe(0);

  await openEditor(page, { url: LINK_PDF });
  await assertNoErrorBoundary(page);
  const linkInv = await inventory(page);
  expect(linkInv.caret, 'clickable-link has no Caret').toBe(0);
  expect(linkInv.polygonTool, 'must not invent create-poly tool').toBe(false);

  await dismissChrome(page);
  const beforeRect = new Set((await userShapes(page)).map((row) => row.id));
  await page.waitForTimeout(250);
  await activateTool(page, 'Shapes', 'Rectangle');
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.32, { steps: 10 });
  await page.mouse.up();
  let rectId = null;
  await expect.poll(async () => {
    const created = (await userShapes(page)).filter((row) => !beforeRect.has(row.id) && /rect/.test(row.type));
    rectId = created[0]?.id || null;
    return rectId;
  }, { message: 'expected a new user rectangle' }).not.toBeNull();
  await dismissChrome(page);
  await page.keyboard.press('v');
  const rectEl = page.locator(
    `[data-shape-id="${rectId}"], [data-svg-annotation-layer="1"] [data-anno-id="${rectId}"]`,
  ).first();
  await expect(rectEl).toBeVisible({ timeout: 8_000 });
  const rectBox = await rectEl.boundingBox();
  await page.mouse.click(rectBox.x + rectBox.width / 2, rectBox.y + rectBox.height / 2);
  await expect(page.locator('[data-resize-handle]').first()).toBeVisible({ timeout: 8_000 });
  await applyRotation(page, 45);
  await expect.poll(async () => (await userShape(page, rectId)).angle).toBeCloseTo(45, 0);
  await setFillOpacity(page, 30);
  await page.keyboard.press('Escape');
  const afterSelect = await userShape(page, rectId);
  expect(afterSelect.angle, 'Select Fill after Rotation must keep 45, not leftover-drop angle').toBeCloseTo(45, 0);
  expect(parseAlpha(afterSelect.fill), 'Select Fill after Rotation must ride').toBeCloseTo(0.3, 1);
  const squareExport = await exportAnnots(page, 'square-rotate-select-hunt');
  const rotated = squareExport.find((row) => (
    row.subtype === 'Square'
    && row.hasMatrix
    && Math.abs((Number(row.angle) || 0) - 45) < 1.5
  ));
  expect(rotated, 'export must keep Square /AP /Matrix + angle 45 after rotate then Select Fill').toBeTruthy();
  expect(rotated.apCa, 'export /AP /ca after rotate then Select').toBeCloseTo(0.3, 1);
  expect(parseAlpha(rotated.fade), 'export metadata fill after rotate then Select').toBeCloseTo(0.3, 1);

  await activateTool(page, 'Shapes', 'Line');
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.62, { steps: 8 });
  await page.mouse.up();

  await dismissChrome(page);
  await activateTool(page, 'Draw', 'Pen');
  const penStyle = await page.getByRole('button', { name: 'Style', exact: true }).first().isVisible().catch(() => false);
  expect(penStyle, 'Pen has no Style (do not invent Ink dash chrome)').toBe(false);
  const penColor = await page.getByRole('button', { name: 'Color', exact: true }).first().isVisible().catch(() => false);
  expect(penColor, 'Pen Color Opacity already rides first-create (no leftover dash control)').toBe(true);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 caret/rotate/inkdash edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count(), 'must not invent 390 hex chrome').toBe(0);
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count(), 'must not invent Font family chrome').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});
