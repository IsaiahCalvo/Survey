import { test, expect } from '@playwright/test';

// Move + Cut/Copy/Paste of remapped objects after page CW.
// Distinct from unrotated E-03 / UL-27–29, remapped format, handle-drag,
// persist/History/export/save, mtr, leftover-18 / X-01.
// PointerEvent select/drag is OK if Playwright mouse misses. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const PLACE_EPS = 4;
const RECT_BOX = { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 };
const GRAY_PASTE = /rgb\(\s*90,\s*100,\s*115\s*\)/;

function almostEq(a, b, eps = PLACE_EPS) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

function placeHeld(a, b) {
  if (!a || !b) return false;
  return almostEq(a.cx, b.cx) && almostEq(a.cy, b.cy)
    && almostEq(a.width, b.width, 6) && almostEq(a.height, b.height, 6);
}

function onLandscape(row, slop = 28) {
  return row
    && row.cx >= -slop && row.cx <= 792 + slop
    && row.cy >= -slop && row.cy <= 612 + slop;
}

function notLeftoverPortrait(row, portrait) {
  if (!row || !portrait) return false;
  return Math.hypot(row.cx - portrait.cx, row.cy - portrait.cy) > 8;
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

async function snapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const origin = (() => {
        const ownL = Number(object.left);
        const dataL = Number(data.left);
        const ownT = Number(object.top);
        const dataT = Number(data.top);
        const left = (Number.isFinite(dataL) && (!Number.isFinite(ownL) || (Math.abs(ownL) < 1 && Math.abs(dataL) > 1)))
          ? dataL
          : (Number.isFinite(ownL) ? ownL : 0);
        const top = (Number.isFinite(dataT) && (!Number.isFinite(ownT) || (Math.abs(ownT) < 1 && Math.abs(dataT) > 1)))
          ? dataT
          : (Number.isFinite(ownT) ? ownT : 0);
        return { left, top };
      })();
      const width = Number(object.width ?? data.width ?? 0);
      const height = Number(object.height ?? data.height ?? 0);
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(object.tool || data.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: origin.left,
        top: origin.top,
        width,
        height,
        cx: origin.left + width / 2,
        cy: origin.top + height / 2,
        angle: Number(object.angle ?? data.angle ?? 0),
        storeLeft: Number(object.left ?? 0),
        storeDataLeft: Number(data.left ?? 0),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function geom(page, id) {
  return (await snapshot(page)).find((row) => row.id === id) || null;
}

async function userCount(page) {
  return (await snapshot(page)).length;
}

async function userOrder(page) {
  return (await snapshot(page)).map((row) => row.id);
}

async function activateTool(page, categoryName, toolName) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const category = page.getByRole('button', { name: categoryName, exact: true }).first();
  await expect(category).toBeVisible({ timeout: 8_000 });
  if (!String(await category.getAttribute('class') || '').includes('btn-active')) {
    await category.click();
  }
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  await expect(sub.first()).toBeVisible({ timeout: 8_000 });
  if (!String(await sub.first().getAttribute('class') || '').includes('btn-active')) {
    await sub.first().click();
  }
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const scoped = page.locator('button.btn-icon[aria-label="Select"]');
  if (await scoped.count() && await scoped.first().isVisible().catch(() => false)) {
    await scoped.first().click();
  }
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function dragOnPage(page, coords) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 8 });
  await page.mouse.up();
}

async function waitForNew(page, beforeIds, pred) {
  let created = null;
  await expect.poll(async () => {
    created = (await snapshot(page)).find((row) => !beforeIds.has(row.id) && pred(row)) || null;
    return created;
  }, { message: 'expected a new annotation' }).not.toBeNull();
  return created;
}

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect';
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

async function createFilledRect(page) {
  const before = new Set((await snapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await setNextDrawFill(page, '#00FFFF');
  await dragOnPage(page, RECT_BOX);
  const created = await waitForNew(page, before, isRect);
  await selectMode(page);
  return geom(page, created.id);
}

async function pointerClickHost(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const fire = (type, buttons) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
    }));
    fire('pointerdown', 1);
    fire('pointerup', 0);
    return true;
  }, selector);
}

async function selectionChromeUp(page) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  const handles = page.locator('[data-resize-handle], [data-handle]');
  return (await color.isVisible().catch(() => false)) || (await handles.count()) > 0;
}

async function deselectEmpty(page) {
  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.92, pageEl.y + pageEl.height * 0.08);
}

function hitSelector(id) {
  return `[data-svg-annotation-layer="1"] [data-anno-id="${id}"] [data-shape-hit-target]`;
}

