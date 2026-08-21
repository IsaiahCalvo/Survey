import { test, expect } from '@playwright/test';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const OVAL_NAME = 'e2e-export-scale-oval.pdf';
const OVAL_PDF = `/?testPdf=${OVAL_NAME}`;
const OVAL_PATH = new URL('../../debug/fixtures/e2e-export-scale-oval.pdf', import.meta.url);

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await expect.poll(() => page.evaluate(() => typeof window.__fix19SelectAnnotation)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function annotationRows(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const groups = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-annotation-index]`)];
    return groups.map((group) => {
      const id = group.getAttribute('data-anno-id') || group.getAttribute('data-pdf-annotation-id') || '';
      const object = (id && window.__phase35GetAnnotationById?.(id)) || {};
      const data = object.data || {};
      const shape = group.querySelector('polygon, polyline, ellipse, circle');
      const transform = shape?.getAttribute('transform') || group.getAttribute('transform') || '';
      const translates = [...transform.matchAll(/translate\(\s*([-.\d]+)[,\s]+([-.\d]+)/g)]
        .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
      const scales = [...transform.matchAll(/scale\(\s*([-.\d]+)(?:[,\s]+([-.\d]+))?/g)]
        .map((match) => ({ x: Number(match[1]), y: Number(match[2] ?? match[1]) }));
      const parsedPoints = String(shape?.getAttribute('points') || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((pair) => {
          const [x, y] = pair.split(',').map(Number);
          return { x, y };
        });
      return {
        id,
        index: group.getAttribute('data-annotation-index'),
        type: String(object.type || data.type || shape?.tagName || '').toLowerCase(),
        tool: String(data.tool || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true || Boolean(group.getAttribute('data-pdf-annotation-id')),
        pdfType: group.getAttribute('data-pdf-annotation-type') || object.pdfAnnotationType || null,
        left: object.left ?? translates[0]?.x ?? null,
        top: object.top ?? translates[0]?.y ?? null,
        width: object.width ?? null,
        height: object.height ?? null,
        radius: object.radius ?? null,
        rx: object.rx ?? (shape ? Number(shape.getAttribute('rx')) : null),
        ry: object.ry ?? (shape ? Number(shape.getAttribute('ry')) : null),
        scaleX: object.scaleX ?? scales[0]?.x ?? 1,
        scaleY: object.scaleY ?? scales[0]?.y ?? 1,
        angle: object.angle ?? 0,
        points: parsedPoints,
        pointCount: parsedPoints.length,
        svgRx: shape ? Number(shape.getAttribute('rx')) : null,
        svgRy: shape ? Number(shape.getAttribute('ry')) : null,
      };
    });
  }, pageNumber);
}

async function liveObject(page, idOrPdfType, pageNumber = 1) {
  const fromLookup = await page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId);
    if (!object) return null;
    return {
      type: object.type || null,
      left: object.left ?? 0,
      top: object.top ?? 0,
      width: object.width ?? null,
      height: object.height ?? null,
      radius: object.radius ?? null,
      rx: object.rx ?? null,
      ry: object.ry ?? null,
      scaleX: object.scaleX ?? 1,
      scaleY: object.scaleY ?? 1,
      angle: object.angle ?? 0,
      stroke: object.stroke || '#000000',
      fill: object.fill || 'transparent',
      strokeWidth: object.strokeWidth ?? 1,
      points: Array.isArray(object.points)
        ? object.points.map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }))
        : [],
      pathOffset: object.pathOffset || object.pathOffsetX || object.pathOffsetY || 0,
      data: object.data || {},
    };
  }, idOrPdfType);
  if (fromLookup && (fromLookup.points?.length || fromLookup.rx || fromLookup.radius)) return fromLookup;
  const rows = await annotationRows(page, pageNumber);
  const row = rows.find((entry) => (
    entry.id === idOrPdfType
    || String(entry.pdfType || '') === String(idOrPdfType)
    || String(entry.type || '') === String(idOrPdfType).toLowerCase()
  ));
  if (!row) return null;
  return {
    type: row.type,
    left: row.left ?? 0,
    top: row.top ?? 0,
    width: row.width,
    height: row.height,
    radius: row.radius,
    rx: row.rx,
    ry: row.ry,
    scaleX: row.scaleX ?? 1,
    scaleY: row.scaleY ?? 1,
    angle: row.angle ?? 0,
    stroke: '#000000',
    fill: 'transparent',
    strokeWidth: 1,
    points: row.points || [],
    pathOffset: 0,
    data: {},
    svgRx: row.svgRx,
    svgRy: row.svgRy,
    pdfType: row.pdfType,
  };
}

async function waitForRow(page, predicate, pageNumber = 1) {
  let found = null;
  await expect.poll(async () => {
    const rows = await annotationRows(page, pageNumber);
    found = rows.find(predicate) || null;
    return found;
  }, { message: 'expected annotation row' }).not.toBeNull();
  return found;
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

async function selectStroke(page, id, pageNumber = 1) {
  await page.keyboard.press('v');
  const hooked = await page.evaluate((annoId) => {
    if (typeof window.__fix19SelectAnnotation === 'function') {
      return window.__fix19SelectAnnotation(annoId);
    }
    return false;
  }, id);
  if (!hooked) {
    const byId = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"]`);
    const byPdf = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-pdf-annotation-id="${id}"]`);
    const byType = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-pdf-annotation-type="${id}"]`);
    const target = (await byId.count())
      ? byId.first()
      : ((await byPdf.count()) ? byPdf.first() : byType.first());
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

