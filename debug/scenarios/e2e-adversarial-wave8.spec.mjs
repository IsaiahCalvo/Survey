import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

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
        displayNumber: (() => {
          const fromData = data.displayNumber ?? data.value ?? data.number ?? object.displayNumber;
          if (Number.isFinite(Number(fromData)) && Number(fromData) > 0) return Number(fromData);
          const el = document.querySelector(
            `[data-counter-overlay="${pageNum}"] [data-anno-id="${id}"] text, [data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"] text`
          );
          const fromDom = el ? Number.parseInt((el.textContent || '').trim(), 10) : NaN;
          return Number.isFinite(fromDom) ? fromDom : (fromData ?? null);
        })(),
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
        cloudIntensity: data.pdfCloudIntensity ?? data.cloudIntensity ?? null,
        cloudBorder: Boolean(data.cloudBorder || object.cloudBorder || data.borderStyle === 'cloud'),
        borderStyle: String(data.borderStyle || object.borderStyle || ''),
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

async function pickDropdownOption(page, triggerName, optionName) {
  const trigger = page.getByRole('button', { name: triggerName, exact: true }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: optionName, exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(String(optionName), { exact: true }).click();
}

async function selectStroke(page, id, pageNumber = 1) {
  await page.keyboard.press('v');
  const target = page.locator(
    `[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"], [data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${id}"], [data-counter-overlay="${pageNumber}"] [data-anno-id="${id}"]`
  ).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + Math.min(8, box.width / 2), box.y + Math.max(2, box.height / 2));
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

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }, pageNumber = 1) {
  const before = new Set((await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle', pageNumber);
}

async function createLine(page, coords = { x0: 0.24, y0: 0.50, x1: 0.54, y1: 0.58 }, pageNumber = 1) {
  const before = new Set((await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => row.tool === 'line' || row.type === 'line', pageNumber);
}

async function createCallout(page, text, coords) {
  const before = await page.locator('[data-callout-id]').evaluateAll((els) => (
    els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
  ));
  await page.keyboard.press('q');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 10 });
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await page.locator('[data-callout-id]').evaluateAll((els) => (
      els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
    ));
    calloutId = ids.find((id) => !before.includes(id)) || null;
    return calloutId;
  }).not.toBeNull();
  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  return calloutId;
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

async function exportedAnnots(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(0);
  const annots = page.node.Annots();
  const rows = [];
  if (!annots) return { rows, pageHeight: page.getHeight() };
  for (const ref of annots.asArray()) {
    const dict = page.doc.context.lookup(ref);
    const subtype = String(dict.get(page.doc.context.obj('Subtype')) || '');
    const be = dict.get(page.doc.context.obj('BE'));
    rows.push({
      subtype,
      be: be ? String(be) : null,
      rect: pdfNums(dict.get(page.doc.context.obj('Rect'))),
      L: pdfNums(dict.get(page.doc.context.obj('L'))),
    });
  }
  return { rows, pageHeight: page.getHeight() };
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

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

async function clickZoomIn(page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((el) => (
      (el.getAttribute('aria-label') || el.textContent || '').trim() === 'Zoom in'
    ));
    btn?.click();
  });
}

async function duplicatePageOne(page) {
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const pageDivs = () => page.locator('.survey-pdfjs-page-div');
  const beforePages = await pageDivs().count();
  const thumb = page.locator('#chrome-left-host [data-page-number="1"], [data-sidebar-panel] [data-page-number="1"]').first();
  await expect(thumb).toBeVisible();
  await thumb.click({ button: 'right' });
  const dup = page.getByText('Duplicate', { exact: true });
  await expect(dup).toBeVisible({ timeout: 8_000 });
  await dup.click();
  await expect.poll(async () => pageDivs().count()).toBeGreaterThan(beforePages);
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]').first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
}

