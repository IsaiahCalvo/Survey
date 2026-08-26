import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';

// AFTER_ARROW_HEAD_FLATTEN_INDEPENDENT_HUNT
// Independent hunt after Arrow flatten Arrowhead style (aa0b87ef).
// No unique LIVE leftover proved. Style Dotted already rides the same
// /AP writers as Dashed. Native Line has no /AP. Font chrome is
// edit-only. Do not invent a leftover. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-after-arrow-head-flatten-hunt.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-after-arrow-head-flatten-hunt\.pdf/;

function dashKey(value) {
  if (value == null) return 'solid';
  const arr = Array.isArray(value)
    ? value.map(Number)
    : String(value).split(/[,\s]+/).filter(Boolean).map(Number);
  if (!arr.length || arr.every((n) => !n)) return 'solid';
  if (arr[0] === 6 && arr[1] === 4) return 'dashed';
  if (arr[0] === 2 && arr[1] === 4) return 'dotted';
  return arr.join(',');
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

async function ellipseSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const group = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id="${id}"]`,
      );
      const shape = group?.querySelector('[data-shape-kind="ellipse"], ellipse');
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        strokeDashArray: object.strokeDashArray ?? data.strokeDashArray ?? null,
        visualDash: shape?.getAttribute('stroke-dasharray') || null,
        imported: object.isPdfImported === true,
      };
    }).filter((row) => {
      const kind = `${row.type} ${row.tool}`;
      if (!/ellipse|circle/.test(kind)) return false;
      return keepImported || row.imported !== true;
    });
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

async function pickStyle(page, optionName) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    const popover = page.locator('[data-annotation-dropdown-popover="true"]');
    await expect(popover).toBeVisible({ timeout: 5_000 });
    const option = popover.getByRole('option', { name: String(optionName), exact: true });
    if (await option.count()) {
      await option.click();
      return;
    }
    await popover.getByText(String(optionName), { exact: true }).click();
    return;
  }
  const mobile = page.getByRole('button', { name: /^Border style:/ }).first();
  await expect(mobile).toBeVisible({ timeout: 8_000 });
  await mobile.click();
  const listbox = page.getByRole('listbox', { name: 'Border style' });
  await expect(listbox).toBeVisible({ timeout: 5_000 });
  await listbox.getByRole('option', { name: String(optionName), exact: true }).click();
}

async function createDottedEllipse(page) {
  const before = new Set((await ellipseSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await activateTool(page, 'Shapes', 'Ellipse');
  expect((await ellipseSnapshot(page)).length, 'next-draw Style must run before any ellipse').toBe(0);
  await pickStyle(page, 'Dotted');
  expect((await ellipseSnapshot(page)).length, 'Style Dotted before first ellipse must not invent a shape').toBe(0);
  await activateTool(page, 'Shapes', 'Ellipse');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.48, { steps: 12 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await ellipseSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows.find((row) => dashKey(row.strokeDashArray) === 'dotted') || rows[0] || null;
    return created && dashKey(created.strokeDashArray) === 'dotted' ? created : null;
  }, { message: 'first ellipse must stamp Dotted [2,4] without touching Style again' }).not.toBeNull();
  expect(isEllipseRow(created)).toBe(true);
  expect(dashKey(created.visualDash), 'SVG stroke-dasharray').toBe('dotted');
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

async function exportedAnnots(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const subtypeText = subtype?.decodeText ? subtype.decodeText() : String(subtype || '');
    return {
      subtype: subtypeText,
      ap: dict.get(PDFName.of('AP')) != null,
      bs: dict.get(PDFName.of('BS')) != null,
      apText: readApStream(doc, dict),
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
  });
}

test('desktop hunt after Arrow flatten: Style Dotted already aligned + Font edit-only + no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count(), 'Font chrome is edit-only').toBe(0);
  expect(await page.locator('[data-rich-text-editor]').count()).toBe(0);

  const created = await createDottedEllipse(page);
  expect(dashKey(created.strokeDashArray)).toBe('dotted');

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedAnnots(dest);
  const circle = exported.find((row) => /Circle/i.test(row.subtype));
  expect(circle, `exported ellipse must write Circle (got ${JSON.stringify(exported)})`).toBeTruthy();
  expect(circle.ap, 'Circle /AP must exist').toBe(true);
  expect(circle.apText, 'Circle /AP must write [2 4] 0 d').toMatch(/\[2 4\] 0 d/);
  expect(circle.bs, 'do not invent Square/Circle /BS').toBe(false);
  expect(
    exported.filter((row) => /^Line$/i.test(row.subtype)).length,
    'this pass created no Line — do not invent Line /AP',
  ).toBe(0);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await ellipseSnapshot(page, 1, { includeImported: true });
    return rows.find((row) => dashKey(row.strokeDashArray) === 'dotted' || dashKey(row.visualDash) === 'dotted') || null;
  }, { timeout: 20_000, message: 'reimport must keep Dotted via /AP or metadata' }).not.toBeNull();

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
  expect((await ellipseSnapshot(page)).length, 'empty export must not invent an ellipse').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Invite', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Open file', exact: true }).count()).toBe(0);
});

test('390 hunt after Arrow flatten: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await ellipseSnapshot(page)).length).toBe(0);
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count()).toBe(0);

  const mobileEllipse = page.getByRole('button', { name: 'Ellipse', exact: true }).first();
  if (await mobileEllipse.isVisible().catch(() => false)) {
    const created = await createDottedEllipse(page);
    expect(dashKey(created.strokeDashArray)).toBe('dotted');
  } else {
    expect(await page.getByRole('button', { name: 'Ellipse', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Ellipse', exact: true }).count()).toBe(0);
});
