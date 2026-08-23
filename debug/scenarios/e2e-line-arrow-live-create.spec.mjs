import { test, expect } from '@playwright/test';

// S-03 / S-04 leftover: live Line / Arrow rubber-band then commit.
// Prior S-03/S-04 dedicated p1/p2/midpoint handles, dash / arrowhead
// catalogs, swatches, and Width. This pass asserts the in-drag
// `line.shape-creation-preview` (CREATE-01 dashed translucent 5,5)
// then pointerup commit via buildLineCommitJSON (3pt length gate).
// Distinct from leftover-18, S-01/S-02 filled g.shape-creation-preview,
// D-01/D-02 freehand preview, E-01 resize, E-02 rotate, E-03 move,
// V-01 pan, color / Width / dash catalogs.
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

function liveLinePreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] line.shape-creation-preview');
}

function liveBoundaryPreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] g.shape-creation-preview');
}

function liveCalloutPreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] g.callout-preview');
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const x1 = Number(object.x1 ?? 0);
      const y1 = Number(object.y1 ?? 0);
      const x2 = Number(object.x2 ?? 0);
      const y2 = Number(object.y2 ?? 0);
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? data.left ?? 0),
        top: Number(object.top ?? data.top ?? 0),
        width: Number(object.width ?? data.width ?? 0) * Math.abs(Number(object.scaleX ?? 1)),
        height: Number(object.height ?? data.height ?? 0) * Math.abs(Number(object.scaleY ?? 1)),
        x1,
        y1,
        x2,
        y2,
        length: Math.hypot(x2 - x1, y2 - y1),
        strokeDashArray: object.strokeDashArray ?? data.strokeDashArray ?? null,
        arrowheadStyle: data.arrowheadStyle || object.arrowheadStyle || null,
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

function isLine(row) {
  return row.tool === 'line' && row.type === 'line';
}

