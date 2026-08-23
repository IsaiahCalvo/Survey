import { test, expect } from '@playwright/test';

// Switched class after selected bbox / mtr / endpoint / midpoint / knee
// root-path. Vertex-N and callout textBox-* pointerup already commit.
// pointercancel on the captured knob left stored geometry stale.
// zoomGeneration flushes the same handlePointerUp. Distinct from leftover-18
// / X-01 / nubbin / create keep-track / eraser commit / survey-marker discard.
// Do not stamp file.id.

const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function selectMode(page) {
  await page.keyboard.press('Escape');
  await blurInputs(page);
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function openEditor(page, url, { width = 1440, height = 900 } = {}) {
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
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

function listPolys(page) {
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
        world: points.map((point) => ({ x: point.x + left, y: point.y + top })),
      };
    }).filter((row) => (row.type === 'polygon' || row.type === 'polyline') && row.world.length >= 3);
  });
}

async function selectUntilVertex(page, id, expectedCount) {
  await selectMode(page);
  await expect.poll(async () => {
    const geom = (await listPolys(page)).find((row) => row.id === id);
    const xs = geom.world.map((p) => p.x);
    const ys = geom.world.map((p) => p.y);
    const box = await pageBox(page);
    const raw = await pageViewBox(page);
    const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
    const W = parts[2] || 612;
    const H = parts[3] || 792;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    await page.mouse.click(box.x + (cx / W) * box.width, box.y + (cy / H) * box.height);
    return page.locator('circle[data-handle^="vertex-"]').count();
  }, { timeout: 12_000 }).toBe(expectedCount);
}

async function cancelOn(page, locator) {
  await locator.dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
    cancelable: true,
  });
}

test('desktop hubPreview has no vertex / callout-corner chrome', async ({ page }) => {
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('circle[data-handle^="vertex-"]').count(), 'hubPreview vertex 0').toBe(0);
  expect(await page.locator('[data-callout-part^="textBox-"]').count(), 'hubPreview callout corners 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview Draw 0').toBe(0);
  await assertNoErrorBoundary(page);
});

test('desktop vertex-0 pointercancel + zoomGeneration commit', async ({ page }) => {
  await openEditor(page, POLY_PDF);
  let polys = [];
  await expect.poll(async () => {
    polys = await listPolys(page);
    return polys.filter((row) => row.type === 'polygon' && row.world.length === 4).length;
  }).toBeGreaterThan(0);
  const polyA = polys.find((row) => row.type === 'polygon' && row.world.length === 4);

  await selectUntilVertex(page, polyA.id, 4);
  const pre = (await listPolys(page)).find((row) => row.id === polyA.id);
  const handle = page.locator('circle[data-handle="vertex-0"]');
  const hbox = await handle.boundingBox();
  const start = { x: hbox.x + hbox.width / 2, y: hbox.y + hbox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 48, start.y + 36, { steps: 10 });
  await page.waitForTimeout(80);
  await cancelOn(page, handle);
  let afterCancel = null;
  await expect.poll(async () => {
    afterCancel = (await listPolys(page)).find((row) => row.id === polyA.id);
    return Math.hypot(afterCancel.world[0].x - pre.world[0].x, afterCancel.world[0].y - pre.world[0].y) > 8;
  }, { message: 'pointercancel must persist the live vertex move', timeout: 8_000 }).toBe(true);

  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = (await listPolys(page)).find((row) => row.id === polyA.id);
    return Math.hypot(afterUndo.world[0].x - pre.world[0].x, afterUndo.world[0].y - pre.world[0].y) < 3;
  }, { timeout: 8_000 }).toBe(true);

  await selectUntilVertex(page, polyA.id, 4);
  const preNoop = (await listPolys(page)).find((row) => row.id === polyA.id);
  const noopBox = await handle.boundingBox();
  await page.mouse.move(noopBox.x + noopBox.width / 2, noopBox.y + noopBox.height / 2);
  await page.mouse.down();
  await cancelOn(page, handle);
  const afterNoop = (await listPolys(page)).find((row) => row.id === polyA.id);
  expect(
    Math.hypot(afterNoop.world[0].x - preNoop.world[0].x, afterNoop.world[0].y - preNoop.world[0].y) < 3,
    'no-move pointercancel invents 0',
  ).toBe(true);

  await selectUntilVertex(page, polyA.id, 4);
  const preZoom = (await listPolys(page)).find((row) => row.id === polyA.id);
  const zoomBox = await handle.boundingBox();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2 + 40, zoomBox.y + zoomBox.height / 2 + 28, { steps: 10 });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+=');
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = (await listPolys(page)).find((row) => row.id === polyA.id);
    return Math.hypot(afterZoom.world[0].x - preZoom.world[0].x, afterZoom.world[0].y - preZoom.world[0].y) > 8;
  }, { message: 'zoomGeneration must flush the live vertex move', timeout: 8_000 }).toBe(true);
  await page.mouse.up().catch(() => {});
  const afterZoomUp = (await listPolys(page)).find((row) => row.id === polyA.id);
  expect(
    Math.hypot(afterZoomUp.world[0].x - afterZoom.world[0].x, afterZoomUp.world[0].y - afterZoom.world[0].y) < 3,
    'zoom flush + pointerup must not double-commit',
  ).toBe(true);

  const proof = {
    id: polyA.id,
    cancelDx: afterCancel.world[0].x - pre.world[0].x,
    cancelDy: afterCancel.world[0].y - pre.world[0].y,
    undoRestored: Math.hypot(afterUndo.world[0].x - pre.world[0].x, afterUndo.world[0].y - pre.world[0].y) < 3,
    zoomDx: afterZoom.world[0].x - preZoom.world[0].x,
    viewBox: await pageViewBox(page),
    fileId: await fileId(page),
  };
  expect(proof.viewBox, 'viewBox owns zoom').toBe('0 0 612 792');
  expect(proof.fileId, 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);
  console.log('VERTEX_POINTERCANCEL_DESKTOP', JSON.stringify(proof));
});

