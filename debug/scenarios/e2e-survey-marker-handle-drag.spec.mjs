import { test, expect } from '@playwright/test';

// Unique leftover after counter nubbin / Shift-orbit: survey-marker
// move / resize / rotate handles on a *placed* marker.
// Not U-01 Walls stamp-create, not Keep-active after-place, not notes,
// not module Next/Prev. Not E-01 rect bbox, not vertex-N, not nubbin.
// Ellipse radii / ink vertices / stamp / Print / Group stay omitted.
// Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

const HANDLE_DRAG = {
  br: { dx: 56, dy: 40 },
  tl: { dx: -44, dy: -32 },
  tr: { dx: 52, dy: -32 },
  bl: { dx: -44, dy: 40 },
  mr: { dx: 56, dy: 0 },
  ml: { dx: -52, dy: 0 },
  mb: { dx: 0, dy: 44 },
  mt: { dx: 0, dy: -48 },
  mtr: { dx: 88, dy: 28 },
};

async function openEditor(page, { width = 1440, height = 900 } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(SURVEY_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
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

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
  return { raw, W: parts[2] || 612, H: parts[3] || 792 };
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

function keepCheckbox(page) {
  return page.locator('#chrome-sub-toolbar-host').getByRole('checkbox', { name: 'Keep active' });
}

async function enterSurveyWalls(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
}

async function armWalls(page) {
  const hostWalls = () => page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (!(await hostWalls().count()) || !(await hostWalls().first().isVisible().catch(() => false))) {
    const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
    if (await survey.count()) await survey.click();
    const picker = page.getByRole('heading', { name: 'Choose survey template' });
    if (await picker.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
    }
  }
  const walls = (await hostWalls().count())
    ? hostWalls()
    : page.getByRole('button', { name: 'Walls', exact: true });
  await expect(walls.first()).toBeVisible({ timeout: 15_000 });
  if (!String(await walls.first().getAttribute('class') || '').includes('btn-active')) {
    await walls.first().click();
  }
}

async function dragOnLayer(page, { x0, y0, x1, y1 }) {
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  expect(box, 'annotation layer geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
  return box;
}

async function finishMarkerName(page, name) {
  const field = page.getByPlaceholder('Enter name');
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0, { timeout: 8_000 });
}

async function markerIds(page) {
  return page.locator('[data-survey-marker-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean),
  );
}

async function placeMarker(page, name, coords) {
  const before = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, coords);
  await finishMarkerName(page, name);
  let created = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected committed survey-marker ${name}` }).not.toBeNull();
  return created;
}

async function markerGeom(page, id) {
  return page.evaluate((annoId) => {
    const group = document.querySelector(`[data-survey-marker-id="${annoId}"]`);
    const rect = group?.querySelector('rect:not([data-survey-marker-hit-target])')
      || group?.querySelector('rect');
    const x = Number(rect?.getAttribute('x'));
    const y = Number(rect?.getAttribute('y'));
    const width = Number(rect?.getAttribute('width'));
    const height = Number(rect?.getAttribute('height'));
    const transform = rect?.getAttribute('transform') || '';
    const rot = /rotate\(\s*([-0-9.]+)/.exec(transform);
    return {
      id: annoId,
      x,
      y,
      width,
      height,
      angle: rot ? Number(rot[1]) : 0,
      transform,
    };
  }, id);
}

function almostEq(a, b, eps = 2.5) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

function angleDelta(a, b) {
  const delta = ((Number(b) - Number(a) + 540) % 360) - 180;
  return Math.abs(delta);
}

function posDelta(a, b) {
  return Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
}

function sizeDelta(a, b) {
  return {
    dw: Number(b.width) - Number(a.width),
    dh: Number(b.height) - Number(a.height),
  };
}

function sameSizeAngle(a, b, eps = 2.5) {
  return almostEq(a.width, b.width, eps)
    && almostEq(a.height, b.height, eps)
    && angleDelta(a.angle, b.angle) < 1;
}

async function listHandleIds(page) {
  const resize = await page.locator('[data-survey-marker-id] [data-resize-handle]').evaluateAll((nodes) => (
    [...new Set(nodes.map((node) => node.getAttribute('data-resize-handle')).filter(Boolean))]
  ));
  const rotate = await page.locator('[data-survey-marker-id] [data-rotation-handle="mtr"]').count();
  return { resize, rotate: rotate > 0 };
}

async function selectUntilHandles(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    const geom = await markerGeom(page, id);
    const hit = page.locator(`[data-survey-marker-id="${id}"] [data-survey-marker-hit-target="true"]`).first();
    if (await hit.count()) {
      await hit.click({ force: true });
    } else {
      const box = await pageBox(page);
      const { W, H } = await pageViewBox(page);
      await page.mouse.click(
        box.x + ((geom.x + geom.width / 2) / W) * box.width,
        box.y + ((geom.y + geom.height / 2) / H) * box.height,
      );
    }
    const handles = await listHandleIds(page);
    return handles.resize.length + (handles.rotate ? 1 : 0);
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

async function dragSelector(page, selector, dx, dy, { originX = 0, originY = 0 } = {}) {
  const handle = page.locator(selector).first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, selector).toBeTruthy();
  const start = {
    x: box.x + box.width / 2 + originX,
    y: box.y + box.height / 2 + originY,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
  return start;
}

async function dragHandle(page, id, dx, dy, origin = {}) {
  const selector = id === 'mtr'
    ? '[data-survey-marker-id] [data-rotation-handle="mtr"]'
    : `[data-survey-marker-id] [data-resize-handle="${id}"]`;
  return dragSelector(page, selector, dx, dy, origin);
}

async function clickEmpty(page) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * 0.92, box.y + box.height * 0.08);
}

function handleChanged(id, before, after) {
  const { dw, dh } = sizeDelta(before, after);
  if (id === 'mtr') return angleDelta(before.angle, after.angle) > 8;
  if (id === 'mr' || id === 'ml') return Math.abs(dw) > 8;
  if (id === 'mt' || id === 'mb') return Math.abs(dh) > 8;
  return Math.abs(dw) > 8 || Math.abs(dh) > 8 || posDelta(before, after) > 8;
}

test('survey-marker handle drag intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  const markerA = await placeMarker(page, 'handle-a', { x0: 0.24, y0: 0.36, x1: 0.48, y1: 0.56 });
  const markerB = await placeMarker(page, 'handle-b', { x0: 0.58, y0: 0.30, x1: 0.78, y1: 0.48 });
  await selectUntilHandles(page, markerA);
  const chrome = await listHandleIds(page);
  expect(chrome.resize.length, 'placed marker shows resize handles').toBeGreaterThan(0);
  expect(chrome.rotate, 'placed marker shows mtr').toBe(true);
  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const intended = {};

  // Body move first — before mtr leaves the rotation pill on the centroid.
  await selectUntilHandles(page, markerA);
  const preMove = await markerGeom(page, markerA);
  const hit = page.locator(`[data-survey-marker-id="${markerA}"] [data-survey-marker-hit-target="true"]`);
  await expect(hit).toBeVisible({ timeout: 8_000 });
  const hitBox = await hit.boundingBox();
  expect(hitBox, 'marker hit target').toBeTruthy();
  await hit.hover({ position: { x: Math.max(12, hitBox.width * 0.35), y: Math.max(12, hitBox.height * 0.4) } });
  await page.mouse.down();
  await page.mouse.move(hitBox.x + hitBox.width * 0.35 + 72, hitBox.y + hitBox.height * 0.4 + 56, { steps: 12 });
  await page.mouse.up();
  let afterMove = null;
  await expect.poll(async () => {
    afterMove = await markerGeom(page, markerA);
    return posDelta(preMove, afterMove) > 8 && sameSizeAngle(preMove, afterMove, 4);
  }, { timeout: 8_000 }).toBe(true);
  intended.move = {
    dPos: posDelta(preMove, afterMove),
    dw: afterMove.width - preMove.width,
    dh: afterMove.height - preMove.height,
    dAngle: angleDelta(preMove.angle, afterMove.angle),
  };
  await page.keyboard.press('Control+z');
  await expect.poll(async () => posDelta(preMove, await markerGeom(page, markerA)) < 3)
    .toBe(true);

  const resizeIds = [...chrome.resize];
  if (chrome.rotate) resizeIds.push('mtr');

  for (const handleId of resizeIds) {
    await selectUntilHandles(page, markerA);
    const before = await markerGeom(page, markerA);
    const drag = HANDLE_DRAG[handleId] || { dx: 48, dy: 32 };
    await dragHandle(page, handleId, drag.dx, drag.dy);
    let after = null;
    await expect.poll(async () => {
      after = await markerGeom(page, markerA);
      return handleChanged(handleId, before, after);
    }, { timeout: 8_000, message: `${handleId} should change stored geometry` }).toBe(true);
    intended[handleId] = {
      before,
      after,
      dw: after.width - before.width,
      dh: after.height - before.height,
      dAngle: angleDelta(before.angle, after.angle),
      dPos: posDelta(before, after),
    };
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const restored = await markerGeom(page, markerA);
      return almostEq(restored.x, before.x, 3)
        && almostEq(restored.y, before.y, 3)
        && almostEq(restored.width, before.width, 3)
        && almostEq(restored.height, before.height, 3)
        && angleDelta(restored.angle, before.angle) < 1;
    }, { timeout: 8_000, message: `undo after ${handleId}` }).toBe(true);
  }

  // Re-apply one resize so later undo / isolation have a committed edit.
  await selectUntilHandles(page, markerA);
  const preBr = await markerGeom(page, markerA);
  await dragHandle(page, 'br', 56, 40);
  await expect.poll(async () => handleChanged('br', preBr, await markerGeom(page, markerA)))
    .toBe(true);
  const afterBr = await markerGeom(page, markerA);

  // Edge: undo restores the committed br grow (before later history).
  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await markerGeom(page, markerA);
    return almostEq(afterUndo.width, preBr.width, 3) && almostEq(afterUndo.height, preBr.height, 3);
  }, { timeout: 8_000 }).toBe(true);
  await selectUntilHandles(page, markerA);
  await dragHandle(page, 'br', 56, 40);
  await expect.poll(async () => handleChanged('br', afterUndo, await markerGeom(page, markerA)))
    .toBe(true);

  // Break: empty-page drag with none selected.
  await clickEmpty(page);
  expect(await page.locator('[data-survey-marker-id] [data-resize-handle]').count(), 'deselect hides handles').toBe(0);
  const preEmpty = await markerGeom(page, markerA);
  const emptyCount = (await markerIds(page)).length;
  const emptyBox = await pageBox(page);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.90, emptyBox.y + emptyBox.height * 0.10);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.96, emptyBox.y + emptyBox.height * 0.16, { steps: 6 });
  await page.mouse.up();
  const afterEmpty = await markerGeom(page, markerA);
  expect(posDelta(preEmpty, afterEmpty) < 2, 'empty-page no move').toBe(true);
  expect(sameSizeAngle(preEmpty, afterEmpty), 'empty-page no resize/rotate').toBe(true);
  expect((await markerIds(page)).length, 'empty-page no new marker').toBe(emptyCount);

  // Break: Pen-armed page drag does not edit the stored marker.
  await selectMode(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  const prePen = await markerGeom(page, markerA);
  const penCount = (await markerIds(page)).length;
  const penBox = await pageBox(page);
  await page.mouse.move(penBox.x + penBox.width * 0.16, penBox.y + penBox.height * 0.62);
  await page.mouse.down();
  await page.mouse.move(penBox.x + penBox.width * 0.28, penBox.y + penBox.height * 0.72, { steps: 8 });
  await page.mouse.up();
  const afterPen = await markerGeom(page, markerA);
  expect(posDelta(prePen, afterPen) < 2, 'Pen-armed no move').toBe(true);
  expect(sameSizeAngle(prePen, afterPen), 'Pen-armed no resize/rotate').toBe(true);
  expect((await markerIds(page)).length, 'Pen-armed no new marker').toBe(penCount);
  await selectMode(page);

  const frozenA = await markerGeom(page, markerA);

  await selectUntilHandles(page, markerB);
  const preB = await markerGeom(page, markerB);
  await dragHandle(page, 'br', 48, 32);
  await expect.poll(async () => handleChanged('br', preB, await markerGeom(page, markerB)))
    .toBe(true);
  const afterB = await markerGeom(page, markerB);
  const firstAfterB = await markerGeom(page, markerA);
  expect(posDelta(frozenA, firstAfterB) < 2, 'A isolated').toBe(true);
  expect(sameSizeAngle(frozenA, firstAfterB), 'A size/angle isolated').toBe(true);

  // Edge: Keep-active was on at place; handle drag must not stamp a third.
  const keepCount = (await markerIds(page)).length;
  expect(keepCount, 'A+B placed under Keep-active').toBe(2);
  await selectUntilHandles(page, markerB);
  const preKeep = await markerGeom(page, markerB);
  await dragHandle(page, chrome.resize.includes('mr') ? 'mr' : 'br', 40, chrome.resize.includes('mr') ? 0 : 28);
  await expect.poll(async () => handleChanged(chrome.resize.includes('mr') ? 'mr' : 'br', preKeep, await markerGeom(page, markerB)))
    .toBe(true);
  expect((await markerIds(page)).length, 'Keep-active handle drag does not stamp').toBe(keepCount);

  // Edge: zoom then handle still uses viewBox page-space.
  const zoomIn = page.getByRole('button', { name: /Zoom in/i }).first();
  if (await zoomIn.count()) {
    await zoomIn.click();
    await zoomIn.click();
  }
  const viewBox = (await pageViewBox(page)).raw;
  expect(viewBox.startsWith('0 0 '), 'viewBox owns scale').toBe(true);
  await selectUntilHandles(page, markerA);
  const preZoom = await markerGeom(page, markerA);
  await dragHandle(page, 'br', 48, 32);
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await markerGeom(page, markerA);
    return handleChanged('br', preZoom, afterZoom);
  }, { timeout: 8_000 }).toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 uses the same SVG overlay (no distinct strip — canEnterBBoxEdit
  // is counter/line/poly only). Prove chrome + one drag if hittable.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  const walls390 = page.getByRole('button', { name: /Walls/ }).first();
  await expect(walls390).toBeVisible({ timeout: 15_000 });
  await walls390.evaluate((el) => el.click());
  const before390 = new Set(await markerIds(page));
  await dragOnLayer(page, { x0: 0.22, y0: 0.22, x1: 0.58, y1: 0.40 });
  if (await page.getByPlaceholder('Enter name').count()) {
    await finishMarkerName(page, 'handle-390');
  }
  let mobileId = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    mobileId = ids.find((id) => !before390.has(id)) || null;
    return mobileId;
  }, { timeout: 12_000, message: 'expected a 390 survey-marker' }).not.toBeNull();
  await selectUntilHandles(page, mobileId);
  const mobileChrome = await listHandleIds(page);
  expect(mobileChrome.resize.length, '390 same resize chrome').toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'Resize and rotate' }).count(), '390 no distinct bbox strip').toBe(0);
  const preMobile = await markerGeom(page, mobileId);
  const mobileHandle = mobileChrome.resize.includes('br') ? 'br' : mobileChrome.resize[0];
  await dragHandle(page, mobileHandle, 40, 28);
  let afterMobile = null;
  await expect.poll(async () => {
    afterMobile = await markerGeom(page, mobileId);
    return handleChanged(mobileHandle, preMobile, afterMobile);
  }, { timeout: 8_000 }).toBe(true);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_MARKER_HANDLE_DRAG_PROOF', JSON.stringify({
    markerA,
    markerB,
    mobileId,
    chrome,
    intended,
    move: intended.move,
    emptyNoop: posDelta(preEmpty, afterEmpty) < 2,
    penNoop: posDelta(prePen, afterPen) < 2,
    afterBr: { w: afterBr.width, h: afterBr.height },
    afterB: { w: afterB.width, h: afterB.height },
    undoRestored: almostEq(afterUndo.width, preBr.width, 3),
    secondDidNotMoveFirst: posDelta(frozenA, firstAfterB) < 2,
    keepCountUnchanged: keepCount,
    viewBox,
    zoomThenBr: {
      dw: afterZoom.width - preZoom.width,
      dh: afterZoom.height - preZoom.height,
    },
    mobile: {
      handleIds: mobileChrome.resize,
      handle: mobileHandle,
      dw: afterMobile.width - preMobile.width,
      dh: afterMobile.height - preMobile.height,
    },
  }));
});
