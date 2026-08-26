import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';

// Textbox wrap survived on-screen + flatten, but faded-fill FreeText
// /AP painted the whole Contents as one Tj so Acrobat stayed a single
// leftover line. Distinct from leftover-18, textbox verticalAlign /AP
// Tm y, textbox textAlign /Q + /AP Tm x, textbox fillOpacity /ca, and
// faded-fill Style dash /AP. Do not click swatch / hex / Transparent.
// Do not invent a richTextEditor or callout verticalAlign. Do not
// stamp file.id. Print panel stays compile-hidden.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-textbox-wrap-export-ap.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-textbox-wrap-export-ap\.pdf/;
const TALL_BOX = { x0: 0.22, y0: 0.18, x1: 0.62, y1: 0.48 };
const LIVE_OPACITY = 40;

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

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
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

async function textSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const type = String(object.type || data.type || '').toLowerCase();
      const tool = String(data.tool || object.tool || data.type || '').toLowerCase();
      const callout = data.type === 'callout' || String(id).startsWith('callout-');
      if (callout || !(type === 'textbox' || type === 'text' || tool === 'text')) return null;
      return {
        id,
        text: String(object.text ?? data.text ?? ''),
        fill: object.backgroundColor || '',
        lines: String(object.text ?? data.text ?? '').split('\n'),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row && (keepImported || row.imported !== true));
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

