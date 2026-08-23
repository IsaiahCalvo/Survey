import { test, expect } from '@playwright/test';

// Object-level canvas mtr AFTER page 180 (two CWs — no dedicated 180
// button). Named remapped-page mtr is CW + CCW; object-180 after CW
// (page-rotate-remap-mtr-180) is a landscape leftover, not this path.
// Distinct from leftover-18 / X-01 / CW/CCW handle catalogs / remapper
// persist. Do not stamp file.id. Do not invent a 180 menu item.

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

function normAngle(value) {
  return (((Number(value) || 0) % 360) + 360) % 360;
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
        )) keys.push(key);
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
      const left = Number(object.left ?? data.left ?? 0);
      const top = Number(object.top ?? data.top ?? 0);
      const vw = width * Math.abs(scaleX);
      const vh = height * Math.abs(scaleY);
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
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
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    try {
      await expect.poll(async () => (await selectedIds(page)).includes(id), { timeout: 800 }).not.toBe(before);
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
    return {
      local: { x: pt.x, y: pt.y },
      screen: screen ? { x: screen.x, y: screen.y } : null,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  });
}

async function dragMtrToAngle(page, id, deg, { requireOnPage = false, preferCtm = false } = {}) {
  const hit = await annoHitBox(page, id);
  const cx = hit.x + hit.width / 2;
  const cy = hit.y + hit.height / 2;
  const ctm = preferCtm ? await mtrScreenFromCtm(page) : null;
  const handle = (ctm?.screen)
    ? { x: ctm.screen.x, y: ctm.screen.y, box: ctm.box, local: ctm.local }
    : await handleScreenCenter(page, 'data-rotation-handle="mtr"');
  const pageRect = await pageBox(page);
  if (requireOnPage) {
    expect(handle.x, 'mtr knob must stay inside the remapped page').toBeGreaterThan(pageRect.x - 4);
    expect(handle.x).toBeLessThan(pageRect.x + pageRect.width + 8);
    expect(handle.y).toBeGreaterThan(pageRect.y - 4);
    expect(handle.y).toBeLessThan(pageRect.y + pageRect.height + 8);
  }
  const radius = Math.max(80, Math.hypot(handle.x - cx, handle.y - cy));
  const end = {
    x: Math.min(pageRect.x + pageRect.width - 8, Math.max(pageRect.x + 8, cx + radius * Math.sin((deg * Math.PI) / 180))),
    y: Math.min(pageRect.y + pageRect.height - 8, Math.max(pageRect.y + 8, cy - radius * Math.cos((deg * Math.PI) / 180))),
  };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 1 });
  await page.mouse.up();
  return { handle, pageRect };
}

async function dragHandleRadial(page, id, attr, { extraPx = 90 } = {}) {
  const hit = await annoHitBox(page, id);
  const cx = hit.x + hit.width / 2;
  const cy = hit.y + hit.height / 2;
  const handle = await handleScreenCenter(page, attr);
  const vx = handle.x - cx;
  const vy = handle.y - cy;
  const len = Math.hypot(vx, vy) || 1;
  const end = { x: handle.x + (vx / len) * extraPx, y: handle.y + (vy / len) * extraPx };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();
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
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') await pages.first().click();
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) await rail.first().click();
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
  await assertNoErrorBoundary(page);
}

async function rotate180ViaTwoCWs(page, pageNumber = 1) {
  await rotatePage(page, pageNumber, 'cw');
  await rotatePage(page, pageNumber, 'cw');
}

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

test('desktop remapped-page mtr after 180 (two CWs) intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);
  expect((await userOwned(page)).length, 'fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();

  const created = await createRect(page, RECT_BOX);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  const before = await geom(page, created.id);

  await rotate180ViaTwoCWs(page, 1);
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: '180 must keep the live rect',
  }).not.toBeNull();
  const rotated = await geom(page, created.id);
  expect(await pageViewBox(page), 'two CWs return portrait viewBox').toBe('0 0 612 792');
  const expected = rotateDisplayedPoint(before.cx, before.cy, 612, 792, 180);
  expect(Math.abs(rotated.cx - expected.x), '180 center follows W-x / H-y').toBeLessThan(18);
  expect(Math.abs(rotated.cy - expected.y)).toBeLessThan(18);
  expect(normAngle(rotated.angle), '180 remapper sets angle 180').toBe(180);
  expect(onPage(rotated, 612, 792)).toBe(true);
  expect(rotated.cx, 'must not stay leftover identity').not.toBeCloseTo(before.cx, 0);
  expect(rotated.cy, 'must not stay leftover identity').not.toBeCloseTo(before.cy, 0);

  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  await selectUntilHandles(page, created.id, 8);
  expect(await page.locator('[data-svg-annotation-layer="1"] [data-rotation-handle="mtr"]').count(), 'mtr after 180').toBeGreaterThan(0);

  const preMtr = await geom(page, created.id);
  await dragMtrToAngle(page, created.id, 225, { requireOnPage: true, preferCtm: true });
  let postMtr = null;
  await expect.poll(async () => {
    postMtr = await geom(page, created.id);
    return postMtr && Math.abs(normAngle(postMtr.angle) - 180) > 8;
  }, { timeout: 8_000, message: 'post-180 mtr must update angle' }).toBeTruthy();
  expect(Math.abs(postMtr.vw - preMtr.vw), 'mtr must hold width').toBeLessThan(6);
  expect(Math.abs(postMtr.vh - preMtr.vh), 'mtr must hold height').toBeLessThan(6);
  expect(onPage(postMtr, 612, 792), 'mtr must stay on-page').toBe(true);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(normAngle(now.angle) - 180) < 2;
  }, { timeout: 8_000, message: 'undo last mtr must restore 180 angle, not invert page rotate' }).toBeTruthy();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await selectUntilHandles(page, created.id, 8);
  const preBr = await geom(page, created.id);
  await dragHandleRadial(page, created.id, 'data-resize-handle="br"', { extraPx: 70 });
  let postBr = null;
  await expect.poll(async () => {
    postBr = await geom(page, created.id);
    return postBr && (Math.abs(postBr.vw - preBr.vw) > 8 || Math.abs(postBr.vh - preBr.vh) > 8);
  }, { timeout: 8_000, message: 'post-180 br must grow bbox' }).toBeTruthy();
  expect(onPage(postBr, 612, 792), 'br grow must stay on-page').toBe(true);
  expect(normAngle(postBr.angle), 'br must hold remapped 180').toBe(180);

  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_ROTATE_MTR_180_PAGE', JSON.stringify({
    id: created.id,
    before: { cx: before.cx, cy: before.cy, angle: before.angle },
    after180: { cx: rotated.cx, cy: rotated.cy, angle: rotated.angle },
    afterMtr: { cx: postMtr.cx, cy: postMtr.cy, angle: postMtr.angle, vw: postMtr.vw, vh: postMtr.vh },
    afterBr: { vw: postBr.vw, vh: postBr.vh, angle: postBr.angle },
    fileId: null,
  }));
});

test('empty 180 invents 0; 390 mtr-after-180 edge; hubPreview Draw 0', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await dismissChrome(page);
  expect((await userOwned(page)).length).toBe(0);
  await rotate180ViaTwoCWs(page, 1);
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await userOwned(page)).length, 'empty 180 invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();

  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  expect((await userOwned(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
});
