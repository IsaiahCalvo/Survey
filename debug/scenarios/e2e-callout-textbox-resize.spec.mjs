import { test, expect } from '@playwright/test';

// Callout text-box CORNER resize (textBox-tl / tr / bl / br).
// Knee / leader / arrowTip / text-box *move* is e2e-callout-knee-drag.
// T-02 create/clone + clipboard last-writer are already proven.
// SVG default (not ?renderer=canvas). Not leftover-18.
// Do not replay Keep active, Survey notes, Mirror V, page Cut/Copy/Paste,
// module Next/Prev, thumbnail, Fit height, Bookmarks, Eraser/Counter,
// F3, Search, keyboard, swatches, callout clipboard paste, thin leftovers,
// PDF links, History, pages insert/rotate/move/Duplicate, flatten, mobile.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const EPS = 0.008;
const MIN_PX = 20;
const CORNERS = ['br', 'tr', 'bl', 'tl'];
const OUTWARD = {
  br: { dx: 32, dy: 28 },
  tr: { dx: 32, dy: -28 },
  bl: { dx: -32, dy: 28 },
  tl: { dx: -32, dy: -28 },
};

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

function oppositeStayed(corner, before, after) {
  if (corner === 'br') return almostEqNum(after.x, before.x) && almostEqNum(after.y, before.y);
  if (corner === 'bl') return almostEqNum(after.right, before.right) && almostEqNum(after.y, before.y);
  if (corner === 'tr') return almostEqNum(after.x, before.x) && almostEqNum(after.bottom, before.bottom);
  return almostEqNum(after.right, before.right) && almostEqNum(after.bottom, before.bottom);
}

