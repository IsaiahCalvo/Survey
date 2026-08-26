import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';

// Textbox underline survived on-screen + metadata + flatten, but
// faded-fill FreeText /AP painted glyphs only so Acrobat stayed
// undecorated. Distinct from leftover-18, textbox wrap /AP,
// textAlign /Q, verticalAlign /AP Tm y. Do not click swatch / hex /
// Transparent. Do not invent a richTextEditor. Do not invent
// callout Rotation or Line /AP. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-textbox-underline-export-ap.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-textbox-underline-export-ap\.pdf/;
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

async function textSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  const keepImported = includeImported;
  return page.evaluate(({ pageNum, includeImported: keepImportedFlag }) => {
    const layer = document.querySelector(`[data-svg-annotation-layer="${pageNum}"]`);
    if (!layer) return [];
    const ids = [...layer.querySelectorAll('[data-anno-id], [data-shape-id]')]
      .map((el) => el.getAttribute('data-anno-id') || el.getAttribute('data-shape-id'))
      .filter(Boolean);
    return [...new Set(ids)].map((id) => {
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
        underline: object.underline === true,
        linethrough: object.linethrough === true || object.strikethrough === true,
        fontFamily: String(object.fontFamily || data.fontFamily || ''),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row && (keepImportedFlag || row.imported !== true));
  }, { pageNum: pageNumber, includeImported: keepImported });
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

async function typeInOverlay(page, text) {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  if (text) await editor.pressSequentially(text, { delay: 6 });
  return editor;
}

async function createTallText(page, text = 'Hi') {
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
  await typeInOverlay(page, text);
  return before;
}

async function toggleUnderline(page) {
  const btn = page.getByRole('button', { name: 'Underline', exact: true }).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
}

async function finishUnderlineCommit(page, before) {
  await commitEdit(page);
  let created = null;
  await expect.poll(async () => {
    const rows = (await textSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created;
  }, { message: 'expected a new textbox' }).not.toBeNull();
  await expect.poll(async () => {
    const row = (await textSnapshot(page)).find((item) => item.id === created.id);
    return row?.underline === true;
  }).toBe(true);
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

function decorationAfterEt(apText) {
  const text = String(apText || '');
  const et = text.lastIndexOf('\nET\n');
  const after = et >= 0 ? text.slice(et) : text;
  return /\d[\d.]* \d[\d.]* m \d[\d.]* \d[\d.]* l S/.test(after);
}

async function exportedFreeTextUnderline(dest) {
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
      decorated: decorationAfterEt(apText),
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

test('desktop textbox underline export /AP persist + reimport intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const before = await createTallText(page, 'Hi');
  await toggleUnderline(page);
  const created = await finishUnderlineCommit(page, before);
  expect(created.text).toBe('Hi');
  expect(created.fontFamily).toBe('Helvetica');
  expect(created.underline).toBe(true);

  const liveFill = await applyFillAndOpacity(page, created.id, LIVE_OPACITY);
  expect(liveFill.hex, 'Fill spectrum must stamp a hex').toMatch(/^#[0-9A-F]{6}$/);
  expect(liveFill.opacity, 'Fill Opacity must stamp 0.4').toBeCloseTo(0.4, 2);
  const afterFill = (await textSnapshot(page)).find((row) => row.id === created.id);
  expect(afterFill?.underline, 'Fill must not clear underline').toBe(true);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedFreeTextUnderline(dest);
  const row = exported.find((item) => item.text === 'Hi' && item.ap);
  expect(row, `exported FreeText must write /AP (got ${JSON.stringify(exported.map((item) => ({ text: item.text, ap: item.ap, decorated: item.decorated })))})`).toBeTruthy();
  expect(row.decorated, 'FreeText /AP must stroke the live underline after ET').toBe(true);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await textSnapshot(page, 1, { includeImported: true });
    return rows.find((item) => (
      item.text === 'Hi'
      && item.underline === true
      && Math.abs(parseFill(item.fill).opacity - 0.4) < 0.02
    )) || null;
  }, { timeout: 20_000, message: 'reimport must keep underline + faded fill' }).not.toBeNull();

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
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 textbox underline export /AP edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await textSnapshot(page)).length).toBe(0);

  const before = await createTallText(page, 'Hi');
  const mobileUnderline = page.getByRole('button', { name: 'Underline', exact: true }).first();
  if (await mobileUnderline.isVisible().catch(() => false)) {
    if ((await mobileUnderline.getAttribute('aria-pressed')) !== 'true') await mobileUnderline.click();
    const created = await finishUnderlineCommit(page, before);
    expect(created.underline).toBe(true);
  } else {
    await commitEdit(page);
    expect(await page.getByRole('button', { name: 'Underline', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Underline', exact: true }).count()).toBe(0);
});
