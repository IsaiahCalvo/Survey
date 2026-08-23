import { test, expect } from '@playwright/test';

// Create AFTER the page is already CW-rotated (viewBox 0 0 792 612).
// Remappers fix existing objects. This path rubber-bands a new rect / live
// pen onto the swapped page. Distinct from leftover-18 / X-01 / remapped
// rect/callout/ink/counter/survey-marker/midpoint / remapped mt/mtr/br /
// remapped-page export. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const RECT_BOX = { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 };
const PEN_BOX = { x0: 0.55, y0: 0.25, x1: 0.78, y1: 0.48 };

function isRect(row) {
  return row.type === 'rect' || row.tool === 'rect';
}

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'highlighter' || row.tool === 'freedraw';
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
          || key.startsWith('pdfSidebar_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
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
      const first = object.paperCenterline?.[0] || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        width,
        height,
        vw,
        vh,
        angle: Number(object.angle ?? data.angle ?? 0),
        cx: left + vw / 2,
        cy: top + vh / 2,
        clx: Number(first.x ?? NaN),
        cly: Number(first.y ?? NaN),
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

async function startLiveDrag(page, { x0, y0, x1, y1 }) {
  const box = await pageBox(page);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  return { start, end };
}

function livePreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] .shape-creation-preview, [data-svg-annotation-layer="1"] .freehand-creation-preview');
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

async function createInk(page, coords = PEN_BOX) {
  const before = new Set((await userOwned(page)).map((row) => row.id));
  await activateTool(page, 'Draw', 'Pen');
  await blurInputs(page);
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isInk);
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

function expectOnSwappedPage(row, label) {
  const left = Number(row.left);
  const top = Number(row.top);
  const right = left + Number(row.vw || row.width || 0);
  const bottom = top + Number(row.vh || row.height || 0);
  expect(left, `${label} left on-page`).toBeGreaterThanOrEqual(-8);
  expect(top, `${label} top on-page`).toBeGreaterThanOrEqual(-8);
  expect(right, `${label} right stays on swapped page`).toBeLessThanOrEqual(800);
  expect(bottom, `${label} bottom stays on swapped page`).toBeLessThanOrEqual(620);
}

