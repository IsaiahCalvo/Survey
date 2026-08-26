import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'path';
import { PDFDocument, PDFName } from 'pdf-lib';

// AFTER_CARET_ROTATE_COUNTER_HIGHLIGHT_HUNT
// Genuine hunt after tip c69d3f5e (class 16). bc-90120044 landed none.
// Unused preferred surfaces: Counter first-create after sibling (not
// lockRotation), imported Highlight Select Color (not live-resize 4636R),
// Textbox Select Color after sibling, Arrow first-create after Ellipse.
// Distinct from leftover-18 and the sixteen exhausted classes. Do not
// invent Font family chrome, stamp renderer, Note/Link create, create-poly
// tool, leftover-18 hosts, or stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SE011 = '/?testPdf=se011.pdf';
const HUB = '/?hubPreview=1';

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([+-]?\d*\.?\d+)\s*\)/i);
  if (rgba) return Number(rgba[1]);
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

function parseRgb(raw) {
  const text = String(raw || '');
  const hex = text.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
    };
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!rgb) return null;
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
}

function isCounterBadgeRed(raw) {
  const rgb = parseRgb(raw);
  if (!rgb) return false;
  return Math.abs(rgb.r - 239) < 8 && Math.abs(rgb.g - 68) < 8 && Math.abs(rgb.b - 68) < 8;
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
  const option = page.getByRole('option', { name: label, exact: true }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    return;
  }
  const menuitem = page.getByRole('menuitem', { name: label, exact: true }).first();
  if (await menuitem.isVisible().catch(() => false)) {
    await menuitem.click();
    return;
  }
  await page.getByText(label, { exact: true }).first().click();
}

async function setArrowhead(page, label) {
  const arrowhead = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
  await expect(arrowhead).toBeVisible({ timeout: 8_000 });
  await arrowhead.click();
  const option = page.getByRole('option', { name: label, exact: true }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    return;
  }
  const menuitem = page.getByRole('menuitem', { name: label, exact: true }).first();
  if (await menuitem.isVisible().catch(() => false)) {
    await menuitem.click();
    return;
  }
  await page.getByText(label, { exact: true }).first().click();
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
      strokeWidth: Number(object.strokeWidth) || 0,
      radius: Number(object.radius) || 0,
      dash: object.strokeDashArray || null,
      fill: object.fill || '',
      stroke: object.stroke || '',
      backgroundColor: object.backgroundColor || '',
      arrowhead: object.data?.arrowheadStyle || object.arrowheadStyle || '',
      lockRotation: object.lockRotation === true,
      editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
      pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || '',
    };
  }, id);
}

async function highlightRow(page, id = '4636R') {
  return page.evaluate((want) => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-pdf-annotation-type="Highlight"]')];
    return groups.map((group) => {
      const painted = group.querySelector('rect, path') || group;
      const annoId = group.getAttribute('data-anno-id') || '';
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const object = window.__phase35GetAnnotationById?.(annoId) || window.__phase35GetAnnotationById?.(pdfId) || {};
      const box = painted.getBoundingClientRect();
      return {
        id: pdfId || object.pdfAnnotationId || annoId,
        annoId,
        fill: object.fill || '',
        stroke: object.stroke || '',
        width: Number(object.width) || 0,
        visualW: box.width,
        editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
        pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || '',
      };
    }).find((row) => row.id === want) || null;
  }, id);
}

async function exportAnnots(page, destName) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first();
  await expect(exportBtn).toBeVisible();
  const dest = path.join(os.tmpdir(), destName);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click({ force: true }),
  ]);
  await download.saveAs(dest);
  const doc = await PDFDocument.load(await readFile(dest));
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const lookup = (value) => {
    if (!value) return null;
    if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
    return doc.context.lookup(value) || null;
  };
  const exported = [];
  if (annots) {
    for (const ref of annots.asArray()) {
      const dict = lookup(ref);
      if (!dict || typeof dict.get !== 'function') continue;
      const subtype = String(dict.get(PDFName.of('Subtype'))?.decodeText?.() || dict.get(PDFName.of('Subtype')) || '');
      const ca = dict.get(PDFName.of('CA'));
      const c = dict.get(PDFName.of('C'));
      const cNums = c?.asArray?.()?.map((n) => (n?.asNumber ? n.asNumber() : Number(n))) || [];
      exported.push({
        subtype: subtype.replace(/^\//, ''),
        ca: ca?.asNumber ? ca.asNumber() : Number(ca),
        c: cNums,
      });
    }
  }
  await unlink(dest).catch(() => {});
  return exported;
}

