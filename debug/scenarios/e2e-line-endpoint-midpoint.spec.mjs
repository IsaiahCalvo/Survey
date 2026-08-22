import { test, expect } from '@playwright/test';

// Line/arrow single-click HANDLE leftover after S-03/S-04 create + E-01 bbox
// resize. Live-prove p1 / p2 endpoint move + midpoint bend / snap-to-straight.
// Callout corners stay T-02. Shape br/tl/mr stay E-01. No mid-edge textBox-*.
// SVG default (not ?renderer=canvas). Not leftover-18.
// Do not replay Keep active, Survey notes, page ctx, Survey module,
// thumbnail, Fit height, Bookmarks, Eraser/Counter, F3, Search, keyboard,
// swatches, callout family, thin leftovers, PDF links, History, pages
// structure, flatten, mobile chrome.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const EPS = 1.6;

async function openEditor(page) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.goto(GLYPH_PDF);
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

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.48,
  y1 = 0.28,
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
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  await expect(sub).toBeVisible({ timeout: 8_000 });
  if (!String(await sub.getAttribute('class') || '').includes('btn-active')) {
    await sub.click();
  }
  await expect(sub).toHaveClass(/btn-active/);
}

async function userLineIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      if (object.isPdfImported === true) return false;
      return String(object.type || '').toLowerCase() === 'line';
    });
  }, pageNumber);
}

async function lineGeom(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId) || {};
    const cx = (object.left ?? 0) + (object.width ?? 0) / 2;
    const cy = (object.top ?? 0) + (object.height ?? 0) / 2;
    const host = document.querySelector(`[data-svg-annotation-layer="1"] > g[data-anno-id="${annoId}"]`);
    const path = host?.querySelector('path');
    const line = host?.querySelector('line');
    return {
      id: annoId,
      type: String(object.type || '').toLowerCase(),
      tool: String(object.tool || object.data?.tool || '').toLowerCase(),
      x1: cx + (object.x1 ?? 0),
      y1: cy + (object.y1 ?? 0),
      x2: cx + (object.x2 ?? 0),
      y2: cy + (object.y2 ?? 0),
      midpoint: object.data?.midpoint ? { x: object.data.midpoint.x, y: object.data.midpoint.y } : null,
      angle: object.angle || 0,
      hasPath: Boolean(path),
      hasLine: Boolean(line),
      pathD: path?.getAttribute('d') || null,
    };
  }, id);
}

function almostEqNum(a, b, eps = EPS) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

function almostEqPt(a, b, eps = EPS) {
  if (!a || !b) return false;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) < eps;
}

async function waitForNewLine(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const ids = await userLineIds(page);
    const id = ids.find((next) => !beforeIds.includes(next)) || null;
    created = id ? await lineGeom(page, id) : null;
    return created;
  }, { message: 'expected a new user line/arrow' }).not.toBeNull();
  return created;
}