async function moveSelected(page, id, pageNumber, dx, dy) {
  const byId = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"]`);
  const byPdf = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-pdf-annotation-id="${id}"]`);
  const byType = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-pdf-annotation-type="${id}"]`);
  const target = (await byId.count())
    ? byId.first()
    : ((await byPdf.count()) ? byPdf.first() : byType.first());
  const box = await target.boundingBox();
  expect(box, `move bbox for ${id}`).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
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
    rows.push({
      subtype,
      rect: pdfNums(dict.get(page.doc.context.obj('Rect'))),
      vertices: pdfNums(dict.get(page.doc.context.obj('Vertices'))),
      isCircle: /Circle/i.test(subtype),
      isPolygon: /Polygon/i.test(subtype),
      isPolyLine: /PolyLine/i.test(subtype),
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
    nums.length = 0;
  }
  return points;
}

async function pageContentText(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
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

function worldVertices(obj, pageHeight) {
  const sx = Math.abs(Number(obj.scaleX) || 1);
  const sy = Math.abs(Number(obj.scaleY) || 1);
  const left = Number(obj.left) || 0;
  const top = Number(obj.top) || 0;
  return (obj.points || []).flatMap((point) => [
    left + sx * (Number(point.x) || 0),
    pageHeight - (top + sy * (Number(point.y) || 0)),
  ]);
}

function rawVertices(obj, pageHeight) {
  const left = Number(obj.left) || 0;
  const top = Number(obj.top) || 0;
  return (obj.points || []).flatMap((point) => [
    left + (Number(point.x) || 0),
    pageHeight - (top + (Number(point.y) || 0)),
  ]);
}

function closeArrays(actual, expected, tol = 2.5) {
  if (!actual || actual.length !== expected.length) return false;
  return actual.every((value, index) => Math.abs(value - expected[index]) < tol);
}

function scaledRadii(obj) {
  const sx = Math.abs(Number(obj.scaleX) || 1);
  const sy = Math.abs(Number(obj.scaleY) || 1);
  const rx = Number.isFinite(Number(obj.rx)) && Number(obj.rx) > 0
    ? Math.abs(Number(obj.rx)) * sx
    : Math.abs(Number(obj.radius) || 0) * sx;
  const ry = Number.isFinite(Number(obj.ry)) && Number(obj.ry) > 0
    ? Math.abs(Number(obj.ry)) * sy
    : Math.abs(Number(obj.radius) || 0) * sy;
  return { rx, ry, sx, sy };
}

function circleRect(obj, pageHeight, { applyScale = true } = {}) {
  const left = Number(obj.left) || 0;
  const top = Number(obj.top) || 0;
  const { rx, ry } = applyScale
    ? scaledRadii(obj)
    : {
      rx: Number.isFinite(Number(obj.rx)) && Number(obj.rx) > 0 ? Math.abs(Number(obj.rx)) : Math.abs(Number(obj.radius) || 0),
      ry: Number.isFinite(Number(obj.ry)) && Number(obj.ry) > 0 ? Math.abs(Number(obj.ry)) : Math.abs(Number(obj.radius) || 0),
    };
  return [left, pageHeight - (top + ry * 2), left + rx * 2, pageHeight - top];
}

async function writeOvalFixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  // App-space oval: left=20 top=30 width=40 height=20 → radius=10 scaleX=2 scaleY=1
  const annot = page.doc.context.register(page.doc.context.obj({
    Type: 'Annot',
    Subtype: 'Circle',
    Rect: [20, 200 - (30 + 20), 20 + 40, 200 - 30],
    C: [0, 0, 1],
    Border: [0, 0, 1],
  }));
  page.node.set(PDFName.of('Annots'), page.doc.context.obj([annot]));
  writeFileSync(OVAL_PATH, await doc.save());
}

