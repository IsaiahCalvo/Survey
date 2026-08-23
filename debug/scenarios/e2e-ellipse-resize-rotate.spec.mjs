import { test, expect } from '@playwright/test';

// E-01 / E-02 leftover: selected ellipse bbox resize + canvas `mtr` rotate.
// Rect 8-handle resize is e2e-annotation-resize. Rect `mtr` is
// e2e-annotation-rotate. Ellipse Style dash is e2e-rect-ellipse-text-dash.
// Export-scale leftover resizes then flatten-exports — not this live slice.
// Callout corners are T-02. Line p1/p2/midpoint are S-03/S-04. Polygon
// vertex-N is X-04. Double-click bbox is e2e-bbox-edit-mode. Survey-marker
// 8 handles / counter nubbin are their own slices. Distinct from leftover-18,
// E-03 move, V-01 pan, V-02 select, color / Match Fill / zoom / page-field /
// pill / textbox-create / pan / move / rect resize / rect rotate catalogs.
// Do not stamp file.id. Ellipse visible size is rx*2*|sx| / ry*2*|sy|.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const ELLIPSE_A = { x0: 0.22, y0: 0.28, x1: 0.42, y1: 0.46 };
const ELLIPSE_B = { x0: 0.58, y0: 0.56, x1: 0.76, y1: 0.72 };

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
      const rx = Number(object.rx ?? data.rx ?? 0);
      const ry = Number(object.ry ?? data.ry ?? 0);
      const radius = Number(object.radius ?? data.radius ?? 0);
      const scaleX = Number(object.scaleX ?? data.scaleX ?? 1) || 1;
      const scaleY = Number(object.scaleY ?? data.scaleY ?? 1) || 1;
      const rawW = rx > 0 ? rx * 2 : (radius > 0 ? radius * 2 : Number(object.width ?? data.width ?? 0));
      const rawH = ry > 0 ? ry * 2 : (radius > 0 ? radius * 2 : Number(object.height ?? data.height ?? 0));
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? data.left ?? 0),
        top: Number(object.top ?? data.top ?? 0),
        rx,
        ry,
        radius,
        width: rawW,
        height: rawH,
        scaleX,
        scaleY,
        vw: rawW * Math.abs(scaleX),
        vh: rawH * Math.abs(scaleY),
        angle: Number(object.angle ?? data.angle ?? 0),
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

function isEllipse(row) {
  return row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse';
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

async function createEllipse(page, coords) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isEllipse);
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
  return page.locator(
    `[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="ellipse"], `
    + `[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="circle"]`,
  ).first();
}

async function annoBox(page, id) {
  const hit = await hitTarget(page, id);
  await expect(hit).toBeVisible();
  const box = await hit.boundingBox();
  expect(box, `hit bbox for ${id}`).toBeTruthy();
  return box;
}

