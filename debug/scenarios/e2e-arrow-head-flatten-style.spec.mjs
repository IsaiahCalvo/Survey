import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Live Arrowhead already stamped data.arrowheadStyle and export /LE, but
// print flatten used leftover drawArrowHead (two-line V) for every Arrow.
// Distinct from leftover-18, Arrow flatten opacity, and Arrowhead after
// sibling. Do not invent Line /AP. Do not stamp file.id. Print panel stays
// compile-hidden — flatten style is Node-proved.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-arrow-head-flatten-style.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-arrow-head-flatten-style\.pdf/;

function parseSurveyHead(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.style?.arrowheadStyle
      || parsed?.flags?.arrowheadStyle
      || parsed?.data?.arrowheadStyle
      || null;
  } catch {
    return null;
  }
}

function visualArrowheadKind(row) {
  if (row.visualCircle) return 'openCircle';
  if (row.visualPolyline) return 'vShape';
  if (row.visualPolygon && row.visualPolygonFill === 'none') return 'openTriangle';
  if (row.visualPolygon) return 'solidTriangle';
  if (row.visualTick) return 'horizontalLine';
  return 'none';
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

async function applyArrowhead(page, label) {
  const field = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
  if (!(await field.isVisible().catch(() => false))) return false;
  await field.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: 'Arrowhead' })).toBeVisible({ timeout: 8_000 });
  await popover.getByRole('option', { name: label, exact: true }).click();
  await expect(popover).toHaveCount(0, { timeout: 8_000 });
  await dismissChrome(page);
  return true;
}

async function userSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const annoIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return annoIds.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const type = String(object.type || data.type || '').toLowerCase();
      const tool = String(data.tool || object.tool || data.type || '').toLowerCase();
      if (object.isPdfImported === true && !keepImported) return null;
      const group = document.querySelector(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id="${id}"]`);
      const paint = (el) => el
        && el.getAttribute('stroke') !== '#4a90e2'
        && !el.hasAttribute('data-handle');
      const polygon = [...(group?.querySelectorAll('polygon') || [])].find(paint);
      const circle = [...(group?.querySelectorAll('circle') || [])]
        .find((el) => paint(el) && !el.hasAttribute('data-handle'));
      const polyline = [...(group?.querySelectorAll('polyline') || [])].find(paint);
      const extraLine = [...(group?.querySelectorAll('line') || [])]
        .find((el) => paint(el) && !el.hasAttribute('data-handle'));
      return {
        id,
        type,
        tool,
        arrowheadStyle: data.arrowheadStyle || object.arrowheadStyle || null,
        visualPolygon: !!polygon,
        visualPolygonFill: polygon?.getAttribute('fill') || null,
        visualCircle: !!circle,
        visualPolyline: !!polyline,
        visualTick: !!extraLine,
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row && (keepImported || row.imported !== true));
  }, { pageNum: pageNumber, includeImported });
}

async function createOpenCircleArrow(page) {
  const before = new Set((await userSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Shapes', 'Arrow');
  expect(await applyArrowhead(page, 'Open circle'), 'Arrowhead must be reachable').toBeTruthy();
  await activateTool(page, 'Shapes', 'Arrow');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.42, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await userSnapshot(page)).filter((row) => !before.has(row.id) && row.tool === 'arrow');
    created = rows[0] || null;
    return created && (created.arrowheadStyle || 'solidTriangle') === 'openCircle'
      ? created
      : null;
  }, { message: 'first Arrow after Open circle must stamp openCircle' }).not.toBeNull();
  expect(visualArrowheadKind(created), 'live SVG is Open circle').toBe('openCircle');
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

async function exportedHeads(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const survey = dict.get(PDFName.of('SurveyAppAnnotation'));
    const le = dict.get(PDFName.of('LE'));
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      metadataHead: parseSurveyHead(survey?.decodeText ? survey.decodeText() : null),
      endings: le ? le.asArray().map((name) => (name.decodeText ? name.decodeText() : String(name))) : null,
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

test('desktop arrowhead flatten style intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createOpenCircleArrow(page);
  expect(created.arrowheadStyle).toBe('openCircle');
  expect(visualArrowheadKind(created)).toBe('openCircle');

  const dest = await exportAndSave(page, DEST_NAME);
  const exported = await exportedHeads(dest);
  const line = exported.find((row) => row.subtype === 'Line');
  expect(line, `export must write a Line (got ${JSON.stringify(exported)})`).toBeTruthy();
  expect(
    line.endings?.some((name) => String(name).includes('Circle')),
    `export /LE must be Circle, not leftover ClosedArrow (got ${JSON.stringify(line.endings)})`,
  ).toBeTruthy();
  expect(line.metadataHead === 'openCircle' || line.endings?.some((name) => String(name).includes('Circle'))).toBeTruthy();

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await userSnapshot(page, 1, { includeImported: true });
    return rows.find((row) => (row.arrowheadStyle || visualArrowheadKind(row)) === 'openCircle') || null;
  }, { timeout: 20_000, message: 'reimport must keep Open circle' }).not.toBeNull();

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
  expect((await userSnapshot(page)).length, 'empty export must not invent an arrow').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 arrowhead flatten style edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await userSnapshot(page)).length).toBe(0);

  const mobileArrow = page.getByRole('button', { name: 'Arrow', exact: true }).first();
  if (await mobileArrow.isVisible().catch(() => false)) {
    const created = await createOpenCircleArrow(page);
    expect(created.arrowheadStyle).toBe('openCircle');
  } else {
    expect(await page.getByRole('button', { name: 'Arrow', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Arrow', exact: true }).count()).toBe(0);
});
