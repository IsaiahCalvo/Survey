import { test, expect } from '@playwright/test';

// D-01 leftover: selected Pen / Highlighter ink bbox resize + canvas `mtr`.
// Counter single-click chrome is nubbin-only (already receipted). Keyboard
// nudge is not wired (ArrowLeft/Right are page nav). Insert image / stamp
// create has no path. Distinct from leftover-18, D-01/D-02 live stroke
// create, rect/ellipse/textbox/cloud-rect transform, E-03 move, V-01 pan,
// Width / color catalogs. Ink resize uses applyPageAffineToInkObject /
// commitInkObjectResize (scale/affine; path commands may hold). Do not
// stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const INK_A = { x0: 0.18, y0: 0.24, x1: 0.44, y1: 0.42 };
const INK_B = { x0: 0.54, y0: 0.52, x1: 0.80, y1: 0.70 };

function isInk(row) {
  return row?.type === 'path'
    || row?.tool === 'pen'
    || row?.tool === 'highlighter'
    || row?.tool === 'freedraw';
}

function isPen(row) {
  return isInk(row) && row.tool !== 'highlighter' && row.multiply !== 'multiply';
}

function isHighlighter(row) {
  return isInk(row) && (row.tool === 'highlighter' || row.multiply === 'multiply');
}

function isLine(row) {
  return row.type === 'line' || row.tool === 'line';
}

