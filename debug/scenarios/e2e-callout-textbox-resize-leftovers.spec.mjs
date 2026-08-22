import { test, expect } from '@playwright/test';

// Callout text-box resize LEFTOVERS after grow/clamp:
//   1. live flip past the opposite corner
//   2. resize-into-knee invalid-drop rollback
// Grow / min-clamp is e2e-callout-textbox-resize. Handle *move* is
// e2e-callout-knee-drag. SVG default (not ?renderer=canvas). Not leftover-18.
// Do not replay Keep active, Survey notes, Mirror V, page Cut/Copy/Paste,
// module Next/Prev, thumbnail, Fit height, Bookmarks, Eraser/Counter,
// F3, Search, keyboard, swatches, callout clipboard paste, thin leftovers,
// PDF links, History, pages insert/rotate/move/Duplicate, flatten, mobile.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const EPS = 0.008;
const MIN_PX = 20;

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

async function calloutIdsOnPage(page, pageNumber = 1) {
  return page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-callout-id]`).evaluateAll((els) => (
    [...new Set(els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean))]
  ));
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

async function selectMode(page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
}

async function createCallout(page, text, coords, pageNumber = 1) {
  const before = await calloutIdsOnPage(page, pageNumber);
  await page.keyboard.press('q');
  await dragOnPage(page, { ...coords, pageNumber });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await calloutIdsOnPage(page, pageNumber);
    calloutId = ids.find((id) => !before.includes(id)) || null;
    return calloutId;
  }).not.toBeNull();
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await selectMode(page);
  return calloutId;
}

async function selectCallout(page, calloutId, pageNumber = 1) {
  const scoped = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${calloutId}"]`);
  const candidates = [
    scoped.locator('[data-callout-part="textBox"]').first(),
    scoped.locator('[data-callout-part="knee"]').last(),
    scoped.first(),
  ];
  for (const target of candidates) {
    if (!(await target.count())) continue;
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const box = await target.boundingBox();
    if (!box || box.width < 1 || box.height < 1) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  }
  return false;
}

function handleLocator(page, calloutId, part, pageNumber = 1) {
  return page.locator(
    `[data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${calloutId}"] [data-callout-part="${part}"]`,
  ).last();
}

