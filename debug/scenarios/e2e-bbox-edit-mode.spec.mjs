import { test, expect } from '@playwright/test';

// Unique leftover after imported vertex-N: double-click / mobile-strip
// bbox edit mode (uniform resize+rotate chrome) for polygon / polyline /
// line / arrow / counter. Not E-01 single-click rect bbox. Not S-03/S-04
// p1/p2/midpoint. Not X-04 vertex-N. Not callout family.
// Ellipse radii / ink vertices / stamp / poly create / Extract / Note /
// Link / Print / Group stay omitted. Leftover-18 parked.

const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const EPS = 2.4;

async function openEditor(page, { fixture = POLY_PDF, width = 1440, height = 900 } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function selectMode(page) {
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
}

async function activateShapeTool(page, toolName) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Escape');
  const category = page.getByRole('button', { name: 'Shapes', exact: true }).first();
  await expect(category).toBeVisible({ timeout: 8_000 });
  if (!String(await category.getAttribute('class') || '').includes('btn-active')) {
    await category.click();
  }
  const desktopSub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const sub = (await desktopSub.count())
    ? desktopSub
    : page.getByRole('button', { name: toolName, exact: true });
  await expect(sub.first()).toBeVisible({ timeout: 8_000 });
  if (!String(await sub.first().getAttribute('class') || '').includes('btn-active')) {
    await sub.first().click();
  }
}

async function dragOnPage(page, { x0, y0, x1, y1 }) {
  const box = await pageBox(page);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return { start, end, box };
}

async function listPolys(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type]')];
    return groups.map((group) => {
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const type = String(group.getAttribute('data-pdf-annotation-type') || '').toLowerCase();
      const shape = group.querySelector('[data-shape-kind="polygon"], [data-shape-kind="polyline"]');
      const raw = shape?.getAttribute('points') || '';
      const transform = shape?.getAttribute('transform') || '';
      const match = /translate\(([-0-9.]+),\s*([-0-9.]+)\)/.exec(transform);
      const scaleMatch = /scale\(([-0-9.]+)(?:,\s*([-0-9.]+))?\)/.exec(transform);
      const left = match ? Number(match[1]) : 0;
      const top = match ? Number(match[2]) : 0;
      const scaleX = scaleMatch ? Number(scaleMatch[1]) : 1;
      const scaleY = scaleMatch ? Number(scaleMatch[2] ?? scaleMatch[1]) : 1;
      const points = raw.trim().split(/\s+/).filter(Boolean).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
      const rect = shape?.getBoundingClientRect();
      return {
        id: pdfId,
        type,
        points,
        left,
        top,
        scaleX,
        scaleY,
        transform,
        screen: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
        world: points.map((point) => ({ x: point.x * scaleX + left, y: point.y * scaleY + top })),
      };
    }).filter((row) => (row.type === 'polygon' || row.type === 'polyline') && row.points.length >= 3);
  });
}

async function polyGeom(page, id) {
  const rows = await listPolys(page);
  const row = rows.find((entry) => entry.id === id);
  expect(row, `poly ${id}`).toBeTruthy();
  return row;
}

function worldBox(geom) {
  if (geom.screen) {
    return {
      minX: geom.screen.x,
      maxX: geom.screen.x + geom.screen.w,
      minY: geom.screen.y,
      maxY: geom.screen.y + geom.screen.h,
      w: geom.screen.w,
      h: geom.screen.h,
      scaleX: geom.scaleX,
      scaleY: geom.scaleY,
    };
  }
  const xs = geom.world.map((p) => p.x);
  const ys = geom.world.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
    scaleX: geom.scaleX,
    scaleY: geom.scaleY,
  };
}

function grew(before, after, px = 6) {
  const a = worldBox(before);
  const b = worldBox(after);
  return (b.w - a.w > px) || (b.h - a.h > px)
    || Math.abs((after.scaleX ?? 1) - (before.scaleX ?? 1)) > 0.04
    || Math.abs((after.scaleY ?? 1) - (before.scaleY ?? 1)) > 0.04;
}