function angleNear(actual, want, tol = 8) {
  const a = ((Number(actual) % 360) + 360) % 360;
  const b = ((Number(want) % 360) + 360) % 360;
  const delta = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  return delta <= tol;
}

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
      const host = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id="${id}"]`,
      );
      const pathEl = host?.querySelector('[data-path-hit-target="true"], path');
      const pathD = pathEl?.getAttribute('d') || '';
      const screen = pathEl?.getBoundingClientRect?.();
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
        sourceWidth: object.sourceWidth ?? null,
        multiply: object.globalCompositeOperation || null,
        pathD,
        pathLen: pathD.length,
        screenLeft: screen?.x ?? null,
        screenTop: screen?.y ?? null,
        screenW: screen?.width ?? null,
        screenH: screen?.height ?? null,
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

async function selectedIds(page) {
  return page.evaluate(() => [...(window.__selectedAnnotationIds || [])]);
}

async function expectSelected(page, ids, message) {
  const want = [...ids].sort();
  await expect.poll(async () => [...(await selectedIds(page))].sort(), {
    timeout: 8_000,
    message: message || `expected selection ${want.join(',')}`,
  }).toEqual(want);
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

async function setWidthTyped(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  if (!(await field.isVisible().catch(() => false))) return false;
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
  await blurInputs(page);
  return true;
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

async function createInk(page, coords, { tool = 'Pen', width } = {}) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Draw', tool);
  if (width != null) await setWidthTyped(page, width);
  const box = await pageBox(page);
  const start = { x: box.x + box.width * coords.x0, y: box.y + box.height * coords.y0 };
  const mid = {
    x: box.x + box.width * ((coords.x0 + coords.x1) / 2 + 0.05),
    y: box.y + box.height * ((coords.y0 + coords.y1) / 2),
  };
  const end = { x: box.x + box.width * coords.x1, y: box.y + box.height * coords.y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  const predicate = tool === 'Highlighter' ? isHighlighter : isPen;
  return waitForNewUserAnnotation(page, before, predicate);
}

async function createLine(page, coords) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isLine);
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

async function inkHitPoint(page, id) {
  return page.evaluate((annoId) => {
    const host = document.querySelector(`[data-svg-annotation-layer="1"] > g[data-anno-id="${annoId}"]`);
    const path = host?.querySelector('[data-path-hit-target="true"]')
      || host?.querySelector('path');
    if (!path || typeof path.getTotalLength !== 'function') return null;
    const len = path.getTotalLength();
    if (!(len > 0)) return null;
    const local = path.getPointAtLength(len * 0.5);
    const ctm = path.getScreenCTM?.();
    if (!ctm) {
      const box = path.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    return {
      x: ctm.a * local.x + ctm.c * local.y + ctm.e,
      y: ctm.b * local.x + ctm.d * local.y + ctm.f,
    };
  }, id);
}

async function annoBox(page, id) {
  const point = await inkHitPoint(page, id);
  const host = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(host).toBeVisible();
  const box = await host.boundingBox();
  expect(box, `ink bbox for ${id}`).toBeTruthy();
  return { ...box, hit: point };
}

async function strokeClick(page, id, { modifiers = [] } = {}) {
  const box = await annoBox(page, id);
  const before = (await selectedIds(page)).includes(id);
  const points = [
    box.hit,
    { x: box.x + box.width * 0.50, y: box.y + box.height * 0.50 },
    { x: box.x + box.width * 0.35, y: box.y + box.height * 0.40 },
    { x: box.x + box.width * 0.70, y: box.y + box.height * 0.55 },
  ].filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  for (const key of modifiers) await page.keyboard.down(key);
  try {
    for (const point of points) {
      await page.mouse.click(point.x, point.y);
      try {
        await expect.poll(async () => (await selectedIds(page)).includes(id), {
          timeout: 800,
        }).not.toBe(before);
        return;
      } catch {
        // This point missed the ink stroke; try the next.
      }
    }
  } finally {
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  }
  throw new Error(`stroke-click missed ${id}`);
}

async function clickEmpty(page, { xf = 0.08, yf = 0.08 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

async function resizeHandleIds(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[data-resize-handle]')]
      .map((el) => el.getAttribute('data-resize-handle'))
      .filter(Boolean)
  ));
}

async function selectUntilHandles(page, id, min = 4) {
  await selectMode(page);
  await clickEmpty(page);
  await strokeClick(page, id);
  await expectSelected(page, [id], `select ${id} before transform`);
  await expect.poll(async () => (await resizeHandleIds(page)).length, {
    timeout: 8_000,
    message: `selected ${id} must show resize handles`,
  }).toBeGreaterThanOrEqual(min);
}

async function dragResizeHandle(page, id, dx, dy, { shift = false } = {}) {
  const handle = page.locator(`[data-resize-handle="${id}"]`).first();
  await expect(handle, `${id} handle`).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, `${id} handle box`).toBeTruthy();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (shift) await page.keyboard.down('Shift');
  try {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
    await page.mouse.up();
  } finally {
    if (shift) await page.keyboard.up('Shift');
  }
  return start;
}

async function dragMtrToAngle(page, id, deg) {
  const box = await annoBox(page, id);
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
  await page.mouse.up();
}

test('desktop ink resize + rotate intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  await selectMode(page);
  expect(await page.locator('[data-resize-handle]').count(), 'empty Select shows 0 handles').toBe(0);
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'empty page mtr 0').toBe(0);
  const emptyBefore = await userOrder(page);
  await dragOnPage(page, { x0: 0.10, y0: 0.12, x1: 0.18, y1: 0.20 });
  expect(await userOrder(page), 'empty Select drag invents 0').toEqual(emptyBefore);

  const inkA = await createInk(page, INK_A, { tool: 'Pen', width: 16 });
  const inkB = await createInk(page, INK_B, { tool: 'Highlighter', width: 4 });
  await dismissChrome(page);
  await blurInputs(page);
  expect(await userOrder(page), 'intended create A then B').toEqual([inkA.id, inkB.id]);
  expect(isPen(inkA), 'A is Pen ink').toBe(true);
  expect(isHighlighter(inkB), 'B is Highlighter ink').toBe(true);
  expect(inkA.type, 'A type is path').toBe('path');
  expect(inkB.multiply, 'B stamps multiply').toBe('multiply');
  expect(inkB.sourceWidth, 'B floors sourceWidth at 8').toBeGreaterThanOrEqual(8);
  expect(inkA.pathLen, 'A paints a live ink path').toBeGreaterThan(8);

  await selectUntilHandles(page, inkA.id, 8);
  const handles = await resizeHandleIds(page);
  expect(handles.sort(), 'single-click ink shows all 8 handles').toEqual(
    ['bl', 'br', 'mb', 'ml', 'mr', 'mt', 'tl', 'tr'],
  );
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'single-select A must show mtr').toBeGreaterThan(0);
  expect(await page.locator('[data-counter-nubbin-handle="true"]').count(), 'no counter nubbin seam').toBe(0);
  expect(await page.locator('circle[data-handle^="vertex-"]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('circle[data-handle="p1"]').count(), 'no line p1 seam').toBe(0);
  expect(await page.locator('[data-handle="textBox-br"]').count(), 'no callout textBox-br seam').toBe(0);
  expect(await page.locator('[data-shape-kind="cloud-rect"]').count(), 'no cloud-rect seam').toBe(0);

  const a0 = await geom(page, inkA.id);
  const b0 = await geom(page, inkB.id);
  expect(a0, 'A geom').toBeTruthy();
  expect(b0, 'B geom').toBeTruthy();
  expect(a0.vw, 'A visible width uses width*|sx|').toBeGreaterThan(8);
  expect(a0.vh, 'A visible height uses height*|sy|').toBeGreaterThan(8);
  expect(a0.angle, 'A starts unrotated').toBeCloseTo(0, 1);
  expect(a0.screenW, 'A has a screen path bbox').toBeGreaterThan(8);

  // Intended — br grows both axes via ink affine/scale; sourceWidth held; path
  // commands may hold (not cloud scallop rebuild); opposite pinned; B isolated.
  await dragResizeHandle(page, 'br', 56, 40);
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && now.vw > a0.vw + 10 && now.vh > a0.vh + 8;
  }, { message: 'br must grow A width and height' }).toBeTruthy();
  const aBr = await geom(page, inkA.id);
  const bBr = await geom(page, inkB.id);
  expect(aBr.screenLeft, 'br must pin A screen left').toBeCloseTo(a0.screenLeft, 1);
  expect(aBr.screenTop, 'br must pin A screen top').toBeCloseTo(a0.screenTop, 1);
  expect(aBr.type, 'br must keep A as path').toBe('path');
  expect(isPen(aBr), 'br must keep A as Pen').toBe(true);
  expect(aBr.sourceWidth, 'br must hold A sourceWidth (not Width catalog)').toBe(a0.sourceWidth);
  expect(aBr.angle, 'br must hold A angle').toBeCloseTo(a0.angle, 1);
  expect(bBr.vw, 'br must isolate B width').toBeCloseTo(b0.vw, 1);
  expect(bBr.vh, 'br must isolate B height').toBeCloseTo(b0.vh, 1);
  expect(bBr.multiply, 'br must isolate B multiply').toBe('multiply');
  expect(bBr.sourceWidth, 'br must isolate B sourceWidth').toBe(b0.sourceWidth);
  expect(bBr.pathD, 'br must isolate B path').toBe(b0.pathD);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && Math.abs(now.vw - a0.vw) < 2 && Math.abs(now.vh - a0.vh) < 2;
  }, { message: 'undo must restore A size' }).toBeTruthy();
  const aUndo = await geom(page, inkA.id);
  expect(aUndo.sourceWidth, 'undo must hold A sourceWidth').toBe(a0.sourceWidth);

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && Math.abs(now.vw - aBr.vw) < 2 && Math.abs(now.vh - aBr.vh) < 2;
  }, { message: 'redo must restore resized A' }).toBeTruthy();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && Math.abs(now.vw - a0.vw) < 2;
  }, { message: 'second undo must restore A again' }).toBeTruthy();

  // Intended — mr grows width only; mb grows height only; sourceWidth held.
  await selectUntilHandles(page, inkA.id, 8);
  const aPreMr = await geom(page, inkA.id);
  await dragResizeHandle(page, 'mr', 48, 0);
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && now.vw > aPreMr.vw + 8 && Math.abs(now.vh - aPreMr.vh) < 4;
  }, { message: 'mr must grow A width only' }).toBeTruthy();
  const aMr = await geom(page, inkA.id);
  expect(aMr.screenTop, 'mr must pin A screen top').toBeCloseTo(aPreMr.screenTop, 1);
  expect(aMr.sourceWidth, 'mr must hold sourceWidth').toBe(aPreMr.sourceWidth);
  expect(isPen(aMr), 'mr must keep Pen').toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && Math.abs(now.vw - aPreMr.vw) < 2;
  }, { message: 'undo mr must restore A width' }).toBeTruthy();

  await selectUntilHandles(page, inkA.id, 8);
  const aPreMb = await geom(page, inkA.id);
  await dragResizeHandle(page, 'mb', 0, 40);
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && now.vh > aPreMb.vh + 8 && Math.abs(now.vw - aPreMb.vw) < 4;
  }, { message: 'mb must grow A height only' }).toBeTruthy();
  const aMb = await geom(page, inkA.id);
  expect(aMb.screenLeft, 'mb must pin A screen left').toBeCloseTo(aPreMb.screenLeft, 1);
  const bAfterSides = await geom(page, inkB.id);
  expect(bAfterSides.vw, 'side handles must isolate B').toBeCloseTo(b0.vw, 1);
  expect(bAfterSides.multiply, 'side handles must isolate B multiply').toBe('multiply');

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && Math.abs(now.vh - aPreMb.vh) < 2;
  }, { message: 'undo mb must restore A height' }).toBeTruthy();

  // Edge — Shift+br locks aspect.
  await selectUntilHandles(page, inkA.id, 8);
  const aPreShift = await geom(page, inkA.id);
  const ratio0 = aPreShift.vw / aPreShift.vh;
  await dragResizeHandle(page, 'br', 70, 20, { shift: true });
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && now.vw > aPreShift.vw + 8 && now.vh > aPreShift.vh + 8;
  }, { message: 'Shift+br must grow both axes' }).toBeTruthy();
  const aShift = await geom(page, inkA.id);
  const ratio1 = aShift.vw / aShift.vh;
  expect(ratio1, 'Shift+br must keep aspect').toBeCloseTo(ratio0, 1);
  expect(aShift.sourceWidth, 'Shift+br must hold sourceWidth').toBe(aPreShift.sourceWidth);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && Math.abs(now.vw - aPreShift.vw) < 2;
  }, { message: 'undo Shift+br must restore A' }).toBeTruthy();

  // Edge — flip past the opposite corner; |scale| / flipY keeps size > 0.
  await selectUntilHandles(page, inkA.id, 8);
  const aPreFlip = await geom(page, inkA.id);
  const aBox = await annoBox(page, inkA.id);
  await dragResizeHandle(page, 'br', -(aBox.width + 48), -(aBox.height + 36));
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && now.screenLeft < aPreFlip.screenLeft - 8 && now.vw > 4 && now.vh > 4;
  }, { message: 'flip past opposite must move origin and keep size' }).toBeTruthy();
  const aFlip = await geom(page, inkA.id);
  expect(Math.abs(aFlip.scaleX), 'flip commit stores |scaleX|').toBeGreaterThan(0);
  expect(Math.abs(aFlip.scaleY), 'flip commit stores |scaleY|').toBeGreaterThan(0);
  expect(isPen(aFlip), 'flip must keep Pen').toBe(true);
  const bAfterFlip = await geom(page, inkB.id);
  expect(bAfterFlip.vw, 'flip must isolate B').toBeCloseTo(b0.vw, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && Math.abs(now.vw - aPreFlip.vw) < 2;
  }, { message: 'undo flip must restore A' }).toBeTruthy();

  // Break — collapse floors above zero; still path ink.
  await selectUntilHandles(page, inkA.id, 8);
  const aPreCollapse = await geom(page, inkA.id);
  const collapseBox = await annoBox(page, inkA.id);
  await dragResizeHandle(page, 'br', -(collapseBox.width * 0.92), -(collapseBox.height * 0.92));
  const aCollapse = await geom(page, inkA.id);
  expect(aCollapse.vw, 'collapse must keep a visible width').toBeGreaterThan(1);
  expect(aCollapse.vh, 'collapse must keep a visible height').toBeGreaterThan(1);
  expect(aCollapse.vw, 'collapse must shrink width').toBeLessThan(aPreCollapse.vw - 4);
  expect(aCollapse.type, 'collapse must keep path').toBe('path');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && Math.abs(now.vw - aPreCollapse.vw) < 2;
  }, { message: 'undo collapse must restore A' }).toBeTruthy();

  // Intended — free-drag mtr to 90° then 180° (not Shift snap, not pill).
  await selectUntilHandles(page, inkA.id, 8);
  const aPreRot = await geom(page, inkA.id);
  await dragMtrToAngle(page, inkA.id, 90);
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && angleNear(now.angle, 90, 10);
  }, { message: 'free mtr drag must set A near 90°' }).toBeTruthy();
  const a90 = await geom(page, inkA.id);
  const b90 = await geom(page, inkB.id);
  expect(a90.vw, 'mtr rotate must hold A width').toBeCloseTo(aPreRot.vw, 1);
  expect(a90.vh, 'mtr rotate must hold A height').toBeCloseTo(aPreRot.vh, 1);
  expect(a90.sourceWidth, 'mtr rotate must hold A sourceWidth').toBe(aPreRot.sourceWidth);
  expect(isPen(a90), 'mtr rotate must keep Pen').toBe(true);
  expect(b90.angle, 'mtr rotate must isolate B angle').toBeCloseTo(b0.angle, 1);
  expect(b90.multiply, 'mtr rotate must isolate B multiply').toBe('multiply');

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: 'undo must restore A angle 0' }).toBeTruthy();

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && angleNear(now.angle, a90.angle, 2);
  }, { message: 'redo must restore rotated A' }).toBeTruthy();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: 'second undo must restore A angle 0 again' }).toBeTruthy();

  await clickEmpty(page);
  await strokeClick(page, inkA.id);
  await dragMtrToAngle(page, inkA.id, 180);
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && angleNear(now.angle, 180, 10);
  }, { message: 'free mtr drag must set A near 180°' }).toBeTruthy();
  const a180 = await geom(page, inkA.id);
  expect(a180.vw, '180 rotate must hold A width').toBeCloseTo(aPreRot.vw, 1);
  expect(isPen(a180), '180 rotate must keep Pen').toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: 'undo 180 must restore A angle 0' }).toBeTruthy();

  // Break — micro-drag on mtr does not commit.
  await clickEmpty(page);
  await strokeClick(page, inkA.id);
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 1, hb.y + hb.height / 2 + 1);
  await page.mouse.up();
  const aMicro = await geom(page, inkA.id);
  expect(angleNear(aMicro.angle, 0, 2), 'micro-drag must not commit angle').toBeTruthy();

  // Break — multi-select group frame is moveOnly (mtr hidden).
  await clickEmpty(page);
  await strokeClick(page, inkA.id);
  await strokeClick(page, inkB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [inkA.id, inkB.id], 'Shift-click must add B');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'group moveOnly hides mtr').toBe(0);
  expect(await page.locator('[data-group-selection-bbox="true"]').count(), 'group dashed frame present').toBeGreaterThan(0);

  // Break — Line single-click omits mtr.
  const line = await createLine(page, { x0: 0.18, y0: 0.80, x1: 0.38, y1: 0.88 });
  await selectMode(page);
  await clickEmpty(page);
  const lineHit = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${line.id}"]`).first();
  await expect(lineHit).toBeVisible();
  const lb = await lineHit.boundingBox();
  await page.mouse.click(lb.x + lb.width * 0.5, lb.y + lb.height * 0.5);
  await expectSelected(page, [line.id], 'line click must select the line');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'Line single-click mtr 0').toBe(0);
  const aAfterLine = await geom(page, inkA.id);
  expect(angleNear(aAfterLine.angle, 0, 2), 'Line select must isolate A angle').toBeTruthy();
  expect(isPen(aAfterLine), 'Line select must keep A as Pen').toBe(true);

  // Break — deselect hides handles.
  await clickEmpty(page);
  expect(await page.locator('[data-resize-handle]').count(), 'deselect hides handles').toBe(0);
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'deselect hides mtr').toBe(0);

  // Break — Highlighter selected chrome is the same 8 + mtr; multiply held.
  await selectUntilHandles(page, inkB.id, 8);
  expect((await resizeHandleIds(page)).sort(), 'selected Highlighter shows all 8 handles').toEqual(
    ['bl', 'br', 'mb', 'ml', 'mr', 'mt', 'tl', 'tr'],
  );
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'selected Highlighter must show mtr').toBeGreaterThan(0);
  const bPre = await geom(page, inkB.id);
  await dragResizeHandle(page, 'br', 40, 28);
  await expect.poll(async () => {
    const now = await geom(page, inkB.id);
    return now && now.vw > bPre.vw + 6 && now.vh > bPre.vh + 4;
  }, { message: 'Highlighter br must grow B' }).toBeTruthy();
  const bHi = await geom(page, inkB.id);
  expect(bHi.multiply, 'Highlighter resize must hold multiply').toBe('multiply');
  expect(bHi.sourceWidth, 'Highlighter resize must hold sourceWidth').toBe(bPre.sourceWidth);
  const aHi = await geom(page, inkA.id);
  expect(aHi.vw, 'Highlighter resize must isolate A').toBeCloseTo(aAfterLine.vw, 1);
  await page.keyboard.press('Control+z');

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);
  expect(await page.locator('[data-resize-handle]').count()).toBe(0);
  expect(await page.locator('[data-rotation-handle="mtr"]').count()).toBe(0);

  console.log('INK_RESIZE_ROTATE_DESKTOP_PROOF', JSON.stringify({
    inkA: inkA.id,
    inkB: inkB.id,
    line: line.id,
    sourceWidthA: a0.sourceWidth,
    sourceWidthB: b0.sourceWidth,
    pathLen0: a0.pathLen,
    brDw: aBr.vw - a0.vw,
    brDh: aBr.vh - a0.vh,
    mrDw: aMr.vw - aPreMr.vw,
    mbDh: aMb.vh - aPreMb.vh,
    shiftRatio0: ratio0,
    shiftRatio1: ratio1,
    flipLeft: aFlip.screenLeft,
    collapseVw: aCollapse.vw,
    angle90: a90.angle,
    angle180: a180.angle,
    viewBox,
    fileId: null,
  }));
});