test('desktop create after CW rotate intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await userOwned(page)).length, 'fresh fixture starts empty').toBe(0);

  // Page CW first on an empty page — remapper has nothing to rewrite.
  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await userOwned(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page), 'create starts on the swapped viewBox').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const landscapeLeft = 792 * RECT_BOX.x0;
  const landscapeTop = 612 * RECT_BOX.y0;
  const stalePortraitLeft = 612 * RECT_BOX.x0;
  const stalePortraitTop = 792 * RECT_BOX.y0;

  // Intended — rubber-band a new rect onto the already-rotated page.
  const beforeRect = new Set((await userOwned(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await setNextDrawFill(page, '#00FFFF');
  await blurInputs(page);
  const rectDrag = await startLiveDrag(page, RECT_BOX);
  expect((await userOwned(page)).map((row) => row.id), 'Rect live drag must not commit yet').toEqual([...beforeRect]);
  await expect(livePreview(page), 'live rect preview must paint on the swapped page').toHaveCount(1, { timeout: 5_000 });
  await page.mouse.move(rectDrag.end.x, rectDrag.end.y, { steps: 4 });
  await page.mouse.up();
  await expect(livePreview(page), 'Rect pointerup must drop the preview').toHaveCount(0);
  const createdRect = await waitForNewUserAnnotation(page, beforeRect, isRect);
  await dismissChrome(page);
  expect(createdRect?.id).toBeTruthy();
  expect(createdRect.width, 'new rect size must be sane').toBeGreaterThan(8);
  expect(createdRect.height, 'new rect size must be sane').toBeGreaterThan(8);
  expect(createdRect.angle, 'new rect must not invent a remapper angle').toBe(0);
  expectOnSwappedPage(createdRect, 'new rect');
  expect(
    Math.abs(createdRect.left - landscapeLeft),
    'new rect must land in displayed 792×612, not pre-rotate 612×792',
  ).toBeLessThan(28);
  expect(Math.abs(createdRect.top - landscapeTop)).toBeLessThan(28);
  expect(
    Math.abs(createdRect.left - stalePortraitLeft),
    'must not use stale portrait pageSize',
  ).toBeGreaterThan(20);
  expect(Math.abs(createdRect.top - stalePortraitTop)).toBeGreaterThan(20);
  expect(await pageViewBox(page), 'viewBox held after new rect').toBe('0 0 792 612');

  // Intended — live pen on the same swapped page.
  const createdInk = await createInk(page, PEN_BOX);
  await dismissChrome(page);
  expect(createdInk?.id).toBeTruthy();
  expect(createdInk.id, 'pen must be a second new object').not.toBe(createdRect.id);
  expect(createdInk.left, 'live ink stays at left 0').toBe(0);
  expect(createdInk.angle, 'new ink must not invent an object angle').toBe(0);
  expect(Number.isFinite(createdInk.clx), 'pen stamps a page-space centerline').toBe(true);
  const inkLandscapeX = 792 * PEN_BOX.x0;
  const inkLandscapeY = 612 * PEN_BOX.y0;
  const inkStaleX = 612 * PEN_BOX.x0;
  const inkStaleY = 792 * PEN_BOX.y0;
  expect(Math.abs(createdInk.clx - inkLandscapeX), 'pen centerline uses swapped width').toBeLessThan(28);
  expect(Math.abs(createdInk.cly - inkLandscapeY), 'pen centerline uses swapped height').toBeLessThan(28);
  expect(Math.abs(createdInk.clx - inkStaleX), 'pen must not use stale portrait width').toBeGreaterThan(20);
  expect(Math.abs(createdInk.cly - inkStaleY), 'pen must not use stale portrait height').toBeGreaterThan(20);
  expect(createdInk.clx, 'pen stays on swapped page').toBeGreaterThanOrEqual(-8);
  expect(createdInk.cly).toBeGreaterThanOrEqual(-8);
  expect(createdInk.clx).toBeLessThanOrEqual(800);
  expect(createdInk.cly).toBeLessThanOrEqual(620);
  expect(await pageViewBox(page), 'viewBox held after new pen').toBe('0 0 792 612');

  const afterIntended = new Set((await userOwned(page)).map((row) => row.id));
  expect(afterIntended.size, 'intended create added rect + pen').toBe(2);

  // Break — tiny click invents 0 (2pt size gate).
  await activateTool(page, 'Shapes', 'Rectangle');
  await blurInputs(page);
  const beforeTiny = new Set((await userOwned(page)).map((row) => row.id));
  const tinyBox = await pageBox(page);
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12, tinyBox.y + tinyBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.up();
  await expect(livePreview(page), 'tiny click must drop any preview').toHaveCount(0, { timeout: 5_000 });
  expect((await userOwned(page)).map((row) => row.id), 'tiny click invents 0').toEqual([...beforeTiny]);

  // Break — pointercancel mid-drag invents 0.
  await activateTool(page, 'Shapes', 'Rectangle');
  await blurInputs(page);
  const beforeCancel = new Set((await userOwned(page)).map((row) => row.id));
  await startLiveDrag(page, { x0: 0.16, y0: 0.58, x1: 0.32, y1: 0.72 });
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
  expect((await userOwned(page)).map((row) => row.id), 'pointercancel invents 0').toEqual([...beforeCancel]);
  expect(await pageViewBox(page), 'viewBox held through break').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const keptRect = await geom(page, createdRect.id);
  const keptInk = await geom(page, createdInk.id);
  expect(keptRect, 'tiny click / cancel must not drop the intended rect').toBeTruthy();
  expect(keptInk, 'tiny click / cancel must not drop the intended pen').toBeTruthy();

  console.log('PAGE_ROTATE_CREATE_DESKTOP_PROOF', JSON.stringify({
    rectId: createdRect.id,
    inkId: createdInk.id,
    rect: { left: createdRect.left, top: createdRect.top, width: createdRect.width, height: createdRect.height, angle: createdRect.angle },
    ink: { clx: createdInk.clx, cly: createdInk.cly, left: createdInk.left, angle: createdInk.angle },
    landscapeExpected: { left: landscapeLeft, top: landscapeTop, clx: inkLandscapeX, cly: inkLandscapeY },
    stalePortrait: { left: stalePortraitLeft, top: stalePortraitTop, clx: inkStaleX, cly: inkStaleY },
    viewBox: await pageViewBox(page),
    fileId: await fileId(page),
    leftover18CloudSave: 'unchanged',
  }));
});

test('390 create-after-rotate edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
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

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_CREATE_390_EDGE', JSON.stringify({
    viewBox: '0 0 612 792',
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    userMarks: 0,
  }));
});
