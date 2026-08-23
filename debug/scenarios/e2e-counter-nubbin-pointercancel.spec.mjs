import { test, expect } from '@playwright/test';

// Switched class after 390 vs desktop missing-control (Start + series Delete
// landed). Counter nubbin pointerup already commits pointerAngle. pointercancel
// dropped only the drag ref and left the live preview + stored angle stale —
// undo / zoom / isolation could not see the nub. zoomGeneration now flushes
// the same commit. Distinct from leftover-18 / X-01 / nubbin orbit / Start /
// series Delete. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
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
      pointerAngle: Number.isFinite(object?.data?.pointerAngle)
        ? Number(object.data.pointerAngle)
        : pointerAngle,
      svgAngle: pointerAngle,
      body: { x: cx, y: cy },
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

async function startNubbinDrag(page, dx, dy) {
  const handle = page.locator('[data-counter-nubbin-handle="true"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, 'nubbin handle').toBeTruthy();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  return start;
}

async function cancelNubbinPointer(page) {
  await page.locator('[data-counter-nubbin-handle="true"]').first().dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
    cancelable: true,
  });
  await page.mouse.up().catch(() => {});
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function proveNubbinPointercancel(page, { xf, yf }) {
  const pin = await createCounter(page, { xf, yf });
  await selectUntilNubbin(page, pin.id);
  const pre = await counterGeom(page, pin.id);

  await startNubbinDrag(page, 90, -20);
  await cancelNubbinPointer(page);
  let afterCancel = null;
  await expect.poll(async () => {
    afterCancel = await counterGeom(page, pin.id);
    return angleDelta(pre.svgAngle, afterCancel.svgAngle);
  }, { message: 'pointercancel must persist the live nubbin angle', timeout: 8_000 }).toBeGreaterThan(12);
  expect(almostEq(afterCancel.left, pre.left, 2.5), 'pointercancel keeps left').toBe(true);
  expect(almostEq(afterCancel.top, pre.top, 2.5), 'pointercancel keeps top').toBe(true);

  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await counterGeom(page, pin.id);
    return angleDelta(pre.svgAngle, afterUndo.svgAngle) < 2
      && almostEq(afterUndo.left, pre.left, 3)
      && almostEq(afterUndo.top, pre.top, 3);
  }, { timeout: 8_000 }).toBe(true);

  await selectUntilNubbin(page, pin.id);
  const preNoop = await counterGeom(page, pin.id);
  const handle = page.locator('[data-counter-nubbin-handle="true"]').first();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await cancelNubbinPointer(page);
  const afterNoop = await counterGeom(page, pin.id);
  expect(angleDelta(preNoop.svgAngle, afterNoop.svgAngle) < 1, 'no-move pointercancel invents 0').toBe(true);

  await selectUntilNubbin(page, pin.id);
  const preZoom = await counterGeom(page, pin.id);
  await startNubbinDrag(page, 80, 36);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+=');
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await counterGeom(page, pin.id);
    return angleDelta(preZoom.svgAngle, afterZoom.svgAngle);
  }, { message: 'zoomGeneration must flush the live nubbin angle', timeout: 8_000 }).toBeGreaterThan(12);
  await page.mouse.up().catch(() => {});
  const afterZoomUp = await counterGeom(page, pin.id);
  expect(angleDelta(afterZoom.svgAngle, afterZoomUp.svgAngle) < 2, 'zoom flush + pointerup must not double-commit').toBe(true);
  expect(almostEq(afterZoom.left, preZoom.left, 3), 'zoom flush keeps body').toBe(true);

  return {
    id: pin.id,
    cancelDelta: angleDelta(pre.svgAngle, afterCancel.svgAngle),
    zoomDelta: angleDelta(preZoom.svgAngle, afterZoom.svgAngle),
    undoRestored: angleDelta(pre.svgAngle, afterUndo.svgAngle) < 2,
    viewBox: (await pageViewBox(page)).raw,
    fileId: await fileId(page),
  };
}

test('desktop nubbin pointercancel + zoomGeneration commit', async ({ page }) => {
  await openEditor(page);
  const proof = await proveNubbinPointercancel(page, { xf: 0.38, yf: 0.30 });
  expect(proof.viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(proof.fileId, 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-counter-nubbin-handle="true"]').count(), 'hubPreview nubbin 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview Draw 0').toBe(0);

  console.log('COUNTER_NUBBIN_POINTERCANCEL_DESKTOP', JSON.stringify(proof));
});

test('390 nubbin pointercancel + zoomGeneration commit', async ({ page }) => {
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const proof = await proveNubbinPointercancel(page, { xf: 0.46, yf: 0.34 });
  expect(proof.viewBox, '390 viewBox owns zoom').toBe('0 0 612 792');
  expect(proof.fileId, 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);
  console.log('COUNTER_NUBBIN_POINTERCANCEL_390', JSON.stringify(proof));
});