function sameGeom(a, b, eps = 3) {
  const boxA = worldBox(a);
  const boxB = worldBox(b);
  return Math.abs(boxA.w - boxB.w) < eps
    && Math.abs(boxA.h - boxB.h) < eps
    && Math.abs((a.scaleX ?? 1) - (b.scaleX ?? 1)) < 0.03
    && Math.abs((a.scaleY ?? 1) - (b.scaleY ?? 1)) < 0.03;
}

function almostEqPt(a, b, eps = EPS) {
  if (!a || !b) return false;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) < eps;
}

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
  return { raw, W: parts[2] || 612, H: parts[3] || 792 };
}

async function pageToScreen(page, x, y) {
  const box = await pageBox(page);
  const { W, H } = await pageViewBox(page);
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
}

async function clickCentroid(page, geom) {
  const xs = geom.world.map((p) => p.x);
  const ys = geom.world.map((p) => p.y);
  const screen = await pageToScreen(
    page,
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  );
  await page.mouse.click(screen.x, screen.y);
  return screen;
}

async function clickPolylineStroke(page, geom) {
  const a = geom.world[0];
  const b = geom.world[1] || a;
  const screen = await pageToScreen(page, (a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.mouse.click(screen.x, screen.y);
  return screen;
}

async function selectUntilVertexHandles(page, id, expectedCount) {
  await selectMode(page);
  await expect.poll(async () => {
    const geom = await polyGeom(page, id);
    if (geom.type === 'polyline') await clickPolylineStroke(page, geom);
    else await clickCentroid(page, geom);
    return page.locator('circle[data-handle^="vertex-"]').count();
  }, { timeout: 12_000 }).toBe(expectedCount);
}

async function enterBboxByDblclick(page, { hitTarget, screen } = {}) {
  await page.waitForTimeout(500);
  if (screen) {
    await page.mouse.dblclick(screen.x, screen.y);
  } else {
    const target = page.locator(`[data-shape-hit-target="${hitTarget}"]`).first();
    await expect(target).toBeVisible({ timeout: 8_000 });
    const box = await target.boundingBox();
    expect(box, `${hitTarget} hit box`).toBeTruthy();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  }
  await expect.poll(() => page.locator('[data-resize-handle]').count(), { timeout: 8_000 })
    .toBeGreaterThan(0);
  await expect(page.locator('[data-resize-handle]').first()).toBeVisible({ timeout: 8_000 });
}

async function dragResizeHandle(page, id, dx, dy) {
  const handle = page.locator(`[data-resize-handle="${id}"]`).first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, `${id} handle`).toBeTruthy();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
  return start;
}

async function userLineIds(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      if (object.isPdfImported === true) return false;
      return String(object.type || '').toLowerCase() === 'line';
    });
  });
}

async function lineGeom(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId) || {};
    const cx = (object.left ?? 0) + (object.width ?? 0) / 2;
    const cy = (object.top ?? 0) + (object.height ?? 0) / 2;
    return {
      id: annoId,
      type: String(object.type || '').toLowerCase(),
      tool: String(object.tool || object.data?.tool || '').toLowerCase(),
      x1: cx + (object.x1 ?? 0),
      y1: cy + (object.y1 ?? 0),
      x2: cx + (object.x2 ?? 0),
      y2: cy + (object.y2 ?? 0),
      scaleX: object.scaleX ?? 1,
      scaleY: object.scaleY ?? 1,
      width: object.width ?? 0,
      height: object.height ?? 0,
    };
  }, id);
}

function lineLength(geom) {
  return Math.hypot(geom.x2 - geom.x1, geom.y2 - geom.y1);
}

async function createLine(page, coords, toolName = 'Line') {
  const before = await userLineIds(page);
  await activateShapeTool(page, toolName);
  await dragOnPage(page, coords);
  let created = null;
  await expect.poll(async () => {
    const ids = await userLineIds(page);
    const id = ids.find((next) => !before.includes(next)) || null;
    created = id ? await lineGeom(page, id) : null;
    return created;
  }, { message: 'expected a new user line' }).not.toBeNull();
  await selectMode(page);
  return created;
}

