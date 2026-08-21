import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const TOL = 1.5;

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
        left: object.left ?? 0,
        top: object.top ?? 0,
        scaleX: object.scaleX ?? 1,
        scaleY: object.scaleY ?? 1,
        angle: object.angle ?? 0,
        pathOffset: object.pathOffset || null,
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
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  return { start, end, box };
}

async function createPen(page, coords = { x0: 0.24, y0: 0.30, x1: 0.52, y1: 0.38 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Draw', 'Pen');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'path' || row.tool === 'pen'
  ));
}

async function liveInkObject(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId);
    if (!object) return null;
    return JSON.parse(JSON.stringify({
      type: object.type || 'path',
      tool: object.tool || object.data?.tool || 'pen',
      left: object.left ?? 0,
      top: object.top ?? 0,
      width: object.width,
      height: object.height,
      scaleX: object.scaleX ?? 1,
      scaleY: object.scaleY ?? 1,
      angle: object.angle ?? 0,
      path: object.path,
      pathOffset: object.pathOffset,
      stroke: object.stroke || '#ff0000',
      strokeWidth: object.strokeWidth ?? 2,
      originX: object.originX,
      originY: object.originY,
      inkGeometryOrigin: object.inkGeometryOrigin,
      inkGeometrySpace: object.inkGeometrySpace,
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

async function moveSelected(page, id, dx, dy, pageNumber = 1) {
  const target = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"]`).first();
  const box = await target.boundingBox();
  expect(box, `move bbox for ${id}`).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

async function typeRotationPill(page, degrees) {
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.waitForTimeout(220);
  const angleInput = page.getByLabel('Rotation angle in degrees');
  await expect(angleInput).toBeVisible({ timeout: 8_000 });
  await angleInput.click();
  await angleInput.fill(String(degrees));
  await angleInput.press('Enter');
}

function firstPathPoint(path) {
  if (!Array.isArray(path)) return null;
  for (const command of path) {
    if (!Array.isArray(command) || command.length < 3) continue;
    const x = Number(command[1]);
    const y = Number(command[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return null;
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
  const widths = [];
  const pushPoints = (op, count) => {
    for (let i = count * 2; i > 0; i -= 2) {
      points.push({ ...apply(ctm, nums[nums.length - i], nums[nums.length - i + 1]), op });
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
    else if (tok === 'w' && nums.length) widths.push(nums[nums.length - 1]);
    nums.length = 0;
  }
  return { points, widths };
}

async function pageContentText(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return {
    text: streams
      .filter((stream) => stream instanceof PDFRawStream)
      .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
      .join('\n'),
    pageHeight: page.getHeight(),
    pageWidth: page.getWidth(),
  };
}

async function flattenInk(page, fabricObj, pageSize) {
  return page.evaluate(async ({ obj, sizes }) => {
    const {
      savePDFWithFlattenedRegularAnnotationsForPrint,
      createInkPageTransform,
    } = await import('/src/utils/pdfAnnotationsPdfLib.js');
    const { createInkPathAffine } = await import('/src/utils/inkGeometryTransform.js');
    const res = await fetch('/debug-fixtures/clickable-link-test.pdf');
    const buf = await res.arrayBuffer();
    const file = { name: 'ink-flatten.pdf', arrayBuffer: async () => buf };
    const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
      file,
      { 1: { objects: [obj] } },
      { 1: sizes },
    );
    const first = (obj.path || []).find((cmd) => Array.isArray(cmd) && cmd.length >= 3);
    const affine = createInkPathAffine(obj, obj.path);
    const transform = createInkPageTransform(obj, obj.path);
    const pagePt = affine.point(first[1], first[2]);
    return {
      bytes: [...new Uint8Array(bytes)],
      expected: { x: pagePt.x, y: sizes.height - pagePt.y },
      raw: { x: first[1], y: sizes.height - first[2] },
      strokeScale: Number(transform.strokeScale ?? affine.strokeScale ?? 1),
      strokeWidth: Number(obj.strokeWidth) || 1,
      left: obj.left,
      top: obj.top,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      angle: obj.angle,
      pathOffset: obj.pathOffset || null,
    };
  }, { obj: fabricObj, sizes: pageSize });
}

async function fixturePageSize() {
  const bytes = readFileSync(new URL('../../debug/fixtures/clickable-link-test.pdf', import.meta.url));
  const doc = await PDFDocument.load(bytes);
  const p = doc.getPage(0);
  return { width: p.getWidth(), height: p.getHeight() };
}

function firstMove(points) {
  const hit = points.find((pt) => pt.op === 'm' || pt.op === 'l');
  expect(hit, 'flattened content has a path move/line').toBeTruthy();
  return hit;
}

function near(actual, expected, label, tol = TOL) {
  expect(
    Math.abs(actual.x - expected.x) < tol && Math.abs(actual.y - expected.y) < tol,
    `${label}: expected (~${expected.x.toFixed(2)}, ~${expected.y.toFixed(2)}), got (${actual.x.toFixed(2)}, ${actual.y.toFixed(2)})`,
  ).toBeTruthy();
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

test('intended: draw ink, move/scale/rotate, print flatten follows transform', async ({ page }) => {
  await openEditor(page);
  const sizes = await fixturePageSize();
  const pen = await createPen(page, { x0: 0.20, y0: 0.24, x1: 0.44, y1: 0.36 });
  const fresh = await liveInkObject(page, pen.id);
  expect(Array.isArray(fresh?.path) && fresh.path.length > 0, 'drawn ink has a path').toBeTruthy();
  const freshStart = firstPathPoint(fresh.path);
  expect(freshStart, 'drawn ink has a start point').toBeTruthy();

  await selectStroke(page, pen.id);
  await moveSelected(page, pen.id, 48, 28);
  await expect.poll(async () => {
    const next = await liveInkObject(page, pen.id);
    return next && (
      Math.abs((Number(next.left) || 0) - (Number(fresh.left) || 0)) > 4
      || Math.abs((Number(next.top) || 0) - (Number(fresh.top) || 0)) > 4
      || Boolean(next.pathOffset)
    );
  }).toBeTruthy();
  const moved = await liveInkObject(page, pen.id);

  await selectStroke(page, pen.id);
  await resizeHandle(page, 'br', 72, 48);
  await expect.poll(async () => {
    const next = await liveInkObject(page, pen.id);
    return next && (
      Math.abs(Number(next.scaleX) || 1) > 1.08
      || Math.abs(Number(next.scaleY) || 1) > 1.08
    );
  }).toBeTruthy();
  const scaled = await liveInkObject(page, pen.id);

  await selectStroke(page, pen.id);
  await typeRotationPill(page, 90);
  await expect.poll(async () => {
    const next = await liveInkObject(page, pen.id);
    const angle = ((Number(next?.angle) || 0) % 360 + 360) % 360;
    return Math.min(Math.abs(angle - 90), Math.abs(angle - 270)) < 12;
  }).toBeTruthy();
  const transformed = await liveInkObject(page, pen.id);

  const hunt = await flattenInk(page, transformed, sizes);
  const { text } = await pageContentText(Uint8Array.from(hunt.bytes));
  const { points } = devicePathPoints(text);
  const start = firstMove(points);
  near(start, hunt.expected, 'transformed flatten start');
  expect(
    Math.abs(start.x - hunt.raw.x) > 5 || Math.abs(start.y - hunt.raw.y) > 5,
    `transformed start must not stay at raw (${hunt.raw.x}, ${hunt.raw.y}); got (${start.x}, ${start.y})`,
  ).toBeTruthy();

  await assertNoErrorBoundary(page);
  console.log('E2E_INK_FLATTEN_INTENDED', JSON.stringify({
    fresh: { left: fresh.left, top: fresh.top, pathOffset: fresh.pathOffset, start: freshStart },
    moved: { left: moved.left, top: moved.top, pathOffset: moved.pathOffset },
    scaled: { scaleX: scaled.scaleX, scaleY: scaled.scaleY },
    transformed: {
      left: transformed.left,
      top: transformed.top,
      scaleX: transformed.scaleX,
      scaleY: transformed.scaleY,
      angle: transformed.angle,
      pathOffset: transformed.pathOffset,
    },
    start,
    expected: hunt.expected,
    raw: hunt.raw,
  }));
});

test('break: fresh unmoved ink (left=0, no pathOffset) still identity', async ({ page }) => {
  await openEditor(page);
  const sizes = await fixturePageSize();
  const pen = await createPen(page, { x0: 0.18, y0: 0.42, x1: 0.40, y1: 0.50 });
  const live = await liveInkObject(page, pen.id);
  expect(Array.isArray(live?.path) && live.path.length > 0, 'drawn ink has a path').toBeTruthy();
  const startPt = firstPathPoint(live.path);
  expect(startPt, 'drawn ink has a start point').toBeTruthy();

  const identityObj = {
    type: 'path',
    tool: 'pen',
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    stroke: live.stroke || '#ff0000',
    strokeWidth: live.strokeWidth || 2,
    path: live.path,
  };
  const hunt = await flattenInk(page, identityObj, sizes);
  const { text } = await pageContentText(Uint8Array.from(hunt.bytes));
  const { points } = devicePathPoints(text);
  const start = firstMove(points);
  near(start, hunt.raw, 'identity flatten start');
  near(start, hunt.expected, 'identity affine start');
  expect(Math.abs(Number(identityObj.left) || 0)).toBe(0);
  expect(identityObj.pathOffset).toBeUndefined();

  const liveHunt = await flattenInk(page, live, sizes);
  const liveText = await pageContentText(Uint8Array.from(liveHunt.bytes));
  const liveStart = firstMove(devicePathPoints(liveText.text).points);
  near(liveStart, liveHunt.expected, 'live unmoved flatten matches affine');

  await assertNoErrorBoundary(page);
  console.log('E2E_INK_FLATTEN_BREAK', JSON.stringify({
    live: {
      left: live.left,
      top: live.top,
      pathOffset: live.pathOffset,
      scaleX: live.scaleX,
      scaleY: live.scaleY,
      angle: live.angle,
      start: startPt,
    },
    identityStart: start,
    liveStart,
    raw: hunt.raw,
  }));
});

test('edge: scale + rotate together; stroke scale', async ({ page }) => {
  await openEditor(page);
  const sizes = await fixturePageSize();
  const pen = await createPen(page, { x0: 0.28, y0: 0.22, x1: 0.50, y1: 0.34 });
  const fresh = await liveInkObject(page, pen.id);
  expect(Array.isArray(fresh?.path) && fresh.path.length > 0, 'drawn ink has a path').toBeTruthy();

  await selectStroke(page, pen.id);
  await resizeHandle(page, 'br', 80, 40);
  await expect.poll(async () => {
    const next = await liveInkObject(page, pen.id);
    return next && (
      Math.abs(Number(next.scaleX) || 1) > 1.08
      || Math.abs(Number(next.scaleY) || 1) > 1.08
    );
  }).toBeTruthy();

  await selectStroke(page, pen.id);
  await typeRotationPill(page, 45);
  await expect.poll(async () => {
    const next = await liveInkObject(page, pen.id);
    const angle = ((Number(next?.angle) || 0) % 360 + 360) % 360;
    return Math.min(Math.abs(angle - 45), Math.abs(angle - 315)) < 12;
  }).toBeTruthy();
  const transformed = await liveInkObject(page, pen.id);
  expect(Math.abs(Number(transformed.scaleX) || 1) > 1.05
    || Math.abs(Number(transformed.scaleY) || 1) > 1.05).toBeTruthy();
  expect(Math.abs(Number(transformed.angle) || 0)).toBeGreaterThan(8);

  const hunt = await flattenInk(page, transformed, sizes);
  const { text } = await pageContentText(Uint8Array.from(hunt.bytes));
  const { points, widths } = devicePathPoints(text);
  const start = firstMove(points);
  near(start, hunt.expected, 'scale+rotate flatten start');
  expect(
    Math.abs(start.x - hunt.raw.x) > 4 || Math.abs(start.y - hunt.raw.y) > 4,
    `scale+rotate start must not stay at raw (${hunt.raw.x}, ${hunt.raw.y}); got (${start.x}, ${start.y})`,
  ).toBeTruthy();

  const expectedWidth = Math.max(0.5, hunt.strokeWidth * hunt.strokeScale);
  const printedWidth = widths.find((width) => Math.abs(width - expectedWidth) < 0.4)
    ?? widths.at(-1);
  expect(printedWidth, 'flatten wrote a stroke width').toBeTruthy();
  expect(Math.abs(printedWidth - expectedWidth)).toBeLessThan(0.4);
  if (Math.abs(hunt.strokeScale - 1) > 0.08) {
    expect(Math.abs(printedWidth - hunt.strokeWidth)).toBeGreaterThan(0.15);
  }

  await assertNoErrorBoundary(page);
  console.log('E2E_INK_FLATTEN_EDGE', JSON.stringify({
    transformed: {
      left: transformed.left,
      top: transformed.top,
      scaleX: transformed.scaleX,
      scaleY: transformed.scaleY,
      angle: transformed.angle,
      pathOffset: transformed.pathOffset,
      strokeWidth: transformed.strokeWidth,
    },
    start,
    expected: hunt.expected,
    raw: hunt.raw,
    strokeScale: hunt.strokeScale,
    printedWidth,
    expectedWidth,
  }));
});