async function commitEdit(page) {
  const pageGeom = await pageBox(page);
  await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(pageGeom.x + pageGeom.width - 12, pageGeom.y + pageGeom.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await dismissChrome(page);
}

async function typeWrappedText(page) {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('Hi', { delay: 6 });
  await editor.press('Enter');
  await editor.pressSequentially('Go', { delay: 6 });
  return editor;
}

async function createWrappedText(page) {
  const before = new Set((await textSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(350);
  await activateTool(page, 'Text', 'Text');
  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * TALL_BOX.x0, box.y + box.height * TALL_BOX.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * TALL_BOX.x1, box.y + box.height * TALL_BOX.y1, { steps: 10 });
  await page.mouse.up();
  await typeWrappedText(page);
  await commitEdit(page);
  let created = null;
  await expect.poll(async () => {
    const rows = (await textSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows.find((row) => row.lines.length >= 2 && row.lines[0] === 'Hi' && row.lines.at(-1) === 'Go')
      || rows[0]
      || null;
    return created;
  }, { message: 'expected a wrapped textbox' }).not.toBeNull();
  return (await textSnapshot(page)).find((item) => item.id === created.id);
}

async function selectTextbox(page, createdId) {
  await page.keyboard.press('v');
  const target = page.locator(
    `[data-shape-id="${createdId}"], [data-svg-annotation-layer="1"] [data-anno-id="${createdId}"]`,
  ).first();
  await expect(target).toBeVisible({ timeout: 8_000 });
  const box = await target.boundingBox();
  expect(box, `bbox for ${createdId}`).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    const pageGeom = await pageBox(page);
    await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
    await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
    await page.keyboard.press('v');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

async function applyFillAndOpacity(page, createdId, pct = LIVE_OPACITY) {
  await selectTextbox(page, createdId);
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) await color.click();
  await expect(presets).toBeVisible({ timeout: 8_000 });
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.isVisible().catch(() => false)) await fillTab.click();
  const spectrumMode = page.getByRole('button', { name: 'Color spectrum', exact: true });
  await expect(spectrumMode).toBeVisible({ timeout: 8_000 });
  await spectrumMode.click();
  const spectrum = page.getByRole('slider', { name: 'Saturation and brightness' });
  await expect(spectrum).toBeVisible({ timeout: 8_000 });
  await spectrum.focus();
  await spectrum.press('Home');
  await spectrum.press('ArrowDown');
  await expect.poll(async () => {
    const row = (await textSnapshot(page)).find((item) => item.id === createdId);
    return parseFill(row?.fill).hex;
  }, { message: 'spectrum must stamp a visible backgroundColor' }).toMatch(/^#[0-9A-F]{6}$/);

  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
  await page.keyboard.press('Escape');
  await expect(presets).toHaveCount(0, { timeout: 8_000 }).catch(() => {});
  await dismissChrome(page);
  let row = null;
  await expect.poll(async () => {
    row = (await textSnapshot(page)).find((item) => item.id === createdId) || null;
    const parsed = parseFill(row?.fill);
    return row && parsed.hex && Math.abs(parsed.opacity - pct / 100) < 0.02 ? parsed : null;
  }, { message: `Fill Opacity must stamp ${pct / 100}` }).not.toBeNull();
  return parseFill(row?.fill);
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

function readApStream(doc, dict) {
  try {
    const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
    if (!ap || typeof ap.get !== 'function') return '';
    const nRef = ap.get(PDFName.of('N'));
    const normal = lookupDict(doc, nRef);
    if (!normal) return '';
    return new TextDecoder('latin1').decode(decodePDFRawStream(normal).decode());
  } catch {
    return '';
  }
}

function appearanceTmYs(apText) {
  return [...String(apText || '').matchAll(/1\s+0\s+0\s+1\s+[\d.]+\s+([\d.]+)\s+Tm/g)]
    .map((match) => Number(match[1]));
}

function appearanceTjs(apText) {
  return [...String(apText || '').matchAll(/\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*Tj/g)]
    .map((match) => match[1].replace(/\\([\\()])/g, '$1'));
}

async function exportedFreeTextWrap(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const subtypeText = subtype?.decodeText ? subtype.decodeText() : String(subtype || '');
    const isFreeText = subtypeText === 'FreeText';
    const apText = isFreeText ? readApStream(doc, dict) : '';
    return {
      subtype: subtypeText,
      text: dict.get(PDFName.of('Contents'))?.decodeText?.() || '',
      ap: dict.get(PDFName.of('AP')) != null,
      apText,
      tmYs: appearanceTmYs(apText),
      tjs: appearanceTjs(apText),
    };
  }).filter((row) => row.subtype === 'FreeText');
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

test('desktop textbox wrap export /AP persist + reimport intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createWrappedText(page);
  expect(created.lines[0]).toBe('Hi');
  expect(created.lines.at(-1)).toBe('Go');
  expect(created.lines.length, 'live text must keep the Enter wrap').toBeGreaterThanOrEqual(2);

  const liveFill = await applyFillAndOpacity(page, created.id, LIVE_OPACITY);
  expect(liveFill.hex, 'Fill spectrum must stamp a hex').toMatch(/^#[0-9A-F]{6}$/);
  expect(liveFill.opacity, 'Fill Opacity must stamp 0.4').toBeCloseTo(0.4, 2);
  const afterFill = (await textSnapshot(page)).find((row) => row.id === created.id);
  expect(afterFill?.lines.length, 'Fill must not collapse wrap').toBeGreaterThanOrEqual(2);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedFreeTextWrap(dest);
  const row = exported.find((item) => item.ap && item.tjs.includes('Hi') && item.tjs.includes('Go'));
  expect(row, `exported FreeText must write wrapped /AP (got ${JSON.stringify(exported.map((item) => ({ text: item.text, ap: item.ap, tjs: item.tjs, tmYs: item.tmYs })))})`).toBeTruthy();
  expect(row.tjs, 'FreeText /AP must paint two lines, not one leftover Tj').toEqual(expect.arrayContaining(['Hi', 'Go']));
  expect(row.tjs.length, 'leftover single Tj must not keep both lines').toBeGreaterThanOrEqual(2);
  expect(row.tmYs.length, 'FreeText /AP must place each wrapped line').toBeGreaterThanOrEqual(2);
  expect(row.tmYs[0], 'second Tm y must sit below the first line').toBeGreaterThan(row.tmYs[1]);
  expect(String(row.apText), 'leftover single Tj must not keep the newline blob').not.toMatch(/\(Hi\\nGo\)\s*Tj|\(Hi\nGo\)\s*Tj/);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await textSnapshot(page, 1, { includeImported: true });
    return rows.find((item) => (
      item.lines[0] === 'Hi'
      && item.lines.at(-1) === 'Go'
      && item.lines.length >= 2
      && Math.abs(parseFill(item.fill).opacity - 0.4) < 0.02
    )) || null;
  }, { timeout: 20_000, message: 'reimport must keep wrap + faded fill' }).not.toBeNull();

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
  expect((await textSnapshot(page)).length, 'empty export must not invent a textbox').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Text alignment', exact: true }).count()).toBe(0);
});

test('390 textbox wrap export /AP edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await textSnapshot(page)).length).toBe(0);

  const created = await createWrappedText(page);
  expect(created.lines.length).toBeGreaterThanOrEqual(2);
  expect(created.lines[0]).toBe('Hi');
  expect(created.lines.at(-1)).toBe('Go');

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Text alignment', exact: true }).count()).toBe(0);
});
