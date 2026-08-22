import { test, expect } from '@playwright/test';

// Unique leftover after bbox edit mode: counter nubbin handle + Shift-orbit.
// Not Size/Start, not series Delete, not double-click bbox, not UL-31 Continue.
// Place-time Shift freezes the tip; selection nubbin rotates pointerAngle only;
// Shift-drag on a committed pin orbits the body around that tip.
// Ellipse radii / ink vertices / stamp / Print / Group stay omitted.
// Leftover-18 parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page, { fixture = LINK_PDF, width = 1440, height = 900 } = {}) {
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

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
  return { raw, W: parts[2] || 612, H: parts[3] || 792 };
}

async function listCounterIds(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[data-shape-hit-target="counter"]')]
      .map((node) => node.closest('[data-anno-id]')?.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));
}

function tipFrom(geom) {
  const radius = (Number(geom.radius) || 14) * Math.abs(Number(geom.scaleX) || 1);
  const cx = Number(geom.left) + radius;
  const cy = Number(geom.top) + radius;
  const rad = (Number(geom.svgAngle ?? geom.pointerAngle) * Math.PI) / 180;
  const tipDistance = radius * 1.5;
  return {
    cx,
    cy,
    radius,
    tipDistance,
    x: cx + Math.cos(rad) * tipDistance,
    y: cy + Math.sin(rad) * tipDistance,
  };
}

function angleDelta(a, b) {
  const delta = ((Number(b) - Number(a) + 540) % 360) - 180;
  return Math.abs(delta);
}

function almostEq(a, b, eps = 3) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

async function counterGeom(page, id) {
  return page.evaluate((annoId) => {
    const group = document.querySelector(`[data-svg-annotation-layer="1"] > g[data-anno-id="${annoId}"]`)
      || document.querySelector(`[data-anno-id="${annoId}"]`);
    const path = group?.querySelector?.('path') || group;
    const pathD = path?.getAttribute?.('d') || '';
    const move = /M\s+([-0-9.]+),([-0-9.]+)/.exec(pathD);
    const line = /L\s+([-0-9.]+),([-0-9.]+)/.exec(pathD);
    const arc = /A\s+([\d.]+),([\d.]+)\s+0\s+1\s+1\s+([-0-9.]+),([-0-9.]+)/.exec(pathD);
    const r = arc ? Number(arc[1]) : 14;
    const tip = move ? { x: Number(move[1]), y: Number(move[2]) } : null;
    const t1 = line ? { x: Number(line[1]), y: Number(line[2]) } : null;
    const t2 = arc ? { x: Number(arc[3]), y: Number(arc[4]) } : null;
    let cx = 0;
    let cy = 0;
    let pointerAngle = 225;
    if (tip && t1 && t2) {
      const midX = (t1.x + t2.x) / 2;
      const midY = (t1.y + t2.y) / 2;
      const axisX = midX - tip.x;
      const axisY = midY - tip.y;
      const axisLen = Math.hypot(axisX, axisY) || 1;
      const tipDistance = r * 1.5;
      cx = tip.x + (axisX / axisLen) * tipDistance;
      cy = tip.y + (axisY / axisLen) * tipDistance;
      pointerAngle = Math.atan2(tip.y - cy, tip.x - cx) * 180 / Math.PI;
    }
    const object = window.__phase35GetAnnotationById?.(annoId);
    return {
      id: annoId,
      left: Number.isFinite(object?.left) ? object.left : (cx - r),
      top: Number.isFinite(object?.top) ? object.top : (cy - r),
      radius: Number(object?.radius || r),
      scaleX: object?.scaleX ?? 1,
      pointerAngle: Number.isFinite(object?.data?.pointerAngle)
        ? Number(object.data.pointerAngle)
        : pointerAngle,
      svgAngle: pointerAngle,
      svgR: r,
      tip,
      body: { x: cx, y: cy },
      fromObject: !!(object && Object.keys(object).length),
      pathD: pathD.slice(0, 80),
    };
  }, id);
}