async function strokeClick(page, id, { modifiers = [] } = {}) {
  const box = await annoBox(page, id);
  const before = (await selectedIds(page)).includes(id);
  const points = [
    { x: box.x + box.width * 0.50, y: box.y + box.height * 0.50 },
    { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 },
    { x: box.x + box.width * 0.70, y: box.y + box.height * 0.45 },
    { x: box.x + 6, y: box.y + box.height * 0.50 },
  ];
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
        // This point missed the ellipse hit band; try the next.
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

test('desktop ellipse resize + rotate intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const importedAtStart = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));

  await selectMode(page);
  expect(await page.locator('[data-resize-handle]').count(), 'empty Select shows 0 handles').toBe(0);
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'empty page mtr 0').toBe(0);
  const emptyBefore = await userOrder(page);
  await dragOnPage(page, { x0: 0.10, y0: 0.12, x1: 0.18, y1: 0.20 });
  expect(await userOrder(page), 'empty Select drag invents 0').toEqual(emptyBefore);

  await activateTool(page, 'Shapes', 'Ellipse');
  await setNextDrawFill(page, '#00FFFF');
  const ellipseA = await createEllipse(page, ELLIPSE_A);
  const ellipseB = await createEllipse(page, ELLIPSE_B);
  await dismissChrome(page);
  await blurInputs(page);
  expect(await userOrder(page), 'intended create A then B').toEqual([ellipseA.id, ellipseB.id]);
  expect(isEllipse(ellipseA), 'A is ellipse').toBe(true);
  expect(isEllipse(ellipseB), 'B is ellipse').toBe(true);
  expect(ellipseA.rx, 'A stores rx not only width').toBeGreaterThan(0);
  expect(ellipseA.ry, 'A stores ry not only height').toBeGreaterThan(0);

  await selectUntilHandles(page, ellipseA.id, 8);
  const handles = await resizeHandleIds(page);
  expect(handles.sort(), 'single-click ellipse shows all 8 handles').toEqual(
    ['bl', 'br', 'mb', 'ml', 'mr', 'mt', 'tl', 'tr'],
  );
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'single-select A must show mtr').toBeGreaterThan(0);
  expect(await page.locator('circle[data-handle^="vertex-"]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('circle[data-handle="p1"]').count(), 'no line p1 seam').toBe(0);

  const a0 = await geom(page, ellipseA.id);
  const b0 = await geom(page, ellipseB.id);
  expect(a0, 'A geom').toBeTruthy();
  expect(b0, 'B geom').toBeTruthy();
  expect(a0.vw, 'A visible width uses rx*2*|sx|').toBeGreaterThan(8);
  expect(a0.vh, 'A visible height uses ry*2*|sy|').toBeGreaterThan(8);
  expect(a0.angle, 'A starts unrotated').toBeCloseTo(0, 1);

  // Intended — br grows both axes via scale on rx/ry; opposite left/top pinned; B isolated.
  await dragResizeHandle(page, 'br', 56, 40);
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && now.vw > a0.vw + 10 && now.vh > a0.vh + 8;
  }, { message: 'br must grow A width and height' }).toBeTruthy();
  const aBr = await geom(page, ellipseA.id);
  const bBr = await geom(page, ellipseB.id);
  expect(aBr.left, 'br must pin A left').toBeCloseTo(a0.left, 1);
  expect(aBr.top, 'br must pin A top').toBeCloseTo(a0.top, 1);
  expect(aBr.rx, 'br must hold raw rx (scale grows)').toBeCloseTo(a0.rx, 1);
  expect(aBr.ry, 'br must hold raw ry (scale grows)').toBeCloseTo(a0.ry, 1);
  expect(aBr.angle, 'br must hold A angle').toBeCloseTo(a0.angle, 1);
  expect(bBr.left, 'br must isolate B left').toBeCloseTo(b0.left, 1);
  expect(bBr.vw, 'br must isolate B width').toBeCloseTo(b0.vw, 1);
  expect(bBr.vh, 'br must isolate B height').toBeCloseTo(b0.vh, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && Math.abs(now.vw - a0.vw) < 2 && Math.abs(now.vh - a0.vh) < 2;
  }, { message: 'undo must restore A size' }).toBeTruthy();

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && Math.abs(now.vw - aBr.vw) < 2 && Math.abs(now.vh - aBr.vh) < 2;
  }, { message: 'redo must restore resized A' }).toBeTruthy();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && Math.abs(now.vw - a0.vw) < 2;
  }, { message: 'second undo must restore A again' }).toBeTruthy();

  // Intended — mr grows width only; mb grows height only.
  await selectUntilHandles(page, ellipseA.id, 8);
  const aPreMr = await geom(page, ellipseA.id);
  await dragResizeHandle(page, 'mr', 48, 0);
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && now.vw > aPreMr.vw + 8 && Math.abs(now.vh - aPreMr.vh) < 3;
  }, { message: 'mr must grow A width only' }).toBeTruthy();
  const aMr = await geom(page, ellipseA.id);
  expect(aMr.left, 'mr must pin A left').toBeCloseTo(aPreMr.left, 1);
  expect(aMr.top, 'mr must pin A top').toBeCloseTo(aPreMr.top, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && Math.abs(now.vw - aPreMr.vw) < 2;
  }, { message: 'undo mr must restore A width' }).toBeTruthy();

  await selectUntilHandles(page, ellipseA.id, 8);
  const aPreMb = await geom(page, ellipseA.id);
  await dragResizeHandle(page, 'mb', 0, 40);
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && now.vh > aPreMb.vh + 8 && Math.abs(now.vw - aPreMb.vw) < 3;
  }, { message: 'mb must grow A height only' }).toBeTruthy();
  const aMb = await geom(page, ellipseA.id);
  expect(aMb.left, 'mb must pin A left').toBeCloseTo(aPreMb.left, 1);
  expect(aMb.top, 'mb must pin A top').toBeCloseTo(aPreMb.top, 1);
  const bAfterSides = await geom(page, ellipseB.id);
  expect(bAfterSides.vw, 'side handles must isolate B').toBeCloseTo(b0.vw, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && Math.abs(now.vh - aPreMb.vh) < 2;
  }, { message: 'undo mb must restore A height' }).toBeTruthy();

  // Edge — Shift+br locks aspect (uniform |sx|/|sy|).
  await selectUntilHandles(page, ellipseA.id, 8);
  const aPreShift = await geom(page, ellipseA.id);
  const ratio0 = aPreShift.vw / aPreShift.vh;
  await dragResizeHandle(page, 'br', 70, 20, { shift: true });
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && now.vw > aPreShift.vw + 8 && now.vh > aPreShift.vh + 8;
  }, { message: 'Shift+br must grow both axes' }).toBeTruthy();
  const aShift = await geom(page, ellipseA.id);
  const ratio1 = aShift.vw / aShift.vh;
  expect(ratio1, 'Shift+br must keep aspect').toBeCloseTo(ratio0, 1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && Math.abs(now.vw - aPreShift.vw) < 2;
  }, { message: 'undo Shift+br must restore A' }).toBeTruthy();

  // Edge — flip past the opposite corner; abs(scale) commit keeps size > 0.
  await selectUntilHandles(page, ellipseA.id, 8);
  const aPreFlip = await geom(page, ellipseA.id);
  const aBox = await annoBox(page, ellipseA.id);
  await dragResizeHandle(page, 'br', -(aBox.width + 48), -(aBox.height + 36));
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && now.left < aPreFlip.left - 8 && now.top < aPreFlip.top - 8 && now.vw > 4 && now.vh > 4;
  }, { message: 'flip past opposite must move origin and keep size' }).toBeTruthy();
  const aFlip = await geom(page, ellipseA.id);
  expect(aFlip.scaleX, 'flip commit stores |scaleX|').toBeGreaterThan(0);
  expect(aFlip.scaleY, 'flip commit stores |scaleY|').toBeGreaterThan(0);
  const bAfterFlip = await geom(page, ellipseB.id);
  expect(bAfterFlip.left, 'flip must isolate B').toBeCloseTo(b0.left, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && Math.abs(now.left - aPreFlip.left) < 2 && Math.abs(now.vw - aPreFlip.vw) < 2;
  }, { message: 'undo flip must restore A' }).toBeTruthy();

  // Break — collapse toward the opposite corner floors above zero.
  await selectUntilHandles(page, ellipseA.id, 8);
  const aPreCollapse = await geom(page, ellipseA.id);
  const collapseBox = await annoBox(page, ellipseA.id);
  await dragResizeHandle(page, 'br', -(collapseBox.width * 0.92), -(collapseBox.height * 0.92));
  const aCollapse = await geom(page, ellipseA.id);
  expect(aCollapse.vw, 'collapse must keep a visible width').toBeGreaterThan(1);
  expect(aCollapse.vh, 'collapse must keep a visible height').toBeGreaterThan(1);
  expect(aCollapse.vw, 'collapse must shrink width').toBeLessThan(aPreCollapse.vw - 4);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && Math.abs(now.vw - aPreCollapse.vw) < 2;
  }, { message: 'undo collapse must restore A' }).toBeTruthy();

  // Intended — free-drag mtr to 90° then 180° (not Shift snap, not pill).
  await selectUntilHandles(page, ellipseA.id, 8);
  const aPreRot = await geom(page, ellipseA.id);
  await dragMtrToAngle(page, ellipseA.id, 90);
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && angleNear(now.angle, 90, 10);
  }, { message: 'free mtr drag must set A near 90°' }).toBeTruthy();
  const a90 = await geom(page, ellipseA.id);
  const b90 = await geom(page, ellipseB.id);
  expect(a90.vw, 'mtr rotate must hold A width').toBeCloseTo(aPreRot.vw, 1);
  expect(a90.vh, 'mtr rotate must hold A height').toBeCloseTo(aPreRot.vh, 1);
  expect(a90.left, 'mtr rotate must hold A left').toBeCloseTo(aPreRot.left, 1);
  expect(a90.top, 'mtr rotate must hold A top').toBeCloseTo(aPreRot.top, 1);
  expect(b90.angle, 'mtr rotate must isolate B angle').toBeCloseTo(b0.angle, 1);
  expect(b90.left, 'mtr rotate must isolate B left').toBeCloseTo(b0.left, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: 'undo must restore A angle 0' }).toBeTruthy();

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && angleNear(now.angle, a90.angle, 2);
  }, { message: 'redo must restore rotated A' }).toBeTruthy();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: 'second undo must restore A angle 0 again' }).toBeTruthy();

  await clickEmpty(page);
  await strokeClick(page, ellipseA.id);
  await dragMtrToAngle(page, ellipseA.id, 180);
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && angleNear(now.angle, 180, 10);
  }, { message: 'free mtr drag must set A near 180°' }).toBeTruthy();
  const a180 = await geom(page, ellipseA.id);
  expect(a180.vw, '180 rotate must hold A width').toBeCloseTo(aPreRot.vw, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: 'undo 180 must restore A angle 0' }).toBeTruthy();

  // Break — micro-drag on mtr does not commit.
  await clickEmpty(page);
  await strokeClick(page, ellipseA.id);
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 1, hb.y + hb.height / 2 + 1);
  await page.mouse.up();
  const aMicro = await geom(page, ellipseA.id);
  expect(angleNear(aMicro.angle, 0, 2), 'micro-drag must not commit angle').toBeTruthy();

  // Break — multi-select group frame is moveOnly (mtr hidden).
  await clickEmpty(page);
  await strokeClick(page, ellipseA.id);
  await strokeClick(page, ellipseB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [ellipseA.id, ellipseB.id], 'Shift-click must add B');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'group moveOnly hides mtr').toBe(0);
  expect(await page.locator('[data-group-selection-bbox="true"]').count(), 'group dashed frame present').toBeGreaterThan(0);
  const aGroup = await geom(page, ellipseA.id);
  expect(angleNear(aGroup.angle, 0, 2), 'group select must not rotate A').toBeTruthy();

  // Break — Line single-click omits mtr (endpoints, not bbox rotate).
  const line = await createLine(page, { x0: 0.18, y0: 0.72, x1: 0.38, y1: 0.80 });
  await selectMode(page);
  await clickEmpty(page);
  const lineHit = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${line.id}"]`).first();
  await expect(lineHit).toBeVisible();
  const lb = await lineHit.boundingBox();
  await page.mouse.click(lb.x + lb.width * 0.5, lb.y + lb.height * 0.5);
  await expectSelected(page, [line.id], 'line click must select the line');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'Line single-click mtr 0').toBe(0);
  const aAfterLine = await geom(page, ellipseA.id);
  expect(angleNear(aAfterLine.angle, 0, 2), 'Line select must isolate A angle').toBeTruthy();

  // Break — deselect hides handles.
  await clickEmpty(page);
  expect(await page.locator('[data-resize-handle]').count(), 'deselect hides handles').toBe(0);
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'deselect hides mtr').toBe(0);

  // Break — Pen empty-page invents ink; A size/angle held. Pen-armed handle still resizes.
  const aPen = await geom(page, ellipseA.id);
  const bPen = await geom(page, ellipseB.id);
  await selectUntilHandles(page, ellipseA.id, 8);
  await activateTool(page, 'Draw', 'Pen');
  await dragResizeHandle(page, 'br', 40, 28);
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && now.vw > aPen.vw + 6 && now.vh > aPen.vh + 4;
  }, { message: 'Pen-armed handle still resizes A' }).toBeTruthy();
  const aPenResize = await geom(page, ellipseA.id);
  const beforePen = new Set(await userOrder(page));
  await dragOnPage(page, { x0: 0.12, y0: 0.86, x1: 0.28, y1: 0.92 });
  const ink = await waitForNewUserAnnotation(page, beforePen, (row) => (
    row.type === 'path' || row.tool === 'pen' || row.tool === 'freedraw'
  ));
  expect(ink, 'Pen drag must invent ink').toBeTruthy();
  const aPenAfter = await geom(page, ellipseA.id);
  const bPenAfter = await geom(page, ellipseB.id);
  expect(aPenAfter.vw, 'Pen drag must not resize A').toBeCloseTo(aPenResize.vw, 1);
  expect(angleNear(aPenAfter.angle, aPenResize.angle, 2), 'Pen drag must not rotate A').toBeTruthy();
  expect(bPenAfter.vw, 'Pen drag must not resize B').toBeCloseTo(bPen.vw, 1);

  for (const id of importedAtStart) {
    const still = await page.evaluate((want) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .some((group) => group.getAttribute('data-anno-id') === want)
    ), id);
    expect(still, `imported ${id} must survive ellipse transform`).toBe(true);
  }

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

  console.log('ELLIPSE_RESIZE_ROTATE_DESKTOP_PROOF', JSON.stringify({
    ellipseA: ellipseA.id,
    ellipseB: ellipseB.id,
    line: line.id,
    rx: a0.rx,
    ry: a0.ry,
    brDw: aBr.vw - a0.vw,
    brDh: aBr.vh - a0.vh,
    mrDw: aMr.vw - aPreMr.vw,
    mbDh: aMb.vh - aPreMb.vh,
    shiftRatio0: ratio0,
    shiftRatio1: ratio1,
    flipLeft: aFlip.left,
    collapseVw: aCollapse.vw,
    angle90: a90.angle,
    angle180: a180.angle,
    viewBox,
    fileId: null,
  }));
});

