import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

// AFTER_TEXTBOX_ROTATE_LINE_INK_HUNT
// Genuine hunt after tip c1f129ca (class 18). Unused preferred surfaces:
// Textbox rotate then Select/export persist (Square was class 16, Ellipse
// was class 18), imported Line Select Width/dash (not Poly — class 18),
// imported Ink Select Color/Width remapping. Distinct from leftover-18
// and the eighteen exhausted classes. Do not invent Font family chrome,
// stamp renderer, Note/Link create, create-poly tool, leftover-18 hosts,
// or stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const LINE_PDF = '/?testPdf=e2e-imported-line.pdf';
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

async function setStrokeOpacity(page, pct) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await color.click();
  }
  const borderTab = page.getByRole('button', { name: 'Border', exact: true }).first();
  const strokeTab = page.getByRole('button', { name: 'Stroke', exact: true }).first();
  if (await borderTab.isVisible().catch(() => false)) await borderTab.click();
  else if (await strokeTab.isVisible().catch(() => false)) await strokeTab.click();
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
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
      angle: Number(object.angle) || 0,
      strokeWidth: Number(object.strokeWidth) || 0,
      sourceWidth: Number(object.sourceWidth || object.data?.sourceWidth) || 0,
      dash: object.strokeDashArray || null,
      fill: object.fill || '',
      stroke: object.stroke || '',
      backgroundColor: object.backgroundColor || '',
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
  for (let i = 0; i < doc.getPageCount(); i += 1) {
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
        sourceWidth: Number(meta?.style?.sourceWidth ?? meta?.geometry?.sourceWidth ?? 0),
      });
    }
  }
  await unlink(dest).catch(() => {});
  return exported;
}