async function deleteAnnotation(page, id, pageNumber = 1) {
  await page.keyboard.press('v');
  await selectStroke(page, id, pageNumber);
  await page.keyboard.press('Delete');
  if (await annotationById(page, id, pageNumber)) await page.keyboard.press('Backspace');
  if (await annotationById(page, id, pageNumber)) {
    const pinBox = await page.locator(
      `[data-counter-overlay] [data-anno-id="${id}"], [data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"], [data-callout-id="${id}"]`
    ).first().boundingBox();
    if (pinBox) {
      await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2, { button: 'right' });
      const del = page.locator('[data-annotation-context-menu="true"]').getByText('Delete', { exact: true });
      if (await del.count()) await del.click();
      else await page.keyboard.press('Escape');
    }
  }
  await expect.poll(async () => Boolean(await annotationById(page, id, pageNumber))).toBeFalsy();
}

test('W8 grouped line + move + export: /L is world, not x1+left and not raw x1', async ({ page }) => {
  await openEditor(page);

  const line = await createLine(page, { x0: 0.20, y0: 0.28, x1: 0.46, y1: 0.40 });
  await selectStroke(page, line.id);
  const before = await annotationById(page, line.id);
  const lineEl = page.locator(`[data-svg-annotation-layer="1"] [data-anno-id="${line.id}"]`).first();
  const box = await lineEl.boundingBox();
  expect(box, 'line bbox').toBeTruthy();
  await page.mouse.move(box.x + 6, box.y + Math.max(2, box.height / 2));
  await page.mouse.down();
  await page.mouse.move(box.x + 48, box.y + 32, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => {
    const next = await annotationById(page, line.id);
    return next && (next.left !== before.left || next.top !== before.top
      || next.x1 !== before.x1 || next.y1 !== before.y1);
  }).toBeTruthy();

  const live = await page.evaluate(async (id) => {
    const { getLineEndpoints } = await import('/src/utils/svgBoundingBox.js');
    const obj = window.__phase35GetAnnotationById?.(id) || {};
    const world = getLineEndpoints(obj);
    return {
      world,
      raw: { x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2 },
      leftTop: { left: obj.left, top: obj.top, width: obj.width, height: obj.height },
      buggy: {
        x1: (Number(obj.x1) || 0) + (Number(obj.left) || 0),
        y1: (Number(obj.y1) || 0) + (Number(obj.top) || 0),
      },
    };
  }, line.id);

  const bytes = await exportAnnotatedPdf(page);
  const exported = await exportedAnnots(bytes);
  const lineAnnot = exported.rows.find((row) => /Line/i.test(row.subtype) && Array.isArray(row.L));
  expect(lineAnnot, 'export writes a Line').toBeTruthy();
  const [lx1, ly1] = lineAnnot.L;
  const worldPdfY = exported.pageHeight - live.world.y1;
  expect(Math.abs(lx1 - live.world.x1)).toBeLessThan(3);
  expect(Math.abs(ly1 - worldPdfY)).toBeLessThan(3);
  expect(Math.abs(lx1 - (Number(live.raw.x1) || 0))).toBeGreaterThan(8);
  expect(Math.abs(lx1 - live.buggy.x1)).toBeGreaterThan(4);

  const grouped = await page.evaluate(async () => {
    const { getLineEndpoints } = await import('/src/utils/svgBoundingBox.js');
    const { savePDFWithAnnotationsPdfLib } = await import('/src/utils/pdfAnnotationsPdfLib.js');
    const res = await fetch('/debug-fixtures/clickable-link-test.pdf');
    const buf = await res.arrayBuffer();
    const file = { name: 'wave8-group.pdf', arrayBuffer: async () => buf };
    const fabricLine = {
      type: 'line', left: 100, top: 100, width: 50, height: 40,
      x1: -25, y1: -20, x2: 25, y2: 20, stroke: '#cc0000', strokeWidth: 2,
    };
    const parent = { left: 40, top: 30 };
    const child = { ...fabricLine, left: fabricLine.left + parent.left, top: fabricLine.top + parent.top };
    const world = getLineEndpoints(child);
    const exportBytes = await savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects: [child] } },
      { 1: { width: 612, height: 792 } },
      null,
      { returnBytes: true, actionType: 'pdf-export' },
    );
    return { world, exportBytes: [...new Uint8Array(exportBytes)] };
  });
  const groupExport = await exportedAnnots(Uint8Array.from(grouped.exportBytes));
  const groupLine = groupExport.rows.find((row) => /Line/i.test(row.subtype));
  expect(groupLine?.L?.[0]).toBeCloseTo(grouped.world.x1, 0);
  expect(Math.abs((groupLine?.L?.[0] || 0) - (100 + 40 + -25))).toBeGreaterThan(8);

  const src = readFileSync(new URL('../../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');
  const create = src.slice(src.indexOf('const createLineAnnotation'), src.indexOf('const createFreeTextAnnotation'));
  expect(create).toMatch(/getLineEndpoints\(fabricObj\)/);
  expect(create).not.toMatch(/const x1 = fabricObj\.x1 \|\| 0/);
  const flattenLine = src.slice(src.indexOf('const drawFlattenedLine'));
  expect(flattenLine.slice(0, 900)).toMatch(/getLineEndpoints\(obj\)/);

  await assertNoErrorBoundary(page);
  console.log('W8_EXPORT_LINE', JSON.stringify({
    live,
    exportedL: lineAnnot.L,
    groupWorld: grouped.world,
    groupL: groupLine?.L,
  }));
});

