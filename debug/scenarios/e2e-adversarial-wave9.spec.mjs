import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
const LINK_FIXTURE = '/debug-fixtures/clickable-link-test.pdf';
const FORM_FIXTURE = '/debug-fixtures/kal441-form-fields.pdf';

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
    const annoIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const calloutIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
      .map((group) => group.getAttribute('data-callout-id'))
      .filter(Boolean);
    const overlayIds = [...document.querySelectorAll(`[data-counter-overlay="${pageNum}"] [data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const ids = [...new Set([...annoIds, ...calloutIds, ...overlayIds])];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const isCallout = calloutIds.includes(id);
      return {
        id,
        type: String(object.type || data.type || (isCallout ? 'callout' : '')).toLowerCase(),
        tool: String(data.tool || data.type || object.tool || (isCallout ? 'callout' : '')).toLowerCase(),
        imported: object.isPdfImported === true,
        left: object.left ?? data.left ?? null,
        top: object.top ?? data.top ?? null,
        width: object.width ?? data.width ?? null,
        height: object.height ?? data.height ?? null,
        scaleX: object.scaleX ?? data.scaleX ?? 1,
        scaleY: object.scaleY ?? data.scaleY ?? 1,
        x1: object.x1 ?? data.x1 ?? null,
        y1: object.y1 ?? data.y1 ?? null,
        x2: object.x2 ?? data.x2 ?? null,
        y2: object.y2 ?? data.y2 ?? null,
        text: object.text || data.text || null,
        callout: isCallout,
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

async function annotationById(page, id, pageNumber = 1) {
  const rows = await userAnnotationSnapshot(page, pageNumber);
  return rows.find((row) => row.id === id) || null;
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

async function clickOnPage(page, { pageNumber = 1, xf = 0.18, yf = 0.18 } = {}) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

function isCounterRow(row) {
  return row.tool === 'counter'
    || row.type.includes('counter')
    || row.type === 'circle'
    || row.type === 'group'
    || !row.type;
}

async function dropCounterPin(page, { pageNumber = 1, xf = 0.40, yf = 0.36 } = {}) {
  const overlay = page.locator(`[data-counter-overlay="${pageNumber}"]`);
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(280);
  const box = await overlay.boundingBox();
  expect(box, 'counter overlay geometry').toBeTruthy();
  const start = { x: box.x + box.width * xf, y: box.y + box.height * yf };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 8, { steps: 4 });
  await page.mouse.up();
}

async function createByTool(page, tool, coords, pageNumber = 1) {
  const before = new Set((await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id));
  if (tool.name === 'text') {
    await page.keyboard.press('t');
    const overlay = page.locator(`[data-text-overlay="${pageNumber}"]`);
    if (!(await overlay.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Text', exact: true }).first().click();
    }
    const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
    if (await sub.count()) {
      const pressed = await sub.getAttribute('aria-pressed');
      if (pressed !== 'true') await sub.click();
    }
    await expect(overlay).toBeVisible({ timeout: 8_000 });
    await dragOnPage(page, { ...coords, pageNumber });
    const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.click();
    await editor.pressSequentially(tool.sampleText || 'w9-text', { delay: 8 });
    await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
    return waitForNewUserAnnotation(page, before, tool.predicate, pageNumber);
  }
  if (tool.name === 'callout') {
    const beforeCallouts = await page.locator('[data-callout-id]').evaluateAll((els) => (
      els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
    ));
    await page.keyboard.press('q');
    await dragOnPage(page, { ...coords, pageNumber });
    const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.click();
    await editor.pressSequentially(tool.sampleText || 'w9-call', { delay: 8 });
    let calloutId = null;
    await expect.poll(async () => {
      const ids = await page.locator('[data-callout-id]').evaluateAll((els) => (
        els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
      ));
      calloutId = ids.find((id) => !beforeCallouts.includes(id)) || null;
      return calloutId;
    }).not.toBeNull();
    await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
    await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
    return { id: calloutId, type: 'callout', tool: 'callout', callout: true };
  }
  if (tool.name === 'counter') {
    await activateTool(page, tool.category, tool.button);
    await dropCounterPin(page, { pageNumber, xf: coords.x0, yf: coords.y0 });
    return waitForNewUserAnnotation(page, before, tool.predicate, pageNumber);
  }
  await activateTool(page, tool.category, tool.button);
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, tool.predicate, pageNumber);
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
    const target = page.locator(
      `[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"], [data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${id}"], [data-counter-overlay="${pageNumber}"] [data-anno-id="${id}"]`
    ).first();
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box, `bbox for ${id}`).toBeTruthy();
    await page.mouse.click(box.x + Math.min(8, box.width / 2), box.y + Math.max(2, box.height / 2));
  }
}

async function moveSelected(page, id, dx, dy, pageNumber = 1) {
  const target = page.locator(
    `[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"], [data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${id}"], [data-counter-overlay="${pageNumber}"] [data-anno-id="${id}"]`
  ).first();
  const box = await target.boundingBox();
  expect(box, `move bbox for ${id}`).toBeTruthy();
  await page.mouse.move(box.x + Math.min(10, box.width / 2), box.y + Math.max(3, box.height / 2));
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(10, box.width / 2) + dx, box.y + Math.max(3, box.height / 2) + dy, { steps: 8 });
  await page.mouse.up();
}

async function tryResize(page, id, pageNumber = 1) {
  await selectStroke(page, id, pageNumber);
  const handle = page.locator('[data-resize-handle="br"], [data-resize-handle]').last();
  if (!(await handle.count())) return false;
  const hb = await handle.boundingBox();
  if (!hb) return false;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40, hb.y + 28, { steps: 8 });
  await page.mouse.up();
  return true;
}

async function liveClone(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId);
    if (!object) return null;
    try {
      return JSON.parse(JSON.stringify(object));
    } catch {
      return {
        id: object.id,
        type: object.type,
        tool: object.tool || object.data?.tool,
        left: object.left,
        top: object.top,
        width: object.width,
        height: object.height,
        scaleX: object.scaleX,
        scaleY: object.scaleY,
        x1: object.x1,
        y1: object.y1,
        x2: object.x2,
        y2: object.y2,
        text: object.text,
        path: object.path,
        data: object.data,
      };
    }
  }, id);
}

async function liveCallout(page, id) {
  return page.evaluate((calloutId) => {
    const buf = window.__calloutGeomBuffer;
    const cap = buf?.svgById?.[calloutId];
    return cap?.source?._raw || cap?.source || null;
  }, id);
}

async function exportAnnotatedPdf(page) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  const path = await download.path();
  expect(path, 'exported PDF path').toBeTruthy();
  const fs = await import('node:fs/promises');
  return fs.readFile(path);
}

async function cancelExportDownload(page) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  await download.cancel();
  return true;
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

function decodePdfText(value) {
  if (!value) return '';
  if (typeof value.decodeText === 'function') return value.decodeText();
  if (typeof value.asString === 'function') return value.asString();
  return String(value);
}

async function exportedAnnots(bytes, pageIndex = 0) {
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(pageIndex);
  const annots = page.node.Annots();
  const rows = [];
  if (!annots) return { rows, pageHeight: page.getHeight(), pageWidth: page.getWidth() };
  for (const ref of annots.asArray()) {
    const dict = page.doc.context.lookup(ref);
    const subtype = String(dict.get(page.doc.context.obj('Subtype')) || '');
    const contents = decodePdfText(dict.get(page.doc.context.obj('Contents')));
    rows.push({
      subtype,
      rect: pdfNums(dict.get(page.doc.context.obj('Rect'))),
      L: pdfNums(dict.get(page.doc.context.obj('L'))),
      LE: String(dict.get(page.doc.context.obj('LE')) || ''),
      ink: Boolean(dict.get(page.doc.context.obj('InkList'))),
      contents,
      isInk: /^\/Ink$/i.test(subtype),
      isSquare: /^\/Square$/i.test(subtype),
      isCircle: /^\/Circle$/i.test(subtype),
      isLine: /^\/Line$/i.test(subtype),
      isFreeText: /^\/FreeText$/i.test(subtype),
      isLink: /^\/Link$/i.test(subtype),
      isWidget: /^\/Widget$/i.test(subtype),
    });
  }
  return { rows, pageHeight: page.getHeight(), pageWidth: page.getWidth() };
}

function userExportRows(exported) {
  return exported.rows.filter((row) => !row.isLink && !row.isWidget);
}

function devicePathPoints(contentText) {
  const identity = [1, 0, 0, 1, 0, 0];
  const mul = (a, b) => [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
  const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  let ctm = identity;
  const stack = [];
  const nums = [];
  const points = [];
  const pushPoints = (op, count) => {
    for (let i = count * 2; i > 0; i -= 2) {
      const x = nums[nums.length - i];
      const y = nums[nums.length - i + 1];
      points.push({ ...apply(ctm, x, y), op });
    }
  };
  for (const tok of contentText.split(/\s+/).filter(Boolean)) {
    const n = Number(tok);
    if (Number.isFinite(n) && /^[-.\d]/.test(tok)) { nums.push(n); continue; }
    if (tok === 'q') stack.push(ctm);
    else if (tok === 'Q') ctm = stack.pop() || identity;
    else if (tok === 'cm' && nums.length >= 6) ctm = mul(nums.slice(-6), ctm);
    else if (tok === 'm' || tok === 'l') pushPoints(tok, 1);
    else if (tok === 'c') pushPoints(tok, 3);
    else if (tok === 're' && nums.length >= 4) {
      const [x, y, w, h] = nums.slice(-4);
      points.push({ ...apply(ctm, x, y), op: 're', w, h });
      points.push({ ...apply(ctm, x + w, y + h), op: 're' });
    }
    nums.length = 0;
  }
  return points;
}

async function pageContentText(bytes, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}

async function flattenLive(page, {
  objects = [],
  callouts = [],
  fixture = LINK_FIXTURE,
} = {}) {
  return page.evaluate(async ({ objs, calls, fixtureUrl }) => {
    const {
      savePDFWithAnnotationsPdfLib,
      savePDFWithFlattenedRegularAnnotationsForPrint,
    } = await import('/src/utils/pdfAnnotationsPdfLib.js');
    const buf = await (await fetch(fixtureUrl)).arrayBuffer();
    const file = { name: 'wave9.pdf', arrayBuffer: async () => buf };
    const { PDFDocument } = await import('pdf-lib');
    const src = await PDFDocument.load(buf.slice(0));
    const size = src.getPage(0).getSize();
    const pageSizes = { 1: { width: size.width, height: size.height } };
    const annotations = { 1: { objects: objs } };
    const flattenBytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
      file,
      annotations,
      pageSizes,
      { callouts: calls },
    );
    const exportBytes = await savePDFWithAnnotationsPdfLib(
      file,
      annotations,
      pageSizes,
      null,
      { returnBytes: true, actionType: 'pdf-export', callouts: calls },
    );
    return {
      flattenBytes: [...new Uint8Array(flattenBytes)],
      exportBytes: [...new Uint8Array(exportBytes)],
      pageHeight: size.height,
      pageWidth: size.width,
    };
  }, { objs: objects, calls: callouts, fixtureUrl: fixture });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

async function clickUndo(page) {
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
}

const TOOLS = [
  {
    name: 'pen',
    category: 'Draw',
    button: 'Pen',
    coords: { x0: 0.20, y0: 0.26, x1: 0.42, y1: 0.34 },
    sibling: 'highlighter',
    siblingCoords: { x0: 0.50, y0: 0.26, x1: 0.70, y1: 0.34 },
    predicate: (row) => row.type === 'path' || row.tool === 'pen',
    expectExport: (rows) => rows.some((row) => row.isInk),
    expectFlatten: (text, pts) => pts.length >= 2 || /m\b/.test(text),
  },
  {
    name: 'highlighter',
    category: 'Draw',
    button: 'Highlighter',
    coords: { x0: 0.18, y0: 0.40, x1: 0.46, y1: 0.46 },
    sibling: 'rect',
    siblingCoords: { x0: 0.52, y0: 0.38, x1: 0.70, y1: 0.52 },
    predicate: (row) => row.type === 'path' || row.tool.includes('highlight'),
    expectExport: (rows) => rows.some((row) => row.isInk),
    expectFlatten: (text, pts) => pts.length >= 2 || /m\b/.test(text),
  },
  {
    name: 'rect',
    category: 'Shapes',
    button: 'Rectangle',
    coords: { x0: 0.20, y0: 0.22, x1: 0.40, y1: 0.38 },
    sibling: 'ellipse',
    siblingCoords: { x0: 0.50, y0: 0.22, x1: 0.68, y1: 0.38 },
    predicate: (row) => row.type === 'rect' || row.type === 'rectangle',
    expectExport: (rows) => rows.some((row) => row.isSquare),
    expectFlatten: (text, pts) => pts.some((pt) => pt.op === 're') || /re\b/.test(text) || pts.length >= 2,
  },
  {
    name: 'ellipse',
    category: 'Shapes',
    button: 'Ellipse',
    coords: { x0: 0.22, y0: 0.24, x1: 0.42, y1: 0.40 },
    sibling: 'line',
    siblingCoords: { x0: 0.50, y0: 0.28, x1: 0.72, y1: 0.36 },
    predicate: (row) => row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse',
    expectExport: (rows) => rows.some((row) => row.isCircle),
    expectFlatten: (text) => /c\b|cm\b/.test(text),
  },
  {
    name: 'line',
    category: 'Shapes',
    button: 'Line',
    coords: { x0: 0.20, y0: 0.50, x1: 0.48, y1: 0.58 },
    sibling: 'arrow',
    siblingCoords: { x0: 0.52, y0: 0.50, x1: 0.74, y1: 0.58 },
    predicate: (row) => row.tool === 'line' || row.type === 'line',
    expectExport: (rows) => rows.some((row) => row.isLine && Array.isArray(row.L)),
    expectFlatten: (text, pts) => pts.filter((pt) => pt.op === 'm' || pt.op === 'l').length >= 2,
  },
  {
    name: 'arrow',
    category: 'Shapes',
    button: 'Arrow',
    coords: { x0: 0.22, y0: 0.42, x1: 0.48, y1: 0.50 },
    sibling: 'text',
    siblingCoords: { x0: 0.54, y0: 0.40, x1: 0.72, y1: 0.52 },
    predicate: (row) => row.tool === 'arrow' || row.type === 'arrow' || row.type === 'line',
    expectExport: (rows) => rows.some((row) => row.isLine && /ClosedArrow|OpenArrow|Circle|Slash|Butt/i.test(row.LE)),
    expectFlatten: (text, pts) => pts.length >= 2,
  },
  {
    name: 'text',
    category: 'Text',
    button: 'Text',
    coords: { x0: 0.18, y0: 0.22, x1: 0.36, y1: 0.34 },
    sibling: 'rect',
    siblingCoords: { x0: 0.50, y0: 0.22, x1: 0.68, y1: 0.36 },
    sampleText: 'w9-text',
    predicate: (row) => row.type === 'textbox' || row.type === 'text' || row.tool === 'text',
    expectExport: (rows) => rows.some((row) => row.isFreeText && /w9-text/i.test(row.contents || '')),
    expectFlatten: (text) => /Tj\b|TJ\b|w9-text/.test(text),
  },
  {
    name: 'callout',
    category: 'Text',
    button: 'Callout',
    coords: { x0: 0.16, y0: 0.24, x1: 0.34, y1: 0.40 },
    sibling: 'rect',
    siblingCoords: { x0: 0.52, y0: 0.24, x1: 0.70, y1: 0.40 },
    sampleText: 'w9-call',
    predicate: (row) => row.callout || row.tool === 'callout' || row.type === 'callout',
    expectExport: (rows) => rows.some((row) => row.isFreeText && /w9-call/i.test(row.contents || ''))
      && rows.some((row) => row.isLine),
    expectFlatten: (text) => /Tj\b|TJ\b|w9-call/.test(text) || /m\b/.test(text),
  },
  {
    name: 'counter',
    category: 'Shapes',
    button: 'Counter',
    coords: { x0: 0.34, y0: 0.32, x1: 0.36, y1: 0.34 },
    sibling: 'pen',
    siblingCoords: { x0: 0.52, y0: 0.28, x1: 0.72, y1: 0.36 },
    predicate: isCounterRow,
    expectExport: (rows) => rows.some((row) => row.isCircle),
    expectFlatten: (text) => /Tj\b|TJ\b/.test(text) || /c\b/.test(text),
  },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool]));

async function assertBreakEmptyCancelNoop(page, tool) {
  const emptyHunt = await flattenLive(page, { objects: [], callouts: [] });
  const emptyExport = await exportedAnnots(Uint8Array.from(emptyHunt.exportBytes));
  expect(userExportRows(emptyExport).length, `${tool.name} empty-page export invents no user marks`).toBe(0);
  const emptyFlatten = await pageContentText(Uint8Array.from(emptyHunt.flattenBytes));
  expect(emptyFlatten, `${tool.name} empty flatten still produced page content`).toBeTruthy();

  const beforeIds = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, tool.category, tool.button);
  await page.keyboard.press('Escape');
  await clickOnPage(page, { xf: 0.12, yf: 0.12 });
  await page.waitForTimeout(220);
  const afterNoop = await userAnnotationSnapshot(page);
  const created = afterNoop.filter((row) => !beforeIds.has(row.id));
  expect(created.length, `${tool.name} cancel/no-op must not commit a stroke`).toBe(0);
}

async function transformAndExport(page, created, tool) {
  const beforeMove = created.callout
    ? await liveCallout(page, created.id)
    : await liveClone(page, created.id);
  await selectStroke(page, created.id);
  await moveSelected(page, created.id, 36, 24);
  await tryResize(page, created.id);
  const afterMove = created.callout
    ? await liveCallout(page, created.id)
    : await liveClone(page, created.id);

  const bytes = await exportAnnotatedPdf(page);
  const exported = await exportedAnnots(bytes);
  const userRows = userExportRows(exported);
  expect(tool.expectExport(userRows), `${tool.name} export missing expected geometry/text`).toBeTruthy();

  const objects = afterMove && !created.callout ? [afterMove] : [];
  const callouts = created.callout && afterMove ? [afterMove] : [];
  const hunt = await flattenLive(page, { objects, callouts });
  const flattenText = await pageContentText(Uint8Array.from(hunt.flattenBytes));
  const pts = devicePathPoints(flattenText);
  expect(tool.expectFlatten(flattenText, pts), `${tool.name} print flatten missing geometry/text`).toBeTruthy();

  return { beforeMove, afterMove, exported: userRows, flattenText, pts };
}

for (const tool of TOOLS) {
  test(`W9 ${tool.name}: intended + break + edge`, async ({ page }) => {
    await openEditor(page);

    await assertBreakEmptyCancelNoop(page, tool);

    const created = await createByTool(page, tool, tool.coords);
    expect(created?.id, `${tool.name} draw committed`).toBeTruthy();
    const intended = await transformAndExport(page, created, tool);

    const siblingTool = TOOL_BY_NAME[tool.sibling];
    const sibling = await createByTool(page, siblingTool, tool.siblingCoords);
    expect(sibling?.id, `${tool.name} mixed sibling ${siblingTool.name}`).toBeTruthy();
    expect(sibling.id).not.toBe(created.id);

    const mixedBytes = await exportAnnotatedPdf(page);
    const mixed = userExportRows(await exportedAnnots(mixedBytes));
    expect(tool.expectExport(mixed), `${tool.name} still present in mixed export`).toBeTruthy();
    expect(siblingTool.expectExport(mixed), `${siblingTool.name} present in mixed export`).toBeTruthy();

    await clickUndo(page);
    await expect.poll(async () => {
      if (sibling.callout) {
        return page.locator(`[data-callout-id="${sibling.id}"]`).count();
      }
      return annotationById(page, sibling.id);
    }).toBeFalsy();
    expect(
      created.callout
        ? await page.locator(`[data-callout-id="${created.id}"]`).count()
        : Boolean(await annotationById(page, created.id)),
    ).toBeTruthy();

    const afterUndoBytes = await exportAnnotatedPdf(page);
    const afterUndo = userExportRows(await exportedAnnots(afterUndoBytes));
    expect(tool.expectExport(afterUndo), `${tool.name} survives undo-of-sibling export`).toBeTruthy();
    expect(afterUndo.length, `${tool.name} undo must drop the sibling from export`).toBeLessThan(mixed.length);

    await assertNoErrorBoundary(page);
    console.log(`W9_${tool.name.toUpperCase()}`, JSON.stringify({
      id: created.id,
      siblingId: sibling.id,
      intendedExport: intended.exported.map((row) => row.subtype),
      mixedExport: mixed.map((row) => row.subtype),
      afterUndoExport: afterUndo.map((row) => row.subtype),
      flattenHasText: /Tj\b|TJ\b/.test(intended.flattenText),
      flattenPts: intended.pts.length,
    }));
  });
}

test('W9 form widget: intended + break + edge', async ({ page }) => {
  await openEditor(page, FORM_PDF);
  await page.keyboard.press('v');

  const layer = page.locator('.pdfjsFormLayer[data-pdfjs-form-layer="1"]');
  await expect(layer).toBeAttached({ timeout: 30_000 });
  const typed = page.locator('.pdfjsFormLayer input[type="text"], .pdfjsFormLayer textarea').first();
  await expect(typed).toBeAttached({ timeout: 15_000 });

  const emptyHunt = await flattenLive(page, { objects: [], fixture: FORM_FIXTURE });
  const emptyForm = await PDFDocument.load(Uint8Array.from(emptyHunt.exportBytes));
  const emptyName = emptyForm.getForm().getTextField('surveyor.name').getText() || '';
  expect(emptyName, 'unfilled form export stays empty').toBe('');

  await typed.click({ force: true });
  await typed.fill('');
  await typed.blur();
  await page.keyboard.press('Escape');
  await expect(typed).toHaveValue('');

  await cancelExportDownload(page);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();
  await expect(typed).toHaveValue('');

  await typed.click({ force: true });
  await typed.fill('w9-form');
  await typed.blur();
  await page.mouse.click(12, 200);
  await expect(typed).toHaveValue('w9-form');
  await page.waitForTimeout(500);

  const filledBytes = await exportAnnotatedPdf(page);
  const filledPdf = await PDFDocument.load(filledBytes);
  expect(filledPdf.getForm().getTextField('surveyor.name').getText()).toBe('w9-form');

  const formObjects = await page.evaluate(async () => {
    const { buildFormFieldObject } = await import('/src/hooks/usePdfjsFormFieldPersistence.js');
    const input = document.querySelector('.pdfjsFormLayer input[type="text"], .pdfjsFormLayer textarea');
    const section = input?.closest('section[data-annotation-id]');
    const fieldId = section?.getAttribute('data-annotation-id')
      || input?.id
      || null;
    return [buildFormFieldObject(1, {
      fieldId,
      fieldName: 'surveyor.name',
      fieldType: 'Tx',
      value: 'w9-form',
    }, null, 'wave9')];
  });
  const flattenHunt = await flattenLive(page, { objects: formObjects, fixture: FORM_FIXTURE });
  const flattenPdf = await PDFDocument.load(Uint8Array.from(flattenHunt.flattenBytes));
  expect(flattenPdf.getForm().getTextField('surveyor.name').getText()).toBe('w9-form');

  const rect = await createByTool(page, TOOL_BY_NAME.rect, { x0: 0.58, y0: 0.18, x1: 0.82, y1: 0.36 });
  expect(rect.id).toBeTruthy();
  const mixedBytes = await exportAnnotatedPdf(page);
  const mixedPdf = await PDFDocument.load(mixedBytes);
  expect(mixedPdf.getForm().getTextField('surveyor.name').getText()).toBe('w9-form');
  const mixedAnnots = userExportRows(await exportedAnnots(mixedBytes));
  expect(mixedAnnots.some((row) => row.isSquare), 'rect sibling exports with filled form').toBeTruthy();

  await clickUndo(page);
  await expect.poll(async () => annotationById(page, rect.id)).toBeFalsy();
  await expect(typed).toHaveValue('w9-form');
  const afterUndoBytes = await exportAnnotatedPdf(page);
  const afterUndoPdf = await PDFDocument.load(afterUndoBytes);
  expect(afterUndoPdf.getForm().getTextField('surveyor.name').getText()).toBe('w9-form');

  await assertNoErrorBoundary(page);
  console.log('W9_FORM', JSON.stringify({
    filled: 'w9-form',
    mixedSquares: mixedAnnots.filter((row) => row.isSquare).length,
    afterUndoKept: true,
  }));
});
