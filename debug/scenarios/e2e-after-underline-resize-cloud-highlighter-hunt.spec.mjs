import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

// AFTER_UNDERLINE_STRIKE_SELECT_FILL_EXPORT_HUNT
// Unique leftover after tip cb83ce61 / product 162aa1f5: imported StrikeOut /
// Underline stay glow-only (no live resize), but Select Color Fill already
// stamped rgba fill + edited, and export leftover-omitted those subtypes so
// /CA dropped (Square fallthrough). Distinct from leftover-18 and the
// thirteen exhausted classes. Do not invent Font family chrome,
// richTextEditor, Line /AP, callout Rotation, user-settable callout
// verticalAlign, leftover-18 hosts, or stamp file.id.

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

async function setStrokeOpacity(page, pct) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await color.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
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

async function setBump(page, raw) {
  const field = page.getByRole('textbox', { name: 'Cloud bump size', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function pageBox(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(box, 'page geometry').toBeTruthy();
  return box;
}

async function markupRow(page, type, id) {
  return page.evaluate(({ wantType, wantId }) => {
    const groups = [...document.querySelectorAll(`[data-svg-annotation-layer="1"] [data-pdf-annotation-type="${wantType}"]`)];
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
        handles: [...document.querySelectorAll('[data-resize-handle]')].map((el) => el.getAttribute('data-resize-handle')),
        editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
        pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || '',
      };
    }).find((row) => row.id === wantId) || null;
  }, { wantType: type, wantId: id });
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
      angle: Number(object.angle) || 0,
      sourceWidth: Number(object.sourceWidth || object.data?.sourceWidth) || 0,
      intensity: Number(object.data?.pdfCloudIntensity) || 0,
    };
  }, id);
}

async function newUserId(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const ids = await page.evaluate((before) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((g) => g.getAttribute('data-anno-id'))
        .filter((id) => {
          if (!id || before.includes(id)) return false;
          const object = window.__phase35GetAnnotationById?.(id) || {};
          return object.isPdfImported !== true;
        })
    ), beforeIds);
    created = ids[0] || null;
    return created;
  }).not.toBeNull();
  return created;
}