test('W8 print flatten: grouped line no double-offset; cloud /BE vs plain; scaled size', async ({ page }) => {
  await openEditor(page);

  await activateTool(page, 'Shapes', 'Rectangle');
  await pickDropdownOption(page, 'Style', 'Cloud');
  const beforeCloud = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await dragOnPage(page, { x0: 0.18, y0: 0.18, x1: 0.40, y1: 0.34 });
  const cloud = await waitForNewUserAnnotation(page, beforeCloud, (row) => (
    row.type === 'rect' || row.type === 'rectangle' || row.borderStyle === 'cloud' || row.cloudIntensity || row.cloudBorder
  ));

  const plain = await createRect(page, { x0: 0.50, y0: 0.18, x1: 0.68, y1: 0.34 });
  await selectStroke(page, plain.id);
  const handle = page.locator('[data-resize-handle]').last();
  if (await handle.count()) {
    const hb = await handle.boundingBox();
    if (hb) {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + 56, hb.y + 40, { steps: 8 });
      await page.mouse.up();
    }
  }
  const afterScale = await annotationById(page, plain.id);

  const liveExport = await exportAnnotatedPdf(page);
  const squares = (await exportedAnnots(liveExport)).rows.filter((row) => /Square/i.test(row.subtype));
  const cloudSquare = squares.find((row) => /\/S\/C|\/C/.test(String(row.be || '')));
  const plainSquares = squares.filter((row) => !row.be);
  expect(cloudSquare, 'cloud Square still writes /BE after scale sibling').toBeTruthy();
  expect(plainSquares.length, 'plain Square omits /BE').toBeGreaterThan(0);
  const scaledW = Math.abs(Number(afterScale?.width) || 0) * Math.abs(Number(afterScale?.scaleX) || 1);
  expect(scaledW).toBeGreaterThan(0);

  const hunt = await page.evaluate(async () => {
    const { getLineEndpoints } = await import('/src/utils/svgBoundingBox.js');
    const {
      savePDFWithFlattenedRegularAnnotationsForPrint,
      savePDFWithAnnotationsPdfLib,
    } = await import('/src/utils/pdfAnnotationsPdfLib.js');

    const res = await fetch('/debug-fixtures/clickable-link-test.pdf');
    const buf = await res.arrayBuffer();
    const file = { name: 'wave8.pdf', arrayBuffer: async () => buf };
    const pageHeight = 792;

    const fabricLine = {
      type: 'line',
      left: 100,
      top: 100,
      width: 50,
      height: 40,
      x1: -25,
      y1: -20,
      x2: 25,
      y2: 20,
      stroke: '#cc0000',
      strokeWidth: 2,
    };
    const parent = { left: 40, top: 30 };
    const grouped = {
      type: 'group',
      left: parent.left,
      top: parent.top,
      objects: [fabricLine],
    };
    const childCorrect = {
      ...fabricLine,
      left: fabricLine.left + parent.left,
      top: fabricLine.top + parent.top,
    };
    const world = getLineEndpoints(childCorrect);
    const doubleOffset = getLineEndpoints({
      ...fabricLine,
      left: fabricLine.left + parent.left,
      top: fabricLine.top + parent.top,
      x1: fabricLine.x1 + parent.left,
      y1: fabricLine.y1 + parent.top,
      x2: fabricLine.x2 + parent.left,
      y2: fabricLine.y2 + parent.top,
    });
    const rawAfterParent = {
      x1: fabricLine.x1,
      y1: fabricLine.y1,
    };

    const flattenBytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
      file,
      { 1: { objects: [grouped] } },
      { 1: { width: 612, height: pageHeight } },
    );

    const scaledCloud = {
      type: 'rect',
      left: 40,
      top: 50,
      width: 60,
      height: 40,
      scaleX: 2,
      scaleY: 1.5,
      stroke: '#0066aa',
      strokeWidth: 2,
      fill: 'transparent',
      data: { pdfCloudIntensity: 2 },
    };
    const scaledPlain = {
      type: 'rect',
      left: 200,
      top: 50,
      width: 60,
      height: 40,
      scaleX: 2,
      scaleY: 1.5,
      stroke: '#111111',
      strokeWidth: 2,
      fill: 'transparent',
    };
    const printScaled = await savePDFWithFlattenedRegularAnnotationsForPrint(
      file,
      { 1: { objects: [scaledCloud, scaledPlain] } },
      { 1: { width: 612, height: pageHeight } },
    );

    const exportBytes = await savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects: [scaledCloud, scaledPlain, childCorrect] } },
      { 1: { width: 612, height: pageHeight } },
      null,
      { returnBytes: true, actionType: 'pdf-export' },
    );

    return {
      world,
      doubleOffset,
      rawAfterParent,
      flattenBytes: [...new Uint8Array(flattenBytes)],
      printScaledBytes: [...new Uint8Array(printScaled)],
      exportBytes: [...new Uint8Array(exportBytes)],
    };
  });

  const flattenPts = devicePathPoints(await pageContentText(Uint8Array.from(hunt.flattenBytes)));
  const linePts = flattenPts.filter((pt) => pt.op === 'm' || pt.op === 'l');
  expect(linePts.length, 'grouped line printed a path').toBeGreaterThanOrEqual(2);
  const start = linePts[0];
  const expectedY = 792 - hunt.world.y1;
  expect(Math.abs(start.x - hunt.world.x1)).toBeLessThan(3);
  expect(Math.abs(start.y - expectedY)).toBeLessThan(3);
  expect(Math.abs(start.x - hunt.doubleOffset.x1)).toBeGreaterThan(8);
  expect(Math.abs(start.x - hunt.rawAfterParent.x1)).toBeGreaterThan(8);

  const scaledPts = devicePathPoints(await pageContentText(Uint8Array.from(hunt.printScaledBytes)));
  const rects = scaledPts.filter((pt) => pt.op === 're' && Number.isFinite(pt.w));
  expect(rects.some((pt) => Math.abs(pt.w - 120) < 3 && Math.abs(pt.h - 60) < 3), 'plain scaled print is 120x60').toBeTruthy();
  expect(scaledPts.some((pt) => pt.op === 'c' || pt.op === 'm'), 'cloud flatten emits scallop path').toBeTruthy();

  const exported = await exportedAnnots(Uint8Array.from(hunt.exportBytes));
  const exportSquares = exported.rows.filter((row) => /Square/i.test(row.subtype));
  expect(exportSquares.some((row) => /\/S\/C|\/C/.test(String(row.be || '')))).toBeTruthy();
  expect(exportSquares.some((row) => !row.be)).toBeTruthy();
  const exportLine = exported.rows.find((row) => /Line/i.test(row.subtype));
  expect(exportLine?.L?.[0]).toBeCloseTo(hunt.world.x1, 0);

  await assertNoErrorBoundary(page);
  console.log('W8_PRINT_FLATTEN', JSON.stringify({
    world: hunt.world,
    doubleOffset: hunt.doubleOffset,
    start,
    squareBes: exportSquares.map((row) => row.be),
    scaledRect: rects.find((pt) => Math.abs(pt.w - 120) < 3) || null,
  }));
});

