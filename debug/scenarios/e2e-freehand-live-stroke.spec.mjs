import { test, expect } from '@playwright/test';

// D-01 / D-02 leftover: live freehand preview then commit.
// Prior D-01/D-02 dedicated create-time Width / swatch / 1-dot tap of the
// committed path. This pass asserts the in-drag `.freehand-creation-preview`
// polyline, pointerup commit, highlighter multiply + as-is Width preview,
// zoomGeneration mid-stroke flush, and pointercancel discard.
// Distinct from leftover-18, E-01 resize, E-02 rotate, E-03 move, V-01 pan,
// color / Width catalogs. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const RECT_A = { x0: 0.58, y0: 0.22, x1: 0.78, y1: 0.38 };

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

function livePreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] polyline.freehand-creation-preview');
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
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
        sourceWidth: object.sourceWidth ?? null,
        multiply: object.globalCompositeOperation || null,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userOrder(page) {
  return (await userAnnotationSnapshot(page)).map((row) => row.id);
}

async function geom(page, id) {
  const rows = await userAnnotationSnapshot(page);
  return rows.find((row) => row.id === id) || null;
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

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'highlighter' || row.tool === 'freedraw';
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

async function setWidthTyped(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
  await blurInputs(page);
}

async function startLiveStroke(page, { x0 = 0.16, y0 = 0.62, x1 = 0.40, y1 = 0.70 } = {}) {
  const box = await pageBox(page);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const mid = {
    x: box.x + box.width * ((x0 + x1) / 2),
    y: box.y + box.height * ((y0 + y1) / 2),
  };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 8 });
  await expect(livePreview(page), 'live freehand preview must paint before pointerup').toBeVisible({ timeout: 5_000 });
  return { box, start, mid, end };
}

async function previewInfo(page) {
  const preview = livePreview(page);
  if (!(await preview.count())) return null;
  return preview.evaluate((el) => ({
    points: (el.getAttribute('points') || '').trim(),
    strokeWidth: Number(el.getAttribute('stroke-width') || 0),
    mix: window.getComputedStyle(el).mixBlendMode,
    tick: Number(el.getAttribute('data-preview-tick') || 0),
  }));
}

test('desktop freehand live stroke intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  await selectMode(page);
  const emptyBefore = await userOrder(page);
  expect(await livePreview(page).count(), 'empty page live preview 0').toBe(0);
  await dragOnPage(page, { x0: 0.10, y0: 0.12, x1: 0.18, y1: 0.20 });
  expect(await userOrder(page), 'empty Select drag invents 0').toEqual(emptyBefore);
  expect(await livePreview(page).count(), 'Select drag must not paint freehand preview').toBe(0);

  const rectA = await createRect(page, RECT_A);
  await dismissChrome(page);
  await blurInputs(page);
  const a0 = await geom(page, rectA.id);
  expect(a0, 'A geom').toBeTruthy();

  // Intended — Pen: live polyline during drag, commit on pointerup.
  const beforePen = new Set(await userOrder(page));
  await activateTool(page, 'Draw', 'Pen');
  await blurInputs(page);
  const penDrag = await startLiveStroke(page, { x0: 0.14, y0: 0.58, x1: 0.42, y1: 0.68 });
  expect(await userOrder(page), 'Pen live drag must not commit yet').toEqual([...beforePen]);
  const penLive = await previewInfo(page);
  expect(penLive?.points.split(' ').length, 'Pen preview must sample more than one point').toBeGreaterThan(1);
  expect(penLive?.mix === 'multiply', 'Pen preview is not highlighter multiply').toBe(false);
  await page.mouse.move(penDrag.end.x, penDrag.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(livePreview(page), 'Pen pointerup must drop the preview').toHaveCount(0);
  const penInk = await waitForNewUserAnnotation(page, beforePen, isInk);
  expect(penInk.tool === 'pen' || penInk.type === 'path', 'Pen pointerup must commit ink').toBeTruthy();
  expect(penInk.multiply === 'multiply', 'Pen commit is not highlighter multiply').toBe(false);
  const aPen = await geom(page, rectA.id);
  expect(aPen.left, 'Pen commit must isolate A left').toBeCloseTo(a0.left, 1);
  expect(aPen.top, 'Pen commit must isolate A top').toBeCloseTo(a0.top, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await userOrder(page)).includes(penInk.id), {
    message: 'undo must restore by dropping Pen ink',
  }).toBe(false);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await userOrder(page)).includes(penInk.id), {
    message: 'redo must restore Pen ink',
  }).toBe(true);

  // Intended — Highlighter: live multiply + as-is Width preview, then commit.
  await activateTool(page, 'Draw', 'Highlighter');
  await setWidthTyped(page, 4);
  const beforeHi = new Set(await userOrder(page));
  const hiDrag = await startLiveStroke(page, { x0: 0.16, y0: 0.74, x1: 0.44, y1: 0.84 });
  expect(await userOrder(page), 'Highlighter live drag must not commit yet').toEqual([...beforeHi]);
  const hiLive = await previewInfo(page);
  expect(hiLive?.mix, 'Highlighter live preview uses multiply').toBe('multiply');
  expect(hiLive?.strokeWidth, 'Highlighter live preview stamps Width 4 as-is').toBe(4);
  await page.mouse.move(hiDrag.end.x, hiDrag.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(livePreview(page), 'Highlighter pointerup must drop the preview').toHaveCount(0);
  const hiInk = await waitForNewUserAnnotation(page, beforeHi, (row) => (
    isInk(row) && (row.tool === 'highlighter' || row.multiply === 'multiply')
  ));
  expect(hiInk.sourceWidth, 'Highlighter commit stamps sourceWidth 4 as-is').toBe(4);
  expect(hiInk.multiply, 'Highlighter commit stamps multiply').toBe('multiply');
  expect((await userOrder(page)).includes(penInk.id), 'Highlighter commit must isolate Pen ink').toBe(true);

  // Break — pointercancel mid-stroke discards (never commits).
  await activateTool(page, 'Draw', 'Pen');
  await blurInputs(page);
  const beforeCancel = new Set(await userOrder(page));
  await startLiveStroke(page, { x0: 0.12, y0: 0.46, x1: 0.28, y1: 0.52 });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
    }));
  });
  await expect(livePreview(page), 'pointercancel must drop the preview').toHaveCount(0, { timeout: 5_000 });
  await page.mouse.up().catch(() => {});
  expect(await userOrder(page), 'pointercancel must invent 0').toEqual([...beforeCancel]);

  // Break — zoom mid-stroke flushes via zoomGeneration (commit, not drop).
  await activateTool(page, 'Draw', 'Pen');
  await blurInputs(page);
  const beforeZoom = new Set(await userOrder(page));
  const zoomDrag = await startLiveStroke(page, { x0: 0.18, y0: 0.40, x1: 0.36, y1: 0.48 });
  expect(await userOrder(page), 'zoom mid-stroke starts uncommitted').toEqual([...beforeZoom]);
  await page.keyboard.press('Control+=');
  const zoomInk = await waitForNewUserAnnotation(page, beforeZoom, isInk);
  await expect(livePreview(page), 'zoom mid-stroke must drop the preview').toHaveCount(0);
  await page.mouse.move(zoomDrag.end.x, zoomDrag.end.y, { steps: 4 });
  await page.mouse.up();
  const afterZoomUp = await userOrder(page);
  expect(afterZoomUp.filter((id) => !beforeZoom.has(id)).length, 'zoom flush + pointerup must not double-commit').toBe(1);
  expect(afterZoomUp.includes(zoomInk.id), 'zoom mid-stroke must keep the flushed ink').toBe(true);
  expect(afterZoomUp.includes(penInk.id), 'zoom flush must isolate earlier Pen').toBe(true);
  expect(afterZoomUp.includes(hiInk.id), 'zoom flush must isolate Highlighter').toBe(true);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);
  expect(await livePreview(page).count()).toBe(0);

  console.log('FREEHAND_LIVE_STROKE_DESKTOP_PROOF', JSON.stringify({
    rectA: rectA.id,
    penInk: penInk.id,
    hiInk: hiInk.id,
    zoomInk: zoomInk.id,
    hiSourceWidth: hiInk.sourceWidth,
    viewBox,
    fileId: null,
  }));
});