function isArrow(row) {
  return row.tool === 'arrow';
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

async function startLiveLine(page, { x0 = 0.16, y0 = 0.52, x1 = 0.38, y1 = 0.68 } = {}) {
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
  await expect(liveLinePreview(page), 'live line preview must paint before pointerup').toBeVisible({ timeout: 5_000 });
  return { box, start, mid, end };
}

async function previewInfo(page) {
  const preview = liveLinePreview(page);
  if (!(await preview.count())) return null;
  return preview.evaluate((el) => {
    const x1 = Number(el.getAttribute('x1') || 0);
    const y1 = Number(el.getAttribute('y1') || 0);
    const x2 = Number(el.getAttribute('x2') || 0);
    const y2 = Number(el.getAttribute('y2') || 0);
    return {
      tag: el.tagName,
      dash: el.getAttribute('stroke-dasharray') || '',
      opacity: Number(el.getAttribute('opacity') || 1),
      x1,
      y1,
      x2,
      y2,
      length: Math.hypot(x2 - x1, y2 - y1),
    };
  });
}

test('desktop line/arrow live create intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  await selectMode(page);
  const emptyBefore = await userOrder(page);
  expect(await liveLinePreview(page).count(), 'empty page live line preview 0').toBe(0);
  await dragOnPage(page, { x0: 0.10, y0: 0.12, x1: 0.18, y1: 0.20 });
  expect(await userOrder(page), 'empty Select drag invents 0').toEqual(emptyBefore);
  expect(await liveLinePreview(page).count(), 'Select drag must not paint line preview').toBe(0);

  // Intended — Line: live dashed CREATE-01 rubber-band during drag, commit on pointerup.
  const beforeLine = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Line');
  await blurInputs(page);
  const lineDrag = await startLiveLine(page, { x0: 0.14, y0: 0.22, x1: 0.40, y1: 0.40 });
  expect(await userOrder(page), 'Line live drag must not commit yet').toEqual([...beforeLine]);
  expect(await liveBoundaryPreview(page).count(), 'Line preview is not the Rect/Ellipse g path').toBe(0);
  expect(await liveCalloutPreview(page).count(), 'Line preview is not the Callout path').toBe(0);
  const lineLive = await previewInfo(page);
  expect(lineLive?.tag, 'Line preview must be a <line>').toBe('line');
  expect(lineLive?.dash, 'CREATE-01 preview is dashed 5,5 (not Style [6,4])').toBe('5,5');
  expect(lineLive?.opacity, 'CREATE-01 preview is translucent').toBeCloseTo(0.6, 5);
  expect(lineLive?.length, 'Line preview must pass the 3pt gate visually').toBeGreaterThan(3);
  await page.mouse.move(lineDrag.end.x, lineDrag.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(liveLinePreview(page), 'Line pointerup must drop the preview').toHaveCount(0);
  const lineA = await waitForNewUserAnnotation(page, beforeLine, isLine);
  expect(lineA.length, 'Line commit must pass the 3pt gate').toBeGreaterThan(3);
  expect(lineA.arrowheadStyle, 'Line create never stamps arrowheadStyle').toBeNull();
  expect(lineA.strokeDashArray, 'CREATE-01 commit restores solid').toBeNull();
  const a0 = await geom(page, lineA.id);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await userOrder(page)).includes(lineA.id), {
    message: 'undo must restore by dropping Line',
  }).toBe(false);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await userOrder(page)).includes(lineA.id), {
    message: 'redo must restore Line',
  }).toBe(true);

  // Intended — Arrow: same dashed preview then commit with default solidTriangle.
  await activateTool(page, 'Shapes', 'Arrow');
  await blurInputs(page);
  const beforeArrow = new Set(await userOrder(page));
  const arrowDrag = await startLiveLine(page, { x0: 0.50, y0: 0.24, x1: 0.76, y1: 0.44 });
  expect(await userOrder(page), 'Arrow live drag must not commit yet').toEqual([...beforeArrow]);
  const arrowLive = await previewInfo(page);
  expect(arrowLive?.tag, 'Arrow preview must be a <line>').toBe('line');
  expect(arrowLive?.dash, 'Arrow CREATE-01 preview is dashed 5,5').toBe('5,5');
  expect(arrowLive?.opacity, 'Arrow CREATE-01 preview is translucent').toBeCloseTo(0.6, 5);
  await page.mouse.move(arrowDrag.end.x, arrowDrag.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(liveLinePreview(page), 'Arrow pointerup must drop the preview').toHaveCount(0);
  const arrowB = await waitForNewUserAnnotation(page, beforeArrow, isArrow);
  expect(arrowB.length, 'Arrow commit must pass the 3pt gate').toBeGreaterThan(3);
  expect(arrowB.arrowheadStyle, 'Arrow create stamps the toolbar default head').toBe('solidTriangle');
  const aLine = await geom(page, lineA.id);
  expect(aLine.left, 'Arrow commit must isolate A left').toBeCloseTo(a0.left, 1);
  expect(aLine.top, 'Arrow commit must isolate A top').toBeCloseTo(a0.top, 1);
  expect(aLine.length, 'Arrow commit must isolate A length').toBeCloseTo(a0.length, 1);
  expect(aLine.arrowheadStyle, 'Arrow commit must not stamp a head onto Line').toBeNull();

  // Break — click / sub-3pt drag invents 0 (length gate).
  await activateTool(page, 'Shapes', 'Line');
  await blurInputs(page);
  const beforeTiny = new Set(await userOrder(page));
  const tinyBox = await pageBox(page);
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12, tinyBox.y + tinyBox.height * 0.48);
  await page.mouse.down();
  await page.mouse.up();
  await expect(liveLinePreview(page), 'tiny click must drop any preview').toHaveCount(0, { timeout: 5_000 });
  expect(await userOrder(page), 'tiny click must invent 0').toEqual([...beforeTiny]);

  // Break — pointercancel mid-drag discards (never commits).
  await activateTool(page, 'Shapes', 'Line');
  await blurInputs(page);
  const beforeCancel = new Set(await userOrder(page));
  await startLiveLine(page, { x0: 0.16, y0: 0.52, x1: 0.32, y1: 0.62 });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
    }));
  });
  await expect(liveLinePreview(page), 'pointercancel must drop the preview').toHaveCount(0, { timeout: 5_000 });
  await page.mouse.up().catch(() => {});
  expect(await userOrder(page), 'pointercancel must invent 0').toEqual([...beforeCancel]);

  // Break — zoom mid-drag does NOT flush drag-out lines (they keep tracking).
  await activateTool(page, 'Shapes', 'Line');
  await blurInputs(page);
  const beforeZoom = new Set(await userOrder(page));
  const zoomDrag = await startLiveLine(page, { x0: 0.18, y0: 0.66, x1: 0.40, y1: 0.80 });
  expect(await userOrder(page), 'zoom mid-drag starts uncommitted').toEqual([...beforeZoom]);
  await page.keyboard.press('Control+=');
  await expect.poll(async () => (await userOrder(page)).join(','), {
    timeout: 3_000,
    message: 'zoom mid-drag must not flush a drag-out line',
  }).toBe([...beforeZoom].join(','));
  expect(
    (await liveLinePreview(page).count()) > 0
    || (await userOrder(page)).length === beforeZoom.size,
    'zoom mid-drag must keep tracking or stay uncommitted',
  ).toBeTruthy();
  await page.mouse.move(zoomDrag.end.x, zoomDrag.end.y, { steps: 4 });
  await page.mouse.up();
  const zoomLine = await waitForNewUserAnnotation(page, beforeZoom, isLine);
  await expect(liveLinePreview(page), 'zoom then pointerup must drop the preview').toHaveCount(0);
  const afterZoomUp = await userOrder(page);
  expect(afterZoomUp.filter((id) => !beforeZoom.has(id)).length, 'zoom keep-track + pointerup must not double-commit').toBe(1);
  expect(afterZoomUp.includes(zoomLine.id), 'zoom mid-drag then pointerup must commit one Line').toBe(true);
  expect(afterZoomUp.includes(lineA.id), 'zoom keep-track must isolate earlier Line').toBe(true);
  expect(afterZoomUp.includes(arrowB.id), 'zoom keep-track must isolate Arrow').toBe(true);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);
  expect(await liveLinePreview(page).count()).toBe(0);

  console.log('LINE_ARROW_LIVE_CREATE_DESKTOP_PROOF', JSON.stringify({
    lineA: lineA.id,
    arrowB: arrowB.id,
    zoomLine: zoomLine.id,
    lineLen: lineA.length,
    arrowLen: arrowB.length,
    arrowHead: arrowB.arrowheadStyle,
    viewBox,
    fileId: null,
  }));
});