test('390 ellipse resize + rotate intended + break + edge', async ({ page }) => {
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

  const ellipseA = await createEllipse(page, { x0: 0.18, y0: 0.24, x1: 0.48, y1: 0.48 });
  const ellipseB = await createEllipse(page, { x0: 0.54, y0: 0.54, x1: 0.78, y1: 0.72 });
  await blurInputs(page);
  expect(await userOrder(page), '390 create A then B').toEqual([ellipseA.id, ellipseB.id]);
  expect(isEllipse(ellipseA), '390 A is ellipse').toBe(true);

  await selectUntilHandles(page, ellipseA.id, 4);
  const a0 = await geom(page, ellipseA.id);
  const b0 = await geom(page, ellipseB.id);
  await dragResizeHandle(page, 'br', 36, 28);
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && now.vw > a0.vw + 6 && now.vh > a0.vh + 4;
  }, { message: '390 br must grow A width and height' }).toBeTruthy();
  const a1 = await geom(page, ellipseA.id);
  const b1 = await geom(page, ellipseB.id);
  expect(a1.left, '390 br must pin A left').toBeCloseTo(a0.left, 1);
  expect(a1.rx, '390 br must hold raw rx').toBeCloseTo(a0.rx, 1);
  expect(b1.vw, '390 resize must isolate B').toBeCloseTo(b0.vw, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && Math.abs(now.vw - a0.vw) < 2;
  }, { message: '390 undo must restore A' }).toBeTruthy();

  await selectUntilHandles(page, ellipseA.id, 4);
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), '390 single-select must show mtr').toBeGreaterThan(0);
  await dragMtrToAngle(page, ellipseA.id, 90);
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && angleNear(now.angle, 90, 12);
  }, { message: '390 free mtr drag must set A near 90°' }).toBeTruthy();
  const aRot = await geom(page, ellipseA.id);
  const bRot = await geom(page, ellipseB.id);
  expect(aRot.vw, '390 mtr must hold A width').toBeCloseTo(a0.vw, 1);
  expect(bRot.angle, '390 mtr must isolate B').toBeCloseTo(b0.angle, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, ellipseA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: '390 undo must restore A angle 0' }).toBeTruthy();

  await selectUntilHandles(page, ellipseA.id, 4);
  const collapseBox = await annoBox(page, ellipseA.id);
  await dragResizeHandle(page, 'br', -(collapseBox.width * 0.90), -(collapseBox.height * 0.90));
  const aCollapse = await geom(page, ellipseA.id);
  expect(aCollapse.vw, '390 collapse must keep a visible width').toBeGreaterThan(1);
  expect(aCollapse.vh, '390 collapse must keep a visible height').toBeGreaterThan(1);

  await clickEmpty(page, { xf: 0.90, yf: 0.10 });
  await dragOnPage(page, { x0: 0.16, y0: 0.22, x1: 0.82, y1: 0.76 });
  await expectSelected(page, [ellipseA.id, ellipseB.id], '390 window marquee must select A+B');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), '390 group moveOnly hides mtr').toBe(0);

  await clickEmpty(page, { xf: 0.90, yf: 0.10 });
  expect(await page.locator('[data-resize-handle]').count(), '390 deselect hides handles').toBe(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ELLIPSE_RESIZE_ROTATE_390_PROOF', JSON.stringify({
    ellipseA: ellipseA.id,
    ellipseB: ellipseB.id,
    brDw: a1.vw - a0.vw,
    brDh: a1.vh - a0.vh,
    angle90: aRot.angle,
    collapseVw: aCollapse.vw,
    viewBox,
    fileId: null,
  }));
});
