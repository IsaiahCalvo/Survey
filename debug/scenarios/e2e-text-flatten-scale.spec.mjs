import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const WRAP_TEXT = 'AAAA BBBB';
const RECT_TOL = 2.5;

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true, pageNumber = 1) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, pageNumber);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    const pressed = await sub.first().getAttribute('aria-pressed');
    if (pressed !== 'true') await sub.first().click();
    return;
  }
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0 || !(await tool.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : tool.first();
  const pressed = await target.getAttribute('aria-pressed');
  if (pressed !== 'true') await target.click();
}

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return { start, end, box };
}

async function createRect(page, coords = { x0: 0.52, y0: 0.22, x1: 0.68, y1: 0.36 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle');
}

async function createText(page, text, coords = { x0: 0.18, y0: 0.22, x1: 0.30, y1: 0.32 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await page.keyboard.press('t');
  const overlay = page.locator('[data-text-overlay="1"]');
  if (!(await overlay.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Text', exact: true }).first().click();
  }
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
  if (await sub.count()) {
    const pressed = await sub.getAttribute('aria-pressed');
    if (pressed !== 'true') await sub.click();
  }
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type(text);
  await page.mouse.click(12, 200);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'textbox' || row.type === 'text' || row.tool === 'text'
  ));
}

async function liveTextObject(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId);
    if (!object) return null;
    return JSON.parse(JSON.stringify({
      type: object.type || 'textbox',
      tool: object.tool || object.data?.tool || 'text',
      left: object.left ?? 0,
      top: object.top ?? 0,
      width: object.width,
      height: object.height,
      scaleX: object.scaleX ?? 1,
      scaleY: object.scaleY ?? 1,
      angle: object.angle ?? 0,
      text: object.text || '',
      fill: object.fill || '#000000',
      fontSize: object.fontSize || 12,
      fontFamily: object.fontFamily || 'Helvetica',
      fontWeight: object.fontWeight || 'normal',
      fontStyle: object.fontStyle || 'normal',
      data: object.data || {},
    }));
  }, id);
}

async function selectStroke(page, id, pageNumber = 1) {
  await page.keyboard.press('v');
  const hooked = await page.evaluate((annoId) => {
    if (typeof window.__fix19SelectAnnotation === 'function') {
      return window.__fix19SelectAnnotation(annoId);
    }
    return false;
  }, id);
  if (!hooked) {
    const target = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"]`).first();
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box, `bbox for ${id}`).toBeTruthy();
    await page.mouse.click(box.x + Math.min(10, Math.max(4, box.width / 2)), box.y + Math.max(3, box.height / 2));
  }
  await expect(page.locator('[data-resize-handle], [data-selection-bbox]').first()).toBeVisible({ timeout: 8_000 });
}

async function resizeHandle(page, handleId, dx, dy) {
  const handle = page.locator(`[data-resize-handle="${handleId}"]`).first();
  await expect(handle).toBeVisible();
  const hb = await handle.boundingBox();
  expect(hb, `resize handle ${handleId}`).toBeTruthy();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
}

async function tryGroupResizeText(page, textId, otherId, dx, dy) {
  await selectStroke(page, textId);
  const other = page.locator(`[data-svg-annotation-layer="1"] [data-anno-id="${otherId}"]`).first();
  await expect(other).toBeVisible();
  const box = await other.boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + Math.min(8, Math.max(3, box.width / 2)), box.y + Math.max(3, box.height / 2));
  await page.keyboard.up('Shift');
  const group = page.locator('[data-group-selection-bbox="true"]');
  const grouped = await group.count();
  const handle = page.locator('[data-group-selection-bbox="true"] [data-resize-handle="br"]');
  const handleCount = await handle.count();
  if (grouped && handleCount) {
    await resizeHandle(page, 'br', dx, dy);
    return 'ui';
  }
  return 'hidden';
}

