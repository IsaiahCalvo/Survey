import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Text first-create inherited Callout / Highlighter Width because Text
// prefs omitted strokeWidth. Distinct from leftover-18, textbox first-create
// Width persist (user-set 8), and Counter first-pin Fill color. Do not click
// Width / swatch / hex / Transparent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-textbox-first-create-width-after-sibling.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-textbox-first-create-width-after-sibling\.pdf/;
const BOX = { x0: 0.22, y0: 0.18, x1: 0.52, y1: 0.28 };
const TEXT_DEFAULT_WIDTH = 1;

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
      localStorage.removeItem('lastReviewTool');
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
      const group = document.querySelector(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id="${id}"]`);
      const frame = [...(group?.querySelectorAll('rect') || [])].find((rect) => (
        rect.getAttribute('fill') === 'none' && rect.getAttribute('stroke')
      ));
      return {
        id,
        text: String(object.text ?? data.text ?? ''),
        strokeWidth: Number(object.strokeWidth) || 0,
        visualWidth: Number(frame?.getAttribute('stroke-width')) || 0,
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

async function widthValue(page) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  return field.inputValue();
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

async function createFirstBoxAfterSiblings(page, text = 'Y') {
  const before = new Set((await textSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Text', 'Callout');
  expect(await widthValue(page), 'Callout default Width is 2').toBe('2');
  expect((await textSnapshot(page)).length, 'Callout visit must not invent a textbox').toBe(0);

  await activateTool(page, 'Text', 'Text');
  expect(await widthValue(page), 'Text must reset Width to 1 after Callout').toBe(String(TEXT_DEFAULT_WIDTH));

  await activateTool(page, 'Draw', 'Highlighter');
  expect(await widthValue(page), 'Highlighter default Width is 20').toBe('20');

  await activateTool(page, 'Text', 'Text');
  expect(await widthValue(page), 'Text must reset Width to 1 after Highlighter').toBe(String(TEXT_DEFAULT_WIDTH));
  expect((await textSnapshot(page)).length, 'sibling switches must not invent a textbox').toBe(0);

  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * BOX.x0, box.y + box.height * BOX.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * BOX.x1, box.y + box.height * BOX.y1, { steps: 10 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  if (text) await editor.pressSequentially(text, { delay: 6 });
  await commitEdit(page);
  let created = null;
  await expect.poll(async () => {
    const rows = (await textSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created && created.strokeWidth === TEXT_DEFAULT_WIDTH ? created : null;
  }, { message: 'first box must stamp Text Width 1 without touching Width' }).not.toBeNull();
  await dismissChrome(page);
  return created;
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

async function exportedFreeTextBorders(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const border = dict.get(PDFName.of('Border'));
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      text: dict.get(PDFName.of('Contents'))?.decodeText?.() || '',
      borderWidth: border && typeof border.asArray === 'function' && border.asArray().length >= 3
        ? (border.asArray()[2]?.asNumber ? border.asArray()[2].asNumber() : Number(border.asArray()[2]))
        : null,
    };
  });
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
    try {
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
    } catch { /* ignore */ }
  });
}

test('desktop first-create Width after sibling persist + export /Border intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createFirstBoxAfterSiblings(page, 'Y');
  expect(created.text).toBe('Y');
  expect(created.strokeWidth, 'first box must keep Text Width 1 after siblings').toBe(TEXT_DEFAULT_WIDTH);

  const dest = await exportAndSave(page, DEST_NAME);
  const borders = await exportedFreeTextBorders(dest);
  const exported = borders.find((row) => row.text === 'Y');
  expect(exported, 'exported FreeText must exist').toBeTruthy();
  expect(exported.borderWidth, 'exported FreeText must write /Border from Text default Width').toBe(TEXT_DEFAULT_WIDTH);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await textSnapshot(page, 1, { includeImported: true });
    return rows.find((row) => row.text === 'Y' && row.strokeWidth === TEXT_DEFAULT_WIDTH) || null;
  }, { timeout: 20_000, message: 'reimport must keep strokeWidth 1' }).not.toBeNull();

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

test('390 first-create Width after sibling edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await textSnapshot(page)).length).toBe(0);

  const mobileText = page.getByRole('button', { name: 'Text', exact: true }).first();
  if (await mobileText.isVisible().catch(() => false)) {
    const created = await createFirstBoxAfterSiblings(page, 'Y');
    expect(created.strokeWidth).toBe(TEXT_DEFAULT_WIDTH);
  } else {
    expect(await page.getByRole('button', { name: 'Text', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Text', exact: true }).count()).toBe(0);
});
