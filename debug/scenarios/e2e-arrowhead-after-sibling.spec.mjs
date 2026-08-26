import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Arrowhead used to be a session-shared arrowheadStyle. Callout → Arrow
// inherited V-shape; Arrow → Callout inherited Open circle; first-create
// stamped the leak until Arrowhead was touched.
// Distinct from leftover-18, Style dash after sibling, and the every-head
// catalogs. Do not invent a new Arrowhead UI. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-arrowhead-after-sibling.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-arrowhead-after-sibling\.pdf/;

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

async function arrowheadTrigger(page) {
  return page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
}

async function arrowheadValue(page) {
  const field = await arrowheadTrigger(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  return String(await field.innerText()).replace(/\s+/g, ' ').trim();
}

async function expectArrowhead(page, label, message) {
  const field = await arrowheadTrigger(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => arrowheadValue(page), { message }).toBe(label);
}

async function applyArrowhead(page, label) {
  const field = await arrowheadTrigger(page);
  if (!(await field.isVisible().catch(() => false))) return false;
  await field.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: 'Arrowhead' })).toBeVisible({ timeout: 8_000 });
  await popover.getByRole('option', { name: label, exact: true }).click();
  await expect(popover).toHaveCount(0, { timeout: 8_000 });
  await dismissChrome(page);
  return true;
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function userSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const annoIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const calloutIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
      .map((el) => el.getAttribute('data-callout-id'))
      .filter(Boolean);
    const ids = [...new Set([...annoIds, ...calloutIds])];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = legacy.style || data.style || object.style || {};
      const type = String(object.type || data.type || '').toLowerCase();
      const tool = String(data.tool || object.tool || data.type || '').toLowerCase();
      const callout = data.type === 'callout'
        || tool === 'callout'
        || String(id).startsWith('callout-')
        || !!legacy.id
        || !!document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"]`);
      if (object.isPdfImported === true && !keepImported) return null;
      const group = document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"]`)
        || document.querySelector(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id="${id}"]`);
      const paint = (el) => el
        && el.getAttribute('stroke') !== '#4a90e2'
        && !el.hasAttribute('data-handle');
      const polygon = [...(group?.querySelectorAll('polygon') || [])].find(paint);
      const circle = [...(group?.querySelectorAll('circle') || [])]
        .find((el) => paint(el) && !el.hasAttribute('data-callout-part') && !el.hasAttribute('data-handle'));
      const polyline = [...(group?.querySelectorAll('polyline') || [])].find(paint);
      const extraLine = [...(group?.querySelectorAll('line') || [])]
        .find((el) => paint(el) && !el.getAttribute('data-callout-part') && !el.hasAttribute('data-handle'));
      return {
        id,
        type,
        tool: callout ? 'callout' : tool,
        callout,
        text: String(object.text ?? data.text ?? legacy.text ?? ''),
        arrowheadStyle: style.arrowheadStyle || data.arrowheadStyle || object.arrowheadStyle || null,
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

async function commitCalloutEdit(page) {
  const pageGeom = await pageBox(page);
  await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(pageGeom.x + pageGeom.width - 12, pageGeom.y + pageGeom.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await dismissChrome(page);
}

async function createAfterSiblingHeads(page) {
  const before = new Set((await userSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Text', 'Callout');
  expect(await applyArrowhead(page, 'V-shape'), 'Callout Arrowhead must be reachable').toBeTruthy();
  await expectArrowhead(page, 'V-shape', 'Callout Arrowhead V-shape is the leak source');
  expect((await userSnapshot(page)).length, 'Callout visit must not invent a shape').toBe(0);

  await activateTool(page, 'Shapes', 'Arrow');
  await expectArrowhead(page, 'Solid triangle', 'Arrow must reset Arrowhead to Solid triangle after Callout V-shape');

  await activateTool(page, 'Text', 'Callout');
  await expectArrowhead(page, 'V-shape', 'Callout must keep its own V-shape after Arrow');

  await activateTool(page, 'Shapes', 'Arrow');
  expect(await applyArrowhead(page, 'Open circle'), 'Arrow Arrowhead must be reachable').toBeTruthy();
  await expectArrowhead(page, 'Open circle', 'Arrow Arrowhead Open circle is the reverse leak source');

  await activateTool(page, 'Text', 'Callout');
  await expectArrowhead(page, 'V-shape', 'Callout must keep V-shape after Arrow Open circle');

  await activateTool(page, 'Shapes', 'Arrow');
  await expectArrowhead(page, 'Open circle', 'Arrow must keep Open circle after Callout');
  expect((await userSnapshot(page)).length, 'sibling switches must not invent a shape').toBe(0);

  await dragOnPage(page, { x0: 0.18, y0: 0.22, x1: 0.48, y1: 0.30 });
  let arrow = null;
  await expect.poll(async () => {
    const rows = (await userSnapshot(page)).filter((row) => !before.has(row.id) && row.tool === 'arrow');
    arrow = rows[0] || null;
    return arrow && (arrow.arrowheadStyle || 'solidTriangle') === 'openCircle'
      ? arrow
      : null;
  }, { message: 'first Arrow must stamp Arrow Open circle without touching Arrowhead' }).not.toBeNull();
  expect(visualArrowheadKind(arrow), 'first Arrow SVG is Open circle').toBe('openCircle');
  await dismissChrome(page);
  await page.keyboard.press('Escape').catch(() => {});
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 8, empty.y + 8);

  await activateTool(page, 'Text', 'Callout');
  await expectArrowhead(page, 'V-shape', 'Callout must stay V-shape after Arrow create');
  await dragOnPage(page, { x0: 0.22, y0: 0.42, x1: 0.56, y1: 0.54 });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('H', { delay: 6 });
  await commitCalloutEdit(page);
  let callout = null;
  await expect.poll(async () => {
    const rows = (await userSnapshot(page)).filter((row) => !before.has(row.id) && row.callout);
    callout = rows[0] || null;
    return callout && (callout.arrowheadStyle || 'solidTriangle') === 'vShape'
      ? callout
      : null;
  }, { message: 'first Callout must stamp Callout V-shape without touching Arrowhead' }).not.toBeNull();
  expect(visualArrowheadKind(callout), 'first Callout SVG is V-shape').toBe('vShape');
  expect(callout.text).toBe('H');
  await dismissChrome(page);
  return { arrow, callout };
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
    const callout = dict.get(PDFName.of('SurveyAppCallout'));
    const le = dict.get(PDFName.of('LE'));
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      text: dict.get(PDFName.of('Contents'))?.decodeText?.() || '',
      metadataHead: parseSurveyHead(survey?.decodeText ? survey.decodeText() : null)
        || parseSurveyHead(callout?.decodeText ? callout.decodeText() : null),
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
    try {
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
    } catch { /* ignore */ }
  });
}

test('desktop Arrowhead after sibling persist + export /LE intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const { arrow, callout } = await createAfterSiblingHeads(page);
  expect(arrow.arrowheadStyle, 'first Arrow must keep Arrow Open circle after Callout').toBe('openCircle');
  expect(callout.arrowheadStyle, 'first Callout must keep Callout V-shape after Arrow').toBe('vShape');

  const dest = await exportAndSave(page, DEST_NAME);
  const heads = await exportedHeads(dest);
  const exportedArrow = heads.find((row) => (
    row.subtype === 'Line'
    && (row.metadataHead === 'openCircle' || (row.endings && row.endings.includes('Circle')))
    && !String(row.text || '').includes('H')
  ));
  const exportedCallout = heads.find((row) => (
    row.metadataHead === 'vShape' || (row.endings && row.endings.includes('Slash'))
  ));
  expect(exportedArrow, 'exported Arrow must exist').toBeTruthy();
  expect(
    exportedArrow.metadataHead || (exportedArrow.endings || []).includes('Circle') ? 'openCircle' : null,
    'exported Arrow must write Open circle from Arrow pref',
  ).toBe('openCircle');
  expect(exportedCallout, 'exported Callout must exist').toBeTruthy();
  expect(
    exportedCallout.metadataHead || ((exportedCallout.endings || []).includes('Slash') ? 'vShape' : null),
    'exported Callout must write V-shape from Callout pref',
  ).toBe('vShape');

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await userSnapshot(page, 1, { includeImported: true });
    const arrowRow = rows.find((row) => row.tool === 'arrow' && (row.arrowheadStyle || visualArrowheadKind(row)) === 'openCircle');
    const calloutRow = rows.find((row) => row.callout && (row.arrowheadStyle || visualArrowheadKind(row)) === 'vShape');
    return arrowRow && calloutRow ? { arrowRow, calloutRow } : null;
  }, { timeout: 20_000, message: 'reimport must keep Arrow Open circle and Callout V-shape' }).not.toBeNull();

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
  expect((await userSnapshot(page)).length, 'empty export must not invent a shape').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Arrowhead', exact: true }).count()).toBe(0);
});

test('390 Arrowhead after sibling edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await userSnapshot(page)).length).toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Arrowhead', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
});