test('W8 callout Shift-union / Alt-subtract then undo; stale-id after delete is a no-op', async ({ page }) => {
  await openEditor(page);

  const callA = await createCallout(page, 'w8-a', { x0: 0.16, y0: 0.22, x1: 0.34, y1: 0.38 });
  const callB = await createCallout(page, 'w8-b', { x0: 0.42, y0: 0.22, x1: 0.60, y1: 0.38 });
  await page.keyboard.press('v');

  const aBox = await page.locator(`[data-callout-id="${callA}"]`).first().boundingBox();
  await page.mouse.click(aBox.x + 10, aBox.y + 10);
  const geom = await pageBox(page);
  await page.keyboard.down('Shift');
  await page.mouse.move(geom.x + geom.width * 0.12, geom.y + geom.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * 0.68, geom.y + geom.height * 0.46, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator(`[data-callout-id="${callA}"]`).first()).toBeVisible();
  await expect(page.locator(`[data-callout-id="${callB}"]`).first()).toBeVisible();

  await page.keyboard.down('Alt');
  await page.mouse.move(geom.x + geom.width * 0.12, geom.y + geom.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * 0.36, geom.y + geom.height * 0.46, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.locator(`[data-callout-id="${callA}"]`).first()).toBeVisible();
  await expect(page.locator(`[data-callout-id="${callB}"]`).first()).toBeVisible();

  await deleteAnnotation(page, callB, 1);
  await expect(page.locator(`[data-callout-id="${callB}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-callout-id="${callA}"]`).first()).toBeVisible();

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => (
    await page.locator(`[data-callout-id="${callB}"]`).count()
  )).toBeGreaterThan(0);
  await expect(page.locator(`[data-callout-id="${callA}"]`).first()).toBeVisible();

  await deleteAnnotation(page, callB, 1);
  await expect(page.locator(`[data-callout-id="${callB}"]`)).toHaveCount(0);

  const stale = await page.evaluate(async ({ goneId, keepId }) => {
    const { resolveAnnotationIndexById } = await import('/src/hooks/useSVGInteraction.js');
    const objects = [{ id: keepId }, { id: 'other' }];
    const goneBox = document.querySelector(`[data-callout-id="${goneId}"]`);
    return {
      staleGone: resolveAnnotationIndexById(objects, goneId, 0),
      keep: resolveAnnotationIndexById(objects, keepId, 1),
      goneDom: Boolean(goneBox),
      selected: window.__selectedAnnotationIds || [],
    };
  }, { goneId: callB, keepId: callA });
  expect(stale.staleGone).toBe(-1);
  expect(stale.keep).toBe(0);
  expect(stale.goneDom).toBe(false);

  const ghost = await page.locator(`[data-callout-id="${callB}"]`).boundingBox().catch(() => null);
  if (ghost) {
    await page.mouse.click(ghost.x + 8, ghost.y + 8);
  } else {
    await page.mouse.click(geom.x + geom.width * 0.50, geom.y + geom.height * 0.30);
  }
  await expect(page.locator(`[data-callout-id="${callA}"]`).first()).toBeVisible();
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);

  await deleteAnnotation(page, callA, 1);
  const afterDelete = await page.evaluate(async (goneId) => {
    const { resolveAnnotationIndexById, remapSelectionByStableIds } = await import('/src/hooks/useSVGInteraction.js');
    const objects = [{ id: 'keep' }];
    return {
      stale: resolveAnnotationIndexById(objects, goneId, 0),
      remapped: remapSelectionByStableIds([goneId], objects).size,
      selected: window.__selectedAnnotationIds || [],
    };
  }, callA);
  expect(afterDelete.stale).toBe(-1);
  expect(afterDelete.remapped).toBe(0);
  expect(afterDelete.selected.includes(callA)).toBeFalsy();

  await assertNoErrorBoundary(page);
  console.log('W8_CALLOUT_UNDO_STALE', JSON.stringify({ callA, callB, stale, afterDelete }));
});