async function createCounter(page, { xf = 0.42, yf = 0.28 } = {}) {
  const before = await listCounterIds(page);
  await activateShapeTool(page, 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
  const box = await pageBox(page);
  await page.waitForTimeout(280);
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

async function selectUntilNubbin(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    const geom = await counterGeom(page, id);
    const hit = page.locator(`[data-anno-id="${id}"] [data-shape-hit-target="counter"]`).first();
    if (await hit.count()) {
      await hit.click({ force: true });
    } else {
      const box = await pageBox(page);
      const { W, H } = await pageViewBox(page);
      await page.mouse.click(
        box.x + (geom.body.x / W) * box.width,
        box.y + (geom.body.y / H) * box.height,
      );
    }
    return page.locator('[data-counter-nubbin-handle="true"]').count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

async function dragNubbin(page, dx, dy) {
  const handle = page.locator('[data-counter-nubbin-handle="true"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, 'nubbin handle').toBeTruthy();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
  return start;
}

async function clickEmpty(page) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * 0.92, box.y + box.height * 0.08);
}

async function shiftOrbitBody(page, geom, { dx = 72, dy = -48 } = {}) {
  await page.waitForTimeout(550);
  if (await page.locator('[data-resize-handle]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
  const box = await pageBox(page);
  const { W, H } = await pageViewBox(page);
  const start = {
    x: box.x + (geom.body.x / W) * box.width,
    y: box.y + (geom.body.y / H) * box.height,
  };
  await page.mouse.move(start.x, start.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  return start;
}

test('counter nubbin + Shift-orbit intended + break + edge', async ({ page }) => {
  await openEditor(page);

  // Intended: click-place stores default 225°; selection chrome is nubbin-only.
  const pinA = await createCounter(page, { xf: 0.38, yf: 0.26 });
  expect(angleDelta(pinA.svgAngle, 225) < 2, `default angle ${pinA.svgAngle}`).toBe(true);
  await selectUntilNubbin(page, pinA.id);
  expect(await page.locator('[data-resize-handle]').count(), 'single-click has no bbox').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle="true"]').count(), 'nubbin chrome').toBe(1);

  const preNub = await counterGeom(page, pinA.id);
  await dragNubbin(page, 90, -20);
  await clickEmpty(page);
  let afterNub = null;
  await expect.poll(async () => {
    afterNub = await counterGeom(page, pinA.id);
    return angleDelta(preNub.svgAngle, afterNub.svgAngle);
  }, { timeout: 8_000 }).toBeGreaterThan(12);
  expect(almostEq(afterNub.left, preNub.left, 2.5), 'nubbin keeps left').toBe(true);
  expect(almostEq(afterNub.top, preNub.top, 2.5), 'nubbin keeps top').toBe(true);
  const nubAngleDelta = angleDelta(preNub.svgAngle, afterNub.svgAngle);

  // Edge: undo restores stored pointerAngle (must run before later history).
  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await counterGeom(page, pinA.id);
    return angleDelta(preNub.svgAngle, afterUndo.svgAngle) < 2
      && almostEq(afterUndo.left, preNub.left, 3)
      && almostEq(afterUndo.top, preNub.top, 3);
  }, { timeout: 8_000 }).toBe(true);
  await selectUntilNubbin(page, pinA.id);
  await dragNubbin(page, 90, -20);
  await clickEmpty(page);
  await expect.poll(async () => angleDelta(preNub.svgAngle, (await counterGeom(page, pinA.id)).svgAngle))
    .toBeGreaterThan(12);

  // Intended: Shift-drag orbits the body around the frozen tip.
  const pinOrbit = await createCounter(page, { xf: 0.28, yf: 0.48 });
  await page.waitForTimeout(550);
  await selectUntilNubbin(page, pinOrbit.id);
  const preOrbit = await counterGeom(page, pinOrbit.id);
  const preTip = tipFrom(preOrbit);
  await shiftOrbitBody(page, preOrbit, { dx: 90, dy: 20 });
  await clickEmpty(page);
  let afterOrbit = null;
  await expect.poll(async () => {
    afterOrbit = await counterGeom(page, pinOrbit.id);
    const moved = Math.hypot(afterOrbit.left - preOrbit.left, afterOrbit.top - preOrbit.top);
    return moved > 6 && angleDelta(preOrbit.svgAngle, afterOrbit.svgAngle) > 8;
  }, { timeout: 8_000 }).toBe(true);
  const afterTip = tipFrom(afterOrbit);
  const tipDrift = Math.hypot(afterTip.x - preTip.x, afterTip.y - preTip.y);
  expect(tipDrift < 14, `orbit tip held (drift ${tipDrift.toFixed(2)})`).toBe(true);
  const orbitAngleDelta = angleDelta(preOrbit.svgAngle, afterOrbit.svgAngle);
  const orbitBodyDelta = Math.hypot(afterOrbit.left - preOrbit.left, afterOrbit.top - preOrbit.top);

  // Intended: place-time Shift freezes the tip and writes a new pointerAngle.
  const beforePlace = await listCounterIds(page);
  await activateShapeTool(page, 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
  const placeBox = await pageBox(page);
  await page.waitForTimeout(280);
  const placeStart = {
    x: placeBox.x + placeBox.width * 0.62,
    y: placeBox.y + placeBox.height * 0.42,
  };
  await page.mouse.move(placeStart.x, placeStart.y);
  await page.mouse.down();
  await page.mouse.move(placeStart.x + 36, placeStart.y + 8, { steps: 6 });
  await page.keyboard.down('Shift');
  await page.mouse.move(placeStart.x + 36, placeStart.y + 90, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  let placed = null;
  await expect.poll(async () => {
    const ids = await listCounterIds(page);
    const id = ids.find((next) => !beforePlace.includes(next)) || null;
    placed = id ? await counterGeom(page, id) : null;
    return placed;
  }, { message: 'expected a Shift-orbit placed pin' }).not.toBeNull();
  expect(angleDelta(placed.svgAngle, 225) > 12, `place Shift wrote angle ${placed.svgAngle}`).toBe(true);
  await selectMode(page);

  // Break: empty-page drag with none selected is a no-op.
  await clickEmpty(page);
  expect(await page.locator('[data-counter-nubbin-handle="true"]').count(), 'deselect hides nubbin').toBe(0);
  const preEmpty = await counterGeom(page, pinA.id);
  const emptyCount = (await listCounterIds(page)).length;
  const emptyBox = await pageBox(page);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.88, emptyBox.y + emptyBox.height * 0.10);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.94, emptyBox.y + emptyBox.height * 0.16, { steps: 6 });
  await page.mouse.up();
  const afterEmpty = await counterGeom(page, pinA.id);
  expect(angleDelta(preEmpty.svgAngle, afterEmpty.svgAngle) < 1, 'empty-page no orbit').toBe(true);
  expect(almostEq(afterEmpty.left, preEmpty.left, 2), 'empty-page no move').toBe(true);
  expect((await listCounterIds(page)).length, 'empty-page no new pin').toBe(emptyCount);

  // Break: Shift without drag is a selection toggle, not an orbit.
  await selectUntilNubbin(page, pinA.id);
  await page.waitForTimeout(550);
  const preShiftClick = await counterGeom(page, pinA.id);
  const shiftBox = await pageBox(page);
  const { W, H } = await pageViewBox(page);
  const bodyScreen = {
    x: shiftBox.x + (preShiftClick.body.x / W) * shiftBox.width,
    y: shiftBox.y + (preShiftClick.body.y / H) * shiftBox.height,
  };
  await page.mouse.move(bodyScreen.x, bodyScreen.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const afterShiftClick = await counterGeom(page, pinA.id);
  expect(angleDelta(preShiftClick.svgAngle, afterShiftClick.svgAngle) < 1, 'Shift-click no orbit').toBe(true);
  expect(almostEq(afterShiftClick.left, preShiftClick.left, 2), 'Shift-click no move').toBe(true);

  // Break: Pen-armed page drag does not orbit the stored pin.
  await selectMode(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  const prePen = await counterGeom(page, pinA.id);
  const penBox = await pageBox(page);
  await page.mouse.move(penBox.x + penBox.width * 0.18, penBox.y + penBox.height * 0.62);
  await page.mouse.down();
  await page.mouse.move(penBox.x + penBox.width * 0.28, penBox.y + penBox.height * 0.70, { steps: 8 });
  await page.mouse.up();
  const afterPen = await counterGeom(page, pinA.id);
  expect(angleDelta(prePen.svgAngle, afterPen.svgAngle) < 1, 'Pen-armed no orbit').toBe(true);
  expect(almostEq(afterPen.left, prePen.left, 2), 'Pen-armed no body move').toBe(true);
  await selectMode(page);

  // Edge: second counter isolated.
  const pinB = await createCounter(page, { xf: 0.72, yf: 0.58 });
  const firstFrozen = await counterGeom(page, pinA.id);
  await selectUntilNubbin(page, pinB.id);
  const preB = await counterGeom(page, pinB.id);
  await dragNubbin(page, 60, 40);
  await expect.poll(async () => angleDelta(preB.svgAngle, (await counterGeom(page, pinB.id)).svgAngle))
    .toBeGreaterThan(10);
  const firstAfterB = await counterGeom(page, pinA.id);
  expect(angleDelta(firstFrozen.svgAngle, firstAfterB.svgAngle) < 1, 'A isolated').toBe(true);
  expect(almostEq(firstAfterB.left, firstFrozen.left, 2), 'A left isolated').toBe(true);

  // Edge: zoom then nubbin still uses viewBox page-space.
  const zoomIn = page.getByRole('button', { name: /Zoom in/i }).first();
  if (await zoomIn.count()) {
    await zoomIn.click();
    await zoomIn.click();
  }
  const viewBox = (await pageViewBox(page)).raw;
  expect(viewBox.startsWith('0 0 '), 'viewBox owns scale').toBe(true);
  await selectUntilNubbin(page, pinA.id);
  const preZoom = await counterGeom(page, pinA.id);
  await dragNubbin(page, 88, -64);
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await counterGeom(page, pinA.id);
    return angleDelta(preZoom.svgAngle, afterZoom.svgAngle);
  }, { timeout: 8_000 }).toBeGreaterThan(8);
  expect(almostEq(afterZoom.left, preZoom.left, 3), 'zoom nubbin keeps body').toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 uses the same SVG nubbin (no pause-to-orbit). Prove chrome + drag if hittable.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const mobilePin = await createCounter(page, { xf: 0.46, yf: 0.34 });
  await selectUntilNubbin(page, mobilePin.id);
  const mobileHandleCount = await page.locator('[data-counter-nubbin-handle="true"]').count();
  expect(mobileHandleCount, '390 has the same nubbin').toBeGreaterThan(0);
  const preMobile = await counterGeom(page, mobilePin.id);
  await dragNubbin(page, 40, -28);
  let afterMobile = null;
  await expect.poll(async () => {
    afterMobile = await counterGeom(page, mobilePin.id);
    return angleDelta(preMobile.svgAngle, afterMobile.svgAngle);
  }, { timeout: 8_000 }).toBeGreaterThan(8);
  await assertNoErrorBoundary(page);

  console.log('COUNTER_NUBBIN_ORBIT_PROOF', JSON.stringify({
    pinA: pinA.id,
    pinOrbit: pinOrbit.id,
    pinB: pinB.id,
    placed: placed.id,
    defaultAngle: pinA.svgAngle,
    fromObject: pinA.fromObject,
    nubbin: {
      dAngle: nubAngleDelta,
      dLeft: afterNub.left - preNub.left,
      dTop: afterNub.top - preNub.top,
      afterAngle: afterNub.svgAngle,
    },
    orbit: {
      dAngle: orbitAngleDelta,
      bodyDelta: orbitBodyDelta,
      tipDrift,
      afterAngle: afterOrbit.svgAngle,
    },
    placeShiftAngle: placed.svgAngle,
    emptyNoop: angleDelta(preEmpty.svgAngle, afterEmpty.svgAngle) < 1,
    shiftClickNoop: angleDelta(preShiftClick.svgAngle, afterShiftClick.svgAngle) < 1,
    penNoop: angleDelta(prePen.svgAngle, afterPen.svgAngle) < 1,
    undoRestored: angleDelta(preNub.svgAngle, afterUndo.svgAngle) < 2,
    secondDidNotMoveFirst: angleDelta(firstFrozen.svgAngle, firstAfterB.svgAngle) < 1,
    viewBox,
    zoomThenNubbin: angleDelta(preZoom.svgAngle, afterZoom.svgAngle),
    mobile: {
      handleCount: mobileHandleCount,
      dAngle: angleDelta(preMobile.svgAngle, afterMobile.svgAngle),
    },
  }));
});