test('callout text-box corner resize (tl/tr/bl/br)', async ({ page }) => {
  await openEditor(page);

  const calloutId = await createCallout(page, 'cr-1', {
    x0: 0.16,
    y0: 0.22,
    x1: 0.46,
    y1: 0.50,
  });
  await selectUntilCorners(page, calloutId);

  const parts = await page.evaluate((cid) => (
    [...new Set([...document.querySelectorAll(`[data-callout-id="${cid}"] [data-callout-part]`)]
      .map((el) => el.getAttribute('data-callout-part'))
      .filter(Boolean))]
  ), calloutId);
  for (const part of ['textBox-tl', 'textBox-tr', 'textBox-bl', 'textBox-br']) {
    expect(parts, `handle ${part}`).toContain(part);
  }

  const beforeAny = await calloutBox(page, calloutId);
  expect(beforeAny, 'stored text box').toBeTruthy();
  expect(beforeAny.wPx, 'default-ish width').toBeGreaterThan(30);
  expect(beforeAny.hPx, 'default-ish height').toBeGreaterThan(18);

  const cornerProof = {};
  for (const corner of CORNERS) {
    await selectUntilCorners(page, calloutId);
    const before = await calloutBox(page, calloutId);
    const { dx, dy } = OUTWARD[corner];
    await dragHandle(page, calloutId, `textBox-${corner}`, dx, dy);
    let after = null;
    await expect.poll(async () => {
      after = await calloutBox(page, calloutId);
      return Math.abs(after.w - before.w) + Math.abs(after.h - before.h);
    }, { timeout: 8_000 }).toBeGreaterThan(EPS);
    expect(after.wPx + after.hPx, `${corner} grew`).toBeGreaterThan(before.wPx + before.hPx);
    expect(oppositeStayed(corner, before, after), `${corner} opposite anchor stayed`).toBe(true);
    cornerProof[corner] = {
      dw: after.w - before.w,
      dh: after.h - before.h,
      oppositeStayed: true,
    };
  }

  // Edge: min-size clamp — inward past 20px floors at 20 page-px.
  await selectUntilCorners(page, calloutId);
  const preClamp = await calloutBox(page, calloutId);
  const inwardX = -(Math.max(8, preClamp.wPx - 8));
  const inwardY = -(Math.max(8, preClamp.hPx - 8));
  await dragHandle(page, calloutId, 'textBox-br', inwardX, inwardY);
  let afterClamp = null;
  await expect.poll(async () => {
    afterClamp = await calloutBox(page, calloutId);
    return afterClamp.wPx + afterClamp.hPx;
  }, { timeout: 8_000 }).toBeLessThan(preClamp.wPx + preClamp.hPx - 2);
  expect(afterClamp.wPx, 'width >= 20px').toBeGreaterThanOrEqual(MIN_PX - 1);
  expect(afterClamp.hPx, 'height >= 20px').toBeGreaterThanOrEqual(MIN_PX - 1);
  expect(afterClamp.wPx, 'width near floor').toBeLessThanOrEqual(MIN_PX + 6);
  expect(afterClamp.hPx, 'height near floor').toBeLessThanOrEqual(MIN_PX + 6);
  expect(almostEqNum(afterClamp.x, preClamp.x), 'br inward keeps left').toBe(true);
  expect(almostEqNum(afterClamp.y, preClamp.y), 'br inward keeps top').toBe(true);

  // Break: Pen armed — creation intercepts; corner resize is a no-op.
  await selectUntilCorners(page, calloutId);
  const prePen = await calloutBox(page, calloutId);
  const inkBefore = await page.locator('[data-svg-annotation-layer="1"] > g[data-anno-id]').count();
  await page.keyboard.press('p');
  await dragHandle(page, calloutId, 'textBox-br', 36, 28);
  const afterPen = await calloutBox(page, calloutId);
  expect(almostEqNum(afterPen.w, prePen.w) && almostEqNum(afterPen.h, prePen.h), 'Pen-armed resize is no-op').toBe(true);
  expect(almostEqNum(afterPen.x, prePen.x) && almostEqNum(afterPen.y, prePen.y), 'Pen-armed box stays').toBe(true);
  const inkAfter = await page.locator('[data-svg-annotation-layer="1"] > g[data-anno-id]').count();
  expect(inkAfter, 'Pen stroke or unchanged count').toBeGreaterThanOrEqual(inkBefore);
  await selectMode(page);

  // Break: nothing selected — empty-page drag does not resize.
  await page.mouse.click(18, 220);
  const preEmpty = await calloutBox(page, calloutId);
  const emptyBox = await pageBox(page, 1);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.84, emptyBox.y + emptyBox.height * 0.12);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.92, emptyBox.y + emptyBox.height * 0.20, { steps: 6 });
  await page.mouse.up();
  const afterEmpty = await calloutBox(page, calloutId);
  expect(almostEqNum(afterEmpty.w, preEmpty.w) && almostEqNum(afterEmpty.h, preEmpty.h), 'empty drag leaves size').toBe(true);

  // Edge: undo after br grow restores pre-drag size.
  await selectUntilCorners(page, calloutId);
  const preUndo = await calloutBox(page, calloutId);
  await dragHandle(page, calloutId, 'textBox-br', 36, 24);
  let midUndo = null;
  await expect.poll(async () => {
    midUndo = await calloutBox(page, calloutId);
    return (midUndo.w - preUndo.w) + (midUndo.h - preUndo.h);
  }, { timeout: 8_000 }).toBeGreaterThan(EPS);
  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await calloutBox(page, calloutId);
    return almostEqNum(afterUndo.w, preUndo.w) && almostEqNum(afterUndo.h, preUndo.h);
  }, { timeout: 8_000 }).toBe(true);

  // Edge: zoom then resize — viewBox owns scale.
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
  await dragHandle(page, calloutId, 'textBox-br', 28, 20);
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await calloutBox(page, calloutId);
    return Math.abs(afterZoom.w - preZoom.w) + Math.abs(afterZoom.h - preZoom.h);
  }, { timeout: 8_000 }).toBeGreaterThan(EPS);
  expect(oppositeStayed('br', preZoom, afterZoom), 'zoom resize keeps tl').toBe(true);

  // Edge: second callout resize does not change the first.
  const secondId = await createCallout(page, 'cr-2', {
    x0: 0.60,
    y0: 0.18,
    x1: 0.78,
    y1: 0.34,
  });
  expect(secondId).not.toBe(calloutId);
  const firstFrozen = await calloutBox(page, calloutId);
  await selectUntilCorners(page, secondId);
  const secondBefore = await calloutBox(page, secondId);
  await dragHandle(page, secondId, 'textBox-br', 30, 22);
  let secondAfter = null;
  await expect.poll(async () => {
    secondAfter = await calloutBox(page, secondId);
    return Math.abs(secondAfter.w - secondBefore.w) + Math.abs(secondAfter.h - secondBefore.h);
  }, { timeout: 8_000 }).toBeGreaterThan(EPS);
  const firstAfterSecond = await calloutBox(page, calloutId);
  expect(almostEqNum(firstAfterSecond.w, firstFrozen.w) && almostEqNum(firstAfterSecond.h, firstFrozen.h), 'first size stays').toBe(true);
  expect(almostEqPt(firstAfterSecond.knee, firstFrozen.knee), 'first knee stays').toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('CALLOUT_TEXTBOX_RESIZE_PROOF', JSON.stringify({
    calloutId,
    secondId,
    handles: parts,
    cornerProof,
    clamp: { wPx: afterClamp.wPx, hPx: afterClamp.hPx, minPx: MIN_PX },
    penArmedNoop: almostEqNum(afterPen.w, prePen.w),
    emptyNoop: almostEqNum(afterEmpty.w, preEmpty.w),
    undoRestored: almostEqNum(afterUndo.w, preUndo.w),
    viewBox,
    zoomThenResize: { dw: afterZoom.w - preZoom.w, dh: afterZoom.h - preZoom.h },
    secondDidNotMoveFirst: almostEqNum(firstAfterSecond.w, firstFrozen.w),
  }));
});
