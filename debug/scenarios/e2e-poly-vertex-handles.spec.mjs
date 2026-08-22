import { test, expect } from '@playwright/test';

// Polygon / polyline single-click VERTEX leftover after line p1/p2/midpoint
// (S-03/S-04) + E-01 bbox. No create tool — fixture import only.
// Ellipse radii / ink vertices / stamp edit omitted in source.
// Do not replay line handles, callout family, Keep active, Survey notes,
// page ctx, Survey module, thumbnail, Fit height, Bookmarks, Eraser/Counter,
// F3, Search, keyboard, swatches, thin leftovers, PDF links, History,
// pages structure, flatten, mobile chrome, leftover-18.

const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const EPS = 2.4;

async function openEditor(page) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.goto(POLY_PDF);
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
      const left = match ? Number(match[1]) : 0;
      const top = match ? Number(match[2]) : 0;
      const points = raw.trim().split(/\s+/).filter(Boolean).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
      return {
        id: pdfId,
        type,
        pdfId,
        imported: Boolean(pdfId),
        points,
        left,
        top,
        world: points.map((point) => ({ x: point.x + left, y: point.y + top })),
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

function almostEqNum(a, b, eps = EPS) {
  return Math.abs(Number(a) - Number(b)) < eps;
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
}

async function clickPolylineStroke(page, geom) {
  const a = geom.world[0];
  const b = geom.world[1] || a;
  const screen = await pageToScreen(page, (a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.mouse.click(screen.x, screen.y);
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

async function handleCenter(page, index) {
  const circle = page.locator(`circle[data-handle="vertex-${index}"]`);
  await expect(circle).toBeAttached({ timeout: 8_000 });
  const box = await circle.boundingBox();
  expect(box, `vertex-${index} bbox`).toBeTruthy();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function dragVertex(page, index, dx, dy) {
  const start = await handleCenter(page, index);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
  return start;
}

function othersHeld(before, after, movedIndex, eps = 3) {
  return before.world.every((point, index) => (
    index === movedIndex || almostEqPt(point, after.world[index], eps)
  ));
}

test('polygon/polyline vertex handles intended + break + edge', async ({ page }) => {
  await openEditor(page);

  let polys = [];
  await expect.poll(async () => {
    polys = await listPolys(page);
    return polys.filter((row) => row.imported && row.points.length >= 3).length;
  }, { message: 'expected imported polygon + polyline' }).toBeGreaterThanOrEqual(3);

  const polyA = polys.find((row) => row.type === 'polygon' && row.points.length === 4);
  const polyLine = polys.find((row) => row.type === 'polyline');
  const polyB = polys.find((row) => row.type === 'polygon' && row.points.length === 3 && row.id !== polyA?.id);
  expect(polyA?.id, 'polygon A').toBeTruthy();
  expect(polyLine?.id, 'polyline').toBeTruthy();
  expect(polyB?.id, 'polygon B').toBeTruthy();
  expect(polyA.id).not.toBe(polyB.id);

  await selectUntilVertexHandles(page, polyA.id, polyA.points.length);
  const handleCount = await page.locator('circle[data-handle^="vertex-"]').count();
  expect(handleCount, 'one handle per vertex').toBe(polyA.points.length);

  const preV0 = await polyGeom(page, polyA.id);
  await dragVertex(page, 0, 40, 28);
  let afterV0 = null;
  await expect.poll(async () => {
    afterV0 = await polyGeom(page, polyA.id);
    return Math.hypot(afterV0.world[0].x - preV0.world[0].x, afterV0.world[0].y - preV0.world[0].y) > 8
      && othersHeld(preV0, afterV0, 0);
  }, { timeout: 8_000 }).toBe(true);

  await selectUntilVertexHandles(page, polyA.id, preV0.world.length);
  const preV2 = await polyGeom(page, polyA.id);
  const last = preV2.world.length - 1;
  await dragVertex(page, last, -24, 36);
  let afterLast = null;
  await expect.poll(async () => {
    afterLast = await polyGeom(page, polyA.id);
    return Math.hypot(afterLast.world[last].x - preV2.world[last].x, afterLast.world[last].y - preV2.world[last].y) > 8
      && othersHeld(preV2, afterLast, last);
  }, { timeout: 8_000 }).toBe(true);

  await selectUntilVertexHandles(page, polyLine.id, polyLine.points.length);
  const preLine = await polyGeom(page, polyLine.id);
  await dragVertex(page, 1, 32, -28);
  let afterLine = null;
  await expect.poll(async () => {
    afterLine = await polyGeom(page, polyLine.id);
    return Math.hypot(afterLine.world[1].x - preLine.world[1].x, afterLine.world[1].y - preLine.world[1].y) > 8
      && othersHeld(preLine, afterLine, 1);
  }, { timeout: 8_000 }).toBe(true);

  await selectUntilVertexHandles(page, polyA.id, preV0.world.length);
  const prePen = await polyGeom(page, polyA.id);
  await page.keyboard.press('p');
  await dragVertex(page, 1, 36, 20);
  let afterPen = null;
  await expect.poll(async () => {
    afterPen = await polyGeom(page, polyA.id);
    return Math.hypot(afterPen.world[1].x - prePen.world[1].x, afterPen.world[1].y - prePen.world[1].y) > 8
      && othersHeld(prePen, afterPen, 1);
  }, { timeout: 8_000 }).toBe(true);
  await selectMode(page);

  await page.mouse.click(18, 220);
  const preEmpty = await polyGeom(page, polyA.id);
  const emptyBox = await pageBox(page);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.82, emptyBox.y + emptyBox.height * 0.12);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.90, emptyBox.y + emptyBox.height * 0.20, { steps: 6 });
  await page.mouse.up();
  const afterEmpty = await polyGeom(page, polyA.id);
  expect(afterEmpty.world.every((point, index) => almostEqPt(point, preEmpty.world[index], 3)), 'empty-page no-op').toBe(true);

  await selectUntilVertexHandles(page, polyA.id, preV0.world.length);
  const preUndo = await polyGeom(page, polyA.id);
  await dragVertex(page, 2, 0, 44);
  await expect.poll(async () => {
    const now = await polyGeom(page, polyA.id);
    return Math.abs(now.world[2].y - preUndo.world[2].y) > 8;
  }).toBe(true);
  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await polyGeom(page, polyA.id);
    return afterUndo.world.every((point, index) => almostEqPt(point, preUndo.world[index], 3));
  }, { timeout: 8_000 }).toBe(true);

  const firstFrozen = await polyGeom(page, polyA.id);
  const polyBBefore = await polyGeom(page, polyB.id);
  await selectUntilVertexHandles(page, polyB.id, polyB.points.length);
  await dragVertex(page, 0, 0, 36);
  let afterB = null;
  await expect.poll(async () => {
    afterB = await polyGeom(page, polyB.id);
    return Math.hypot(afterB.world[0].x - polyBBefore.world[0].x, afterB.world[0].y - polyBBefore.world[0].y) > 6;
  }, { timeout: 8_000 }).toBe(true);
  const firstAfterB = await polyGeom(page, polyA.id);
  expect(firstAfterB.world.every((point, index) => almostEqPt(point, firstFrozen.world[index], 3)), 'A isolated').toBe(true);

  const zoomIn = page.getByRole('button', { name: /Zoom in/i }).first();
  if (await zoomIn.count()) {
    await zoomIn.click();
    await zoomIn.click();
  }
  const viewBox = (await pageViewBox(page)).raw;
  expect(viewBox, 'viewBox present').toBeTruthy();
  expect(viewBox.startsWith('0 0 '), 'viewBox owns scale').toBe(true);
  await selectUntilVertexHandles(page, polyA.id, preV0.world.length);
  const preZoom = await polyGeom(page, polyA.id);
  await dragVertex(page, 0, 22, 16);
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await polyGeom(page, polyA.id);
    return Math.hypot(afterZoom.world[0].x - preZoom.world[0].x, afterZoom.world[0].y - preZoom.world[0].y) > 4
      && othersHeld(preZoom, afterZoom, 0);
  }, { timeout: 8_000 }).toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('POLY_VERTEX_HANDLES_PROOF', JSON.stringify({
    polyA: polyA.id,
    polyLine: polyLine.id,
    polyB: polyB.id,
    handleCount,
    v0: {
      dx: afterV0.world[0].x - preV0.world[0].x,
      dy: afterV0.world[0].y - preV0.world[0].y,
      othersHeld: othersHeld(preV0, afterV0, 0),
    },
    last: {
      dx: afterLast.world[last].x - preV2.world[last].x,
      dy: afterLast.world[last].y - preV2.world[last].y,
      othersHeld: othersHeld(preV2, afterLast, last),
    },
    polyline: {
      dx: afterLine.world[1].x - preLine.world[1].x,
      dy: afterLine.world[1].y - preLine.world[1].y,
      othersHeld: othersHeld(preLine, afterLine, 1),
    },
    penArmedHandleStillMoves: Math.hypot(afterPen.world[1].x - prePen.world[1].x, afterPen.world[1].y - prePen.world[1].y),
    emptyNoop: afterEmpty.world.every((point, index) => almostEqPt(point, preEmpty.world[index], 3)),
    undoRestored: afterUndo.world.every((point, index) => almostEqPt(point, preUndo.world[index], 3)),
    secondDidNotMoveFirst: firstAfterB.world.every((point, index) => almostEqPt(point, firstFrozen.world[index], 3)),
    viewBox,
    zoomThenV0: Math.hypot(afterZoom.world[0].x - preZoom.world[0].x, afterZoom.world[0].y - preZoom.world[0].y),
  }));
});