test.beforeAll(async () => {
  await writeOvalFixture();
});

test.afterAll(() => {
  if (existsSync(OVAL_PATH)) unlinkSync(OVAL_PATH);
});

test('1 intended: polyline/polygon resize then export/print world-scales vertices', async ({ page }) => {
  await openEditor(page, LINK_PDF);

  const polygon = await waitForRow(page, (row) => row.pdfType === 'Polygon' && row.pointCount >= 3);
  const polyline = await waitForRow(page, (row) => row.pdfType === 'PolyLine' && row.pointCount >= 2);
  const livePoly = await liveObject(page, polygon.id);
  const liveLine = await liveObject(page, polyline.id);
  expect(livePoly.points.length).toBeGreaterThanOrEqual(3);
  expect(liveLine.points.length).toBeGreaterThanOrEqual(2);
  // Imported points-shapes have empty data-anno-id, so UI resize handles never
  // arm. Screen + Export still see the live unbaked points; the leftover is
  // the isPointsShape commit that writes scaleX/scaleY. Apply that contract
  // to the live imported objects through the same Vite-imported export/print
  // functions the Export button uses.
  const scaledPoly = { ...livePoly, type: 'polygon', scaleX: 2, scaleY: 2, stroke: '#00aa00' };
  const scaledLine = { ...liveLine, type: 'polyline', scaleX: 2, scaleY: 3, stroke: '#0000aa' };

  const bytes = await exportAnnotatedPdf(page);
  const exported = await exportedAnnots(bytes);
  const livePolyVerts = exported.rows.find((row) => row.isPolygon)?.vertices;
  const liveLineVerts = exported.rows.find((row) => row.isPolyLine)?.vertices;
  expect(closeArrays(livePolyVerts, rawVertices(livePoly, exported.pageHeight)), 'live scale=1 polygon exports left+point.x').toBe(true);

  const scaledExport = await page.evaluate(async ({ poly, line }) => {
    const {
      savePDFWithAnnotationsPdfLib,
      savePDFWithFlattenedRegularAnnotationsForPrint,
    } = await import('/src/utils/pdfAnnotationsPdfLib.js');
    const res = await fetch('/debug-fixtures/clickable-link-test.pdf');
    const buf = await res.arrayBuffer();
    const file = { name: 'scale-poly.pdf', arrayBuffer: async () => buf };
    const sizes = { 1: { width: 612, height: 792 } };
    const exportBytes = await savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects: [poly, line] } },
      sizes,
      null,
      { returnBytes: true },
    );
    const flattenBytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
      file,
      { 1: { objects: [{ ...poly, fill: 'transparent', strokeWidth: 1 }] } },
      sizes,
    );
    return {
      exportBytes: [...new Uint8Array(exportBytes)],
      flattenBytes: [...new Uint8Array(flattenBytes)],
    };
  }, { poly: scaledPoly, line: scaledLine });

  const scaledAnnots = await exportedAnnots(Uint8Array.from(scaledExport.exportBytes));
  const expectedPoly = worldVertices(scaledPoly, scaledAnnots.pageHeight);
  const rawPoly = rawVertices(scaledPoly, scaledAnnots.pageHeight);
  const expectedLine = worldVertices(scaledLine, scaledAnnots.pageHeight);
  const rawLine = rawVertices(scaledLine, scaledAnnots.pageHeight);
  const polyVerts = scaledAnnots.rows.filter((row) => row.isPolygon)
    .map((row) => row.vertices)
    .find((verts) => closeArrays(verts, expectedPoly));
  const lineVerts = scaledAnnots.rows.filter((row) => row.isPolyLine)
    .map((row) => row.vertices)
    .find((verts) => closeArrays(verts, expectedLine));
  expect(polyVerts, `scaled polygon /Vertices among ${JSON.stringify(scaledAnnots.rows.filter((row) => row.isPolygon).map((row) => row.vertices))}`).toBeTruthy();
  expect(lineVerts, 'scaled polyline /Vertices').toBeTruthy();
  expect(closeArrays(polyVerts, rawPoly)).toBe(false);
  expect(closeArrays(lineVerts, rawLine)).toBe(false);

  const pts = devicePathPoints(await pageContentText(Uint8Array.from(scaledExport.flattenBytes)));
  const lineOps = pts.filter((point) => point.op === 'm' || point.op === 'l');
  expect(lineOps.length).toBeGreaterThanOrEqual(3);
  const expectedX = (Number(scaledPoly.left) || 0) + 2 * (Number(scaledPoly.points[1]?.x) || 0);
  const rawX = (Number(scaledPoly.left) || 0) + (Number(scaledPoly.points[1]?.x) || 0);
  expect(Math.abs(lineOps[1].x - expectedX)).toBeLessThan(3);
  expect(Math.abs(lineOps[1].x - rawX)).toBeGreaterThan(4);

  console.log('E2E_SCALE_POLY', JSON.stringify({
    liveScale1: livePolyVerts,
    scaledPoly: worldVertices(scaledPoly, scaledAnnots.pageHeight),
    polyVerts,
    lineVerts,
  }));
});