test('desktop callout textBox-br pointercancel + zoomGeneration commit', async ({ page }) => {
  await openEditor(page, GLYPH_PDF);
  const idsBefore = await page.locator('[data-svg-annotation-layer="1"] [data-callout-id]').evaluateAll((els) => (
    [...new Set(els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean))]
  ));
  await page.keyboard.press('q');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.46, { steps: 8 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('corner cancel', { delay: 6 });
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await page.locator('[data-svg-annotation-layer="1"] [data-callout-id]').evaluateAll((els) => (
      [...new Set(els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean))]
    ));
    calloutId = ids.find((id) => !idsBefore.includes(id)) || null;
    return calloutId;
  }).not.toBeNull();
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await selectMode(page);

  const handle = page.locator(
    `[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"] [data-callout-part="textBox-br"]`,
  ).last();
  await expect.poll(async () => {
    const tb = page.locator(
      `[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"] [data-callout-part="textBox"]`,
    ).first();
    if (await tb.count()) {
      const b = await tb.boundingBox();
      if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    }
    return handle.count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);

  const calloutBox = () => page.evaluate((cid) => {
    const boxEl = document.querySelector(`[data-callout-id="${cid}"] [data-callout-part="textBox"]`);
    if (!boxEl) return null;
    return {
      w: Number(boxEl.getAttribute('width')),
      h: Number(boxEl.getAttribute('height')),
      x: Number(boxEl.getAttribute('x')),
      y: Number(boxEl.getAttribute('y')),
    };
  }, calloutId);

  const pre = await calloutBox();
  const hbox = await handle.boundingBox();
  const start = { x: hbox.x + hbox.width / 2, y: hbox.y + hbox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 32, { steps: 10 });
  await page.waitForTimeout(80);
  await cancelOn(page, handle);
  let afterCancel = null;
  await expect.poll(async () => {
    afterCancel = await calloutBox();
    return afterCancel && afterCancel.w > pre.w + 8 && afterCancel.h > pre.h + 6;
  }, { message: 'pointercancel must persist the live br resize', timeout: 8_000 }).toBeTruthy();
  expect(afterCancel.x, 'pointercancel pins left').toBeCloseTo(pre.x, 1);
  expect(afterCancel.y, 'pointercancel pins top').toBeCloseTo(pre.y, 1);

  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await calloutBox();
    return afterUndo && Math.abs(afterUndo.w - pre.w) < 2 && Math.abs(afterUndo.h - pre.h) < 2;
  }, { timeout: 8_000 }).toBeTruthy();

  const preNoop = await calloutBox();
  const noopBox = await handle.boundingBox();
  await page.mouse.move(noopBox.x + noopBox.width / 2, noopBox.y + noopBox.height / 2);
  await page.mouse.down();
  await cancelOn(page, handle);
  const afterNoop = await calloutBox();
  expect(Math.abs(afterNoop.w - preNoop.w) < 2, 'no-move pointercancel invents 0').toBe(true);
  expect(Math.abs(afterNoop.h - preNoop.h) < 2, 'no-move pointercancel invents 0 height').toBe(true);

  const preZoom = await calloutBox();
  const zoomBox = await handle.boundingBox();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2 + 36, zoomBox.y + zoomBox.height / 2 + 28, { steps: 10 });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+=');
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await calloutBox();
    return afterZoom && afterZoom.w > preZoom.w + 8 && afterZoom.h > preZoom.h + 6;
  }, { message: 'zoomGeneration must flush the live br resize', timeout: 8_000 }).toBeTruthy();
  await page.mouse.up().catch(() => {});
  const afterZoomUp = await calloutBox();
  expect(Math.abs(afterZoomUp.w - afterZoom.w) < 2, 'zoom flush + pointerup must not double-commit').toBe(true);

  const proof = {
    id: calloutId,
    cancelDw: afterCancel.w - pre.w,
    cancelDh: afterCancel.h - pre.h,
    undoRestored: Math.abs(afterUndo.w - pre.w) < 2,
    zoomDw: afterZoom.w - preZoom.w,
    viewBox: await pageViewBox(page),
    fileId: await fileId(page),
  };
  expect(proof.viewBox, 'viewBox owns zoom').toBe('0 0 612 792');
  expect(proof.fileId, 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);
  console.log('CALLOUT_CORNER_POINTERCANCEL_DESKTOP', JSON.stringify(proof));
});
