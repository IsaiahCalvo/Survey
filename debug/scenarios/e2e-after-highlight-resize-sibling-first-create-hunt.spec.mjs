import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

// AFTER_HIGHLIGHT_RESIZE_SIBLING_FIRST_CREATE_HUNT
// Genuine hunt of Highlight after live resize + Ellipse/Textbox/Ink
// first-create after sibling leftovers after tip c02066a0 / product
// 162aa1f5. Distinct from leftover-18 and the twelve exhausted classes.
// Do not invent Font family chrome, richTextEditor, Line /AP, callout
// Rotation, user-settable callout verticalAlign, leftover-18 hosts,
// or stamp file.id.

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

async function pageBox(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(box, 'page geometry').toBeTruthy();
  return box;
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
        fill: object.fill || '',
        width: Number(object.width) || 0,
        scaleX: Number(object.scaleX) || 1,
        visualW: box.width,
        editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
      };
    }).find((row) => row.id === want) || null;
  }, id);
}

async function userShape(page, id) {
  return page.evaluate((want) => {
    const object = window.__phase35GetAnnotationById?.(want) || {};
    return {
      id: want,
      type: String(object.type || '').toLowerCase(),
      strokeWidth: Number(object.strokeWidth) || 0,
      dash: object.strokeDashArray || null,
      fill: object.fill || '',
      backgroundColor: object.backgroundColor || '',
      sourceWidth: Number(object.sourceWidth || object.data?.sourceWidth) || 0,
    };
  }, id);
}

test('Highlight live resize + sibling first-create already aligned intended + break', async ({ page }) => {
  test.setTimeout(150_000);
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
  await expect(page.locator('[data-resize-handle]').first()).toBeVisible({ timeout: 8_000 });
  const moved = await page.evaluate(() => {
    const handle = document.querySelector('[data-resize-handle="br"]') || document.querySelector('[data-resize-handle]');
    if (!handle) return false;
    const rect = handle.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const fire = (type, clientX, clientY) => {
      handle.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX,
        clientY,
      }));
    };
    fire('pointerdown', x, y);
    fire('pointermove', x + 80, y + 40);
    fire('pointerup', x + 80, y + 40);
    return true;
  });
  expect(moved, 'Highlight br resize').toBe(true);
  let after = null;
  await expect.poll(async () => {
    after = await highlightRow(page);
    return after && after.visualW > before.visualW + 8;
  }, { message: 'Highlight must grow after live resize' }).toBe(true);
  expect(parseAlpha(after.fill), 'Highlight fill /CA after resize').toBeCloseTo(0.4, 1);
  expect(after.editState, 'Highlight resize stamps edited').toBe('edited');

  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  if (await color.isVisible().catch(() => false)) {
    if (!(await page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true }).isVisible().catch(() => false))) {
      await color.click();
      const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
      if (await fillTab.isVisible().catch(() => false)) await fillTab.click();
    }
    const opacity = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
    if (await opacity.isVisible().catch(() => false)) {
      expect(await opacity.inputValue(), 'Select Opacity after resize').toBe('40');
    }
  }

  await dismissChrome(page);
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first();
  await expect(exportBtn).toBeVisible();
  const dest = path.join(os.tmpdir(), `highlight-resize-hunt-${Date.now()}.pdf`);
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
      if (!/Highlight/i.test(subtype)) continue;
      const rect = dict.get(PDFName.of('Rect'));
      const quad = dict.get(PDFName.of('QuadPoints'));
      const ca = dict.get(PDFName.of('CA'));
      const rectNums = rect?.asArray?.()?.map((n) => (n?.asNumber ? n.asNumber() : Number(n))) || [];
      const quadNums = quad?.asArray?.()?.map((n) => (n?.asNumber ? n.asNumber() : Number(n))) || [];
      exported.push({
        rectW: rectNums.length >= 3 ? Math.abs(rectNums[2] - rectNums[0]) : 0,
        quadW: quadNums.length >= 3 ? Math.abs(quadNums[2] - quadNums[0]) : 0,
        ca: ca?.asNumber ? ca.asNumber() : Number(ca),
      });
    }
  }
  await unlink(dest).catch(() => {});
  const expectedW = after.width * Math.abs(after.scaleX);
  expect(exported.length, 'export writes resized Highlight').toBeGreaterThan(0);
  expect(exported[0].rectW, 'export /Rect uses scaled width, not leftover unscaled').toBeCloseTo(expectedW, 1);
  expect(exported[0].quadW, 'export /QuadPoints uses scaled width').toBeCloseTo(expectedW, 1);
  expect(exported[0].ca, 'export /CA after resize').toBeCloseTo(0.4, 1);

  await openEditor(page, { url: LINK_PDF });
  await dismissChrome(page);
  await activateTool(page, 'Shapes', 'Line');
  await setWidth(page, 5);
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.62, { steps: 8 });
  await page.mouse.up();

  await activateTool(page, 'Shapes', 'Ellipse');
  await setWidth(page, 8);
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const beforeIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.36, { steps: 10 });
  await page.mouse.up();
  let ellipseId = null;
  await expect.poll(async () => {
    const ids = await page.evaluate((before) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((g) => g.getAttribute('data-anno-id'))
        .filter((id) => !before.includes(id))
    ), beforeIds);
    ellipseId = ids[0] || null;
    return ellipseId;
  }).not.toBeNull();
  const ellipse = await userShape(page, ellipseId);
  expect(ellipse.strokeWidth, 'desktop Ellipse first-create Width 8 after sibling Line').toBe(8);
  expect(parseAlpha(ellipse.fill), 'desktop Ellipse first-create Fill 40 after sibling').toBeCloseTo(0.4, 2);
  expect(ellipse.dash, 'desktop Ellipse first-create Dashed after sibling').toEqual([6, 4]);

  await activateTool(page, 'Text', 'Text');
  await setWidth(page, 8);
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const beforeText = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.80, box.y + box.height * 0.32, { steps: 10 });
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
  const textbox = await userShape(page, textId);
  expect(textbox.strokeWidth, 'desktop Textbox first-create Width 8 after sibling').toBe(8);
  expect(parseAlpha(textbox.backgroundColor), 'desktop Textbox first-create Fill 40 after sibling').toBeCloseTo(0.4, 2);
  expect(textbox.dash, 'desktop Textbox first-create Dashed after sibling').toEqual([6, 4]);

  await activateTool(page, 'Draw', 'Pen');
  await setWidth(page, 16);
  await dismissChrome(page);
  const beforePen = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.20, box.y + box.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.78, { steps: 12 });
  await page.mouse.up();
  let penId = null;
  await expect.poll(async () => {
    const ids = await page.evaluate((before) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((g) => g.getAttribute('data-anno-id'))
        .filter((id) => !before.includes(id))
    ), beforePen);
    penId = ids[0] || null;
    return penId;
  }).not.toBeNull();
  const pen = await userShape(page, penId);
  expect(pen.sourceWidth, 'desktop Pen first-create Width 16 after sibling').toBe(16);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 highlight-resize / sibling-create edge: viewBox, file.id, no invent', async ({ page }) => {
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