test('390 line/arrow live create intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const emptyBefore = await userOrder(page);
  await selectMode(page);
  expect(await liveLinePreview(page).count(), '390 empty live line preview 0').toBe(0);
  await dragOnPage(page, { x0: 0.12, y0: 0.16, x1: 0.22, y1: 0.24 });
  expect(await userOrder(page), '390 empty Select drag invents 0').toEqual(emptyBefore);

  const beforeLine = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Line');
  const lineDrag = await startLiveLine(page, { x0: 0.16, y0: 0.28, x1: 0.52, y1: 0.46 });
  expect(await userOrder(page), '390 Line live drag must not commit yet').toEqual([...beforeLine]);
  const lineLive = await previewInfo(page);
  expect(lineLive?.tag, '390 Line preview must be a <line>').toBe('line');
  expect(lineLive?.dash, '390 CREATE-01 preview is dashed 5,5').toBe('5,5');
  await page.mouse.move(lineDrag.end.x, lineDrag.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(liveLinePreview(page), '390 Line pointerup must drop the preview').toHaveCount(0);
  const lineA = await waitForNewUserAnnotation(page, beforeLine, isLine);
  expect(lineA.arrowheadStyle, '390 Line create never stamps arrowheadStyle').toBeNull();
  const a0 = await geom(page, lineA.id);

  await activateTool(page, 'Shapes', 'Arrow');
  const beforeArrow = new Set(await userOrder(page));
  const arrowDrag = await startLiveLine(page, { x0: 0.18, y0: 0.54, x1: 0.56, y1: 0.74 });
  const arrowLive = await previewInfo(page);
  expect(arrowLive?.tag, '390 Arrow preview must be a <line>').toBe('line');
  await page.mouse.move(arrowDrag.end.x, arrowDrag.end.y, { steps: 6 });
  await page.mouse.up();
  const arrowB = await waitForNewUserAnnotation(page, beforeArrow, isArrow);
  const a1 = await geom(page, lineA.id);
  expect(a1.left, '390 Arrow commit must isolate A').toBeCloseTo(a0.left, 1);
  expect(arrowB.length, '390 Arrow commit must pass the 3pt gate').toBeGreaterThan(3);
  expect(arrowB.arrowheadStyle, '390 Arrow create stamps the toolbar default head').toBe('solidTriangle');

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('LINE_ARROW_LIVE_CREATE_390_PROOF', JSON.stringify({
    lineA: lineA.id,
    arrowB: arrowB.id,
    viewBox,
    fileId: null,
  }));
});