test('390 freehand live stroke intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const emptyBefore = await userOrder(page);
  await selectMode(page);
  expect(await livePreview(page).count(), '390 empty live preview 0').toBe(0);
  await dragOnPage(page, { x0: 0.12, y0: 0.16, x1: 0.22, y1: 0.24 });
  expect(await userOrder(page), '390 empty Select drag invents 0').toEqual(emptyBefore);

  const rectA = await createRect(page, { x0: 0.54, y0: 0.22, x1: 0.78, y1: 0.38 });
  await blurInputs(page);
  const a0 = await geom(page, rectA.id);

  const beforePen = new Set(await userOrder(page));
  await activateTool(page, 'Draw', 'Pen');
  const penDrag = await startLiveStroke(page, { x0: 0.16, y0: 0.56, x1: 0.46, y1: 0.66 });
  expect(await userOrder(page), '390 Pen live drag must not commit yet').toEqual([...beforePen]);
  await page.mouse.move(penDrag.end.x, penDrag.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(livePreview(page), '390 Pen pointerup must drop the preview').toHaveCount(0);
  const penInk = await waitForNewUserAnnotation(page, beforePen, isInk);
  const a1 = await geom(page, rectA.id);
  expect(a1.left, '390 Pen commit must isolate A').toBeCloseTo(a0.left, 1);

  await activateTool(page, 'Draw', 'Highlighter');
  const beforeHi = new Set(await userOrder(page));
  const hiDrag = await startLiveStroke(page, { x0: 0.18, y0: 0.72, x1: 0.48, y1: 0.82 });
  const hiLive = await previewInfo(page);
  expect(hiLive?.mix, '390 Highlighter live preview uses multiply').toBe('multiply');
  await page.mouse.move(hiDrag.end.x, hiDrag.end.y, { steps: 6 });
  await page.mouse.up();
  const hiInk = await waitForNewUserAnnotation(page, beforeHi, (row) => (
    isInk(row) && (row.tool === 'highlighter' || row.multiply === 'multiply')
  ));
  expect((await userOrder(page)).includes(penInk.id), '390 Highlighter must isolate Pen').toBe(true);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('FREEHAND_LIVE_STROKE_390_PROOF', JSON.stringify({
    rectA: rectA.id,
    penInk: penInk.id,
    hiInk: hiInk.id,
    viewBox,
    fileId: null,
  }));
});
