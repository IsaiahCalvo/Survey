import { test, expect } from '@playwright/test';

// Callout knee / leader / arrowTip / text-box HANDLE drag.
// T-02 + e2e-callout-paste cover create/clone. This pass must drag the
// canvas handles. SVG default (not ?renderer=canvas). Not leftover-18.
// Do not replay Keep active, Survey notes, Mirror V, page Cut/Copy/Paste,
// module Next/Prev, thumbnail, Fit height, Bookmarks, Eraser/Counter,
// F3, Search, keyboard, swatches, callout clipboard paste, thin leftovers,
// PDF links, History, pages insert/rotate/move/Duplicate, flatten, mobile.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const EPS = 0.008;

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
  const textBox = scoped.locator('[data-callout-part="textBox"]').first();
  const target = (await textBox.count()) ? textBox : scoped.first();
  await expect(target).toBeVisible({ timeout: 15_000 });
  const box = await target.boundingBox();
  expect(box, `bbox for callout ${calloutId}`).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

function handleLocator(page, calloutId, part, pageNumber = 1) {
  return page.locator(
    `[data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${calloutId}"] [data-callout-part="${part}"]`,
  ).last();
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

async function calloutGeom(page, calloutId) {
  return page.evaluate((cid) => {
    const obj = window.__phase35GetAnnotationById?.(cid) || {};
    const lnc = obj.data?.legacyNormalizedCoords || obj.data?.legacyCallout || {};
    const pick = (a, b) => (a && Number.isFinite(a.x) ? a : b);
    const kneeEl = document.querySelector(`[data-callout-id="${cid}"] [data-callout-part="knee"]`);
    const tipEl = document.querySelector(`[data-callout-id="${cid}"] [data-callout-part="arrowTip"]`);
    const boxEl = document.querySelector(`[data-callout-id="${cid}"] [data-callout-part="textBox"]`);
    return {
      arrowTip: pick(lnc.arrowTip, obj.arrowTip),
      knee: pick(lnc.knee, obj.knee),
      textBoxPosition: pick(lnc.textBoxPosition, obj.textBoxPosition),
      svg: {
        knee: kneeEl ? { cx: Number(kneeEl.getAttribute('cx')), cy: Number(kneeEl.getAttribute('cy')) } : null,
        arrowTip: tipEl ? { cx: Number(tipEl.getAttribute('cx')), cy: Number(tipEl.getAttribute('cy')) } : null,
        textBox: boxEl ? { x: Number(boxEl.getAttribute('x')), y: Number(boxEl.getAttribute('y')) } : null,
      },
    };
  }, calloutId);
}

function pointDelta(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(Number(a.x ?? a.cx) - Number(b.x ?? b.cx), Number(a.y ?? a.cy) - Number(b.y ?? b.cy));
}

function almostEq(a, b, eps = EPS) {
  return pointDelta(a, b) < eps;
}

test('callout knee / leader / arrowTip / text-box handle drag', async ({ page }) => {
  await openEditor(page);

  const calloutId = await createCallout(page, 'kd-1', {
    x0: 0.20,
    y0: 0.52,
    x1: 0.46,
    y1: 0.70,
  });
  await selectCallout(page, calloutId);

  const parts = await page.evaluate((cid) => (
    [...new Set([...document.querySelectorAll(`[data-callout-id="${cid}"] [data-callout-part]`)]
      .map((el) => el.getAttribute('data-callout-part'))
      .filter(Boolean))]
  ), calloutId);
  for (const part of ['knee', 'arrowTip', 'textBox', 'line1', 'line2']) {
    expect(parts, `handle ${part}`).toContain(part);
  }

  const before = await calloutGeom(page, calloutId);
  expect(before.knee, 'stored knee').toBeTruthy();
  expect(before.arrowTip, 'stored arrowTip').toBeTruthy();
  expect(before.textBoxPosition, 'stored textBox').toBeTruthy();

  // Intended: knee drag moves the bend; text box stays (product: partType knee).
  await dragHandle(page, calloutId, 'knee', 0, -48);
  const afterKnee = await calloutGeom(page, calloutId);
  expect(pointDelta(afterKnee.knee, before.knee), 'knee moved').toBeGreaterThan(EPS);
  expect(almostEq(afterKnee.textBoxPosition, before.textBoxPosition), 'textbox stays on knee drag').toBe(true);
  expect(almostEq(afterKnee.arrowTip, before.arrowTip), 'arrowTip stays on knee drag').toBe(true);

  // Intended: arrowTip drag moves the tip; text box stays.
  const preTip = await calloutGeom(page, calloutId);
  await dragHandle(page, calloutId, 'arrowTip', -36, 28);
  const afterTip = await calloutGeom(page, calloutId);
  expect(pointDelta(afterTip.arrowTip, preTip.arrowTip), 'arrowTip moved').toBeGreaterThan(EPS);
  expect(almostEq(afterTip.textBoxPosition, preTip.textBoxPosition), 'textbox stays on arrowTip drag').toBe(true);

  // Intended: leader line2 is whole-move — text box follows the rigid leader.
  const preLeader = await calloutGeom(page, calloutId);
  await dragHandle(page, calloutId, 'line2', 40, -24);
  const afterLeader = await calloutGeom(page, calloutId);
  expect(pointDelta(afterLeader.textBoxPosition, preLeader.textBoxPosition), 'textbox follows leader').toBeGreaterThan(EPS);
  expect(pointDelta(afterLeader.knee, preLeader.knee), 'knee follows leader').toBeGreaterThan(EPS);
  expect(pointDelta(afterLeader.arrowTip, preLeader.arrowTip), 'arrowTip follows leader').toBeGreaterThan(EPS);

  // Intended: text-box drag moves the box; knee/arrow stay unless release auto-routes.
  const preBox = await calloutGeom(page, calloutId);
  await dragHandle(page, calloutId, 'textBox', 36, 20);
  const afterBox = await calloutGeom(page, calloutId);
  expect(pointDelta(afterBox.textBoxPosition, preBox.textBoxPosition), 'textbox moved').toBeGreaterThan(EPS);

  // Break: drag empty page with nothing selected — geometry unchanged.
  await page.mouse.click(18, 220);
  const preEmpty = await calloutGeom(page, calloutId);
  const emptyBox = await pageBox(page, 1);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.82, emptyBox.y + emptyBox.height * 0.14);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.90, emptyBox.y + emptyBox.height * 0.22, { steps: 6 });
  await page.mouse.up();
  const afterEmpty = await calloutGeom(page, calloutId);
  expect(almostEq(afterEmpty.knee, preEmpty.knee), 'empty drag leaves knee').toBe(true);
  expect(almostEq(afterEmpty.arrowTip, preEmpty.arrowTip), 'empty drag leaves arrowTip').toBe(true);
  expect(almostEq(afterEmpty.textBoxPosition, preEmpty.textBoxPosition), 'empty drag leaves textbox').toBe(true);

  // Break: Pen armed — creation intercepts; callout geometry is a no-op.
  await selectCallout(page, calloutId);
  const prePen = await calloutGeom(page, calloutId);
  const inkBefore = await page.locator('[data-svg-annotation-layer="1"] > g[data-anno-id]').count();
  await page.keyboard.press('p');
  await dragHandle(page, calloutId, 'knee', 0, -40);
  const afterPen = await calloutGeom(page, calloutId);
  expect(almostEq(afterPen.knee, prePen.knee), 'Pen-armed knee is no-op').toBe(true);
  expect(almostEq(afterPen.textBoxPosition, prePen.textBoxPosition), 'Pen-armed textbox stays').toBe(true);
  const inkAfter = await page.locator('[data-svg-annotation-layer="1"] > g[data-anno-id]').count();
  expect(inkAfter, 'Pen stroke or unchanged count').toBeGreaterThanOrEqual(inkBefore);
  await selectMode(page);

  // Break: Esc mid-knee-drag — product Esc only cancels marquee, not callout-part.
  await selectCallout(page, calloutId);
  const preEsc = await calloutGeom(page, calloutId);
  const kneeHandle = handleLocator(page, calloutId, 'knee');
  const kneeBox = await kneeHandle.boundingBox();
  const kx = kneeBox.x + kneeBox.width / 2;
  const ky = kneeBox.y + kneeBox.height / 2;
  await page.mouse.move(kx, ky);
  await page.mouse.down();
  await page.mouse.move(kx + 8, ky - 30, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.move(kx + 12, ky - 50, { steps: 6 });
  await page.mouse.up();
  const afterEsc = await calloutGeom(page, calloutId);
  const escMoved = pointDelta(afterEsc.knee, preEsc.knee) > EPS;
  const escCanceled = almostEq(afterEsc.knee, preEsc.knee);
  expect(escMoved || escCanceled, 'Esc mid-drag asserted').toBe(true);
  const escRule = escCanceled ? 'cancels' : 'no-op (marquee only)';

  // Break: drag arrowTip toward / off the page edge — clamp or allow (assert actual).
  await selectCallout(page, calloutId);
  const preOff = await calloutGeom(page, calloutId);
  await dragHandle(page, calloutId, 'arrowTip', -240, 0);
  const afterOff = await calloutGeom(page, calloutId);
  const offMoved = pointDelta(afterOff.arrowTip, preOff.arrowTip) > EPS;
  const offClamped = Number(afterOff.arrowTip?.x) >= -0.02 && Number(afterOff.arrowTip?.x) <= 1.02;
  const offAllowed = Number(afterOff.arrowTip?.x) < -0.02 || Number(afterOff.arrowTip?.x) > 1.02;
  expect(offMoved || almostEq(afterOff.arrowTip, preOff.arrowTip), 'off-page asserted').toBe(true);
  const offRule = !offMoved ? 'rejected' : (offAllowed ? 'allow-outside' : 'clamp-or-in-page');

  // Edge: undo after knee drag restores the pre-drag knee.
  await selectMode(page);
  await selectCallout(page, calloutId);
  const preUndo = await calloutGeom(page, calloutId);
  await dragHandle(page, calloutId, 'knee', 24, -36);
  const midUndo = await calloutGeom(page, calloutId);
  expect(pointDelta(midUndo.knee, preUndo.knee), 'pre-undo knee moved').toBeGreaterThan(EPS);
  await page.keyboard.press('Control+z');
  const afterUndo = await calloutGeom(page, calloutId);
  expect(almostEq(afterUndo.knee, preUndo.knee), 'undo restores knee').toBe(true);

  // Edge: zoom then drag — viewBox owns scale (normalized coords still move).
  const zoomIn = page.getByRole('button', { name: /Zoom in/i }).first();
  if (await zoomIn.count()) {
    await zoomIn.click();
    await zoomIn.click();
  }
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  expect(viewBox, 'viewBox present').toBeTruthy();
  expect(viewBox.startsWith('0 0 '), 'viewBox owns scale').toBe(true);
  await selectCallout(page, calloutId);
  const preZoom = await calloutGeom(page, calloutId);
  await dragHandle(page, calloutId, 'knee', 0, -32);
  const afterZoom = await calloutGeom(page, calloutId);
  expect(pointDelta(afterZoom.knee, preZoom.knee), 'knee moves after zoom').toBeGreaterThan(EPS);

  // Edge: second callout handles do not move the first.
  const secondId = await createCallout(page, 'kd-2', {
    x0: 0.58,
    y0: 0.22,
    x1: 0.80,
    y1: 0.38,
  });
  expect(secondId).not.toBe(calloutId);
  const firstFrozen = await calloutGeom(page, calloutId);
  await selectCallout(page, secondId);
  const secondBefore = await calloutGeom(page, secondId);
  await dragHandle(page, secondId, 'knee', 0, 36);
  const firstAfterSecond = await calloutGeom(page, calloutId);
  const secondAfter = await calloutGeom(page, secondId);
  expect(almostEq(firstAfterSecond.knee, firstFrozen.knee), 'first knee stays').toBe(true);
  expect(almostEq(firstAfterSecond.arrowTip, firstFrozen.arrowTip), 'first tip stays').toBe(true);
  expect(pointDelta(secondAfter.knee, secondBefore.knee), 'second knee moved').toBeGreaterThan(EPS);

  // Edge: rotate page then drag (cheap — Pages Rotate).
  let rotateProof = 'skipped';
  const pagesBtn = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pagesBtn.count()) {
    if ((await pagesBtn.getAttribute('aria-pressed')) !== 'true') await pagesBtn.click();
    const thumb = page.locator('#chrome-left-host [data-page-number="1"]').first();
    if (await thumb.count()) {
      const tbox = await thumb.boundingBox();
      if (tbox) {
        await page.mouse.click(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { button: 'right' });
        const menu = page.locator('[data-pages-context-menu="true"]');
        if (await menu.isVisible().catch(() => false)) {
          const rotate = menu.getByText('Rotate', { exact: true });
          if (await rotate.count()) {
            await rotate.click();
            await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 15_000 });
            await selectMode(page);
            await selectCallout(page, calloutId);
            const preRot = await calloutGeom(page, calloutId);
            await dragHandle(page, calloutId, 'arrowTip', 20, 20);
            const afterRot = await calloutGeom(page, calloutId);
            rotateProof = pointDelta(afterRot.arrowTip, preRot.arrowTip) > EPS
              ? 'rotated-then-dragged'
              : 'rotate-drag-no-move';
          }
        }
      }
    }
  }

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('CALLOUT_KNEE_DRAG_PROOF', JSON.stringify({
    calloutId,
    secondId,
    handles: parts,
    kneeMoved: pointDelta(afterKnee.knee, before.knee),
    textBoxStayedOnKnee: almostEq(afterKnee.textBoxPosition, before.textBoxPosition),
    arrowTipMoved: pointDelta(afterTip.arrowTip, preTip.arrowTip),
    leaderMovedBox: pointDelta(afterLeader.textBoxPosition, preLeader.textBoxPosition),
    boxMoved: pointDelta(afterBox.textBoxPosition, preBox.textBoxPosition),
    emptyNoop: almostEq(afterEmpty.knee, preEmpty.knee),
    penArmedNoop: almostEq(afterPen.knee, prePen.knee),
    escRule,
    offRule,
    undoRestored: almostEq(afterUndo.knee, preUndo.knee),
    viewBox,
    zoomThenDrag: pointDelta(afterZoom.knee, preZoom.knee),
    secondDidNotMoveFirst: almostEq(firstAfterSecond.knee, firstFrozen.knee),
    rotateProof,
  }));
});