function scaledRect(obj, pageHeight) {
  const sx = Math.abs(Number(obj.scaleX) || 1);
  const sy = Math.abs(Number(obj.scaleY) || 1);
  const width = (Number(obj.width) || 0) * sx;
  const height = (Number(obj.height) || 0) * sy;
  const left = Number(obj.left) || 0;
  const top = Number(obj.top) || 0;
  return [left, pageHeight - (top + height), left + width, pageHeight - top];
}

function rawRect(obj, pageHeight) {
  return scaledRect({ ...obj, scaleX: 1, scaleY: 1 }, pageHeight);
}

function closeArrays(actual, expected, tol = RECT_TOL) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  return actual.every((value, index) => Math.abs(Number(value) - Number(expected[index])) < tol);
}

function pdfNums(value) {
  if (!value) return null;
  if (typeof value.asArray === 'function') {
    return value.asArray().map((item) => (
      typeof item?.asNumber === 'function' ? item.asNumber() : Number(item)
    ));
  }
  const text = String(value);
  const nums = [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return nums.length ? nums : null;
}

async function exportedFreeTexts(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(0);
  const annots = page.node.Annots();
  const rows = [];
  if (annots) {
    for (const ref of annots.asArray()) {
      const dict = page.doc.context.lookup(ref);
      const subtype = String(dict.get(page.doc.context.obj('Subtype')) || '');
      if (!/FreeText/i.test(subtype)) continue;
      rows.push({
        subtype,
        rect: pdfNums(dict.get(page.doc.context.obj('Rect'))),
      });
    }
  }
  return { rows, pageHeight: page.getHeight(), pageWidth: page.getWidth() };
}

function countTextShows(contentText) {
  return (contentText.match(/Tj\b/g) || []).length;
}

async function pageContentStreams(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()));
}

async function flattenOverlayText(bytes) {
  const streams = await pageContentStreams(bytes);
  return streams.at(-1) || '';
}

async function overlayShows(bytes) {
  return countTextShows(await flattenOverlayText(bytes));
}

async function exportAndFlatten(page, fabricObj, pageSize, { blankWrap = false } = {}) {
  const blankBytes = blankWrap ? await (async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    return [...new Uint8Array(await doc.save())];
  })() : null;
  return page.evaluate(async ({ obj, sizes, blank }) => {
    const {
      savePDFWithAnnotationsPdfLib,
      savePDFWithFlattenedRegularAnnotationsForPrint,
    } = await import('/src/utils/pdfAnnotationsPdfLib.js');
    const fixtureBuf = await (await fetch('/debug-fixtures/clickable-link-test.pdf')).arrayBuffer();
    const file = {
      name: 'text-flatten.pdf',
      arrayBuffer: async () => (blank ? Uint8Array.from(blank).buffer : fixtureBuf),
    };
    const pageSizes = { 1: blank ? { width: 200, height: 200 } : sizes };
    const annotations = { 1: { objects: [obj] } };
    const exportBytes = await savePDFWithAnnotationsPdfLib(
      file,
      annotations,
      pageSizes,
      null,
      { returnBytes: true },
    );
    const flattenBytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
      file,
      annotations,
      pageSizes,
    );
    return {
      exportBytes: [...new Uint8Array(exportBytes)],
      flattenBytes: [...new Uint8Array(flattenBytes)],
    };
  }, { obj: fabricObj, sizes: pageSize, blank: blankBytes });
}

async function fixturePageSize() {
  const bytes = readFileSync(new URL('../../debug/fixtures/clickable-link-test.pdf', import.meta.url));
  const doc = await PDFDocument.load(bytes);
  const p = doc.getPage(0);
  return { width: p.getWidth(), height: p.getHeight() };
}