test('Counter after sibling + Highlight Select Color + Arrow after Ellipse intended + break', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { url: SE011 });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await expect.poll(
    async () => page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-type="Highlight"]').count(),
    { timeout: 60_000 },
  ).toBeGreaterThan(0);

  const before = await highlightRow(page);
  expect(before, 'imported Highlight 4636R').toBeTruthy();
  await page.keyboard.press('v');
  const hlEl = page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-id="4636R"]').first();
  await expect(hlEl).toBeVisible({ timeout: 8_000 });
  const hlBox = await hlEl.boundingBox();
  await page.mouse.click(hlBox.x + hlBox.width / 2, hlBox.y + hlBox.height / 2);
  const colorOn = await page.getByRole('button', { name: 'Color', exact: true }).first().isVisible().catch(() => false);
  expect(colorOn, 'Select Color on imported Highlight must ride').toBe(true);
  await setFillOpacity(page, 30);
  await page.keyboard.press('Escape');
  const afterColor = await highlightRow(page);
  expect(parseAlpha(afterColor.fill), 'Highlight Select Color Fill must ride, not leftover-drop').toBeCloseTo(0.3, 1);
  expect(afterColor.editState, 'Highlight Select Color stamps edited').toBe('edited');
  expect(afterColor.pdfType).toBe('Highlight');

  const exported = await exportAnnots(page, `highlight-select-color-hunt-${Date.now()}.pdf`);
  const fadedHighlight = exported.find((row) => (
    row.subtype === 'Highlight' && Number.isFinite(row.ca) && Math.abs(row.ca - 0.3) < 0.05
  ));
  expect(fadedHighlight, 'export must keep Highlight subtype + /CA after Select Color').toBeTruthy();
  expect(exported.some((row) => (
    row.subtype === 'Square' && Number.isFinite(row.ca) && Math.abs(row.ca - 0.3) < 0.05
  )), 'Select Color must not leftover-export Highlight as Square').toBe(false);

  await openEditor(page, { url: LINK_PDF });
  await dismissChrome(page);
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');

  await activateTool(page, 'Shapes', 'Line');
  await setWidth(page, 5);
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.62, { steps: 8 });
  await page.mouse.up();

  await activateTool(page, 'Shapes', 'Counter');
  await expect(page.getByRole('button', { name: 'Counter colors', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  const sizeField = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  if (await sizeField.isVisible().catch(() => false)) {
    expect(await sizeField.inputValue(), 'Counter Size after sibling Line must not leftover-inherit Width 5').not.toBe('5');
  }
  const beforePins = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  let pinId = null;
  await expect.poll(async () => {
    const ids = await page.evaluate((before) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((g) => g.getAttribute('data-anno-id'))
        .filter((id) => !before.includes(id))
    ), beforePins);
    pinId = ids[0] || null;
    return pinId;
  }, { message: 'Counter first-pin after sibling Line' }).not.toBeNull();
  const pin = await userShape(page, pinId);
  expect(pin.tool, 'first-pin is Counter').toMatch(/counter/i);
  expect(isCounterBadgeRed(pin.fill), `Counter first-pin Fill after sibling must stay badge red (got ${pin.fill})`).toBeTruthy();
  expect(parseAlpha(pin.fill), 'Counter first-pin Fill must stay opaque').toBeGreaterThan(0.9);
  expect(pin.radius || pin.strokeWidth, 'Counter first-pin Size must not leftover-inherit Line Width 5').not.toBe(5);
  expect(pin.lockRotation, 'must not invent Counter rotation leftover').toBe(true);

  await activateTool(page, 'Shapes', 'Ellipse');
  await setWidth(page, 8);
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const beforeEllipse = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.32, { steps: 10 });
  await page.mouse.up();
  let ellipseId = null;
  await expect.poll(async () => {
    const ids = await page.evaluate((before) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((g) => g.getAttribute('data-anno-id'))
        .filter((id) => !before.includes(id))
    ), beforeEllipse);
    ellipseId = ids[0] || null;
    return ellipseId;
  }).not.toBeNull();
  const ellipse = await userShape(page, ellipseId);
  expect(ellipse.strokeWidth, 'sibling Ellipse Width 8').toBe(8);

  await activateTool(page, 'Shapes', 'Arrow');
  await setWidth(page, 6);
  await setStyle(page, 'Dotted');
  await setArrowhead(page, 'Open circle');
  await dismissChrome(page);
  const beforeArrow = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.74, box.y + box.height * 0.62, { steps: 8 });
  await page.mouse.up();
  let arrowId = null;
  await expect.poll(async () => {
    const ids = await page.evaluate((before) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((g) => g.getAttribute('data-anno-id'))
        .filter((id) => !before.includes(id))
    ), beforeArrow);
    arrowId = ids[0] || null;
    return arrowId;
  }, { message: 'Arrow first-create after Ellipse' }).not.toBeNull();
  const arrow = await userShape(page, arrowId);
  expect(arrow.strokeWidth, 'Arrow first-create Width 6 after Ellipse').toBe(6);
  expect(String(arrow.arrowhead || ''), 'Arrow first-create Open circle after Ellipse').toMatch(/openCircle/i);
  expect(arrow.dash, 'Arrow first-create Dotted after Ellipse').toEqual([2, 4]);

  await activateTool(page, 'Text', 'Text');
  await dismissChrome(page);
  const beforeText = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.80, box.y + box.height * 0.30, { steps: 10 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('Hi', { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  let textId = null;
  await expect.poll(async () => {
    const ids = await page.evaluate((before) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((g) => g.getAttribute('data-anno-id'))
        .filter((id) => !before.includes(id))
    ), beforeText);
    textId = ids[0] || null;
    return textId;
  }).not.toBeNull();
  await page.keyboard.press('v');
  const textEl = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${textId}"]`).first();
  const textBox = await textEl.boundingBox();
  await page.mouse.click(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2);
  const textColorOn = await page.getByRole('button', { name: 'Color', exact: true }).first().isVisible().catch(() => false);
  expect(textColorOn, 'Select Color on Textbox must ride').toBe(true);
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  const textAfter = await userShape(page, textId);
  expect(parseAlpha(textAfter.backgroundColor || textAfter.fill), 'Textbox Select Color Fill after sibling must ride').toBeCloseTo(0.4, 1);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 counter-highlight edge: viewBox, file.id, no invent', async ({ page }) => {
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
