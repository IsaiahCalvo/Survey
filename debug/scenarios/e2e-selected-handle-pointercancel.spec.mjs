import { test, expect } from '@playwright/test';

// Switched class after Counter nubbin pointercancel. Selected bbox `mtr`
// pointerup already commits obj.angle. pointercancel left visualTransform
// armed and stored angle stale — undo / zoom / isolation could not see the
// rotate. zoomGeneration now flushes the same handlePointerUp commit.
// Endpoint / midpoint / knee / bbox resize share that path. Distinct from
// leftover-18 / X-01 / nubbin / create keep-track / eraser commit /
// survey-marker discard. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const RECT_A = { x0: 0.24, y0: 0.30, x1: 0.44, y1: 0.48 };

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

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
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

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function userAnnotationSnapshot(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? data.left ?? 0),
        top: Number(object.top ?? data.top ?? 0),
        width: Number(object.width ?? data.width ?? 0) * Math.abs(Number(object.scaleX ?? 1)),
        height: Number(object.height ?? data.height ?? 0) * Math.abs(Number(object.scaleY ?? 1)),
        angle: Number(object.angle ?? data.angle ?? 0),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  });
}

async function geom(page, id) {
  const rows = await userAnnotationSnapshot(page);
  return rows.find((row) => row.id === id) || null;
}

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect';
}

function angleDelta(a, b) {
  const delta = ((Number(b) - Number(a) + 540) % 360) - 180;
  return Math.abs(delta);
}

function almostEq(a, b, eps = 3) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  const visible = page.getByRole('button', { name: toolName, exact: true });
  if (await visible.count() && await visible.first().isVisible().catch(() => false)) {
    if ((await visible.first().getAttribute('aria-pressed')) !== 'true') await visible.first().click();
    return;
  }
  const category = page.getByRole('button', { name: categoryName, exact: true }).first();
  await expect(category).toBeVisible({ timeout: 8_000 });
  if (!String(await category.getAttribute('class') || '').includes('btn-active')) {
    await category.click();
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function dragOnPage(page, { x0, y0, x1, y1 }) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function createRect(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !before.has(row.id) && isRect(row)) || null;
    return created;
  }, { message: 'expected a rectangle' }).not.toBeNull();
  return created;
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function selectUntilMtr(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    const hit = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="rect"]`).first();
    if (await hit.count()) {
      await hit.click({ force: true });
    }
    return page.locator('[data-rotation-handle="mtr"]').count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

async function startMtrDrag(page, id, deg) {
  const hit = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="rect"]`).first();
  const box = await hit.boundingBox();
  expect(box, 'rect hit').toBeTruthy();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  expect(hb, 'mtr handle').toBeTruthy();
  const start = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  const radius = Math.max(80, Math.hypot(start.x - cx, start.y - cy));
  const end = {
    x: cx + radius * Math.sin((deg * Math.PI) / 180),
    y: cy - radius * Math.cos((deg * Math.PI) / 180),
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 16 });
  return start;
}

async function cancelMtrPointer(page) {
  await page.locator('[data-rotation-handle="mtr"]').first().dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
    cancelable: true,
  });
  await page.mouse.up().catch(() => {});
}

async function proveMtrPointercancel(page, coords) {
  const rect = await createRect(page, coords);
  await selectUntilMtr(page, rect.id);
  const pre = await geom(page, rect.id);

  await startMtrDrag(page, rect.id, 90);
  await cancelMtrPointer(page);
  let afterCancel = null;
  await expect.poll(async () => {
    afterCancel = await geom(page, rect.id);
    return angleDelta(pre.angle, afterCancel.angle);
  }, { message: 'pointercancel must persist the live mtr angle', timeout: 8_000 }).toBeGreaterThan(40);
  expect(almostEq(afterCancel.left, pre.left, 3), 'pointercancel keeps left').toBe(true);
  expect(almostEq(afterCancel.top, pre.top, 3), 'pointercancel keeps top').toBe(true);
  expect(almostEq(afterCancel.width, pre.width, 3), 'pointercancel keeps width').toBe(true);
  expect(almostEq(afterCancel.height, pre.height, 3), 'pointercancel keeps height').toBe(true);

  const empty = await pageBox(page);
  await page.mouse.click(empty.x + empty.width * 0.92, empty.y + empty.height * 0.08);
  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await geom(page, rect.id);
    return angleDelta(pre.angle, afterUndo.angle) < 2
      && almostEq(afterUndo.left, pre.left, 3)
      && almostEq(afterUndo.top, pre.top, 3);
  }, { timeout: 8_000 }).toBe(true);

  await selectUntilMtr(page, rect.id);
  const preNoop = await geom(page, rect.id);
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await cancelMtrPointer(page);
  const afterNoop = await geom(page, rect.id);
  expect(angleDelta(preNoop.angle, afterNoop.angle) < 1, 'no-move pointercancel invents 0').toBe(true);

  await selectUntilMtr(page, rect.id);
  const preZoom = await geom(page, rect.id);
  await startMtrDrag(page, rect.id, 180);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+=');
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await geom(page, rect.id);
    return angleDelta(preZoom.angle, afterZoom.angle);
  }, { message: 'zoomGeneration must flush the live mtr angle', timeout: 8_000 }).toBeGreaterThan(40);
  await page.mouse.up().catch(() => {});
  const afterZoomUp = await geom(page, rect.id);
  expect(angleDelta(afterZoom.angle, afterZoomUp.angle) < 2, 'zoom flush + pointerup must not double-commit').toBe(true);
  expect(almostEq(afterZoom.left, preZoom.left, 4), 'zoom flush keeps left').toBe(true);
  expect(almostEq(afterZoom.top, preZoom.top, 4), 'zoom flush keeps top').toBe(true);

  return {
    id: rect.id,
    cancelDelta: angleDelta(pre.angle, afterCancel.angle),
    zoomDelta: angleDelta(preZoom.angle, afterZoom.angle),
    undoRestored: angleDelta(pre.angle, afterUndo.angle) < 2,
    viewBox: (await pageViewBox(page)).raw,
    fileId: await fileId(page),
  };
}

test('desktop selected mtr pointercancel + zoomGeneration commit', async ({ page }) => {
  await openEditor(page);
  const proof = await proveMtrPointercancel(page, RECT_A);
  expect(proof.viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(proof.fileId, 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'hubPreview mtr 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview Draw 0').toBe(0);

  console.log('SELECTED_HANDLE_POINTERCANCEL_DESKTOP', JSON.stringify(proof));
});

test('390 selected mtr pointercancel + zoomGeneration commit', async ({ page }) => {
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const proof = await proveMtrPointercancel(page, { x0: 0.28, y0: 0.34, x1: 0.52, y1: 0.52 });
  expect(proof.viewBox, '390 viewBox owns zoom').toBe('0 0 612 792');
  expect(proof.fileId, 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);
  console.log('SELECTED_HANDLE_POINTERCANCEL_390', JSON.stringify(proof));
});