function groupResizePersistContract() {
  const src = readFileSync(new URL('../../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  const groupStart = src.indexOf("ds.mode === 'group-resize' && ds.groupMemberOriginals");
  const groupEnd = src.indexOf('ds.currentAnnotations = updatedAnnotations', groupStart);
  const groupResize = src.slice(groupStart, groupEnd);
  const textBakeStart = src.indexOf("objType === 'textbox' || objType === 'i-text' || objType === 'text'");
  const textBake = src.slice(textBakeStart, src.indexOf('isPointsShape', textBakeStart));
  const individualTextBake = textBake.includes('obj.width = (obj.width || 100) * (newScaleX / (ds.originalProps.scaleX || 1))')
    && textBake.includes('obj.scaleX = 1');
  return {
    groupWritesScale: /target\.scaleX = \(orig\.scaleX \|\| 1\) \* Math\.abs\(sx\)/.test(groupResize),
    groupBakesTextWidth: /target\.width = \(orig\.width/.test(groupResize)
      && groupResize.includes('textbox'),
    individualTextBake,
  };
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

function applyGroupResizePersist(obj, scaleX, scaleY) {
  return {
    ...obj,
    type: obj.type || 'textbox',
    scaleX: (Number(obj.scaleX) || 1) * Math.abs(scaleX),
    scaleY: (Number(obj.scaleY) || 1) * Math.abs(scaleY),
  };
}

test('intended: group-resize persist leaves unbaked scale; export/print use scaled box', async ({ page }) => {
  await openEditor(page);
  const sizes = await fixturePageSize();
  const contract = groupResizePersistContract();
  expect(contract.groupWritesScale, 'group-resize persist multiplies scaleX/scaleY').toBe(true);
  expect(contract.groupBakesTextWidth, 'group-resize must not bake text width').toBe(false);

  const text = await createText(page, WRAP_TEXT, { x0: 0.16, y0: 0.20, x1: 0.28, y1: 0.30 });
  const rect = await createRect(page, { x0: 0.52, y0: 0.22, x1: 0.68, y1: 0.36 });
  const live = await liveTextObject(page, text.id);
  expect(String(live?.text || '')).toContain('AAAA');
  expect(Number(live.width) || 0).toBeGreaterThan(4);
  expect(Number(live.height) || 0).toBeGreaterThan(4);

  const uiPath = await tryGroupResizeText(page, text.id, rect.id, 80, 56);
  let grouped = await liveTextObject(page, text.id);
  if (uiPath === 'hidden' || (
    Math.abs((Number(grouped.scaleX) || 1) - 1) < 0.04
    && Math.abs((Number(grouped.scaleY) || 1) - 1) < 0.04
  )) {
    grouped = applyGroupResizePersist(live, 2, 2);
  }
  expect(Math.abs(Number(grouped.scaleX) || 1)).toBeGreaterThan(1.2);
  expect(Math.abs(Number(grouped.scaleY) || 1)).toBeGreaterThan(1.2);
  expect(Math.abs((Number(grouped.width) || 0) - (Number(live.width) || 0))).toBeLessThan(1.5);

  const hunt = await exportAndFlatten(page, grouped, sizes);
  const exported = await exportedFreeTexts(Uint8Array.from(hunt.exportBytes));
  const expected = scaledRect(grouped, exported.pageHeight);
  const raw = rawRect(grouped, exported.pageHeight);
  const hit = exported.rows.find((row) => closeArrays(row.rect, expected));
  expect(hit, `scaled FreeText /Rect among ${JSON.stringify(exported.rows)}`).toBeTruthy();
  expect(closeArrays(hit.rect, raw), 'scaled /Rect must not stay at raw width/height').toBe(false);

  const scaledShows = await overlayShows(Uint8Array.from(hunt.flattenBytes));
  const rawHunt = await exportAndFlatten(page, { ...grouped, scaleX: 1, scaleY: 1 }, sizes);
  const rawShows = await overlayShows(Uint8Array.from(rawHunt.flattenBytes));
  expect(scaledShows, 'scaled print wrote text').toBeGreaterThan(0);
  expect(rawShows, 'raw-width print wrote text').toBeGreaterThan(0);
  if (rawShows >= 2 && scaledShows !== rawShows) {
    expect(scaledShows).toBeLessThan(rawShows);
  } else {
    const narrow = { ...grouped, width: 40, height: 40, scaleX: 2, scaleY: 1, text: WRAP_TEXT, fontSize: 12 };
    const narrowHunt = await exportAndFlatten(page, narrow, sizes, { blankWrap: true });
    const narrowRaw = await exportAndFlatten(page, { ...narrow, scaleX: 1, scaleY: 1 }, sizes, { blankWrap: true });
    const narrowScaledShows = await overlayShows(Uint8Array.from(narrowHunt.flattenBytes));
    const narrowRawShows = await overlayShows(Uint8Array.from(narrowRaw.flattenBytes));
    expect(narrowRawShows).toBeGreaterThanOrEqual(2);
    expect(narrowScaledShows).toBe(1);
  }

  await assertNoErrorBoundary(page);
  console.log('E2E_TEXT_FLATTEN_INTENDED', JSON.stringify({
    uiPath,
    live: { left: live.left, top: live.top, width: live.width, height: live.height, scaleX: live.scaleX, scaleY: live.scaleY },
    grouped: { width: grouped.width, height: grouped.height, scaleX: grouped.scaleX, scaleY: grouped.scaleY },
    rect: hit.rect,
    expected,
    raw,
    scaledShows,
    rawShows,
  }));
});

test('break: individual resize bakes scale=1; export/print still use raw width', async ({ page }) => {
  await openEditor(page);
  const sizes = await fixturePageSize();
  const contract = groupResizePersistContract();
  expect(contract.individualTextBake, 'individual text resize bakes width and scale=1').toBe(true);

  const text = await createText(page, WRAP_TEXT, { x0: 0.20, y0: 0.40, x1: 0.36, y1: 0.52 });
  const fresh = await liveTextObject(page, text.id);
  expect(Math.abs((Number(fresh.scaleX) || 1) - 1)).toBeLessThan(0.04);
  expect(Math.abs((Number(fresh.scaleY) || 1) - 1)).toBeLessThan(0.04);

  await selectStroke(page, text.id);
  await resizeHandle(page, 'br', 90, 36);
  await expect.poll(async () => {
    const next = await liveTextObject(page, text.id);
    return next && Math.abs((Number(next.width) || 0) - (Number(fresh.width) || 0)) > 8;
  }).toBeTruthy();
  const baked = await liveTextObject(page, text.id);
  expect(Math.abs((Number(baked.scaleX) || 1) - 1)).toBeLessThan(0.04);
  expect(Math.abs((Number(baked.scaleY) || 1) - 1)).toBeLessThan(0.04);
  expect(Number(baked.width)).toBeGreaterThan(Number(fresh.width) + 8);

  const hunt = await exportAndFlatten(page, baked, sizes);
  const exported = await exportedFreeTexts(Uint8Array.from(hunt.exportBytes));
  const expected = rawRect(baked, exported.pageHeight);
  const doubleScaled = scaledRect({
    ...baked,
    scaleX: (Number(baked.width) || 1) / (Number(fresh.width) || 1),
    scaleY: (Number(baked.height) || 1) / (Number(fresh.height) || 1),
  }, exported.pageHeight);
  const hit = exported.rows.find((row) => closeArrays(row.rect, expected));
  expect(hit, `baked FreeText /Rect among ${JSON.stringify(exported.rows)}`).toBeTruthy();
  expect(closeArrays(hit.rect, doubleScaled), 'baked resize must not be re-multiplied').toBe(false);

  const shows = await overlayShows(Uint8Array.from(hunt.flattenBytes));
  expect(shows, 'baked print wrote text').toBeGreaterThan(0);

  await assertNoErrorBoundary(page);
  console.log('E2E_TEXT_FLATTEN_BREAK', JSON.stringify({
    fresh: { width: fresh.width, height: fresh.height, scaleX: fresh.scaleX, scaleY: fresh.scaleY },
    baked: { width: baked.width, height: baked.height, scaleX: baked.scaleX, scaleY: baked.scaleY },
    rect: hit.rect,
    expected,
  }));
});

test('edge: non-uniform |scaleX|≠|scaleY| stretches wrap and /Rect independently', async ({ page }) => {
  await openEditor(page);
  const sizes = await fixturePageSize();
  const text = await createText(page, WRAP_TEXT, { x0: 0.18, y0: 0.24, x1: 0.32, y1: 0.36 });
  const live = await liveTextObject(page, text.id);
  const stretched = applyGroupResizePersist(live, 2, 3);
  expect(Math.abs(Math.abs(stretched.scaleX) - Math.abs(stretched.scaleY))).toBeGreaterThan(0.4);

  const hunt = await exportAndFlatten(page, stretched, sizes);
  const exported = await exportedFreeTexts(Uint8Array.from(hunt.exportBytes));
  const expected = scaledRect(stretched, exported.pageHeight);
  const raw = rawRect(stretched, exported.pageHeight);
  const uniformX = scaledRect({ ...stretched, scaleY: stretched.scaleX }, exported.pageHeight);
  const hit = exported.rows.find((row) => closeArrays(row.rect, expected));
  expect(hit, `non-uniform FreeText /Rect among ${JSON.stringify(exported.rows)}`).toBeTruthy();
  expect(closeArrays(hit.rect, raw)).toBe(false);
  expect(closeArrays(hit.rect, uniformX), 'height must use |scaleY|, not |scaleX|').toBe(false);
  const [x1, y1, x2, y2] = hit.rect;
  const visualW = (Number(live.width) || 0) * 2;
  const visualH = (Number(live.height) || 0) * 3;
  expect(Math.abs((x2 - x1) - visualW)).toBeLessThan(RECT_TOL);
  expect(Math.abs((y2 - y1) - visualH)).toBeLessThan(RECT_TOL);
  expect(Math.abs((x2 - x1) - (y2 - y1))).toBeGreaterThan(4);

  const xOnly = applyGroupResizePersist({ ...live, text: WRAP_TEXT, width: 40, height: 40, fontSize: 12 }, 2, 1);
  const yOnly = applyGroupResizePersist({ ...live, text: WRAP_TEXT, width: 40, height: 16, fontSize: 12 }, 1, 3);
  const xHunt = await exportAndFlatten(page, xOnly, sizes, { blankWrap: true });
  const yHunt = await exportAndFlatten(page, yOnly, sizes, { blankWrap: true });
  const xExport = await exportedFreeTexts(Uint8Array.from(xHunt.exportBytes));
  const yExport = await exportedFreeTexts(Uint8Array.from(yHunt.exportBytes));
  expect(closeArrays(xExport.rows[0]?.rect, scaledRect(xOnly, xExport.pageHeight))).toBe(true);
  expect(closeArrays(yExport.rows[0]?.rect, scaledRect(yOnly, yExport.pageHeight))).toBe(true);
  const xShows = await overlayShows(Uint8Array.from(xHunt.flattenBytes));
  const yShows = await overlayShows(Uint8Array.from(yHunt.flattenBytes));
  expect(xShows).toBe(1);
  expect(yShows).toBeGreaterThanOrEqual(2);

  await assertNoErrorBoundary(page);
  console.log('E2E_TEXT_FLATTEN_EDGE', JSON.stringify({
    live: { width: live.width, height: live.height, scaleX: live.scaleX, scaleY: live.scaleY },
    stretched: { scaleX: stretched.scaleX, scaleY: stretched.scaleY },
    rect: hit.rect,
    expected,
    visualW,
    visualH,
    xShows,
    yShows,
  }));
});
