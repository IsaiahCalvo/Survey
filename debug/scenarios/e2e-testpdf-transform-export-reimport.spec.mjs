import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Current-code proof: create + transform live objects, then local save/reload
// AND export → ?testPdf= re-import. Distinct from the 2026-08-22 create-only
// local save receipt (no bbox / mtr / pen resize). Distinct from leftover-18
// / X-01 / pointercancel / tool-switch / paste-after-zoom. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const REIMPORT_NAME = '_e2e-transform-export-reimport.pdf';

const RECT_BOX = { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 };
const PEN_BOX = { x0: 0.52, y0: 0.58, x1: 0.82, y1: 0.64 };

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect';
}

function isPen(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'freedraw';
}

function angleNear(actual, want, tol = 12) {
  const a = ((Number(actual) % 360) + 360) % 360;
  const b = ((Number(want) % 360) + 360) % 360;
  return Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= tol;
}

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
  keepOnReload = false,
} = {}) {
  await page.addInitScript((opts) => {
    try {
      if (opts.keepOnReload && sessionStorage.getItem('e2e-keep-local-save') === '1') return;
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
  }, { keepOnReload });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
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

async function pageCoveredByHub(page) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  if (!box) return false;
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const text = el?.textContent || '';
    return /No documents yet|Upload your first PDF|Search documents/.test(text);
  }, { x: box.x + box.width * 0.45, y: box.y + box.height * 0.40 });
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page))) break;
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
    } else {
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf|_e2e-transform-export-reimport\.pdf/ }).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click({ position: { x: 24, y: 8 } }).catch(() => {});
      }
    }
    await expect(hubCopy).toHaveCount(0, { timeout: 8_000 });
  }
  await expect.poll(async () => pageCoveredByHub(page), {
    timeout: 8_000,
    message: 'hub Documents must not cover the page',
  }).toBe(false);
  await blurInputs(page);
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

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const width = Number(object.width ?? data.width ?? 0);
      const height = Number(object.height ?? data.height ?? 0);
      const scaleX = Number(object.scaleX ?? data.scaleX ?? 1) || 1;
      const scaleY = Number(object.scaleY ?? data.scaleY ?? 1) || 1;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? data.left ?? 0),
        top: Number(object.top ?? data.top ?? 0),
        width,
        height,
        scaleX,
        scaleY,
        vw: width * Math.abs(scaleX),
        vh: height * Math.abs(scaleY),
        angle: Number(object.angle ?? data.angle ?? 0),
      };
    }).filter((row) => !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userOwned(page) {
  return (await userAnnotationSnapshot(page)).filter((row) => row.imported !== true);
}

async function geom(page, id) {
  return (await userAnnotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userOwned(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function selectedIds(page) {
  return page.evaluate(() => [...(window.__selectedAnnotationIds || [])]);
}

function toolButtons(page, name) {
  return page.locator(
    `button.btn-icon[aria-label="${name}"], button.mobile-pdf-tools__button[aria-label="${name}"]`,
  );
}

async function clickVisible(page, name) {
  const buttons = toolButtons(page, name);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    return button;
  }
  const fallback = page.getByRole('button', { name, exact: true });
  await expect(fallback.first(), `visible ${name}`).toBeVisible();
  await fallback.first().click();
  return fallback.first();
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
  await clickVisible(page, categoryName);
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

async function setWidthTyped(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  if (!(await field.isVisible().catch(() => false))) return false;
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
  await blurInputs(page);
  return true;
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const scoped = toolButtons(page, 'Select');
  if (await scoped.count() && await scoped.first().isVisible().catch(() => false)) {
    await scoped.first().click();
  }
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
  await expect.poll(async () => {
    const cls = String(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('class') || '');
    return !cls.includes('tool-crosshair');
  }, { timeout: 8_000 }).toBeTruthy();
}

async function clickEmpty(page, { xf = 0.08, yf = 0.08 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

async function strokeClickRect(page, id) {
  const hit = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="rect"]`).first();
  await expect(hit).toBeVisible();
  const box = await hit.boundingBox();
  expect(box, `hit bbox for ${id}`).toBeTruthy();
  const before = (await selectedIds(page)).includes(id);
  const points = [
    { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 },
    { x: box.x + box.width * 0.65, y: box.y + box.height * 0.40 },
    { x: box.x + 6, y: box.y + box.height * 0.30 },
    { x: box.x + box.width * 0.30, y: box.y + 6 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    try {
      await expect.poll(async () => (await selectedIds(page)).includes(id), {
        timeout: 800,
      }).not.toBe(before);
      return;
    } catch { /* try next */ }
  }
  throw new Error(`rect click missed ${id}`);
}

async function inkHitPoints(page, id) {
  return page.evaluate((annoId) => {
    const host = document.querySelector(`[data-svg-annotation-layer="1"] > g[data-anno-id="${annoId}"]`);
    const pathEl = host?.querySelector('[data-path-hit-target="true"]') || host?.querySelector('path');
    if (!pathEl) return [];
    const hits = [];
    if (typeof pathEl.getTotalLength === 'function') {
      const len = pathEl.getTotalLength();
      const ctm = pathEl.getScreenCTM?.();
      if (len > 0 && ctm) {
        for (let i = 1; i <= 12; i += 1) {
          const local = pathEl.getPointAtLength(len * (i / 13));
          hits.push({
            x: ctm.a * local.x + ctm.c * local.y + ctm.e,
            y: ctm.b * local.x + ctm.d * local.y + ctm.f,
          });
        }
      }
    }
    return hits;
  }, id);
}

async function strokeClickInk(page, id) {
  const points = await inkHitPoints(page, id);
  if (!points.length) throw new Error(`ink ${id} has 0 hit points`);
  for (const point of points.slice(0, 8)) {
    await page.mouse.click(point.x, point.y);
    try {
      await expect.poll(async () => (await selectedIds(page)).includes(id), { timeout: 1_200 }).toBe(true);
      return;
    } catch { /* try next */ }
  }
  throw new Error(`ink click missed ${id}`);
}

async function selectUntilHandles(page, id, clicker, min = 4) {
  await dismissChrome(page);
  await selectMode(page);
  await clickEmpty(page);
  await clicker(page, id);
  await expect.poll(async () => (await selectedIds(page)).includes(id), { timeout: 8_000 }).toBe(true);
  await expect.poll(async () => page.locator('[data-svg-annotation-layer="1"] [data-resize-handle]').count(), {
    timeout: 8_000,
    message: `selected ${id} must show resize handles`,
  }).toBeGreaterThanOrEqual(min);
}

async function dragResizeHandle(page, handleId, dx, dy) {
  await dismissChrome(page);
  const handle = page.locator(`[data-svg-annotation-layer="1"] [data-resize-handle="${handleId}"]`).first();
  await expect(handle, `${handleId} handle`).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
}

async function dragMtrToAngle(page, id, deg) {
  const host = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  const box = await host.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  const start = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  const radius = Math.max(80, Math.hypot(start.x - cx, start.y - cy));
  const end = {
    x: cx + radius * Math.sin((deg * Math.PI) / 180),
    y: cy - radius * Math.cos((deg * Math.PI) / 180),
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();
}

async function setNextDrawFill(page, hex = '#00FFFF') {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  if (!(await color.isVisible().catch(() => false))) return false;
  await color.click();
  const picker = page.locator('[data-annotation-color-picker]');
  try {
    await expect(picker).toBeVisible({ timeout: 2_000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
  const fillTab = picker.getByRole('button', { name: 'Fill', exact: true });
  if (await fillTab.count()) await fillTab.click();
  await picker.locator(`button[title="${hex}"]`).first().click();
  await page.keyboard.press('Escape').catch(() => {});
  return true;
}

async function createRect(page, coords) {
  const before = new Set((await userOwned(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await setNextDrawFill(page, '#00FFFF');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
}

async function createPen(page, coords) {
  const before = new Set((await userOwned(page)).map((row) => row.id));
  await activateTool(page, 'Draw', 'Pen');
  await setWidthTyped(page, 16);
  const box = await pageBox(page);
  const start = { x: box.x + box.width * coords.x0, y: box.y + box.height * coords.y0 };
  const mid = {
    x: box.x + box.width * ((coords.x0 + coords.x1) / 2 + 0.04),
    y: box.y + box.height * ((coords.y0 + coords.y1) / 2),
  };
  const end = { x: box.x + box.width * coords.x1, y: box.y + box.height * coords.y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return waitForNewUserAnnotation(page, before, isPen);
}

async function localCache(page) {
  return page.evaluate(() => {
    const objects = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('annotationsByPage_')) continue;
      let parsed = null;
      try { parsed = JSON.parse(localStorage.getItem(key) || '{}'); } catch { parsed = null; }
      for (const pageData of Object.values(parsed || {})) {
        for (const object of pageData?.objects || []) {
          objects.push({
            key,
            id: object?.id || object?.data?.id || null,
            type: String(object?.type || object?.data?.type || '').toLowerCase(),
            angle: Number(object?.angle ?? 0),
            scaleX: Number(object?.scaleX ?? 1),
            scaleY: Number(object?.scaleY ?? 1),
            width: Number(object?.width ?? 0),
            height: Number(object?.height ?? 0),
          });
        }
      }
    }
    return { objects, fileId: window.__devTestPdf?.id ?? null };
  });
}

async function keepLocalSave(page) {
  await page.evaluate(() => {
    sessionStorage.setItem('e2e-keep-local-save', '1');
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  });
}

async function reloadEditor(page) {
  await keepLocalSave(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await assertNoErrorBoundary(page);
}

async function waitForCacheIds(page, ids) {
  await expect.poll(async () => {
    const cache = await localCache(page);
    return ids.every((id) => cache.objects.some((object) => object.id === id));
  }, { timeout: 10_000, message: 'local cache must hold transformed ids' }).toBe(true);
}

async function exportAndSave(page, destName) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const dest = path.join(FIXTURE_DIR, destName);
  await download.saveAs(dest);
  return { download, dest, filename: download.suggestedFilename() };
}

test('desktop create/transform then local save/reload + export re-import', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page, { keepOnReload: true });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await userOwned(page)).length, 'fresh fixture starts empty').toBe(0);

  const created = await createRect(page, RECT_BOX);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  const createdGeom = await geom(page, created.id);
  expect(createdGeom.angle).toBeCloseTo(0, 1);
  expect(createdGeom.vw).toBeGreaterThan(20);

  await selectUntilHandles(page, created.id, strokeClickRect, 8);
  await dragResizeHandle(page, 'br', 120, 90);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && now.vw > createdGeom.vw + 10 && now.vh > createdGeom.vh + 8;
  }, { message: 'br must grow the live rect' }).toBeTruthy();
  const resized = await geom(page, created.id);
  expect(resized.left, 'br pins left').toBeCloseTo(createdGeom.left, 1);
  expect(resized.top, 'br pins top').toBeCloseTo(createdGeom.top, 1);

  await selectUntilHandles(page, created.id, strokeClickRect, 8);
  expect(await page.locator('[data-rotation-handle="mtr"]').count()).toBeGreaterThan(0);
  await dragMtrToAngle(page, created.id, 90);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && angleNear(now.angle, 90);
  }, { message: 'mtr must rotate the live rect near 90' }).toBeTruthy();
  const rotated = await geom(page, created.id);
  expect(rotated.vw, 'mtr holds resized width').toBeCloseTo(resized.vw, 1);
  expect(rotated.vh, 'mtr holds resized height').toBeCloseTo(resized.vh, 1);

  const pen = await createPen(page, PEN_BOX);
  await dismissChrome(page);
  expect(pen?.id).toBeTruthy();
  const pen0 = await geom(page, pen.id);
  expect(pen0.vw).toBeGreaterThan(8);
  await selectUntilHandles(page, pen.id, strokeClickInk, 8);
  await dragResizeHandle(page, 'br', 80, 48);
  await expect.poll(async () => {
    const now = await geom(page, pen.id);
    return now && now.vw > pen0.vw + 8 && now.vh > pen0.vh + 6;
  }, { message: 'selected pen br must grow the stroke' }).toBeTruthy();
  const penResized = await geom(page, pen.id);
  expect(isPen(penResized), 'resized stroke stays pen').toBe(true);

  await waitForCacheIds(page, [created.id, pen.id]);
  const cached = await localCache(page);
  expect(cached.fileId).toBeNull();
  const cachedRect = cached.objects.find((object) => object.id === created.id);
  expect(angleNear(cachedRect.angle, 90), 'local cache stores rotated angle').toBe(true);

  // Intended — reload restores the transformed live objects, not the create-time size.
  const viewBoxBefore = await pageViewBox(page);
  await reloadEditor(page);
  await dismissChrome(page);
  await expect.poll(async () => {
    const rows = await userOwned(page);
    return rows.some((row) => row.id === created.id) && rows.some((row) => row.id === pen.id);
  }, { timeout: 20_000 }).toBe(true);
  const restoredRect = await geom(page, created.id);
  const restoredPen = await geom(page, pen.id);
  expect(restoredRect, 'reload restores the transformed rect').toBeTruthy();
  expect(restoredPen, 'reload restores the resized pen').toBeTruthy();
  expect(angleNear(restoredRect.angle, 90), 'reload keeps mtr angle').toBe(true);
  expect(Math.abs(restoredRect.vw - rotated.vw)).toBeLessThan(4);
  expect(Math.abs(restoredRect.vh - rotated.vh)).toBeLessThan(4);
  expect(Math.abs(restoredPen.vw - penResized.vw)).toBeLessThan(6);
  expect(Math.abs(restoredPen.vh - penResized.vh)).toBeLessThan(6);
  expect(restoredRect.vw, 'reload must not restore create-time rect size').toBeGreaterThan(createdGeom.vw + 8);
  expect(await pageViewBox(page), 'viewBox held across reload').toBe(viewBoxBefore);
  expect(await fileId(page)).toBeNull();

  // Edge — undo stack is not required across reload.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const undoEnabled = await undo.isEnabled().catch(() => false);
  if (undoEnabled) await undo.click();
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return Boolean(now);
  }, { timeout: 8_000 }).toBe(true);
  const afterUndo = await geom(page, created.id);
  expect(afterUndo, 'reload is not an undo frame').toBeTruthy();
  expect(angleNear(afterUndo.angle, 90) || afterUndo.vw > createdGeom.vw + 4).toBe(true);

  // Intended — export the transformed page and re-import via ?testPdf=.
  const { dest, filename } = await exportAndSave(page, REIMPORT_NAME);
  await page.evaluate(() => {
    sessionStorage.removeItem('e2e-keep-local-save');
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('annotationsByPage_')) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  });
  await openEditor(page, { url: `/?testPdf=${REIMPORT_NAME}`, keepOnReload: false });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page), 're-import must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const imported = await userAnnotationSnapshot(page);
  expect(imported.length, 're-import must paint the exported marks').toBeGreaterThanOrEqual(2);
  const importedRect = imported.find((row) => (
    isRect(row) && (row.id === created.id || row.imported === true) && angleNear(row.angle, 90, 20)
  )) || imported.find((row) => isRect(row) && angleNear(row.angle, 90, 20));
  const importedPen = imported.find((row) => (
    isPen(row) && (row.id === pen.id || row.imported === true)
  )) || imported.find((row) => isPen(row));
  expect(importedRect, 're-import keeps the rotated rect').toBeTruthy();
  expect(importedPen, 're-import keeps the resized pen').toBeTruthy();
  expect(importedRect.vw, 're-import keeps resized rect width').toBeGreaterThan(createdGeom.vw + 4);
  expect(importedPen.vw, 're-import keeps resized pen width').toBeGreaterThan(pen0.vw + 4);
  expect(await fileId(page)).toBeNull();

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }

  // Break — wipe the local cache; reload invents 0 of the transformed ids.
  await keepLocalSave(page);
  await openEditor(page, { keepOnReload: true });
  await dismissChrome(page);
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('annotationsByPage_')) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  });
  await reloadEditor(page);
  await dismissChrome(page);
  const wiped = await userOwned(page);
  expect(wiped.some((row) => row.id === created.id || row.id === pen.id), 'reload without save invents 0').toBe(false);

  // Break — empty export still downloads; cancel does not invent marks.
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  await emptyDownload.cancel();
  expect((await userOwned(page)).some((row) => row.id === created.id || row.id === pen.id)).toBe(false);
  expect(await fileId(page)).toBeNull();

  console.log('TESTPDF_TRANSFORM_EXPORT_REIMPORT', JSON.stringify({
    rectId: created.id,
    penId: pen.id,
    createdVw: createdGeom.vw,
    rotatedAngle: rotated.angle,
    rotatedVw: rotated.vw,
    pen0Vw: pen0.vw,
    penResizedVw: penResized.vw,
    restoredAngle: restoredRect.angle,
    restoredRectVw: restoredRect.vw,
    restoredPenVw: restoredPen.vw,
    importedRectId: importedRect.id,
    importedRectAngle: importedRect.angle,
    importedRectVw: importedRect.vw,
    importedPenId: importedPen.id,
    importedPenVw: importedPen.vw,
    exportName: filename,
    emptyExport: emptyDownload.suggestedFilename(),
    wipedInvented: wiped.length,
    viewBox: viewBoxBefore,
    fileId: await fileId(page),
    leftover18CloudSave: 'unchanged',
  }));
});

test('390 create/transform then local reload', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page, { width: 390, height: 844, keepOnReload: true });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  const rect = await createRect(page, { x0: 0.18, y0: 0.30, x1: 0.52, y1: 0.48 });
  await dismissChrome(page);
  const before = await geom(page, rect.id);
  await selectUntilHandles(page, rect.id, strokeClickRect, 4);
  await dragResizeHandle(page, 'br', 36, 28);
  await expect.poll(async () => {
    const now = await geom(page, rect.id);
    return now && now.vw > before.vw + 6;
  }, { message: '390 br must grow the live rect' }).toBeTruthy();
  const resized = await geom(page, rect.id);
  await waitForCacheIds(page, [rect.id]);
  await reloadEditor(page);
  await dismissChrome(page);
  await expect.poll(async () => Boolean(await geom(page, rect.id)), { timeout: 20_000 }).toBe(true);
  const restored = await geom(page, rect.id);
  expect(Math.abs(restored.vw - resized.vw)).toBeLessThan(4);
  expect(restored.vw, '390 reload keeps the resize, not create size').toBeGreaterThan(before.vw + 4);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  console.log('TESTPDF_TRANSFORM_390_RELOAD', JSON.stringify({
    rectId: rect.id,
    beforeVw: before.vw,
    resizedVw: resized.vw,
    restoredVw: restored.vw,
    fileId: null,
  }));
});