test('390 ink resize + rotate intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const emptyBefore = await userOrder(page);
  await selectMode(page);
  expect(await page.locator('[data-resize-handle]').count(), '390 empty Select shows 0 handles').toBe(0);
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), '390 empty mtr 0').toBe(0);
  await dragOnPage(page, { x0: 0.12, y0: 0.16, x1: 0.22, y1: 0.24 });
  expect(await userOrder(page), '390 empty Select drag invents 0').toEqual(emptyBefore);

  const inkA = await createInk(page, { x0: 0.16, y0: 0.22, x1: 0.50, y1: 0.40 }, { tool: 'Pen', width: 16 });
  const inkB = await createInk(page, { x0: 0.52, y0: 0.50, x1: 0.86, y1: 0.68 }, { tool: 'Highlighter' });
  await blurInputs(page);
  expect(await userOrder(page), '390 create A then B').toEqual([inkA.id, inkB.id]);
  expect(isPen(inkA), '390 A is Pen ink').toBe(true);
  expect(isHighlighter(inkB), '390 B is Highlighter ink').toBe(true);

  await selectUntilHandles(page, inkA.id, 4);
  const a0 = await geom(page, inkA.id);
  const b0 = await geom(page, inkB.id);
  await dragResizeHandle(page, 'br', 36, 28);
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && now.vw > a0.vw + 6 && now.vh > a0.vh + 4;
  }, { message: '390 br must grow A width and height' }).toBeTruthy();
  const a1 = await geom(page, inkA.id);
  const b1 = await geom(page, inkB.id);
  expect(a1.screenLeft, '390 br must pin A screen left').toBeCloseTo(a0.screenLeft, 1);
  expect(a1.type, '390 br must keep path').toBe('path');
  expect(a1.sourceWidth, '390 br must hold sourceWidth').toBe(a0.sourceWidth);
  expect(b1.vw, '390 resize must isolate B').toBeCloseTo(b0.vw, 1);
  expect(b1.multiply, '390 resize must isolate B multiply').toBe('multiply');

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && Math.abs(now.vw - a0.vw) < 2;
  }, { message: '390 undo must restore A' }).toBeTruthy();

  await selectUntilHandles(page, inkA.id, 4);
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), '390 single-select must show mtr').toBeGreaterThan(0);
  await dragMtrToAngle(page, inkA.id, 90);
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && angleNear(now.angle, 90, 12);
  }, { message: '390 free mtr drag must set A near 90°' }).toBeTruthy();
  const aRot = await geom(page, inkA.id);
  const bRot = await geom(page, inkB.id);
  expect(aRot.vw, '390 mtr must hold A width').toBeCloseTo(a0.vw, 1);
  expect(isPen(aRot), '390 mtr must keep Pen').toBe(true);
  expect(bRot.angle, '390 mtr must isolate B').toBeCloseTo(b0.angle, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, inkA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: '390 undo must restore A angle 0' }).toBeTruthy();

  await selectUntilHandles(page, inkA.id, 4);
  const collapseBox = await annoBox(page, inkA.id);
  await dragResizeHandle(page, 'br', -(collapseBox.width * 0.90), -(collapseBox.height * 0.90));
  const aCollapse = await geom(page, inkA.id);
  expect(aCollapse.vw, '390 collapse must keep a visible width').toBeGreaterThan(1);
  expect(aCollapse.vh, '390 collapse must keep a visible height').toBeGreaterThan(1);
  expect(aCollapse.type, '390 collapse must keep path').toBe('path');

  await clickEmpty(page, { xf: 0.90, yf: 0.10 });
  await dragOnPage(page, { x0: 0.12, y0: 0.16, x1: 0.90, y1: 0.72 });
  await expectSelected(page, [inkA.id, inkB.id], '390 window marquee must select A+B');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), '390 group moveOnly hides mtr').toBe(0);

  await clickEmpty(page, { xf: 0.90, yf: 0.10 });
  expect(await page.locator('[data-resize-handle]').count(), '390 deselect hides handles').toBe(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('INK_RESIZE_ROTATE_390_PROOF', JSON.stringify({
    inkA: inkA.id,
    inkB: inkB.id,
    sourceWidthA: a0.sourceWidth,
    brDw: a1.vw - a0.vw,
    brDh: a1.vh - a0.vh,
    pathLen0: a0.pathLen,
    angle90: aRot.angle,
    collapseVw: aCollapse.vw,
    viewBox,
    fileId: null,
  }));
});