async function selectImportedByPdfId(page, pdfId) {
  await dismissChrome(page);
  await page.keyboard.press('v');
  const group = page.locator(
    `[data-svg-annotation-layer="1"] [data-pdf-annotation-id="${pdfId}"]`,
  ).first();
  await expect(group).toBeVisible({ timeout: 8_000 });
  const box = await group.boundingBox();
  expect(box, `imported ${pdfId} geometry`).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('Textbox rotate-Select + imported Line Width + Ink Select intended + break', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { url: LINK_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  await waitForImports(page);

  await dismissChrome(page);
  await activateTool(page, 'Text', 'Text');
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  const box = await pageBox(page);
  const beforeIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.28, { steps: 10 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('Hi', { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  const textId = await newUserId(page, beforeIds, isTextRow);
  await dismissChrome(page);
  await page.keyboard.press('v');
  const textEl = page.locator(
    `[data-shape-id="${textId}"], [data-svg-annotation-layer="1"] [data-anno-id="${textId}"]`,
  ).first();
  await expect(textEl).toBeVisible({ timeout: 8_000 });
  const textBox = await textEl.boundingBox();
  await page.mouse.click(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2);
  await expect(page.locator('[data-rotation-handle="mtr"]').first()).toBeVisible({ timeout: 8_000 });
  await applyRotation(page, 45);
  await expect.poll(async () => (await userShape(page, textId)).angle).toBeCloseTo(45, 0);
  await setFillOpacity(page, 30);
  await page.keyboard.press('Escape');
  const afterText = await userShape(page, textId);
  expect(afterText.angle, 'Textbox Select Fill after Rotation must keep 45, not leftover-drop angle').toBeCloseTo(45, 0);
  expect(parseAlpha(afterText.backgroundColor || afterText.fill), 'Textbox Select Fill after Rotation must ride').toBeCloseTo(0.3, 1);
  const textExport = await exportAnnots(page, 'textbox-rotate-select-hunt');
  const rotated = textExport.find((row) => (
    /FreeText/i.test(row.subtype)
    && row.hasMatrix
    && Math.abs((Number(row.angle) || 0) - 45) < 1.5
  ));
  expect(rotated, 'export must keep FreeText /AP /Matrix + angle 45 after rotate then Select Fill').toBeTruthy();
  expect(rotated.apCa, 'export /AP /ca after Textbox rotate then Select').toBeCloseTo(0.3, 1);

  await expect.poll(() => page.evaluate(() => typeof window.__fix19SelectAnnotation)).toBe('function');
  const selectedInk = await page.evaluate(() => window.__fix19SelectAnnotation?.('67R'));
  expect(selectedInk, 'select imported Ink 67R').toBeTruthy();
  await expect(page.getByRole('textbox', { name: 'Width', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await setWidth(page, 8);
  await setStrokeOpacity(page, 40);
  await page.keyboard.press('Escape');
  const afterInk = await page.evaluate(() => {
    const group = document.querySelector('[data-svg-annotation-layer="1"] [data-pdf-annotation-id="67R"]');
    const id = group?.getAttribute('data-anno-id') || '67R';
    const object = window.__phase35GetAnnotationById?.(id) || {};
    return {
      sourceWidth: Number(object.sourceWidth || object.data?.sourceWidth) || 0,
      fill: object.fill || '',
      editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
    };
  });
  expect(afterInk.sourceWidth, 'imported Ink Select Width 8 must ride').toBe(8);
  expect(parseAlpha(afterInk.fill), 'imported Ink Select Color Opacity 40 must ride').toBeCloseTo(0.4, 1);
  expect(afterInk.editState, 'Select Color/Width must stamp edited').toBe('edited');
  const inkExport = await exportAnnots(page, 'imported-ink-select-hunt');
  const inkOut = inkExport.find((row) => row.subtype === 'Ink' && Number(row.sourceWidth) === 8);
  expect(inkOut, 'export must keep Ink subtype after Select Color/Width').toBeTruthy();
  expect(inkOut.ca, 'export must keep Ink /CA 0.40, not leftover-remap').toBeCloseTo(0.4, 1);
  expect(inkExport.filter((row) => row.subtype === 'Ink').length, 'Select must not leftover-duplicate native Ink').toBe(1);

  await openEditor(page, { url: LINE_PDF });
  await assertNoErrorBoundary(page);
  await waitForImports(page);
  await selectImportedByPdfId(page, '5R');
  await expect.poll(async () => (
    await page.getByRole('textbox', { name: 'Width', exact: true }).first().isVisible().catch(() => false)
  ), { timeout: 8_000 }).toBe(true);
  await setWidth(page, 8);
  await setStyle(page, 'Dashed');
  await page.keyboard.press('Escape');
  const afterLine = await page.evaluate(() => {
    const group = document.querySelector('[data-svg-annotation-layer="1"] [data-pdf-annotation-id="5R"]');
    const id = group?.getAttribute('data-anno-id') || '5R';
    const object = window.__phase35GetAnnotationById?.(id) || {};
    return {
      strokeWidth: Number(object.strokeWidth) || 0,
      dash: object.strokeDashArray || null,
      editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
      pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || '',
    };
  });
  expect(afterLine.strokeWidth, 'imported Line Select Width 8 must ride').toBe(8);
  expect(afterLine.dash, 'imported Line Select Dashed must ride').toEqual([6, 4]);
  expect(afterLine.editState, 'Select Width/dash must stamp edited so export replaces native leftover Border').toBe('edited');
  const lineExport = await exportAnnots(page, 'imported-line-width-dash-hunt');
  const lineOuts = lineExport.filter((row) => row.subtype === 'Line');
  expect(lineOuts.length, 'Select must not leftover-duplicate native Line').toBe(1);
  expect(Number(lineOuts[0].bsW ?? lineOuts[0].borderW), 'export must keep Select Width 8, not leftover-drop').toBe(8);
  expect(lineOuts[0].dash, 'export must keep Select Dashed, not leftover-drop').toEqual([6, 4]);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 textbox-rotate-line-ink edge: viewBox, file.id, no invent', async ({ page }) => {
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