test('2 intended: circle/ellipse resize then export /Rect uses scaled radii', async ({ page }) => {
  await openEditor(page, LINK_PDF);
  const before = new Set((await annotationRows(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, { x0: 0.16, y0: 0.16, x1: 0.30, y1: 0.28 });
  const ellipse = await waitForRow(page, (row) => (
    !before.has(row.id) && (row.type === 'ellipse' || row.type === 'circle') && row.imported !== true
  ));

  const beforeScale = await liveObject(page, ellipse.id);
  await selectStroke(page, ellipse.id);
  await resizeHandle(page, 'br', 64, 48);
  const after = await liveObject(page, ellipse.id);
  const scaled = scaledRadii(after);
  expect(scaled.sx > 1.08 || scaled.sy > 1.08).toBeTruthy();
  expect(scaled.rx).toBeGreaterThan((Number(beforeScale.rx) || Number(beforeScale.radius) || 0) + 4);

  const bytes = await exportAnnotatedPdf(page);
  const exported = await exportedAnnots(bytes);
  const circle = exported.rows.find((row) => row.isCircle && closeArrays(row.rect, circleRect(after, exported.pageHeight), 4));
  expect(circle, 'export writes a Circle /Rect for the resized ellipse').toBeTruthy();
  expect(closeArrays(circle.rect, circleRect(after, exported.pageHeight, { applyScale: false }), 3)).toBe(false);

  const liveExport = await page.evaluate(async (obj) => {
    const { savePDFWithAnnotationsPdfLib } = await import('/src/utils/pdfAnnotationsPdfLib.js');
    const res = await fetch('/debug-fixtures/clickable-link-test.pdf');
    const buf = await res.arrayBuffer();
    const file = { name: 'scale-circle.pdf', arrayBuffer: async () => buf };
    const bytes = await savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects: [obj] } },
      { 1: { width: 612, height: 792 } },
      null,
      { returnBytes: true },
    );
    return [...new Uint8Array(bytes)];
  }, after);
  const isolated = await exportedAnnots(Uint8Array.from(liveExport));
  const isolatedCircle = isolated.rows.find((row) => (
    row.isCircle && closeArrays(row.rect, circleRect(after, isolated.pageHeight), 4)
  ));
  expect(isolatedCircle, 'Vite-import of the live ellipse writes scaled /Rect').toBeTruthy();

  console.log('E2E_SCALE_CIRCLE', JSON.stringify({
    before: { rx: beforeScale.rx, ry: beforeScale.ry, scaleX: beforeScale.scaleX },
    after: { rx: after.rx, ry: after.ry, radius: after.radius, scaleX: after.scaleX, scaleY: after.scaleY },
    rect: circle.rect,
    scaled,
  }));
});