async function selectUntilMidpoint(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    const geom = await lineGeom(page, id);
    const screen = await pageToScreen(page, (geom.x1 + geom.x2) / 2, (geom.y1 + geom.y2) / 2);
    await page.mouse.click(screen.x, screen.y);
    return page.locator('circle[data-handle="midpoint"]').count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

async function createRect(page, coords) {
  const before = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));
  await activateShapeTool(page, 'Rectangle');
  await dragOnPage(page, coords);
  let created = null;
  await expect.poll(async () => {
    const ids = await page.evaluate(() => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean)
    ));
    const id = ids.find((next) => !before.includes(next)) || null;
    if (!id) return null;
    created = await page.evaluate((annoId) => {
      const object = window.__phase35GetAnnotationById?.(annoId) || {};
      return {
        id: annoId,
        type: String(object.type || '').toLowerCase(),
        width: object.width ?? 0,
        height: object.height ?? 0,
      };
    }, id);
    return created;
  }).not.toBeNull();
  await selectMode(page);
  return created;
}

async function listCounterIds(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[data-shape-hit-target="counter"]')]
      .map((node) => node.closest('[data-anno-id]')?.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));
}

async function createCounter(page, { xf = 0.82, yf = 0.18 } = {}) {
  const before = await listCounterIds(page);
  await activateShapeTool(page, 'Counter');
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
  let created = null;
  await expect.poll(async () => {
    const ids = await listCounterIds(page);
    const id = ids.find((next) => !before.includes(next)) || null;
    created = id ? await counterGeom(page, id) : null;
    return created;
  }, { message: 'expected a counter pin' }).not.toBeNull();
  await selectMode(page);
  return created;
}

async function counterGeom(page, id) {
  return page.evaluate((annoId) => {
    const host = document.querySelector(`[data-anno-id="${annoId}"] [data-shape-hit-target="counter"]`)
      || document.querySelector(`[data-counter-overlay] [data-anno-id="${annoId}"]`)
      || document.querySelector(`[data-svg-annotation-layer="1"] [data-anno-id="${annoId}"]`);
    const path = host?.matches?.('path') ? host : host?.querySelector?.('path');
    const pathD = path?.getAttribute('d') || '';
    const arc = /A\s+([\d.]+),([\d.]+)/.exec(pathD);
    const rect = (path || host)?.getBoundingClientRect();
    const object = window.__phase35GetAnnotationById?.(annoId) || {};
    return {
      id: annoId,
      svgR: arc ? Number(arc[1]) : Number(object.radius || 0),
      radius: Number(object.radius || 0),
      scaleX: object.scaleX ?? 1,
      left: object.left ?? 0,
      top: object.top ?? 0,
      screen: rect ? { w: rect.width, h: rect.height, x: rect.x, y: rect.y } : null,
    };
  }, id);
}