test('W8 counter renumber after delete + page move; empty page bucket stays ===', async ({ page }) => {
  await openEditor(page);
  await duplicatePageOne(page);

  await activateTool(page, 'Shapes', 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
  const before1 = new Set((await userAnnotationSnapshot(page, 1)).map((row) => row.id));
  await dropCounterPin(page, { pageNumber: 1, xf: 0.34, yf: 0.32 });
  const pin1 = await waitForNewUserAnnotation(page, before1, isCounterRow, 1);
  const before2 = new Set((await userAnnotationSnapshot(page, 1)).map((row) => row.id));
  await dropCounterPin(page, { pageNumber: 1, xf: 0.50, yf: 0.32 });
  const pin2 = await waitForNewUserAnnotation(page, before2, (row) => isCounterRow(row) && row.id !== pin1.id, 1);
  const before3 = new Set((await userAnnotationSnapshot(page, 1)).map((row) => row.id));
  await dropCounterPin(page, { pageNumber: 1, xf: 0.66, yf: 0.32 });
  const pin3 = await waitForNewUserAnnotation(page, before3, (row) => (
    isCounterRow(row) && row.id !== pin1.id && row.id !== pin2.id
  ), 1);

  const counterNums = async (ids) => page.evaluate((annoIds) => annoIds.map((id) => {
    const object = window.__phase35GetAnnotationById?.(id) || {};
    const data = object.data || {};
    const fromData = data.displayNumber ?? data.value ?? data.number;
    const el = document.querySelector(
      `[data-counter-overlay] [data-anno-id="${id}"] text, [data-svg-annotation-layer] [data-anno-id="${id}"] text`
    );
    const fromDom = el ? Number.parseInt((el.textContent || '').trim(), 10) : NaN;
    return Number.isFinite(Number(fromData)) && Number(fromData) > 0
      ? Number(fromData)
      : (Number.isFinite(fromDom) ? fromDom : null);
  }), ids);

  await expect.poll(async () => counterNums([pin1.id, pin2.id, pin3.id])).toEqual([1, 2, 3]);
  await deleteAnnotation(page, pin1.id, 1);
  await expect.poll(async () => counterNums([pin2.id, pin3.id])).toEqual([1, 2]);

  const thumb1 = page.locator('#chrome-left-host [data-page-number="1"], [data-sidebar-panel] [data-page-number="1"]').first();
  const thumb2 = page.locator('#chrome-left-host [data-page-number="2"], [data-sidebar-panel] [data-page-number="2"]').first();
  await expect(thumb1).toBeVisible();
  await expect(thumb2).toBeVisible();
  await thumb1.click({ button: 'right' });
  const cut = page.getByText('Cut', { exact: true });
  await expect(cut).toBeVisible({ timeout: 8_000 });
  await cut.click();
  await thumb2.click({ button: 'right' });
  const paste = page.getByText('Paste', { exact: true });
  await expect(paste).toBeVisible({ timeout: 8_000 });
  await paste.click();
  await expect.poll(async () => {
    const nums = await counterNums([pin2.id, pin3.id]);
    return nums.filter((n) => n != null).length;
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(async () => counterNums([pin2.id, pin3.id])).toEqual([1, 2]);

  const afterMove = await counterNums([pin2.id, pin3.id]);
  expect(afterMove).toEqual([1, 2]);
  expect(await annotationById(page, pin1.id, 1)).toBeFalsy();
  expect(await annotationById(page, pin1.id, 2)).toBeFalsy();

  const helper = await page.evaluate(async () => {
    const { renumberCounters } = await import('/src/utils/counterNumbering.js');
    const { transformPageState } = await import('/src/utils/pageAnnotationReindex.js');
    const empty = { version: '5.3.0', objects: [] };
    const inkOnly = { version: '5.3.0', objects: [{ type: 'path', data: { id: 'ink' } }] };
    const counters = {
      version: '5.3.0',
      objects: [
        { type: 'group', data: { id: 'c2', type: 'counter', seriesId: 's', seriesStart: 1, createdAt: 2, displayNumber: 2 } },
        { type: 'group', data: { id: 'c3', type: 'counter', seriesId: 's', seriesStart: 1, createdAt: 3, displayNumber: 3 } },
      ],
    };
    const beforeMove = { 1: empty, 2: counters, 3: inkOnly };
    const moved = transformPageState({
      annotationsByPage: beforeMove,
      callouts: [],
      bookmarks: [],
      pageNames: {},
      pageTransformations: {},
    }, { type: 'move', from: 2, to: 1 });
    const remapped = moved?.annotationsByPage || {};
    const result = renumberCounters({ 1: remapped[1] || counters, 2: remapped[2] || empty, 3: inkOnly });
    const byPage = { 1: empty, 2: counters, 3: inkOnly };
    const numbered = renumberCounters(byPage);
    return {
      emptySame: numbered[1] === empty,
      inkSame: numbered[3] === inkOnly,
      countersReplaced: numbered[2] !== counters,
      numbers: numbered[2].objects.map((obj) => obj.data.displayNumber),
      originalUntouched: counters.objects[0].data.displayNumber,
      hostileNull: renumberCounters(null) === null,
      hostileEmpty: Object.keys(renumberCounters({})).length === 0,
      movedKeys: Object.keys(remapped).sort(),
      movedHasCounters: Object.values(remapped).some((page) => (
        (page?.objects || []).some((obj) => obj?.data?.type === 'counter')
      )),
    };
  });
  expect(helper.emptySame).toBe(true);
  expect(helper.inkSame).toBe(true);
  expect(helper.countersReplaced).toBe(true);
  expect(helper.numbers).toEqual([1, 2]);
  expect(helper.originalUntouched).toBe(2);
  expect(helper.hostileNull).toBe(true);
  expect(helper.hostileEmpty).toBe(true);
  expect(helper.movedHasCounters).toBe(true);
  expect(helper.movedKeys.length).toBeGreaterThan(0);

  await assertNoErrorBoundary(page);
  console.log('W8_COUNTER_PAGE_MOVE', JSON.stringify({ afterMove, helper, pin2: pin2.id, pin3: pin3.id }));
});

test('W8 zoomGeneration mid-callout keeps tracking; mid-export does not crash', async ({ page }) => {
  await openEditor(page);

  await page.keyboard.press('q');
  const beforeIds = await page.locator('[data-callout-id]').evaluateAll((els) => (
    els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
  ));
  const box = await pageBox(page);
  const start = { x: box.x + box.width * 0.22, y: box.y + box.height * 0.30 };
  const mid = { x: box.x + box.width * 0.40, y: box.y + box.height * 0.44 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 8 });
  await clickZoomIn(page);
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.50, { steps: 6 });
  await page.mouse.up();

  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  const editorVisible = await editor.isVisible().catch(() => false);
  if (editorVisible) {
    await editor.click();
    await editor.pressSequentially('w8-zoom', { delay: 8 });
    await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  }
  await expect.poll(async () => {
    const ids = await page.locator('[data-callout-id]').evaluateAll((els) => (
      els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
    ));
    return ids.find((id) => !beforeIds.includes(id)) || editorVisible;
  }).toBeTruthy();

  const line = await createLine(page, { x0: 0.58, y0: 0.28, x1: 0.78, y1: 0.40 });
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
  await exportBtn.click();
  await clickZoomIn(page);
  const download = await downloadPromise;
  const path = await download.path();
  expect(path, 'export finished through mid-zoom').toBeTruthy();
  expect(await annotationById(page, line.id)).toBeTruthy();

  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  expect(await annotationById(page, line.id)).toBeTruthy();
  await assertNoErrorBoundary(page);
  console.log('W8_ZOOM_MID', JSON.stringify({ lineId: line.id, exportOk: true }));
});