async function selectUntilCorners(page, calloutId, pageNumber = 1) {
  await expect.poll(async () => {
    await selectCallout(page, calloutId, pageNumber);
    return page.locator(
      `[data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${calloutId}"] [data-callout-part="textBox-br"]`,
    ).count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

async function dragHandle(page, calloutId, part, dx, dy, pageNumber = 1) {
  const handle = handleLocator(page, calloutId, part, pageNumber);
  await expect(handle).toBeAttached({ timeout: 10_000 });
  const box = await handle.boundingBox();
  expect(box, `${part} handle bbox`).toBeTruthy();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
  return { x, y };
}

async function calloutBox(page, calloutId) {
  return page.evaluate((cid) => {
    const layer = document.querySelector('[data-svg-annotation-layer="1"]');
    const vb = layer?.viewBox?.baseVal;
    const W = vb?.width || 1;
    const H = vb?.height || 1;
    const boxEl = document.querySelector(`[data-callout-id="${cid}"] [data-callout-part="textBox"]`);
    if (!boxEl) return null;
    const xPx = Number(boxEl.getAttribute('x'));
    const yPx = Number(boxEl.getAttribute('y'));
    const wPx = Number(boxEl.getAttribute('width'));
    const hPx = Number(boxEl.getAttribute('height'));
    const kneeEl = [...document.querySelectorAll(`[data-callout-id="${cid}"] [data-callout-part="knee"]`)].at(-1);
    const tipEl = [...document.querySelectorAll(`[data-callout-id="${cid}"] [data-callout-part="arrowTip"]`)].at(-1);
    const toNorm = (pt) => (pt && Number.isFinite(pt.x) ? { x: pt.x / W, y: pt.y / H } : null);
    return {
      x: xPx / W,
      y: yPx / H,
      w: wPx / W,
      h: hPx / H,
      right: (xPx + wPx) / W,
      bottom: (yPx + hPx) / H,
      wPx,
      hPx,
      W,
      H,
      knee: toNorm(kneeEl ? { x: Number(kneeEl.getAttribute('cx')), y: Number(kneeEl.getAttribute('cy')) } : null),
      arrowTip: toNorm(tipEl ? { x: Number(tipEl.getAttribute('cx')), y: Number(tipEl.getAttribute('cy')) } : null),
    };
  }, calloutId);
}

function almostEqNum(a, b, eps = EPS) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

function almostEqPt(a, b, eps = EPS) {
  if (!a || !b) return false;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) < eps;
}

function flippedPastOpposite(before, after) {
  const leftMovedPastOldRight = after.x + EPS >= before.right;
  const topMovedPastOldBottom = after.y + EPS >= before.bottom;
  return leftMovedPastOldRight && topMovedPastOldBottom && after.wPx + 1 >= MIN_PX && after.hPx + 1 >= MIN_PX;
}

test('callout text-box resize leftovers: flip + knee rollback', async ({ page }) => {
  await openEditor(page);

  // Arrow above-left, box mid-page so the knee sits between them.
  // Flip tl past br expands AWAY from that knee; grow tl toward the
  // knee swallows it and must roll back.
  const calloutId = await createCallout(page, 'lf-1', {
    x0: 0.14,
    y0: 0.18,
    x1: 0.42,
    y1: 0.46,
  });
  await selectUntilCorners(page, calloutId);

  const parts = await page.evaluate((cid) => (
    [...new Set([...document.querySelectorAll(`[data-callout-id="${cid}"] [data-callout-part]`)]
      .map((el) => el.getAttribute('data-callout-part'))
      .filter(Boolean))]
  ), calloutId);
  for (const part of ['textBox-tl', 'textBox-tr', 'textBox-bl', 'textBox-br', 'knee']) {
    expect(parts, `handle ${part}`).toContain(part);
  }

  // Intended: live flip past the opposite corner (tl → past br).
  const preFlip = await calloutBox(page, calloutId);
  expect(preFlip, 'stored text box').toBeTruthy();
  expect(preFlip.knee, 'knee present').toBeTruthy();
  await dragHandle(page, calloutId, 'textBox-tl', preFlip.wPx + 48, preFlip.hPx + 28);
  let afterFlip = null;
  await expect.poll(async () => {
    afterFlip = await calloutBox(page, calloutId);
    return flippedPastOpposite(preFlip, afterFlip);
  }, { timeout: 8_000 }).toBe(true);
  expect(afterFlip.x, 'flipped left is at/after old right').toBeGreaterThanOrEqual(preFlip.right - EPS);
  expect(afterFlip.y, 'flipped top is at/after old bottom').toBeGreaterThanOrEqual(preFlip.bottom - EPS);
  expect(afterFlip.wPx, 'flip width >= 20').toBeGreaterThanOrEqual(MIN_PX - 1);
  expect(almostEqPt(afterFlip.knee, preFlip.knee), 'flip away from knee keeps knee').toBe(true);

  // Edge: undo after flip restores pre-drag size + origin.
  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await calloutBox(page, calloutId);
    return almostEqNum(afterUndo.w, preFlip.w)
      && almostEqNum(afterUndo.h, preFlip.h)
      && almostEqNum(afterUndo.x, preFlip.x)
      && almostEqNum(afterUndo.y, preFlip.y);
  }, { timeout: 8_000 }).toBe(true);

  // Intended: resize-into-knee invalid-drop rollback.
  await selectUntilCorners(page, calloutId);
  const preKnee = await calloutBox(page, calloutId);
  const pg = await pageBox(page, 1);
  const tlHandle = handleLocator(page, calloutId, 'textBox-tl');
  const tlBox = await tlHandle.boundingBox();
  expect(tlBox, 'tl handle for knee-swallow').toBeTruthy();
  const kneeScreen = {
    x: pg.x + preKnee.knee.x * pg.width,
    y: pg.y + preKnee.knee.y * pg.height,
  };
  const swallowDx = (kneeScreen.x - 16) - (tlBox.x + tlBox.width / 2);
  const swallowDy = (kneeScreen.y - 16) - (tlBox.y + tlBox.height / 2);
  expect(swallowDx, 'knee is left of tl (grow toward it)').toBeLessThan(-4);
  expect(swallowDy, 'knee is above tl (grow toward it)').toBeLessThan(-4);
  await dragHandle(page, calloutId, 'textBox-tl', swallowDx, swallowDy);
  let afterRollback = null;
  await expect.poll(async () => {
    afterRollback = await calloutBox(page, calloutId);
    return almostEqNum(afterRollback.w, preKnee.w)
      && almostEqNum(afterRollback.h, preKnee.h)
      && almostEqNum(afterRollback.x, preKnee.x)
      && almostEqNum(afterRollback.y, preKnee.y);
  }, { timeout: 8_000 }).toBe(true);
  expect(almostEqPt(afterRollback.knee, preKnee.knee), 'rollback restores knee').toBe(true);

  // Break: Pen armed — creation intercepts; flip is a no-op.
  await selectUntilCorners(page, calloutId);
  const prePen = await calloutBox(page, calloutId);
  await page.keyboard.press('p');
  await dragHandle(page, calloutId, 'textBox-tl', prePen.wPx + 40, prePen.hPx + 24);
  const afterPen = await calloutBox(page, calloutId);
  expect(almostEqNum(afterPen.w, prePen.w) && almostEqNum(afterPen.h, prePen.h), 'Pen-armed flip is no-op').toBe(true);
  expect(almostEqNum(afterPen.x, prePen.x) && almostEqNum(afterPen.y, prePen.y), 'Pen-armed origin stays').toBe(true);
  await selectMode(page);

  // Break: nothing selected — empty-page drag does not flip or resize.
  await page.mouse.click(18, 220);
  const preEmpty = await calloutBox(page, calloutId);
  const emptyBox = await pageBox(page, 1);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.84, emptyBox.y + emptyBox.height * 0.12);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.92, emptyBox.y + emptyBox.height * 0.20, { steps: 6 });
  await page.mouse.up();
  const afterEmpty = await calloutBox(page, calloutId);
  expect(almostEqNum(afterEmpty.w, preEmpty.w) && almostEqNum(afterEmpty.h, preEmpty.h), 'empty drag leaves size').toBe(true);
  expect(almostEqNum(afterEmpty.x, preEmpty.x) && almostEqNum(afterEmpty.y, preEmpty.y), 'empty drag leaves origin').toBe(true);

  // Edge: zoom then flip — viewBox owns scale.
  const zoomIn = page.getByRole('button', { name: /Zoom in/i }).first();
  if (await zoomIn.count()) {
    await zoomIn.click();
    await zoomIn.click();
  }
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  expect(viewBox, 'viewBox present').toBeTruthy();
  expect(viewBox.startsWith('0 0 '), 'viewBox owns scale').toBe(true);
  await selectUntilCorners(page, calloutId);
  const preZoom = await calloutBox(page, calloutId);
  await dragHandle(page, calloutId, 'textBox-tl', preZoom.wPx + 44, preZoom.hPx + 26);
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await calloutBox(page, calloutId);
    return flippedPastOpposite(preZoom, afterZoom);
  }, { timeout: 8_000 }).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const restored = await calloutBox(page, calloutId);
    return almostEqNum(restored.w, preZoom.w) && almostEqNum(restored.x, preZoom.x);
  }, { timeout: 8_000 }).toBe(true);

  // Edge: second callout flip does not change the first.
  const secondId = await createCallout(page, 'lf-2', {
    x0: 0.62,
    y0: 0.16,
    x1: 0.80,
    y1: 0.32,
  });
  expect(secondId).not.toBe(calloutId);
  const firstFrozen = await calloutBox(page, calloutId);
  await selectUntilCorners(page, secondId);
  const secondBefore = await calloutBox(page, secondId);
  await dragHandle(page, secondId, 'textBox-tl', secondBefore.wPx + 40, secondBefore.hPx + 22);
  let secondAfter = null;
  await expect.poll(async () => {
    secondAfter = await calloutBox(page, secondId);
    return flippedPastOpposite(secondBefore, secondAfter);
  }, { timeout: 8_000 }).toBe(true);
  const firstAfterSecond = await calloutBox(page, calloutId);
  expect(almostEqNum(firstAfterSecond.w, firstFrozen.w) && almostEqNum(firstAfterSecond.h, firstFrozen.h), 'first size stays').toBe(true);
  expect(almostEqNum(firstAfterSecond.x, firstFrozen.x) && almostEqNum(firstAfterSecond.y, firstFrozen.y), 'first origin stays').toBe(true);
  expect(almostEqPt(firstAfterSecond.knee, firstFrozen.knee), 'first knee stays').toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('CALLOUT_TEXTBOX_RESIZE_LEFTOVERS_PROOF', JSON.stringify({
    calloutId,
    secondId,
    handles: parts,
    flip: {
      dx: afterFlip.x - preFlip.x,
      dy: afterFlip.y - preFlip.y,
      pastOpposite: flippedPastOpposite(preFlip, afterFlip),
    },
    undoRestored: almostEqNum(afterUndo.w, preFlip.w) && almostEqNum(afterUndo.x, preFlip.x),
    kneeRollback: {
      w: afterRollback.w,
      h: afterRollback.h,
      restored: almostEqNum(afterRollback.w, preKnee.w) && almostEqNum(afterRollback.x, preKnee.x),
    },
    penArmedNoop: almostEqNum(afterPen.w, prePen.w),
    emptyNoop: almostEqNum(afterEmpty.w, preEmpty.w),
    viewBox,
    zoomThenFlip: flippedPastOpposite(preZoom, afterZoom),
    secondDidNotMoveFirst: almostEqNum(firstAfterSecond.w, firstFrozen.w),
  }));
});