test('bbox edit mode intended + break + edge', async ({ page }) => {
  await openEditor(page);

  let polys = [];
  await expect.poll(async () => {
    polys = await listPolys(page);
    return polys.filter((row) => row.points.length >= 3).length;
  }, { message: 'expected imported polygon + polyline' }).toBeGreaterThanOrEqual(3);

  const polyA = polys.find((row) => row.type === 'polygon' && row.points.length === 4);
  const polyLine = polys.find((row) => row.type === 'polyline');
  const polyB = polys.find((row) => row.type === 'polygon' && row.points.length === 3 && row.id !== polyA?.id);
  expect(polyA?.id, 'polygon A').toBeTruthy();
  expect(polyLine?.id, 'polyline').toBeTruthy();
  expect(polyB?.id, 'polygon B').toBeTruthy();

  // Intended: single-click vertex chrome, then double-click swaps to bbox.
  await selectUntilVertexHandles(page, polyA.id, polyA.points.length);
  expect(await page.locator('[data-resize-handle]').count(), 'no bbox on single-click').toBe(0);
  const polyAClick = await clickCentroid(page, await polyGeom(page, polyA.id));
  await enterBboxByDblclick(page, { hitTarget: 'polygon', screen: polyAClick });
  expect(await page.locator('circle[data-handle^="vertex-"]').count(), 'vertices hide in bbox').toBe(0);
  const resizeIds = await page.locator('[data-resize-handle]').evaluateAll((nodes) => (
    [...new Set(nodes.map((node) => node.getAttribute('data-resize-handle')).filter(Boolean))]
  ));
  expect(resizeIds, 'uniform bbox corners').toEqual(expect.arrayContaining(['tl', 'tr', 'bl', 'br']));
  await expect(page.locator('[data-rotation-handle="mtr"]').first()).toBeVisible();

  const preA = await polyGeom(page, polyA.id);
  const preABox = worldBox(preA);
  await dragResizeHandle(page, 'br', 48, 36);
  let afterA = null;
  await expect.poll(async () => {
    afterA = await polyGeom(page, polyA.id);
    return grew(preA, afterA);
  }, { timeout: 8_000 }).toBe(true);
  const afterABox = worldBox(afterA);
  expect(grew(preA, afterA), 'bbox grew').toBe(true);
  expect(almostEqPt(
    { x: preABox.minX, y: preABox.minY },
    { x: afterABox.minX, y: afterABox.minY },
    14,
  ), 'tl origin held').toBe(true);

  // Esc exits bbox and restores vertex chrome.
  await page.keyboard.press('Escape');
  await expect.poll(() => page.locator('circle[data-handle^="vertex-"]').count(), { timeout: 8_000 })
    .toBe(polyA.points.length);
  expect(await page.locator('[data-resize-handle]').count(), 'bbox gone after Esc').toBe(0);

  // Intended: polyline same swap + grow.
  await selectUntilVertexHandles(page, polyLine.id, polyLine.points.length);
  const polyLineClick = await clickPolylineStroke(page, await polyGeom(page, polyLine.id));
  await enterBboxByDblclick(page, { hitTarget: 'polyline', screen: polyLineClick });
  expect(await page.locator('circle[data-handle^="vertex-"]').count()).toBe(0);
  const preLinePoly = await polyGeom(page, polyLine.id);
  const preLineBox = worldBox(preLinePoly);
  await dragResizeHandle(page, 'br', 40, 28);
  let afterLinePoly = null;
  await expect.poll(async () => {
    afterLinePoly = await polyGeom(page, polyLine.id);
    return grew(preLinePoly, afterLinePoly, 5);
  }, { timeout: 8_000 }).toBe(true);

  // Intended: line p1/p2/midpoint swap to bbox; br scales the whole stroke.
  const line = await createLine(page, { x0: 0.16, y0: 0.18, x1: 0.40, y1: 0.18 }, 'Line');
  await selectUntilMidpoint(page, line.id);
  expect(await page.locator('[data-resize-handle]').count(), 'line single-click is endpoints').toBe(0);
  const lineGeomNow = await lineGeom(page, line.id);
  const lineClick = await pageToScreen(
    page,
    lineGeomNow.x1 + (lineGeomNow.x2 - lineGeomNow.x1) * 0.32,
    lineGeomNow.y1 + (lineGeomNow.y2 - lineGeomNow.y1) * 0.32,
  );
  await enterBboxByDblclick(page, { hitTarget: 'line', screen: lineClick });
  expect(await page.locator('circle[data-handle="midpoint"]').count(), 'midpoint hides').toBe(0);
  const preLine = await lineGeom(page, line.id);
  await dragResizeHandle(page, 'br', 44, 0);
  let afterLine = null;
  await expect.poll(async () => {
    afterLine = await lineGeom(page, line.id);
    return lineLength(afterLine) - lineLength(preLine) > 6;
  }, { timeout: 8_000 }).toBe(true);

  // Intended: counter nubbin-only chrome swaps to bbox; br grows the pin.
  const counter = await createCounter(page, { xf: 0.80, yf: 0.22 });
  await selectMode(page);
  await expect.poll(async () => {
    await page.locator('[data-shape-hit-target="counter"]').first().click({ force: true });
    return page.locator('[data-shape-hit-target="counter"]').count();
  }).toBeGreaterThan(0);
  expect(await page.locator('[data-resize-handle]').count(), 'counter single-click has no bbox').toBe(0);
  const counterHit = page.locator('[data-shape-hit-target="counter"]').first();
  const counterBox = await counterHit.boundingBox();
  await enterBboxByDblclick(page, {
    hitTarget: 'counter',
    screen: { x: counterBox.x + counterBox.width / 2, y: counterBox.y + counterBox.height / 2 },
  });
  const preCounter = await counterGeom(page, counter.id);
  await dragResizeHandle(page, 'br', 56, 56);
  let afterCounter = null;
  await expect.poll(async () => {
    afterCounter = await counterGeom(page, counter.id);
    const dR = (afterCounter.svgR || 0) - (preCounter.svgR || 0);
    const dScreen = (afterCounter.screen?.w || 0) - (preCounter.screen?.w || 0);
    return dR > 1.5 || dScreen > 6;
  }, { timeout: 8_000 }).toBe(true);

  // Break: arming Pen clears bbox edit (PDFViewer setEditingAnnotation(null)).
  await page.keyboard.press('Escape');
  await selectUntilVertexHandles(page, polyA.id, polyA.points.length);
  await enterBboxByDblclick(page, { hitTarget: 'polygon', screen: await clickCentroid(page, await polyGeom(page, polyA.id)) });
  expect(await page.locator('[data-resize-handle]').count(), 'in bbox before Pen').toBeGreaterThan(0);
  const prePen = await polyGeom(page, polyA.id);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await expect.poll(() => page.locator('[data-resize-handle]').count(), { timeout: 8_000 }).toBe(0);
  const afterPen = await polyGeom(page, polyA.id);
  expect(sameGeom(prePen, afterPen, 5), 'Pen exit does not resize').toBe(true);
  await selectMode(page);

  // Break: empty-page drag is a no-op.
  await page.mouse.click(18, 220);
  const preEmpty = await polyGeom(page, polyA.id);
  const emptyBox = await pageBox(page);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.88, emptyBox.y + emptyBox.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.94, emptyBox.y + emptyBox.height * 0.14, { steps: 6 });
  await page.mouse.up();
  const afterEmpty = await polyGeom(page, polyA.id);
  expect(sameGeom(preEmpty, afterEmpty), 'empty-page no-op').toBe(true);

  // Edge: undo restores the pre-resize polygon.
  await selectUntilVertexHandles(page, polyA.id, polyA.points.length);
  await enterBboxByDblclick(page, { hitTarget: 'polygon', screen: await clickCentroid(page, await polyGeom(page, polyA.id)) });
  const preUndo = await polyGeom(page, polyA.id);
  const preUndoBox = worldBox(preUndo);
  await dragResizeHandle(page, 'br', 0, 40);
  await expect.poll(async () => grew(preUndo, await polyGeom(page, polyA.id), 5)).toBe(true);
  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await polyGeom(page, polyA.id);
    return sameGeom(preUndo, afterUndo, 5);
  }, { timeout: 8_000 }).toBe(true);

  // Edge: second polygon isolated.
  const firstFrozen = await polyGeom(page, polyA.id);
  await selectUntilVertexHandles(page, polyB.id, polyB.points.length);
  await enterBboxByDblclick(page, { hitTarget: 'polygon', screen: await clickCentroid(page, await polyGeom(page, polyB.id)) });
  const polyBBefore = await polyGeom(page, polyB.id);
  await dragResizeHandle(page, 'br', 0, 32);
  await expect.poll(async () => grew(polyBBefore, await polyGeom(page, polyB.id), 4), { timeout: 8_000 }).toBe(true);
  const firstAfterB = await polyGeom(page, polyA.id);
  expect(sameGeom(firstFrozen, firstAfterB), 'A isolated').toBe(true);

  // Edge: zoom then bbox resize still uses viewBox.
  const zoomIn = page.getByRole('button', { name: /Zoom in/i }).first();
  if (await zoomIn.count()) {
    await zoomIn.click();
    await zoomIn.click();
  }
  const viewBox = (await pageViewBox(page)).raw;
  expect(viewBox.startsWith('0 0 '), 'viewBox owns scale').toBe(true);
  await selectUntilVertexHandles(page, polyA.id, polyA.points.length);
  await enterBboxByDblclick(page, { hitTarget: 'polygon', screen: await clickCentroid(page, await polyGeom(page, polyA.id)) });
  const preZoom = await polyGeom(page, polyA.id);
  const preZoomBox = worldBox(preZoom);
  await dragResizeHandle(page, 'br', 24, 16);
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await polyGeom(page, polyA.id);
    return grew(preZoom, afterZoom, 3);
  }, { timeout: 8_000 }).toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 uses the Resize and rotate strip (no reliable dblclick).
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const mobileLine = await createLine(page, { x0: 0.20, y0: 0.22, x1: 0.62, y1: 0.22 }, 'Line');
  await selectUntilMidpoint(page, mobileLine.id);
  await activateShapeTool(page, 'Line');
  const resizeBtn = page.getByRole('button', { name: 'Resize and rotate', exact: true });
  await expect(resizeBtn).toBeVisible({ timeout: 8_000 });
  await resizeBtn.click();
  await expect(page.locator('[data-resize-handle]').first()).toBeVisible({ timeout: 8_000 });
  expect(await page.locator('circle[data-handle="midpoint"]').count(), '390 strip hid endpoints').toBe(0);
  const preMobile = await lineGeom(page, mobileLine.id);
  await dragResizeHandle(page, 'br', 56, 16);
  let afterMobile = null;
  await expect.poll(async () => {
    afterMobile = await lineGeom(page, mobileLine.id);
    return lineLength(afterMobile) - lineLength(preMobile) > 3
      || Math.abs((afterMobile.scaleX || 1) - (preMobile.scaleX || 1)) > 0.04
      || Math.abs((afterMobile.width || 0) - (preMobile.width || 0)) > 4;
  }, { timeout: 8_000 }).toBe(true);
  await assertNoErrorBoundary(page);

  console.log('BBOX_EDIT_MODE_PROOF', JSON.stringify({
    polyA: polyA.id,
    polyLine: polyLine.id,
    polyB: polyB.id,
    line: line.id,
    counter: counter.id,
    resizeIds,
    polyGrow: {
      dw: afterABox.w - preABox.w,
      dh: afterABox.h - preABox.h,
      dScaleX: afterA.scaleX - preA.scaleX,
    },
    polylineGrow: {
      dw: worldBox(afterLinePoly).w - preLineBox.w,
      dh: worldBox(afterLinePoly).h - preLineBox.h,
      dScaleX: afterLinePoly.scaleX - preLinePoly.scaleX,
    },
    lineGrow: lineLength(afterLine) - lineLength(preLine),
    counterGrow: {
      dR: afterCounter.svgR - preCounter.svgR,
      dScale: afterCounter.scaleX - preCounter.scaleX,
    },
    penExitsBbox: sameGeom(prePen, afterPen, 5),
    emptyNoop: sameGeom(preEmpty, afterEmpty),
    undoRestored: sameGeom(preUndo, afterUndo, 5),
    secondDidNotMoveFirst: sameGeom(firstFrozen, firstAfterB),
    viewBox,
    zoomThenGrow: grew(preZoom, afterZoom, 3),
    mobileLineGrow: lineLength(afterMobile) - lineLength(preMobile),
  }));
});