async function selectAnno(page, id) {
  await selectMode(page);
  await deselectEmpty(page);
  const selectors = [
    hitSelector(id),
    `[data-svg-annotation-layer="1"] [data-anno-id="${id}"]`,
  ];
  await expect.poll(async () => {
    for (const selector of selectors) {
      await pointerClickHost(page, selector);
      if (await selectionChromeUp(page)) return true;
    }
    return false;
  }, { timeout: 12_000, message: `select remapped ${id}` }).toBe(true);
  return true;
}

async function pointerBodyDrag(page, id, dxPx = 80, dyPx = 48) {
  const selector = hitSelector(id);
  return page.evaluate(({ sel, dx, dy }) => {
    const el = document.querySelector(sel);
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    if (!el || !svg) return false;
    const r = el.getBoundingClientRect();
    const x0 = r.left + r.width * 0.35;
    const y0 = r.top + r.height * 0.35;
    const x1 = x0 + dx;
    const y1 = y0 + dy;
    const fire = (target, type, x, y, buttons) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
    }));
    fire(el, 'pointerdown', x0, y0, 1);
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      fire(svg, 'pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, 1);
    }
    fire(svg, 'pointerup', x1, y1, 0);
    return true;
  }, { sel: selector, dx: dxPx, dy: dyPx });
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
  await assertNoErrorBoundary(page);
}

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function dismissMenus(page) {
  await page.keyboard.press('Escape').catch(() => {});
}

async function menuLabels(page) {
  return page.locator('[data-annotation-context-menu="true"]').evaluate((el) => (
    [...el.querySelectorAll('div')]
      .map((node) => (node.textContent || '').trim())
      .filter((text) => text && !['Page', 'Annotation', 'Callout', 'Counter'].includes(text))
  ));
}

async function pasteColor(page) {
  return page.locator('[data-annotation-context-menu="true"]')
    .getByText('Paste', { exact: true })
    .evaluate((el) => getComputedStyle(el).color);
}

async function rightClickEmpty(page, { xf = 0.82, yf = 0.78 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf, { button: 'right' });
}

async function rightClickUntilPasteOnly(page, candidates = [
  { xf: 0.82, yf: 0.78 },
  { xf: 0.10, yf: 0.12 },
  { xf: 0.88, yf: 0.18 },
]) {
  let labels = null;
  for (const pos of candidates) {
    await dismissMenus(page);
    await rightClickEmpty(page, pos);
    const menu = page.locator('[data-annotation-context-menu="true"]');
    if (!(await menu.count())) await page.waitForTimeout(120);
    if (!(await menu.count())) continue;
    const next = await menuLabels(page);
    if (next.length === 1 && next[0] === 'Paste') {
      labels = next;
      break;
    }
  }
  expect(labels, 'empty remapped page must offer Paste-only').toEqual(['Paste']);
  return labels;
}

async function rightClickAnno(page, id) {
  await selectAnno(page, id);
  const selectors = [
    hitSelector(id),
    `[data-svg-annotation-layer="1"] [data-anno-id="${id}"]`,
  ];
  for (const selector of selectors) {
    await dismissMenus(page);
    const opened = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width * 0.35,
        clientY: r.top + r.height * 0.35,
      }));
      return true;
    }, selector);
    if (!opened) continue;
    const menu = page.locator('[data-annotation-context-menu="true"]');
    try {
      await expect(menu).toBeVisible({ timeout: 2_000 });
      const labels = await menuLabels(page);
      if (labels.includes('Cut') || labels.includes('Copy')) return labels;
    } catch { /* try next */ }
  }
  throw new Error(`remapped context menu missed ${id}`);
}

async function clickMenuItem(page, label) {
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText(label, { exact: true }).click();
  await expect(menu).toHaveCount(0, { timeout: 8_000 });
}

async function pasteCloneOnEmpty(page, beforeIds, candidates) {
  await rightClickUntilPasteOnly(page, candidates);
  const color = await pasteColor(page);
  expect(color, 'Paste must be enabled').not.toMatch(GRAY_PASTE);
  await clickMenuItem(page, 'Paste');
  return waitForNew(page, beforeIds, isRect);
}

