import { test, expect } from '@playwright/test';

// S-01 / S-02 leftover: live rect/ellipse rubber-band then commit.
// Prior S-01/S-02 dedicated Style / Width / Cloud catalogs + selected
// bbox resize / canvas mtr. This pass asserts the in-drag
// `.shape-creation-preview` (computeDrawnBoundaryShapePreviewGeometry)
// then pointerup commit via buildBoundaryShapeCommitJSON.
// Distinct from leftover-18, D-01/D-02 freehand preview, E-01 resize,
// E-02 rotate, E-03 move, V-01 pan, color / Width catalogs.
// Line/arrow dashed preview is a different CREATE-01 path (not this slice).
// Do not stamp file.id.

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
  return page.locator('[data-svg-annotation-layer="1"] g.shape-creation-preview');
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
        rx: Number(object.rx ?? 0),
        ry: Number(object.ry ?? 0),
        strokeWidth: Number(object.strokeWidth ?? 0),
        contract: data.strokeRenderContract || null,
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

function isEllipse(row) {
  return row.type === 'ellipse' || row.tool === 'ellipse';
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

async function startLiveShape(page, { x0 = 0.16, y0 = 0.52, x1 = 0.38, y1 = 0.68 } = {}) {
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
  await expect(livePreview(page), 'live shape preview must paint before pointerup').toBeVisible({ timeout: 5_000 });
  return { box, start, mid, end };
}

async function previewInfo(page) {
  const preview = livePreview(page);
  if (!(await preview.count())) return null;
  return preview.evaluate((el) => {
    const rect = el.querySelector('[data-shape-kind="rect"]');
    const ellipse = el.querySelector('[data-shape-kind="ellipse"]');
    const line = el.closest('svg')?.querySelector('line.shape-creation-preview');
    return {
      kind: rect ? 'rect' : ellipse ? 'ellipse' : null,
      width: rect ? Number(rect.getAttribute('width') || 0) : 0,
      height: rect ? Number(rect.getAttribute('height') || 0) : 0,
      rx: ellipse ? Number(ellipse.getAttribute('rx') || 0) : 0,
      ry: ellipse ? Number(ellipse.getAttribute('ry') || 0) : 0,
      dashedLine: !!line,
    };
  });
}

test('desktop shape live create intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  await selectMode(page);
  const emptyBefore = await userOrder(page);
  expect(await livePreview(page).count(), 'empty page live preview 0').toBe(0);
  await dragOnPage(page, { x0: 0.10, y0: 0.12, x1: 0.18, y1: 0.20 });
  expect(await userOrder(page), 'empty Select drag invents 0').toEqual(emptyBefore);
  expect(await livePreview(page).count(), 'Select drag must not paint shape preview').toBe(0);

  // Intended — Rect: live rubber-band during drag, commit on pointerup.
  const beforeRect = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await blurInputs(page);
  const rectDrag = await startLiveShape(page, { x0: 0.14, y0: 0.22, x1: 0.40, y1: 0.40 });
  expect(await userOrder(page), 'Rect live drag must not commit yet').toEqual([...beforeRect]);
  const rectLive = await previewInfo(page);
  expect(rectLive?.kind, 'Rect preview must render a rect').toBe('rect');
  expect(rectLive?.width, 'Rect preview must have width').toBeGreaterThan(2);
  expect(rectLive?.height, 'Rect preview must have height').toBeGreaterThan(2);
  expect(rectLive?.dashedLine, 'Rect preview is not the Line dashed path').toBe(false);
  await page.mouse.move(rectDrag.end.x, rectDrag.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(livePreview(page), 'Rect pointerup must drop the preview').toHaveCount(0);
  const rectA = await waitForNewUserAnnotation(page, beforeRect, isRect);
  expect(rectA.width, 'Rect commit must pass the 2pt gate').toBeGreaterThan(2);
  expect(rectA.height, 'Rect commit must pass the 2pt gate').toBeGreaterThan(2);
  expect(rectA.contract, 'Rect commit stamps drawn-centered-stroke').toBe('drawn-centered-stroke');
  const a0 = await geom(page, rectA.id);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await userOrder(page)).includes(rectA.id), {
    message: 'undo must restore by dropping Rect',
  }).toBe(false);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await userOrder(page)).includes(rectA.id), {
    message: 'redo must restore Rect',
  }).toBe(true);

  // Intended — Ellipse: live ellipse preview then commit (rx/ry).
  await activateTool(page, 'Shapes', 'Ellipse');
  await blurInputs(page);
  const beforeEll = new Set(await userOrder(page));
  const ellDrag = await startLiveShape(page, { x0: 0.50, y0: 0.24, x1: 0.76, y1: 0.44 });
  expect(await userOrder(page), 'Ellipse live drag must not commit yet').toEqual([...beforeEll]);
  const ellLive = await previewInfo(page);
  expect(ellLive?.kind, 'Ellipse preview must render an ellipse').toBe('ellipse');
  expect(ellLive?.rx, 'Ellipse preview must have rx').toBeGreaterThan(1);
  expect(ellLive?.ry, 'Ellipse preview must have ry').toBeGreaterThan(1);
  await page.mouse.move(ellDrag.end.x, ellDrag.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(livePreview(page), 'Ellipse pointerup must drop the preview').toHaveCount(0);
  const ellB = await waitForNewUserAnnotation(page, beforeEll, isEllipse);
  expect(ellB.rx, 'Ellipse commit stamps rx').toBeGreaterThan(1);
  expect(ellB.ry, 'Ellipse commit stamps ry').toBeGreaterThan(1);
  expect(ellB.contract, 'Ellipse commit stamps drawn-centered-stroke').toBe('drawn-centered-stroke');
  const aEll = await geom(page, rectA.id);
  expect(aEll.left, 'Ellipse commit must isolate A left').toBeCloseTo(a0.left, 1);
  expect(aEll.top, 'Ellipse commit must isolate A top').toBeCloseTo(a0.top, 1);

  // Break — click / sub-2pt drag invents 0 (size gate).
  await activateTool(page, 'Shapes', 'Rectangle');
  await blurInputs(page);
  const beforeTiny = new Set(await userOrder(page));
  const tinyBox = await pageBox(page);
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12, tinyBox.y + tinyBox.height * 0.48);
  await page.mouse.down();
  await page.mouse.up();
  await expect(livePreview(page), 'tiny click must drop any preview').toHaveCount(0, { timeout: 5_000 });
  expect(await userOrder(page), 'tiny click must invent 0').toEqual([...beforeTiny]);

  // Break — pointercancel mid-drag discards (never commits). Distinct from
  // freehand only in the preview class; same OS-cancel contract.
  await activateTool(page, 'Shapes', 'Rectangle');
  await blurInputs(page);
  const beforeCancel = new Set(await userOrder(page));
  await startLiveShape(page, { x0: 0.16, y0: 0.52, x1: 0.32, y1: 0.62 });
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

  // Break — zoom mid-drag does NOT flush drag-out shapes (they keep
  // tracking). Distinct from freehand zoomGeneration commit.
  await activateTool(page, 'Shapes', 'Rectangle');
  await blurInputs(page);
  const beforeZoom = new Set(await userOrder(page));
  const zoomDrag = await startLiveShape(page, { x0: 0.18, y0: 0.66, x1: 0.40, y1: 0.80 });
  expect(await userOrder(page), 'zoom mid-drag starts uncommitted').toEqual([...beforeZoom]);
  await page.keyboard.press('Control+=');
  await expect.poll(async () => (await userOrder(page)).join(','), {
    timeout: 3_000,
    message: 'zoom mid-drag must not flush a drag-out shape',
  }).toBe([...beforeZoom].join(','));
  expect(
    (await livePreview(page).count()) > 0
    || (await userOrder(page)).length === beforeZoom.size,
    'zoom mid-drag must keep tracking or stay uncommitted',
  ).toBeTruthy();
  await page.mouse.move(zoomDrag.end.x, zoomDrag.end.y, { steps: 4 });
  await page.mouse.up();
  const zoomRect = await waitForNewUserAnnotation(page, beforeZoom, isRect);
  await expect(livePreview(page), 'zoom then pointerup must drop the preview').toHaveCount(0);
  const afterZoomUp = await userOrder(page);
  expect(afterZoomUp.filter((id) => !beforeZoom.has(id)).length, 'zoom keep-track + pointerup must not double-commit').toBe(1);
  expect(afterZoomUp.includes(zoomRect.id), 'zoom mid-drag then pointerup must commit one Rect').toBe(true);
  expect(afterZoomUp.includes(rectA.id), 'zoom keep-track must isolate earlier Rect').toBe(true);
  expect(afterZoomUp.includes(ellB.id), 'zoom keep-track must isolate Ellipse').toBe(true);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);
  expect(await livePreview(page).count()).toBe(0);

  console.log('SHAPE_LIVE_CREATE_DESKTOP_PROOF', JSON.stringify({
    rectA: rectA.id,
    ellB: ellB.id,
    zoomRect: zoomRect.id,
    rectW: rectA.width,
    rectH: rectA.height,
    ellRx: ellB.rx,
    ellRy: ellB.ry,
    viewBox,
    fileId: null,
  }));
});

