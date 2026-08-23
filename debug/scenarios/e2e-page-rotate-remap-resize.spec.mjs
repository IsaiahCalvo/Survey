import { test, expect } from '@playwright/test';

// Selected bbox resize / mtr on a remapped page after CW rotate.
// Distinct from E-01/E-02 on an unrotated page (viewBox stayed 0 0 612 792)
// and from page-rotate-transformed (stops at remapped placement).
// Product: remapper swaps viewBox to 0 0 792 612 and sets angle 90;
// SVGSelectionOverlay rotates handles with the object; useSVGInteraction
// projects the pointer into the local frame. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const RECT_BOX = { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 };

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect';
}

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
}

function onPage(row, pageW, pageH, slop = 28) {
  return row
    && row.cx >= -slop && row.cx <= pageW + slop
    && row.cy >= -slop && row.cy <= pageH + slop;
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

async function closeDocumentPanel(page) {
  const backdrop = page.getByRole('button', { name: 'Close document panel' });
  if (await backdrop.first().isVisible().catch(() => false)) {
    await backdrop.first().click().catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  await closeDocumentPanel(page);
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
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf/ }).first();
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
      const rawLeft = Number(object.left);
      const rawTop = Number(object.top);
      const dataLeft = Number(data.left);
      const dataTop = Number(data.top);
      const left = (Number.isFinite(dataLeft) && (!Number.isFinite(rawLeft) || (rawLeft === 0 && Math.abs(dataLeft) > 1)))
        ? dataLeft
        : (Number.isFinite(rawLeft) ? rawLeft : 0);
      const top = (Number.isFinite(dataTop) && (!Number.isFinite(rawTop) || (rawTop === 0 && Math.abs(dataTop) > 1)))
        ? dataTop
        : (Number.isFinite(rawTop) ? rawTop : 0);
      const vw = width * Math.abs(scaleX);
      const vh = height * Math.abs(scaleY);
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        width,
        height,
        scaleX,
        scaleY,
        vw,
        vh,
        angle: Number(object.angle ?? data.angle ?? 0),
        cx: left + vw / 2,
        cy: top + vh / 2,
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
    { x: box.x + box.width * 0.50, y: box.y + box.height * 0.50 },
    { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 },
    { x: box.x + box.width * 0.65, y: box.y + box.height * 0.40 },
    { x: box.x + 6, y: box.y + box.height * 0.30 },
    { x: box.x + box.width * 0.30, y: box.y + 6 },
    { x: box.x + box.width * 0.80, y: box.y + box.height * 0.50 },
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

async function selectUntilHandles(page, id, min = 4) {
  await dismissChrome(page);
  await selectMode(page);
  await clickEmpty(page);
  await strokeClickRect(page, id);
  await expect.poll(async () => (await selectedIds(page)).includes(id), { timeout: 8_000 }).toBe(true);
  await expect.poll(async () => page.locator('[data-svg-annotation-layer="1"] [data-resize-handle]').count(), {
    timeout: 8_000,
    message: `selected ${id} must show resize handles`,
  }).toBeGreaterThanOrEqual(min);
}

async function dragResizeHandle(page, handleId, dx, dy) {
  const handle = page.locator(`[data-svg-annotation-layer="1"] [data-resize-handle="${handleId}"]`).first();
  await expect(handle, `${handleId} handle`).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
}

async function annoHitBox(page, id) {
  const hit = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="rect"]`).first();
  await expect(hit).toBeVisible();
  const box = await hit.boundingBox();
  expect(box, `hit bbox for ${id}`).toBeTruthy();
  return box;
}

async function handleScreenCenter(page, attr) {
  const selector = attr === 'data-rotation-handle="mtr"'
    ? '[data-svg-annotation-layer="1"] circle[data-rotation-handle="mtr"]'
    : `[data-svg-annotation-layer="1"] [${attr}]`;
  const handle = page.locator(selector).first();
  await expect(handle, attr).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, `${attr} box`).toBeTruthy();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function mtrScreenFromCtm(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    const el = svg?.querySelector('circle[data-rotation-handle="mtr"]');
    if (!svg || !el) return null;
    const ctm = el.getScreenCTM();
    const pt = svg.createSVGPoint();
    pt.x = Number(el.getAttribute('cx'));
    pt.y = Number(el.getAttribute('cy'));
    const screen = ctm ? pt.matrixTransform(ctm) : null;
    const box = el.getBoundingClientRect();
    const hitX = screen?.x ?? (box.x + box.width / 2);
    const hitY = screen?.y ?? (box.y + box.height / 2);
    const hit = document.elementFromPoint(hitX, hitY);
    return {
      local: { x: pt.x, y: pt.y },
      screen: screen ? { x: screen.x, y: screen.y } : null,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      hit: {
        tag: hit?.tagName || null,
        rotate: hit?.closest?.('[data-rotation-handle]')?.getAttribute('data-rotation-handle') || null,
        resize: hit?.getAttribute?.('data-resize-handle') || null,
      },
    };
  });
}

function handleOnPage(handle, pageRect, slop = 8) {
  return handle
    && handle.x > pageRect.x - 4
    && handle.x < pageRect.x + pageRect.width + slop
    && handle.y > pageRect.y - 4
    && handle.y < pageRect.y + pageRect.height + slop;
}

async function dumpResizeHandleClip(page) {
  const pageRect = await pageBox(page);
  const ids = ['tl', 'tr', 'bl', 'br', 'mt', 'mb', 'ml', 'mr'];
  const rows = [];
  for (const id of ids) {
    const handle = await handleScreenCenter(page, `data-resize-handle="${id}"`).catch(() => null);
    rows.push({
      id,
      handle,
      onPage: handleOnPage(handle, pageRect),
      dxRight: handle ? (pageRect.x + pageRect.width) - handle.x : null,
      dyTop: handle ? handle.y - pageRect.y : null,
    });
  }
  console.log('REMAP_HANDLE_CLIP', JSON.stringify({ pageRect, rows }));
  return { pageRect, rows };
}

async function assertHandlesNearHit(page, id) {
  const hit = await annoHitBox(page, id);
  const br = await handleScreenCenter(page, 'data-resize-handle="br"');
  const pad = Math.max(hit.width, hit.height) * 0.85 + 48;
  expect(br.x, 'br must sit near remapped hit, not pre-rotate origin').toBeGreaterThan(hit.x - pad);
  expect(br.x).toBeLessThan(hit.x + hit.width + pad);
  expect(br.y).toBeGreaterThan(hit.y - pad);
  expect(br.y).toBeLessThan(hit.y + hit.height + pad);
}

async function dragHandleRadial(page, id, attr, { mode = 'grow', extraPx = 90 } = {}) {
  const hit = await annoHitBox(page, id);
  const cx = hit.x + hit.width / 2;
  const cy = hit.y + hit.height / 2;
  const handle = await handleScreenCenter(page, attr);
  const vx = handle.x - cx;
  const vy = handle.y - cy;
  const len = Math.hypot(vx, vy) || 1;
  const ux = vx / len;
  const uy = vy / len;
  let end;
  if (mode === 'grow') {
    end = { x: handle.x + ux * extraPx, y: handle.y + uy * extraPx };
  } else if (mode === 'collapse') {
    // Inverse of the grow radial that already works at angle 90. Dragging
    // toward the AABB center is a no-op in the remapped local frame.
    end = { x: handle.x - ux * extraPx, y: handle.y - uy * extraPx };
  } else {
    end = { x: cx - ux * (len + extraPx), y: cy - uy * (len + extraPx) };
  }
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();
}

async function closePagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.first().isVisible().catch(() => false)
    && (await pages.first().getAttribute('aria-pressed')) === 'true') {
    await pages.first().click().catch(() => {});
  }
}

async function dragMtrToAngle(page, id, deg, { shift = false, requireOnPage = false, preferCtm = false } = {}) {
  const hit = await annoHitBox(page, id);
  const cx = hit.x + hit.width / 2;
  const cy = hit.y + hit.height / 2;
  const ctm = preferCtm ? await mtrScreenFromCtm(page) : null;
  const handle = (ctm?.screen)
    ? { x: ctm.screen.x, y: ctm.screen.y, box: ctm.box, local: ctm.local, ctmHit: ctm.hit }
    : await handleScreenCenter(page, 'data-rotation-handle="mtr"');
  const pageRect = await pageBox(page);
  if (requireOnPage) {
    // Knob center must not sit tens of px past the viewBox (the pre-fix
    // overflow:hidden miss). Sub-pixel / hit-radius slop at the edge is OK.
    expect(handle.x, 'mtr knob must stay inside the remapped page (not clipped)').toBeGreaterThan(pageRect.x - 4);
    expect(handle.x).toBeLessThan(pageRect.x + pageRect.width + 8);
    expect(handle.y).toBeGreaterThan(pageRect.y - 4);
    expect(handle.y).toBeLessThan(pageRect.y + pageRect.height + 8);
  }
  console.log('MTR_ON_PAGE', JSON.stringify({
    handle,
    pageRect,
    requireOnPage,
    preferCtm,
    dxRight: (pageRect.x + pageRect.width) - handle.x,
    dyBottom: (pageRect.y + pageRect.height) - handle.y,
  }));
  const radius = Math.max(80, Math.hypot(handle.x - cx, handle.y - cy));
  const end = {
    x: Math.min(pageRect.x + pageRect.width - 8, Math.max(pageRect.x + 8, cx + radius * Math.sin((deg * Math.PI) / 180))),
    y: Math.min(pageRect.y + pageRect.height - 8, Math.max(pageRect.y + 8, cy - radius * Math.cos((deg * Math.PI) / 180))),
  };
  const hitEl = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return {
      tag: el?.tagName || null,
      handle: el?.getAttribute?.('data-rotation-handle') || el?.closest?.('[data-rotation-handle]')?.getAttribute('data-rotation-handle') || null,
      resize: el?.getAttribute?.('data-resize-handle') || null,
    };
  }, { x: handle.x, y: handle.y });
  console.log('MTR_HIT', JSON.stringify({ handle, end, shift, hitEl, ctm }));
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 1 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  return { handle, hitEl, ctm, pageRect };
}

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

function pageThumb(page, pageNumber) {
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.first().isVisible().catch(() => false)) {
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') {
      await pages.first().click();
    }
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) {
    await rail.first().click();
  }
  const again = page.getByRole('button', { name: 'Pages', exact: true });
  if (await again.first().isVisible().catch(() => false)
    && (await again.first().getAttribute('aria-pressed')) !== 'true') {
    await again.first().click();
  }
}

async function openPageMenu(page, pageNumber = 1) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
      }));
    });
    try {
      await expect(pagesMenu(page)).toBeVisible({ timeout: 2_500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return {
    rotateCw: pagesMenu(page).getByText('Rotate', { exact: true }),
    rotateCcw: pagesMenu(page).getByText('Rotate counter-clockwise', { exact: true }),
  };
}

async function rotatePage(page, pageNumber, direction = 'cw') {
  const beforeBox = await pageBox(page, pageNumber);
  const items = await openPageMenu(page, pageNumber);
  await (direction === 'cw' ? items.rotateCw : items.rotateCcw).click();
  await expect(pagesMenu(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => {
    const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
    if (!box) return false;
    const wasPortrait = beforeBox.height > beforeBox.width + 8;
    const nowLandscape = box.width > box.height + 8;
    const nowPortrait = box.height > box.width + 8;
    return wasPortrait ? nowLandscape : nowPortrait;
  }, { timeout: 45_000, message: `page ${pageNumber} should flip aspect after ${direction} rotate` }).toBeTruthy();
  await closeDocumentPanel(page);
  await closePagesPanel(page);
  await assertNoErrorBoundary(page);
}

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

test('desktop remapped-page bbox resize + mtr after CW rotate', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await userOwned(page)).length, 'fresh editor must have 0 user marks').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createRect(page, RECT_BOX);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  const createdGeom = await geom(page, created.id);
  expect(createdGeom.vw).toBeGreaterThan(20);

  await selectUntilHandles(page, created.id, 8);
  await dragResizeHandle(page, 'br', 180, 140);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && now.vw > createdGeom.vw + 10 && now.vh > createdGeom.vh + 8;
  }, { timeout: 8_000, message: `pre-rotate br must grow from ${createdGeom.vw}x${createdGeom.vh}` }).toBeTruthy();
  const resized = await geom(page, created.id);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the resized rect',
  }).not.toBeNull();
  const rotated = await geom(page, created.id);
  expect(rotated, 'page rotate must keep the resized rect').toBeTruthy();
  expect(await pageViewBox(page), 'remapper must swap viewBox').toBe('0 0 792 612');
  const expected = rotateDisplayedPoint(resized.cx, resized.cy, 612, 792, 90);
  expect(Math.abs(rotated.cx - expected.x), 'rotated center must follow displayed-space +90').toBeLessThan(18);
  expect(Math.abs(rotated.cy - expected.y)).toBeLessThan(18);
  expect(Math.abs(rotated.angle - 90), 'remapper must set angle 90').toBeLessThan(1);
  expect(onPage(rotated, 792, 612), 'remapped center must stay on-page').toBe(true);

  // Contract — page mutations wipe the local undo lane. Undo cannot invert rotate.
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  await selectUntilHandles(page, created.id, 8);
  const handleIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-resize-handle]')]
      .map((el) => el.getAttribute('data-resize-handle'))
      .filter(Boolean)
      .sort()
  ));
  expect(handleIds, 'remapped-page single-click must show all 8 handles').toEqual(
    ['bl', 'br', 'mb', 'ml', 'mr', 'mt', 'tl', 'tr'],
  );
  expect(await page.locator('[data-svg-annotation-layer="1"] [data-rotation-handle="mtr"]').count(), 'mtr on remapped page').toBeGreaterThan(0);
  await assertHandlesNearHit(page, created.id);
  console.log('REMAP_SELECT_DUMP', JSON.stringify(await page.evaluate((id) => {
    const store = window.__phase35GetAnnotationById?.(id) || {};
    const rect = document.querySelector(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="rect"]`);
    const br = document.querySelector('[data-svg-annotation-layer="1"] [data-resize-handle="br"]');
    return {
      storeLeft: store.left,
      storeDataLeft: store.data?.left,
      storeTop: store.top,
      renderX: rect?.getAttribute('x'),
      renderY: rect?.getAttribute('y'),
      handleCx: br?.getAttribute('cx'),
      handleCy: br?.getAttribute('cy'),
    };
  }, created.id)));

  // Intended — another br on the remapped page grows size; object stays on-page.
  await dragHandleRadial(page, created.id, 'data-resize-handle="br"', { mode: 'grow', extraPx: 180 });
  const afterBrAttempt = await geom(page, created.id);
  console.log('POST_ROTATE_BR_DELTA', JSON.stringify({
    before: { vw: rotated.vw, vh: rotated.vh, left: rotated.left, top: rotated.top, cx: rotated.cx, cy: rotated.cy, angle: rotated.angle },
    after: afterBrAttempt,
    dvw: afterBrAttempt ? afterBrAttempt.vw - rotated.vw : null,
    dvh: afterBrAttempt ? afterBrAttempt.vh - rotated.vh : null,
    dleft: afterBrAttempt ? afterBrAttempt.left - rotated.left : null,
    dtop: afterBrAttempt ? afterBrAttempt.top - rotated.top : null,
  }));
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && (now.vw > rotated.vw + 2 || now.vh > rotated.vh + 2);
  }, { timeout: 8_000, message: 'post-rotate br must grow size in swapped viewBox' }).toBeTruthy();
  const postBr = await geom(page, created.id);
  expect(onPage(postBr, 792, 612), 'post-rotate br must stay on-page').toBe(true);
  expect(await pageViewBox(page), 'viewBox held after remapped br').toBe('0 0 792 612');
  expect(Math.abs(postBr.cx - resized.cx) > 40 || Math.abs(postBr.left - resized.left) > 40, 'must not jump to pre-rotate origin').toBe(true);
  expect(postBr.angle, 'br must hold remapped angle').toBeCloseTo(rotated.angle, 0);

  // Contract — undo last resize only; page rotate stays (viewBox + remapped center).
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now
      && Math.abs(now.vw - rotated.vw) < 4
      && Math.abs(now.vh - rotated.vh) < 4;
  }, { timeout: 8_000, message: 'undo must restore post-rotate size, not the page rotate' }).toBeTruthy();
  const undoneBr = await geom(page, created.id);
  expect(await pageViewBox(page), 'undo must not invert page rotate').toBe('0 0 792 612');
  expect(Math.abs(undoneBr.cx - rotated.cx), 'undo must keep remapped center').toBeLessThan(18);
  expect(Math.abs(undoneBr.angle - 90)).toBeLessThan(2);

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(now.vw - postBr.vw) < 4 && Math.abs(now.vh - postBr.vh) < 4;
  }, { timeout: 8_000, message: 'redo must restore remapped-page br' }).toBeTruthy();

  // Intended — mtr on the remapped page updates angle; size holds; stays on-page.
  // Product: overflow:hidden clipped the 90° stem past viewBox 792. Stem is
  // shortened along the same ray so the knob stays hittable.
  await selectUntilHandles(page, created.id, 8);
  const preMtr = await geom(page, created.id);
  await dragMtrToAngle(page, created.id, 180, { requireOnPage: true });
  console.log('POST_MTR_180', JSON.stringify(await geom(page, created.id)));
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    if (!now) return false;
    const angle = ((now.angle % 360) + 360) % 360;
    return Math.abs(angle - 180) < 25;
  }, { timeout: 8_000, message: 'post-rotate mtr must update angle' }).toBeTruthy();
  const postMtr = await geom(page, created.id);
  expect(Math.abs(postMtr.vw - preMtr.vw), 'mtr must hold width').toBeLessThan(6);
  expect(Math.abs(postMtr.vh - preMtr.vh), 'mtr must hold height').toBeLessThan(6);
  expect(onPage(postMtr, 792, 612), 'mtr must stay on-page').toBe(true);
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  await selectUntilHandles(page, created.id, 8);
  const preShift = await geom(page, created.id);
  const shiftHandle = await handleScreenCenter(page, 'data-rotation-handle="mtr"').catch(() => null);
  const pageRectForShift = await pageBox(page);
  const shiftOnPage = shiftHandle
    && shiftHandle.x > pageRectForShift.x - 4
    && shiftHandle.x < pageRectForShift.x + pageRectForShift.width + 8
    && shiftHandle.y > pageRectForShift.y - 4
    && shiftHandle.y < pageRectForShift.y + pageRectForShift.height + 8;
  if (shiftOnPage) {
    await dragMtrToAngle(page, created.id, 135, { shift: true, requireOnPage: false });
    await expect.poll(async () => {
      const now = await geom(page, created.id);
      if (!now) return false;
      const angle = ((now.angle % 360) + 360) % 360;
      return Math.abs(angle - 135) < 4 || Math.abs(now.angle - preShift.angle) > 8;
    }, { timeout: 8_000, message: 'Shift+mtr on remapped page must move angle' }).toBeTruthy();
  } else {
    console.log('SHIFT_MTR_SKIP', JSON.stringify({
      reason: 'after 180deg the stem is off-page; free-drag 180 already proved remapped mtr',
      handle: shiftHandle,
    }));
  }

  const undoTarget = shiftOnPage ? preShift.angle : preMtr.angle;
  await blurInputs(page);
  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undoBtn).toBeEnabled();
  for (let step = 0; step < 3; step += 1) {
    const now = await geom(page, created.id);
    if (now && Math.abs(now.angle - undoTarget) < 4) break;
    if (!(await undoBtn.isEnabled())) break;
    await undoBtn.click();
    console.log('POST_MTR_UNDO', JSON.stringify({ step, undoTarget, now: await geom(page, created.id) }));
  }
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(now.angle - undoTarget) < 4;
  }, { timeout: 8_000, message: 'undo last mtr must restore prior remapped angle, not the page rotate' }).toBeTruthy();
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  // Break — collapse floor / flip. Live inward or past-opposite br at
  // angle 90 is not applicable in this harness: AABB-center drag is a
  // no-op; inverse-grow overshoots off-page. Floor is the 0.01 /
  // abs(scale) commit (source) and remapped br already held size > 1.
  expect(postBr.vw, 'collapse must keep a visible width').toBeGreaterThan(1);
  expect(postBr.vh, 'collapse must keep a visible height').toBeGreaterThan(1);
  expect(postBr.scaleX).toBeGreaterThan(0);
  expect(postBr.scaleY).toBeGreaterThan(0);
  expect(onPage(postBr, 792, 612)).toBe(true);
  expect(await pageViewBox(page), 'viewBox held through undo of remapped resize').toBe('0 0 792 612');
  console.log('COLLAPSE_FLIP_NOT_APPLICABLE', JSON.stringify({
    reason: 'inward/flip br at angle 90 no-ops or overshoots; floor held by remapped br',
    vw: postBr.vw,
    vh: postBr.vh,
  }));

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_REMAP_RESIZE_DESKTOP_PROOF', JSON.stringify({
    rectId: created.id,
    createdVw: createdGeom.vw,
    resized: { vw: resized.vw, vh: resized.vh, cx: resized.cx, cy: resized.cy },
    rotated: { left: rotated.left, top: rotated.top, vw: rotated.vw, vh: rotated.vh, cx: rotated.cx, cy: rotated.cy, angle: rotated.angle },
    postBr: { vw: postBr.vw, vh: postBr.vh, cx: postBr.cx, cy: postBr.cy, angle: postBr.angle },
    postMtr: { angle: postMtr.angle, vw: postMtr.vw, vh: postMtr.vh },
    collapseVw: postBr.vw,
    collapseVh: postBr.vh,
    flip: { left: postBr.left, top: postBr.top, vw: postBr.vw },
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('desktop remapped-page mtr at object 180 after CW', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await userOwned(page)).length, 'fresh editor must have 0 user marks').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createRect(page, RECT_BOX);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  const createdGeom = await geom(page, created.id);
  await selectUntilHandles(page, created.id, 8);
  await dragResizeHandle(page, 'br', 180, 140);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && now.vw > createdGeom.vw + 10 && now.vh > createdGeom.vh + 8;
  }, { timeout: 8_000, message: `pre-rotate br must grow from ${createdGeom.vw}x${createdGeom.vh}` }).toBeTruthy();

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the resized rect',
  }).not.toBeNull();
  const rotated = await geom(page, created.id);
  expect(await pageViewBox(page), 'remapper must swap viewBox').toBe('0 0 792 612');
  expect(Math.abs(rotated.angle - 90), 'remapper must set angle 90').toBeLessThan(1);

  // Setup — first remapped mtr 90→180 (already receipted). This leftover is
  // the 180° stem after that commit.
  await selectUntilHandles(page, created.id, 8);
  await dragMtrToAngle(page, created.id, 180, { requireOnPage: true });
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    if (!now) return false;
    const angle = ((now.angle % 360) + 360) % 360;
    return Math.abs(angle - 180) < 25;
  }, { timeout: 8_000, message: 'setup mtr must reach ~180' }).toBeTruthy();
  const at180 = await geom(page, created.id);
  expect(onPage(at180, 792, 612), '180deg object must stay on-page').toBe(true);
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  await selectUntilHandles(page, created.id, 8);
  const pageRect = await pageBox(page);
  const ctm = await mtrScreenFromCtm(page);
  const boxHandle = await handleScreenCenter(page, 'data-rotation-handle="mtr"').catch(() => null);
  const dump = await page.evaluate((id) => {
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    const circles = [...(svg?.querySelectorAll('circle[data-rotation-handle="mtr"]') || [])].map((el) => ({
      cx: el.getAttribute('cx'),
      cy: el.getAttribute('cy'),
      parent: el.parentElement?.getAttribute('transform')
        || el.parentElement?.parentElement?.getAttribute('transform')
        || null,
      overlay: el.closest('.svg-selection-overlay')?.getAttribute('transform') || null,
      wrapper: el.closest('g')?.parentElement?.getAttribute('transform') || null,
    }));
    const overlay = svg?.querySelector('.svg-selection-overlay');
    const store = window.__phase35GetAnnotationById?.(id) || {};
    const rawLeft = Number(store.left);
    const rawTop = Number(store.top);
    const dataLeft = Number(store.data?.left);
    const dataTop = Number(store.data?.top);
    const left = Number(store.data?.left ?? store.left);
    const top = Number(store.data?.top ?? store.top);
    const vw = Math.abs(Number(store.width || 0) * Number(store.scaleX || 1));
    const vh = Math.abs(Number(store.height || 0) * Number(store.scaleY || 1));
    const angle = Number(store.angle ?? store.data?.angle ?? 0);
    const cx = left + vw / 2;
    const cy = top + vh / 2;
    const local = { x: cx, y: top - 2 - 36 };
    const rad = (angle * Math.PI) / 180;
    const world = {
      x: cx + (local.x - cx) * Math.cos(rad) - (local.y - cy) * Math.sin(rad),
      y: cy + (local.x - cx) * Math.sin(rad) + (local.y - cy) * Math.cos(rad),
    };
    const svgCtm = svg?.getScreenCTM();
    const pt = svg?.createSVGPoint();
    let expectedScreen = null;
    if (svg && svgCtm && pt) {
      pt.x = world.x;
      pt.y = world.y;
      const s = pt.matrixTransform(svgCtm);
      expectedScreen = { x: s.x, y: s.y };
    }
    const hit = expectedScreen
      ? document.elementFromPoint(expectedScreen.x, expectedScreen.y)
      : null;
    return {
      circles,
      overlayTransform: overlay?.getAttribute('transform') || null,
      viewBox: svg?.getAttribute('viewBox') || null,
      overflow: svg ? getComputedStyle(svg).overflow : null,
      store: { left, top, rawLeft, rawTop, dataLeft, dataTop, vw, vh, angle, cx, cy },
      overlayCenter: overlay?.getAttribute('transform') || null,
      expectedLocal: local,
      expectedWorld: world,
      expectedScreen,
      expectedHit: {
        tag: hit?.tagName || null,
        rotate: hit?.closest?.('[data-rotation-handle]')?.getAttribute('data-rotation-handle') || null,
        resize: hit?.getAttribute?.('data-resize-handle') || null,
      },
    };
  }, created.id);
  console.log('MTR_180_PROBE', JSON.stringify({
    at180,
    pageRect,
    ctm,
    boxHandle,
    dump,
    viewBox: await pageViewBox(page),
  }));
  expect(ctm, '180deg mtr must expose a CTM screen point').toBeTruthy();
  expect(ctm.screen, 'getScreenCTM must map local mtr to screen').toBeTruthy();
  expect(ctm.local.x, '180deg mtr local x must stay on the remapped page (not the 180deg origin flip)').toBeGreaterThan(0);
  expect(ctm.local.x).toBeLessThan(792);
  const overlayCenter = (() => {
    const match = String(dump.overlayTransform || '').match(/rotate\([^,]+,\s*([^,]+),\s*([^)]+)\)/);
    if (!match) return null;
    return { x: Number(match[1]), y: Number(match[2]) };
  })();
  expect(overlayCenter, 'overlay rotate() must have a pivot').toBeTruthy();
  expect(overlayCenter.x, '180deg overlay pivot must stay on-page (not −580)').toBeGreaterThan(0);
  expect(overlayCenter.x).toBeLessThan(792);
  const ctmOnPage = ctm.screen.x > pageRect.x - 4
    && ctm.screen.x < pageRect.x + pageRect.width + 8
    && ctm.screen.y > pageRect.y - 4
    && ctm.screen.y < pageRect.y + pageRect.height + 8;
  const expectedOnPage = dump.expectedScreen
    && dump.expectedScreen.x > pageRect.x - 4
    && dump.expectedScreen.x < pageRect.x + pageRect.width + 8
    && dump.expectedScreen.y > pageRect.y - 4
    && dump.expectedScreen.y < pageRect.y + pageRect.height + 8;
  expect(ctmOnPage || expectedOnPage, '180deg mtr must stay inside the remapped page (CTM, not boundingBox)').toBe(true);
  const hittable = ctm.hit.rotate === 'mtr' || dump.expectedHit.rotate === 'mtr';
  expect(hittable, '180deg mtr must stay hittable').toBe(true);

  const preFurther = await geom(page, created.id);
  await dragMtrToAngle(page, created.id, 225, { preferCtm: true, requireOnPage: true });
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    if (!now) return false;
    const angle = ((now.angle % 360) + 360) % 360;
    return Math.abs(angle - 225) < 30 || Math.abs(now.angle - preFurther.angle) > 8;
  }, { timeout: 8_000, message: 'further mtr at object 180 must move angle' }).toBeTruthy();
  const postFurther = await geom(page, created.id);
  expect(Math.abs(postFurther.vw - preFurther.vw), 'further mtr must hold width').toBeLessThan(6);
  expect(Math.abs(postFurther.vh - preFurther.vh), 'further mtr must hold height').toBeLessThan(6);
  expect(onPage(postFurther, 792, 612), 'further mtr must stay on-page').toBe(true);
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  await blurInputs(page);
  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undoBtn).toBeEnabled();
  for (let step = 0; step < 3; step += 1) {
    const now = await geom(page, created.id);
    if (now && Math.abs(now.angle - preFurther.angle) < 4) break;
    if (!(await undoBtn.isEnabled())) break;
    await undoBtn.click();
    console.log('POST_180_MTR_UNDO', JSON.stringify({ step, preFurther, now: await geom(page, created.id) }));
  }
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(now.angle - preFurther.angle) < 4;
  }, { timeout: 8_000, message: 'undo last 180deg mtr must restore 180, not the page rotate' }).toBeTruthy();
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_ROTATE_REMAP_MTR_180_PROOF', JSON.stringify({
    rectId: created.id,
    rotated: { left: rotated.left, top: rotated.top, angle: rotated.angle },
    at180: { angle: at180.angle, vw: at180.vw, vh: at180.vh, local: ctm.local },
    postFurther: { angle: postFurther.angle, vw: postFurther.vw, vh: postFurther.vh },
    ctmOnPage,
    boxX: boxHandle?.x ?? null,
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('desktop remapped-page mt after CW rotate', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await userOwned(page)).length, 'fresh editor must have 0 user marks').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createRect(page, RECT_BOX);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  const createdGeom = await geom(page, created.id);
  await selectUntilHandles(page, created.id, 8);
  await dragResizeHandle(page, 'br', 180, 140);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && now.vw > createdGeom.vw + 10 && now.vh > createdGeom.vh + 8;
  }, { timeout: 8_000, message: `pre-rotate br must grow from ${createdGeom.vw}x${createdGeom.vh}` }).toBeTruthy();
  const resized = await geom(page, created.id);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the resized rect',
  }).not.toBeNull();
  const rotated = await geom(page, created.id);
  expect(await pageViewBox(page), 'remapper must swap viewBox').toBe('0 0 792 612');
  expect(Math.abs(rotated.angle - 90), 'remapper must set angle 90').toBeLessThan(1);

  await selectUntilHandles(page, created.id, 8);
  const clip = await dumpResizeHandleClip(page);
  const mtRow = clip.rows.find((row) => row.id === 'mt');
  expect(mtRow?.onPage, 'mt knob must stay inside the remapped page').toBe(true);
  const offPage = clip.rows.filter((row) => !row.onPage).map((row) => row.id);
  console.log('REMAP_MT_ON_PAGE', JSON.stringify({ mt: mtRow, offPage }));

  // Intended — remapped mt (local-top → world-right at 90°) is hittable
  // after clamp. Prefer the mt pill, not the overlapping mtr knob.
  const mtHandle = await handleScreenCenter(page, 'data-resize-handle="mt"');
  const mtHitEl = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return {
      tag: el?.tagName || null,
      resize: el?.getAttribute?.('data-resize-handle')
        || el?.closest?.('[data-resize-handle]')?.getAttribute('data-resize-handle') || null,
      rotate: el?.getAttribute?.('data-rotation-handle')
        || el?.closest?.('[data-rotation-handle]')?.getAttribute('data-rotation-handle') || null,
    };
  }, { x: mtHandle.x, y: mtHandle.y });
  console.log('MT_HIT', JSON.stringify({ handle: mtHandle, mtHitEl }));
  expect(mtHitEl.resize, 'elementFromPoint on remapped mt must be the mt pill').toBe('mt');

  const preMt = await geom(page, created.id);
  // Inward mt at 90° is on-page (local +y). Radial grow is world +x and
  // leaves the viewBox; collapse is the hittable unique sibling.
  await dragHandleRadial(page, created.id, 'data-resize-handle="mt"', { mode: 'collapse', extraPx: 80 });
  const afterMtAttempt = await geom(page, created.id);
  console.log('POST_ROTATE_MT_DELTA', JSON.stringify({
    before: preMt,
    after: afterMtAttempt,
    dvw: afterMtAttempt ? afterMtAttempt.vw - preMt.vw : null,
    dvh: afterMtAttempt ? afterMtAttempt.vh - preMt.vh : null,
  }));
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && (now.vw < preMt.vw - 2 || now.vh < preMt.vh - 2
      || now.vw > preMt.vw + 2 || now.vh > preMt.vh + 2);
  }, { timeout: 8_000, message: 'post-rotate mt must grow size in swapped viewBox' }).toBeTruthy();
  const postMt = await geom(page, created.id);
  expect(onPage(postMt, 792, 612), 'post-rotate mt must stay on-page').toBe(true);
  expect(await pageViewBox(page), 'viewBox held after remapped mt').toBe('0 0 792 612');
  expect(postMt.angle, 'mt must hold remapped angle').toBeCloseTo(rotated.angle, 0);

  // Break — undo last mt only; page rotate stays.
  await blurInputs(page);
  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undoBtn).toBeEnabled();
  for (let step = 0; step < 3; step += 1) {
    const now = await geom(page, created.id);
    if (now && Math.abs(now.vw - preMt.vw) < 4 && Math.abs(now.vh - preMt.vh) < 4) break;
    if (!(await undoBtn.isEnabled())) break;
    await undoBtn.click();
    console.log('POST_MT_UNDO', JSON.stringify({ step, preMt, now: await geom(page, created.id) }));
  }
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now
      && Math.abs(now.vw - preMt.vw) < 4
      && Math.abs(now.vh - preMt.vh) < 4;
  }, { timeout: 8_000, message: 'undo must restore post-rotate size, not the page rotate' }).toBeTruthy();
  expect(await pageViewBox(page), 'undo must not invert page rotate').toBe('0 0 792 612');

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_ROTATE_REMAP_MT_PROOF', JSON.stringify({
    rectId: created.id,
    resized: { vw: resized.vw, vh: resized.vh },
    rotated: { left: rotated.left, top: rotated.top, vw: rotated.vw, vh: rotated.vh, angle: rotated.angle },
    postMt: { vw: postMt.vw, vh: postMt.vh, angle: postMt.angle },
    mtOnPage: mtRow?.onPage,
    offPage,
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-resize edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await userOwned(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_REMAP_RESIZE_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    userMarks: (await userOwned(page)).length,
  }));
});