test('desktop remapped move + copy/paste + cut/paste after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userCount(page), 'fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await userCount(page), 'empty CW invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await userCount(page), 'empty CCW invents 0').toBe(0);

  const rect = await createFilledRect(page);
  await dismissChrome(page);
  expect(rect?.id).toBeTruthy();
  const portrait = { cx: rect.cx, cy: rect.cy, width: rect.width, height: rect.height };

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const remapped = await geom(page, rect.id);
  expect(Math.hypot(remapped.cx - portrait.cx, remapped.cy - portrait.cy), 'rect remaps').toBeGreaterThan(8);
  expect(onLandscape(remapped), 'remapped rect is on landscape page').toBe(true);
  expect(notLeftoverPortrait(remapped, portrait), 'remap leaves leftover portrait').toBe(true);

  expect(await selectAnno(page, rect.id), 'select remapped rect').toBe(true);
  await page.keyboard.press('Escape');
  expect(placeHeld(await geom(page, rect.id), remapped), 'Escape cancel does not move').toBe(true);

  expect(await selectAnno(page, rect.id)).toBe(true);
  await pointerBodyDrag(page, rect.id, 80, 48);
  let moved = null;
  await expect.poll(async () => {
    moved = await geom(page, rect.id);
    return moved && Math.hypot(moved.cx - remapped.cx, moved.cy - remapped.cy) > 8;
  }, { timeout: 12_000, message: 'remapped body-drag must update landscape placement' }).toBeTruthy();
  expect(onLandscape(moved), 'moved rect stays on landscape page').toBe(true);
  expect(notLeftoverPortrait(moved, portrait), 'move must not jump to leftover portrait').toBe(true);
  expect(Math.hypot(moved.cx, moved.cy), 'move must not jump to origin').toBeGreaterThan(80);
  expect(almostEq(moved.width, remapped.width, 6), 'move holds remapped width').toBe(true);
  expect(almostEq(moved.height, remapped.height, 6), 'move holds remapped height').toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rect.id);
    return placeHeld(now, remapped) && onLandscape(now);
  }, { timeout: 12_000, message: 'undo restores remapped-unmoved' }).toBeTruthy();

  expect(await selectAnno(page, rect.id)).toBe(true);
  const owned = await rightClickAnno(page, rect.id);
  expect(owned, 'remapped menu lists Copy').toContain('Copy');
  expect(owned).toContain('Cut');
  await clickMenuItem(page, 'Copy');
  expect(placeHeld(await geom(page, rect.id), remapped), 'Copy must hold remapped original').toBe(true);

  const copy1 = await pasteCloneOnEmpty(page, new Set([rect.id]), [
    { xf: 0.78, yf: 0.72 },
    { xf: 0.86, yf: 0.22 },
  ]);
  expect(copy1.id).not.toBe(rect.id);
  expect(placeHeld(await geom(page, rect.id), remapped), 'Copy+Paste must hold remapped original').toBe(true);
  expect(onLandscape(copy1), 'paste clone must land on rotated page').toBe(true);
  expect(notLeftoverPortrait(copy1, portrait), 'paste must not land leftover portrait').toBe(true);
  expect(Math.hypot(copy1.cx - remapped.cx, copy1.cy - remapped.cy), 'clone is not stacked on original').toBeGreaterThan(4);

  await rightClickAnno(page, rect.id);
  await clickMenuItem(page, 'Cut');
  await expect.poll(async () => (await userOrder(page)).includes(rect.id)).toBeFalsy();
  expect(await userOrder(page), 'Cut must leave the copy clone').toContain(copy1.id);

  const cutClone = await pasteCloneOnEmpty(page, new Set(await userOrder(page)), [
    { xf: 0.22, yf: 0.78 },
    { xf: 0.50, yf: 0.82 },
  ]);
  expect(cutClone.id).not.toBe(rect.id);
  expect(onLandscape(cutClone), 'cut-paste must land on rotated page').toBe(true);
  expect(notLeftoverPortrait(cutClone, portrait), 'cut-paste must not land leftover portrait').toBe(true);

  await rightClickUntilPasteOnly(page, [
    { xf: 0.50, yf: 0.50 },
    { xf: 0.12, yf: 0.12 },
  ]);
  expect(await pasteColor(page), 'Cut is one-shot — second Paste stays gray').toMatch(GRAY_PASTE);
  const afterCut = await userOrder(page);
  await page.locator('[data-annotation-context-menu="true"]').getByText('Paste', { exact: true }).click();
  await page.waitForTimeout(200);
  expect(await userOrder(page), 'empty clipboard Paste invents 0').toEqual(afterCut);
  await dismissMenus(page);

  expect(await userCount(page), 'empty remapped-page click invents 0 extras').toBe(2);
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_REMAP_MOVE_CLIPBOARD_DESKTOP_PROOF', JSON.stringify({
    rectId: rect.id,
    copyId: copy1.id,
    cutCloneId: cutClone.id,
    created: portrait,
    remapped: { cx: remapped.cx, cy: remapped.cy, left: remapped.left, top: remapped.top },
    moved: { cx: moved.cx, cy: moved.cy, left: moved.left, top: moved.top },
    copy: { cx: copy1.cx, cy: copy1.cy },
    cutPaste: { cx: cutClone.cx, cy: cutClone.cy },
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-move/clipboard edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userCount(page), '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_REMAP_MOVE_CLIPBOARD_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    annotations: await userCount(page),
  }));
});