test('StrikeOut Select Fill export /CA + Cloud after Ellipse + Highlighter after sibling intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { url: SE011 });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await expect.poll(
    async () => page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-type="Underline"]').count(),
    { timeout: 60_000 },
  ).toBeGreaterThan(0);

  await page.keyboard.press('v');
  const ulEl = page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-id="4640R"]').first();
  await expect(ulEl).toBeVisible({ timeout: 8_000 });
  const ulBox = await ulEl.boundingBox();
  await page.mouse.click(ulBox.x + ulBox.width / 2, ulBox.y + ulBox.height / 2);
  const ulBefore = await markupRow(page, 'Underline', '4640R');
  expect(ulBefore, 'imported Underline 4640R').toBeTruthy();
  expect(await page.locator('[data-resize-handle]').count(), 'Underline must stay glow-only (no live resize)').toBe(0);

  const strikeEl = page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-id="4638R"]').first();
  await expect(strikeEl).toBeVisible({ timeout: 8_000 });
  const stBox = await strikeEl.boundingBox();
  await page.mouse.click(stBox.x + stBox.width / 2, stBox.y + stBox.height / 2);
  const stBefore = await markupRow(page, 'StrikeOut', '4638R');
  expect(stBefore, 'imported StrikeOut 4638R').toBeTruthy();
  expect(await page.locator('[data-resize-handle]').count(), 'StrikeOut must stay glow-only (no live resize)').toBe(0);

  const colorOnMarkup = page.getByRole('button', { name: 'Color', exact: true }).first();
  const widthOnMarkup = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  const styleOnMarkup = page.getByRole('button', { name: 'Style', exact: true }).first();
  const markupChrome = {
    color: await colorOnMarkup.isVisible().catch(() => false),
    width: await widthOnMarkup.isVisible().catch(() => false),
    style: await styleOnMarkup.isVisible().catch(() => false),
  };
  test.info().annotations.push({ type: 'markup-chrome', description: JSON.stringify(markupChrome) });

  if (markupChrome.color) {
    await setFillOpacity(page, 40);
    await page.keyboard.press('Escape');
    const afterColor = await markupRow(page, 'StrikeOut', '4638R');
    expect(parseAlpha(afterColor.fill), 'Select Fill on StrikeOut must ride, not leftover-drop').toBeCloseTo(0.4, 1);
    expect(afterColor.editState, 'Select Fill stamps edited').toBe('edited');

    await dismissChrome(page);
    const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first();
    await expect(exportBtn).toBeVisible();
    const dest = path.join(os.tmpdir(), `underline-strike-color-hunt-${Date.now()}.pdf`);
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
        exported.push({
          subtype,
          ca: ca?.asNumber ? ca.asNumber() : Number(ca),
        });
      }
    }
    await unlink(dest).catch(() => {});
    const fadedStrike = exported.find((row) => (
      /StrikeOut/i.test(row.subtype) && Number.isFinite(row.ca) && Math.abs(row.ca - 0.4) < 0.05
    ));
    expect(fadedStrike, 'export must keep StrikeOut subtype + /CA after Select Fill').toBeTruthy();
    expect(exported.some((row) => (
      /Square/i.test(row.subtype) && Number.isFinite(row.ca) && Math.abs(row.ca - 0.4) < 0.05
    )), 'Select Fill must not leftover-export StrikeOut as Square').toBe(false);
  }

  await openEditor(page, { url: LINK_PDF });
  await dismissChrome(page);
  await activateTool(page, 'Shapes', 'Ellipse');
  await setWidth(page, 8);
  await expect(page.getByRole('textbox', { name: 'Width', exact: true }).first()).toHaveValue('8');
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const box = await pageBox(page);
  let beforeIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.32, { steps: 10 });
  await page.mouse.up();
  const ellipseId = await newUserId(page, beforeIds);
  const ellipse = await userShape(page, ellipseId);
  expect(ellipse.strokeWidth, 'sibling Ellipse Width 8').toBe(8);
  expect(parseAlpha(ellipse.fill), 'sibling Ellipse Fill 40').toBeCloseTo(0.4, 2);
  expect(ellipse.dash, 'sibling Ellipse Dashed').toEqual([6, 4]);

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
  await page.mouse.move(box.x + box.width * 0.50, box.y + box.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.74, box.y + box.height * 0.34, { steps: 10 });
  await page.mouse.up();
  const cloudId = await newUserId(page, beforeIds);
  const cloud = await userShape(page, cloudId);
  expect(cloud.intensity, 'Cloud first-create Bump 8 after Ellipse sibling').toBe(8);
  expect(parseAlpha(cloud.fill), 'Cloud first-create Fill 40 after Ellipse sibling').toBeCloseTo(0.4, 2);
  expect(cloud.dash, 'Cloud first-create must not leftover-stamp Ellipse dash').toBeNull();

  await activateTool(page, 'Draw', 'Highlighter');
  await setWidth(page, 4);
  await setStrokeOpacity(page, 30);
  await dismissChrome(page);
  beforeIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
  ));
  await page.mouse.move(box.x + box.width * 0.20, box.y + box.height * 0.70);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.78, { steps: 12 });
  await page.mouse.up();
  const hlId = await newUserId(page, beforeIds);
  const highlighter = await userShape(page, hlId);
  expect(highlighter.sourceWidth, 'Highlighter first-create Width 4 after sibling').toBe(4);
  expect(parseAlpha(highlighter.fill), 'Highlighter first-create Opacity 30 after sibling').toBeCloseTo(0.3, 1);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 underline-resize / cloud-highlighter edge: viewBox, file.id, no invent', async ({ page }) => {
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