test('390 shape live create intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const emptyBefore = await userOrder(page);
  await selectMode(page);
  expect(await livePreview(page).count(), '390 empty live preview 0').toBe(0);
  await dragOnPage(page, { x0: 0.12, y0: 0.16, x1: 0.22, y1: 0.24 });
  expect(await userOrder(page), '390 empty Select drag invents 0').toEqual(emptyBefore);

  const beforeRect = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  const rectDrag = await startLiveShape(page, { x0: 0.16, y0: 0.28, x1: 0.52, y1: 0.46 });
  expect(await userOrder(page), '390 Rect live drag must not commit yet').toEqual([...beforeRect]);
  const rectLive = await previewInfo(page);
  expect(rectLive?.kind, '390 Rect preview must render a rect').toBe('rect');
  await page.mouse.move(rectDrag.end.x, rectDrag.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(livePreview(page), '390 Rect pointerup must drop the preview').toHaveCount(0);
  const rectA = await waitForNewUserAnnotation(page, beforeRect, isRect);
  const a0 = await geom(page, rectA.id);

  await activateTool(page, 'Shapes', 'Ellipse');
  const beforeEll = new Set(await userOrder(page));
  const ellDrag = await startLiveShape(page, { x0: 0.18, y0: 0.54, x1: 0.56, y1: 0.74 });
  const ellLive = await previewInfo(page);
  expect(ellLive?.kind, '390 Ellipse preview must render an ellipse').toBe('ellipse');
  await page.mouse.move(ellDrag.end.x, ellDrag.end.y, { steps: 6 });
  await page.mouse.up();
  const ellB = await waitForNewUserAnnotation(page, beforeEll, isEllipse);
  const a1 = await geom(page, rectA.id);
  expect(a1.left, '390 Ellipse commit must isolate A').toBeCloseTo(a0.left, 1);
  expect(ellB.rx, '390 Ellipse commit stamps rx').toBeGreaterThan(1);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SHAPE_LIVE_CREATE_390_PROOF', JSON.stringify({
    rectA: rectA.id,
    ellB: ellB.id,
    viewBox,
    fileId: null,
  }));
});
