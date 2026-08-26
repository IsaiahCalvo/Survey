import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Counter Number color opacity survived on-screen as rgba `numberColor`,
// but export Circle /AP painted the label hex-only after the Fill /ca
// reset. Distinct from leftover-18, Counter Fill Circle /ca, and
// Counter first-pin fillOpacity. Do not click swatch / hex / Transparent.
// Do not stamp file.id. Do not open Counter caret.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-counter-number-color-opacity-export.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-counter-number-color-opacity-export\.pdf/;
const LIVE_OPACITY = 40;

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

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
  if (rgba) return rgba[1] != null ? Number(rgba[1]) : 1;
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

async function counterSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
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
      const numberEl = group?.querySelector('text');
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.type || data.tool || object.tool || '').toLowerCase(),
        fill: object.fill ?? data.fill ?? data.color ?? null,
        numberColor: data.numberColor || numberEl?.getAttribute('fill') || null,
        visualNumber: numberEl?.getAttribute('fill') || '',
        imported: object.isPdfImported === true,
      };
    }).filter((row) => {
      const isCounter = row.tool === 'counter' || row.type === 'counter';
      if (!isCounter) return false;
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

async function applyCounterNumberOpacity(page, pct = LIVE_OPACITY) {
  const color = page.getByRole('button', { name: 'Counter colors', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) await color.click();
  await expect(presets).toBeVisible({ timeout: 8_000 });
  const numberTab = page.getByRole('button', { name: 'Number', exact: true }).first();
  await expect(numberTab).toBeVisible({ timeout: 8_000 });
  await numberTab.click();
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
  await page.keyboard.press('Escape');
  await expect(presets).toHaveCount(0, { timeout: 8_000 }).catch(() => {});
  await dismissChrome(page);
}

async function createCounter(page) {
  const before = new Set((await counterSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Shapes', 'Counter');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await counterSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created;
  }, { message: 'expected a new counter pin' }).not.toBeNull();
  await applyCounterNumberOpacity(page, LIVE_OPACITY);
  await expect.poll(async () => {
    const rows = await counterSnapshot(page);
    const row = rows.find((item) => item.id === created.id) || rows[0] || null;
    created = row;
    return row && Math.abs(parseAlpha(row.numberColor || row.visualNumber) - 0.4) < 0.02 ? row : null;
  }, { message: 'Counter colors Number Opacity must stamp numberColor 0.4' }).not.toBeNull();
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

function annotAppearanceGs(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return {};
  const nRef = ap.get(PDFName.of('N'));
  const stream = nRef?.dict ? nRef : doc.context.lookup(nRef);
  if (!stream) return {};
  const streamDict = stream.dict || stream;
  const resources = lookupDict(doc, streamDict.lookup?.(PDFName.of('Resources')) || streamDict.get?.(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  const named = {};
  if (!ext || typeof ext.entries !== 'function') return { named };
  for (const [name, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const key = (name?.decodeText ? name.decodeText() : String(name || '')).replace(/^\/+/, '');
    const ca = gs.get?.(PDFName.of('ca'));
    const CA = gs.get?.(PDFName.of('CA'));
    named[key] = {
      ca: ca != null ? (ca.asNumber ? ca.asNumber() : Number(ca)) : undefined,
      CA: CA != null ? (CA.asNumber ? CA.asNumber() : Number(CA)) : undefined,
    };
  }
  return { named };
}

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

async function exportedCircleOpacity(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const subj = dict.get(PDFName.of('Subj'));
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      subject: subj?.decodeText ? subj.decodeText() : String(subj || ''),
      ca: dictNumber(dict, 'CA'),
      gs: annotAppearanceGs(doc, dict),
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

test('desktop counter number color opacity export GS1 /ca intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createCounter(page);
  expect(created.tool === 'counter' || created.type === 'counter').toBeTruthy();
  expect(parseAlpha(created.numberColor || created.visualNumber), 'Number Opacity must stamp numberColor 0.4').toBeCloseTo(0.4, 2);

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedCircleOpacity(dest);
  const circles = exported.filter((row) => row.subtype === 'Circle' || /counter/i.test(row.subject));
  const circle = circles.find((row) => Math.abs(Number(row.gs.named.GS1?.ca) - 0.4) < 0.02);
  expect(circle, `exported live counter must write Circle AP GS1 /ca 0.4 (got ${JSON.stringify(circles)})`).toBeTruthy();
  expect(circle.ca, 'faded Number must not share dict /CA with the pin').toBeUndefined();
  expect(circle.gs.named.GS1.ca, 'Circle AP GS1 /ca must be live Number opacity').toBeCloseTo(0.4, 2);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await counterSnapshot(page, 1, { includeImported: true });
    return rows.find((row) => Math.abs(parseAlpha(row.numberColor || row.visualNumber) - 0.4) < 0.02) || null;
  }, { timeout: 20_000, message: 'reimport must keep numberColor rgba ~0.4' }).not.toBeNull();

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
  expect((await counterSnapshot(page)).length, 'empty export must not invent a counter').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Counter colors', exact: true }).count()).toBe(0);
});

test('390 counter number color opacity export edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await counterSnapshot(page)).length).toBe(0);

  const mobileCounter = page.getByRole('button', { name: 'Counter', exact: true }).first();
  if (await mobileCounter.isVisible().catch(() => false)) {
    const created = await createCounter(page);
    expect(parseAlpha(created.numberColor || created.visualNumber)).toBeCloseTo(0.4, 2);
  } else {
    expect(await page.getByRole('button', { name: 'Counter', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Counter colors', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Counter', exact: true }).count()).toBe(0);
});
