import { test, expect } from '@playwright/test';

// Switched class after Counter nubbin pointercancel. Selected bbox `br`
// pointerup already commits scale. pointercancel left visualTransform armed
// and stored size stale — undo / zoom / isolation could not see the resize.
// zoomGeneration now flushes the same handlePointerUp commit. mtr / endpoint
// / midpoint / knee share that path. Distinct from leftover-18 / X-01 /
// nubbin / create keep-track / eraser commit / survey-marker discard.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const RECT_A = { x0: 0.22, y0: 0.28, x1: 0.42, y1: 0.46 };

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
  const hubCopy = page.getByText('No documents yet');
  if (await hubCopy.isVisible().catch(() => false) || await pageCoveredByHub(page)) {
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
    } else {
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf/ }).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click({ position: { x: 24, y: 8 } }).catch(() => {});
      }
    }
    await expect(hubCopy).toHaveCount(0, { timeout: 8_000 });
  }
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  return raw || '';
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
        vw: width * Math.abs(scaleX),
        vh: height * Math.abs(scaleY),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function geom(page, id) {
  const rows = await userAnnotationSnapshot(page);
  return rows.find((row) => row.id === id) || null;
}

async function userOrder(page) {
  return (await userAnnotationSnapshot(page)).map((row) => row.id);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect';
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

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function createRect(page, coords) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
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
    const layer = page.locator('[data-svg-annotation-layer="1"]').first();
    const cls = String(await layer.getAttribute('class') || '');
    return !cls.includes('tool-crosshair');
  }, { timeout: 8_000, message: 'Select must drop the creation crosshair' }).toBeTruthy();
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
  const title = /^transparent$/i.test(hex) ? 'Transparent' : hex;
  await picker.locator(`button[title="${title}"]`).first().click();
  await page.keyboard.press('Escape').catch(() => {});
  return true;
}

async function hitTarget(page, id) {
  return page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="rect"]`).first();
}

async function annoBox(page, id) {
  const hit = await hitTarget(page, id);
  await expect(hit).toBeVisible();
  const box = await hit.boundingBox();
  expect(box, `hit bbox for ${id}`).toBeTruthy();
  return box;
}

async function strokeClick(page, id) {
  const box = await annoBox(page, id);
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
    } catch {
      // missed
    }
  }
  throw new Error(`stroke-click missed ${id}`);
}

async function clickEmpty(page, { xf = 0.08, yf = 0.08 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

async function selectUntilHandles(page, id, min = 4) {
  await selectMode(page);
  await clickEmpty(page);
  await strokeClick(page, id);
  await expect.poll(async () => page.locator('[data-resize-handle]').count(), {
    timeout: 8_000,
    message: `selected ${id} must show resize handles`,
  }).toBeGreaterThanOrEqual(min);
}

async function startBrDrag(page, dx, dy) {
  const handle = page.locator('[data-resize-handle="br"]').first();
  await expect(handle, 'br handle').toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, 'br handle box').toBeTruthy();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  return start;
}

async function cancelBrPointer(page) {
  await page.locator('[data-resize-handle="br"]').first().dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
    cancelable: true,
  });
}

async function proveBrPointercancel(page, coords) {
  await activateTool(page, 'Shapes', 'Rectangle');
  await setNextDrawFill(page, '#00FFFF');
  const rect = await createRect(page, coords);
  await dismissChrome(page);
  await blurInputs(page);
  await selectUntilHandles(page, rect.id, 4);
  const pre = await geom(page, rect.id);

  await startBrDrag(page, 48, 36);
  await cancelBrPointer(page);
  let afterCancel = null;
  await expect.poll(async () => {
    afterCancel = await geom(page, rect.id);
    return afterCancel && afterCancel.vw > pre.vw + 6 && afterCancel.vh > pre.vh + 4;
  }, { message: 'pointercancel must persist the live br resize', timeout: 8_000 }).toBeTruthy();
  expect(afterCancel.left, 'pointercancel pins left').toBeCloseTo(pre.left, 1);
  expect(afterCancel.top, 'pointercancel pins top').toBeCloseTo(pre.top, 1);

  await clickEmpty(page, { xf: 0.92, yf: 0.08 });
  await page.keyboard.press('Control+z');
  let afterUndo = null;
  await expect.poll(async () => {
    afterUndo = await geom(page, rect.id);
    return afterUndo && Math.abs(afterUndo.vw - pre.vw) < 2 && Math.abs(afterUndo.vh - pre.vh) < 2;
  }, { timeout: 8_000 }).toBeTruthy();

  await selectUntilHandles(page, rect.id, 4);
  const preNoop = await geom(page, rect.id);
  const handle = page.locator('[data-resize-handle="br"]').first();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await cancelBrPointer(page);
  const afterNoop = await geom(page, rect.id);
  expect(Math.abs(afterNoop.vw - preNoop.vw) < 2, 'no-move pointercancel invents 0').toBe(true);
  expect(Math.abs(afterNoop.vh - preNoop.vh) < 2, 'no-move pointercancel invents 0 height').toBe(true);

  await selectUntilHandles(page, rect.id, 4);
  const preZoom = await geom(page, rect.id);
  await startBrDrag(page, 40, 28);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+=');
  let afterZoom = null;
  await expect.poll(async () => {
    afterZoom = await geom(page, rect.id);
    return afterZoom && afterZoom.vw > preZoom.vw + 6 && afterZoom.vh > preZoom.vh + 4;
  }, { message: 'zoomGeneration must flush the live br resize', timeout: 8_000 }).toBeTruthy();
  await page.mouse.up().catch(() => {});
  const afterZoomUp = await geom(page, rect.id);
  expect(Math.abs(afterZoomUp.vw - afterZoom.vw) < 2, 'zoom flush + pointerup must not double-commit').toBe(true);
  expect(afterZoom.left, 'zoom flush pins left').toBeCloseTo(preZoom.left, 1);

  return {
    id: rect.id,
    cancelDw: afterCancel.vw - pre.vw,
    cancelDh: afterCancel.vh - pre.vh,
    zoomDw: afterZoom.vw - preZoom.vw,
    undoRestored: Math.abs(afterUndo.vw - pre.vw) < 2,
    viewBox: await pageViewBox(page),
    fileId: await fileId(page),
  };
}

test('desktop selected br pointercancel + zoomGeneration commit', async ({ page }) => {
  await openEditor(page);
  await dismissChrome(page);
  const proof = await proveBrPointercancel(page, RECT_A);
  expect(proof.viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(proof.fileId, 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-resize-handle]').count(), 'hubPreview handles 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview Draw 0').toBe(0);

  console.log('SELECTED_HANDLE_POINTERCANCEL_DESKTOP', JSON.stringify(proof));
});

test('390 selected br pointercancel + zoomGeneration commit', async ({ page }) => {
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await blurInputs(page);
  const proof = await proveBrPointercancel(page, { x0: 0.18, y0: 0.24, x1: 0.48, y1: 0.48 });
  expect(proof.viewBox, '390 viewBox owns zoom').toBe('0 0 612 792');
  expect(proof.fileId, 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);
  console.log('SELECTED_HANDLE_POINTERCANCEL_390', JSON.stringify(proof));
});