async function createLine(page, coords, toolName = 'Line') {
  const before = await userLineIds(page);
  await activateShapeTool(page, toolName);
  await dragOnPage(page, coords);
  const created = await waitForNewLine(page, before);
  await selectMode(page);
  return created;
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

async function clickLineStroke(page, id) {
  const geom = await lineGeom(page, id);
  const x = geom.midpoint?.x ?? (geom.x1 + (geom.x2 - geom.x1) * 0.38);
  const y = geom.midpoint?.y ?? (geom.y1 + (geom.y2 - geom.y1) * 0.38);
  const screen = await pageToScreen(page, x, y);
  await page.mouse.click(screen.x, screen.y);
}

async function selectUntilHandles(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    await clickLineStroke(page, id);
    return page.locator('circle[data-handle="midpoint"]').count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

function handleGroup(page) {
  return page.locator('circle[data-handle="midpoint"]').locator('xpath=..');
}

async function handleCenter(page, which) {
  const group = handleGroup(page);
  const circle = which === 'mid'
    ? page.locator('circle[data-handle="midpoint"]')
    : group.locator('circle').nth(which === 'p1' ? 0 : 1);
  await expect(circle).toBeAttached({ timeout: 8_000 });
  const box = await circle.boundingBox();
  expect(box, `${which} handle bbox`).toBeTruthy();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function dragHandle(page, which, dx, dy) {
  const start = await handleCenter(page, which);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
  return start;
}

test('line/arrow endpoint + midpoint handles intended + break + edge', async ({ page }) => {
  await openEditor(page);

  const line = await createLine(page, { x0: 0.18, y0: 0.30, x1: 0.46, y1: 0.30 }, 'Line');
  const arrow = await createLine(page, { x0: 0.18, y0: 0.58, x1: 0.44, y1: 0.58 }, 'Arrow');
  const second = await createLine(page, { x0: 0.58, y0: 0.26, x1: 0.82, y1: 0.26 }, 'Line');
  expect(line.tool === 'line' || line.type === 'line', 'created a line').toBe(true);
  expect(arrow.id, 'arrow id').not.toBe(line.id);
  expect(second.id, 'second id').not.toBe(line.id);
  await selectUntilHandles(page, line.id);

  const handleCount = await handleGroup(page).locator('circle').count();
  expect(handleCount, 'p1 + p2 + midpoint').toBeGreaterThanOrEqual(3);

  // Intended: p2 drag moves that tip; p1 stays.
  const preP2 = await lineGeom(page, line.id);
  await dragHandle(page, 'p2', 48, 36);
  let afterP2 = null;
  await expect.poll(async () => {
    afterP2 = await lineGeom(page, line.id);
    return Math.hypot(afterP2.x2 - preP2.x2, afterP2.y2 - preP2.y2) > 8
      && almostEqNum(afterP2.x1, preP2.x1, 3)
      && almostEqNum(afterP2.y1, preP2.y1, 3);
  }, { timeout: 8_000 }).toBe(true);

  // Intended: p1 drag moves that tip; p2 stays.
  await selectUntilHandles(page, line.id);
  const preP1 = await lineGeom(page, line.id);
  await dragHandle(page, 'p1', -36, 28);
  let afterP1 = null;
  await expect.poll(async () => {
    afterP1 = await lineGeom(page, line.id);
    return Math.hypot(afterP1.x1 - preP1.x1, afterP1.y1 - preP1.y1) > 8
      && almostEqNum(afterP1.x2, preP1.x2, 3)
      && almostEqNum(afterP1.y2, preP1.y2, 3);
  }, { timeout: 8_000 }).toBe(true);

  // Intended: midpoint bend writes data.midpoint and a Q path.
  await selectUntilHandles(page, line.id);
  const preMid = await lineGeom(page, line.id);
  await dragHandle(page, 'mid', 0, 56);
  let afterMid = null;
  await expect.poll(async () => {
    afterMid = await lineGeom(page, line.id);
    return afterMid.midpoint
      && Math.abs(afterMid.midpoint.y - (preMid.midpoint?.y ?? ((preMid.y1 + preMid.y2) / 2))) > 12
      && almostEqNum(afterMid.x1, preMid.x1, 3)
      && almostEqNum(afterMid.x2, preMid.x2, 3);
  }, { timeout: 8_000 }).toBe(true);
  expect(afterMid.hasPath, 'bent line uses <path>').toBe(true);
  expect(String(afterMid.pathD || ''), 'quadratic').toMatch(/Q/i);

  // Intended: arrow uses the same three handles; p2 + midpoint work.
  expect(arrow.tool === 'arrow' || arrow.type === 'line', 'created an arrow').toBe(true);
  await selectUntilHandles(page, arrow.id);
  const preArrow = await lineGeom(page, arrow.id);
  await dragHandle(page, 'p2', 40, 0);
  let afterArrowP2 = null;
  await expect.poll(async () => {
    afterArrowP2 = await lineGeom(page, arrow.id);
    return Math.abs(afterArrowP2.x2 - preArrow.x2) > 8
      && almostEqNum(afterArrowP2.y1, preArrow.y1, 3);
  }, { timeout: 8_000 }).toBe(true);
  await selectUntilHandles(page, arrow.id);
  await dragHandle(page, 'mid', 0, 48);
  let afterArrowMid = null;
  await expect.poll(async () => {
    afterArrowMid = await lineGeom(page, arrow.id);
    return Boolean(afterArrowMid.midpoint) && afterArrowMid.hasPath;
  }, { timeout: 8_000 }).toBe(true);

  // Break: snap-to-straight — drag midpoint back onto the chord.
  await selectUntilHandles(page, line.id);
  const bent = await lineGeom(page, line.id);
  expect(bent.midpoint, 'line still curved').toBeTruthy();
  const midCenter = await handleCenter(page, 'mid');
  const chord = await pageToScreen(page, (bent.x1 + bent.x2) / 2, (bent.y1 + bent.y2) / 2);
  await page.mouse.move(midCenter.x, midCenter.y);
  await page.mouse.down();
  await page.mouse.move(chord.x, chord.y, { steps: 10 });
  await page.mouse.up();
  let afterSnap = null;
  await expect.poll(async () => {
    afterSnap = await lineGeom(page, line.id);
    return afterSnap.midpoint == null;
  }, { timeout: 8_000 }).toBe(true);
  expect(afterSnap.hasLine || !/Q/i.test(String(afterSnap.pathD || '')), 'snap is straight').toBe(true);

  // Break: Pen armed — creation intercepts; endpoint is a no-op.
  await selectUntilHandles(page, line.id);
  const prePen = await lineGeom(page, line.id);
  await page.keyboard.press('p');
  await dragHandle(page, 'p2', 40, 24);
  const afterPen = await lineGeom(page, line.id);
  expect(
    almostEqPt({ x: afterPen.x1, y: afterPen.y1 }, { x: prePen.x1, y: prePen.y1 }, 3)
    && almostEqPt({ x: afterPen.x2, y: afterPen.y2 }, { x: prePen.x2, y: prePen.y2 }, 3),
    'Pen-armed endpoint is no-op',
  ).toBe(true);
  await selectMode(page);

  // Break: nothing selected — empty-page drag does not move the line.
  await page.mouse.click(18, 220);
  const preEmpty = await lineGeom(page, line.id);
  const emptyBox = await pageBox(page);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.82, emptyBox.y + emptyBox.height * 0.12);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.90, emptyBox.y + emptyBox.height * 0.20, { steps: 6 });
  await page.mouse.up();
  const afterEmpty = await lineGeom(page, line.id);
  expect(almostEqPt({ x: afterEmpty.x1, y: afterEmpty.y1 }, { x: preEmpty.x1, y: preEmpty.y1 }, 3), 'empty p1').toBe(true);
  expect(almostEqPt({ x: afterEmpty.x2, y: afterEmpty.y2 }, { x: preEmpty.x2, y: preEmpty.y2 }, 3), 'empty p2').toBe(true);

  // Edge: undo after midpoint bend restores the pre-drag chord.
  await selectUntilHandles(page, line.id);
  const preUndo = await lineGeom(page, line.id);
  await dragHandle(page, 'mid', 0, 50);
  await expect.poll(async () => Boolean((await lineGeom(page, line.id)).midpoint)).toBe(true);
  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await lineGeom(page, line.id);
    return almostEqPt(
      { x: afterUndo.x1, y: afterUndo.y1 },
      { x: preUndo.x1, y: preUndo.y1 },
      3,
    ) && ((preUndo.midpoint == null && afterUndo.midpoint == null)
      || almostEqPt(afterUndo.midpoint, preUndo.midpoint, 3));
  }, { timeout: 8_000 }).toBe(true);

  // Edge: second line isolate — moving it does not move the first.
  const firstFrozen = await lineGeom(page, line.id);
  await selectUntilHandles(page, second.id);
  await dragHandle(page, 'p2', 0, 40);
  let secondAfter = null;
  await expect.poll(async () => {
    secondAfter = await lineGeom(page, second.id);
    return Math.abs(secondAfter.y2 - second.y2) > 8;
  }, { timeout: 8_000 }).toBe(true);
  const firstAfterSecond = await lineGeom(page, line.id);
  expect(almostEqPt(
    { x: firstAfterSecond.x1, y: firstAfterSecond.y1 },
    { x: firstFrozen.x1, y: firstFrozen.y1 },
    3,
  ), 'first p1 stays').toBe(true);
  expect(almostEqPt(
    { x: firstAfterSecond.x2, y: firstAfterSecond.y2 },
    { x: firstFrozen.x2, y: firstFrozen.y2 },
    3,
  ), 'first p2 stays').toBe(true);

  // Edge: zoom then p2 — viewBox owns scale.
  const zoomIn = page.getByRole('button', { name: /Zoom in/i }).first();
  if (await zoomIn.count()) {
    await zoomIn.click();
    await zoomIn.click();
  }
  const viewBox = (await pageViewBox(page)).raw;
  expect(viewBox, 'viewBox present').toBeTruthy();
  expect(viewBox.startsWith('0 0 '), 'viewBox owns scale').toBe(true);
  await selectUntilHandles(page, line.id);
  const preZoom = await lineGeom(page, line.id);
  await dragHandle(page, 'p2', 28, 18);
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await lineGeom(page, line.id);
    return Math.hypot(afterZoom.x2 - preZoom.x2, afterZoom.y2 - preZoom.y2) > 4
      && almostEqNum(afterZoom.x1, preZoom.x1, 3)
      && almostEqNum(afterZoom.y1, preZoom.y1, 3);
  }, { timeout: 8_000 }).toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('LINE_ENDPOINT_MIDPOINT_PROOF', JSON.stringify({
    lineId: line.id,
    arrowId: arrow.id,
    secondId: second.id,
    handleCount,
    p2: { dx: afterP2.x2 - preP2.x2, dy: afterP2.y2 - preP2.y2, p1Held: almostEqNum(afterP2.x1, preP2.x1, 3) },
    p1: { dx: afterP1.x1 - preP1.x1, dy: afterP1.y1 - preP1.y1, p2Held: almostEqNum(afterP1.x2, preP1.x2, 3) },
    midpoint: { y: afterMid.midpoint?.y, hasPath: afterMid.hasPath },
    arrow: { p2dx: afterArrowP2.x2 - preArrow.x2, curved: Boolean(afterArrowMid.midpoint) },
    snapStraight: afterSnap.midpoint == null,
    penArmedNoop: almostEqPt({ x: afterPen.x2, y: afterPen.y2 }, { x: prePen.x2, y: prePen.y2 }, 3),
    emptyNoop: almostEqPt({ x: afterEmpty.x2, y: afterEmpty.y2 }, { x: preEmpty.x2, y: preEmpty.y2 }, 3),
    undoRestored: afterUndo.midpoint == null || almostEqPt(afterUndo.midpoint, preUndo.midpoint, 3),
    secondDidNotMoveFirst: almostEqPt(
      { x: firstAfterSecond.x2, y: firstAfterSecond.y2 },
      { x: firstFrozen.x2, y: firstFrozen.y2 },
      3,
    ),
    viewBox,
    zoomThenP2: Math.hypot(afterZoom.x2 - preZoom.x2, afterZoom.y2 - preZoom.y2),
  }));
});