test('3 break: scale=1 move-only still left+point.x / unscaled radius', async ({ page }) => {
  await openEditor(page, LINK_PDF);
  const polyline = await waitForRow(page, (row) => row.pdfType === 'PolyLine' && row.pointCount >= 2);
  const liveLine = await liveObject(page, polyline.id);
  expect(Math.abs((Number(liveLine.scaleX) || 1) - 1)).toBeLessThan(0.04);

  const beforeIds = new Set((await annotationRows(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, { x0: 0.18, y0: 0.18, x1: 0.30, y1: 0.30 });
  const ellipse = await waitForRow(page, (row) => (
    !beforeIds.has(row.id) && (row.type === 'ellipse' || row.type === 'circle') && row.imported !== true
  ));
  const beforeCircle = await liveObject(page, ellipse.id);
  await selectStroke(page, ellipse.id);
  const selBox = await page.locator('[data-selection-bbox]').first().boundingBox();
  expect(selBox, 'selection bbox for move').toBeTruthy();
  await page.mouse.move(selBox.x + selBox.width / 2, selBox.y + selBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(selBox.x + selBox.width / 2 + 48, selBox.y + selBox.height / 2 + 32, { steps: 8 });
  await page.mouse.up();
  const afterCircle = await liveObject(page, ellipse.id);
  expect(Math.abs((Number(afterCircle.scaleX) || 1) - 1)).toBeLessThan(0.04);
  expect(Math.abs((Number(afterCircle.left) || 0) - (Number(beforeCircle.left) || 0))).toBeGreaterThan(4);

  const bytes = await exportAnnotatedPdf(page);
  const exported = await exportedAnnots(bytes);
  const lineVerts = exported.rows.find((row) => row.isPolyLine)?.vertices;
  expect(closeArrays(lineVerts, rawVertices(liveLine, exported.pageHeight))).toBe(true);
  expect(closeArrays(lineVerts, worldVertices(liveLine, exported.pageHeight))).toBe(true);

  const movedCircle = exported.rows.find((row) => (
    row.isCircle && closeArrays(row.rect, circleRect(afterCircle, exported.pageHeight, { applyScale: false }), 4)
  ));
  expect(movedCircle, 'moved ellipse exports unscaled radius /Rect').toBeTruthy();

  console.log('E2E_SCALE_MOVE', JSON.stringify({
    polyline: { left: liveLine.left, top: liveLine.top, scaleX: liveLine.scaleX, scaleY: liveLine.scaleY },
    circle: { left: afterCircle.left, top: afterCircle.top, rx: afterCircle.rx, ry: afterCircle.ry, scaleX: afterCircle.scaleX },
  }));
});

test('4 edge: non-uniform scaleX≠scaleY oval stays elliptical; imported oval /Rect', async ({ page }) => {
  await openEditor(page, LINK_PDF);
  const before = new Set((await annotationRows(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, { x0: 0.20, y0: 0.20, x1: 0.36, y1: 0.34 });
  const ellipse = await waitForRow(page, (row) => (
    !before.has(row.id) && (row.type === 'ellipse' || row.type === 'circle') && row.imported !== true
  ));
  await selectStroke(page, ellipse.id);
  await resizeHandle(page, 'mr', 80, 0);
  const after = await liveObject(page, ellipse.id);
  const scaled = scaledRadii(after);
  expect(Math.abs(scaled.rx - scaled.ry)).toBeGreaterThan(6);
  expect(Math.abs(scaled.sx - scaled.sy)).toBeGreaterThan(0.12);

  const bytes = await exportAnnotatedPdf(page);
  const exported = await exportedAnnots(bytes);
  const circle = exported.rows.find((row) => row.isCircle && closeArrays(row.rect, circleRect(after, exported.pageHeight), 4));
  expect(circle, 'non-uniform oval export /Rect').toBeTruthy();
  const [x1, y1, x2, y2] = circle.rect;
  expect(Math.abs((x2 - x1) - (y2 - y1))).toBeGreaterThan(6);

  await openEditor(page, OVAL_PDF);
  const imported = await waitForRow(page, (row) => (
    row.pdfType === 'Circle' || ((row.type === 'circle' || row.type === 'ellipse') && row.imported === true)
  ));
  const importedObj = await liveObject(page, imported.pdfType || imported.id);
  const screenRx = Number(importedObj.svgRx || importedObj.rx || 0);
  const screenRy = Number(importedObj.svgRy || importedObj.ry || 0);
  expect(Math.abs(screenRx - screenRy)).toBeGreaterThan(4);

  const importBytes = await exportAnnotatedPdf(page);
  const importExport = await exportedAnnots(importBytes);
  const oval = importExport.rows.find((row) => row.isCircle);
  expect(oval?.rect, 'imported oval exports /Circle').toBeTruthy();
  expect(Math.abs((oval.rect[2] - oval.rect[0]) - screenRx * 2)).toBeLessThan(3);
  expect(Math.abs((oval.rect[3] - oval.rect[1]) - screenRy * 2)).toBeLessThan(3);
  const minR = Math.min(screenRx, screenRy);
  expect(Math.abs((oval.rect[2] - oval.rect[0]) - minR * 2)).toBeGreaterThan(8);
  expect(Math.abs((oval.rect[2] - oval.rect[0]) - (oval.rect[3] - oval.rect[1]))).toBeGreaterThan(8);

  console.log('E2E_SCALE_OVAL', JSON.stringify({
    drawn: { scaleX: after.scaleX, scaleY: after.scaleY, rx: scaled.rx, ry: scaled.ry, rect: circle.rect },
    imported: { scaleX: importedObj.scaleX, scaleY: importedObj.scaleY, radius: importedObj.radius, rect: oval.rect },
  }));
});
