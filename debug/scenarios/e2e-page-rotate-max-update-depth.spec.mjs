import { test, expect } from '@playwright/test';

// Product: Maximum update depth in PDFViewer while rotating page 2 of
// spike-120-pages.pdf. Chrome-publish identity-churn (CLAUDE.md 2026-05-13).
// Distinct from remapper / persist / mtr / page-2 isolation catalogs.
// Do not stamp file.id.

const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
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

function isDepthWarning(text) {
  return /Maximum update depth exceeded|too many re-renders/i.test(String(text || ''));
}

function attachDepthTraps(page) {
  const hits = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (isDepthWarning(text)) hits.push({ kind: 'console', type: msg.type(), text });
  });
  page.on('pageerror', (error) => {
    const text = String(error?.message || error);
    if (isDepthWarning(text)) hits.push({ kind: 'pageerror', text });
  });
  return hits;
}

async function openEditor(page, { width = 1440, height = 900, url = MULTI_PDF } = {}) {
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
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
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
}

async function pageViewBox(page, pageNumber = 1) {
  const layer = page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function cacheGeom(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId);
    if (!object) return null;
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
      id: annoId,
      type: String(object.type || data.type || '').toLowerCase(),
      tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
      left,
      top,
      vw,
      vh,
      angle: Number(object.angle ?? data.angle ?? 0),
      cx: left + vw / 2,
      cy: top + vh / 2,
    };
  }, id);
}

async function userOwned(page, pageNumber = 1) {
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
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, pageNumber, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userOwned(page, pageNumber);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: `expected a new user annotation on page ${pageNumber}` }).not.toBeNull();
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

async function pageBox(page, pageNumber = 1) {
  const host = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  await expect(host).toBeVisible({ timeout: 20_000 });
  const box = await host.boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function dragOnPage(page, pageNumber, { x0, y0, x1, y1 }) {
  const box = await pageBox(page, pageNumber);
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

async function createRect(page, pageNumber, coords) {
  const before = new Set((await userOwned(page, pageNumber)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await setNextDrawFill(page, '#00FFFF');
  await dragOnPage(page, pageNumber, coords);
  return waitForNewUserAnnotation(page, pageNumber, before, isRect);
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

async function goToPage(page, pageNumber) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  await thumb.click();
  await expect(page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`[data-svg-annotation-layer="${pageNumber}"]`)).toBeVisible({ timeout: 20_000 });
  await closeDocumentPanel(page);
}

async function openPageMenu(page, pageNumber) {
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
  };
}

async function rotatePage(page, pageNumber) {
  const items = await openPageMenu(page, pageNumber);
  await items.rotateCw.click();
  await expect(pagesMenu(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await closeDocumentPanel(page);
  await assertNoErrorBoundary(page);
}

test('120-page rotate page 2 does not exceed update depth', async ({ page }) => {
  test.setTimeout(180_000);
  const hits = attachDepthTraps(page);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);
  expect(hits, 'load must not trip max update depth').toEqual([]);
  expect(await fileId(page)).toBeNull();

  const page1 = await createRect(page, 1, RECT_BOX);
  const beforeP1 = await cacheGeom(page, page1.id);
  await goToPage(page, 2);
  await dismissChrome(page);
  const page2 = await createRect(page, 2, RECT_BOX);
  const beforeP2 = await cacheGeom(page, page2.id);

  await rotatePage(page, 2);
  await goToPage(page, 2);
  await dismissChrome(page);

  const afterP2 = await cacheGeom(page, page2.id);
  const afterP1 = await cacheGeom(page, page1.id);
  await expect.poll(async () => pageViewBox(page, 2), {
    timeout: 20_000,
    message: 'page 2 viewBox must swap after CW',
  }).toBe('0 0 792 612');
  const expected = rotateDisplayedPoint(beforeP2.cx, beforeP2.cy, 612, 792, 90);
  expect(Math.abs(afterP2.cx - expected.x), 'page 2 still remaps').toBeLessThan(18);
  expect(Math.abs(afterP1.cx - beforeP1.cx), 'page 1 must not remap').toBeLessThan(2);
  expect(hits, 'page-2 rotate must not trip max update depth').toEqual([]);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_MAX_UPDATE_DEPTH', JSON.stringify({
    hits: hits.length,
    page1: { id: page1.id, held: afterP1.cx },
    page2: { id: page2.id, after: { cx: afterP2.cx, cy: afterP2.cy } },
  }));
});

test('single-page empty rotate invents 0 and does not exceed update depth', async ({ page }) => {
  test.setTimeout(120_000);
  const hits = attachDepthTraps(page);
  await openEditor(page, { url: LINK_PDF });
  await dismissChrome(page);
  expect((await userOwned(page, 1)).length, 'fresh single-page invents 0').toBe(0);
  expect(hits, 'single-page load must not trip max update depth').toEqual([]);

  await rotatePage(page, 1);
  await dismissChrome(page);
  expect((await userOwned(page, 1)).length, 'empty rotate invents 0').toBe(0);
  expect(await pageViewBox(page, 1)).toBe('0 0 792 612');
  expect(hits, 'empty single-page rotate must not trip max update depth').toEqual([]);
  expect(await fileId(page)).toBeNull();
});

test('390 multi-page load does not exceed update depth', async ({ page }) => {
  test.setTimeout(90_000);
  const hits = attachDepthTraps(page);
  await openEditor(page, { width: 390, height: 844, url: MULTI_PDF });
  await dismissChrome(page);
  expect((await userOwned(page, 1)).length, '390 fresh invents 0').toBe(0);
  expect(await pageViewBox(page, 1)).toBe('0 0 612 792');
  expect(hits, '390 load must not trip max update depth').toEqual([]);
  expect(await fileId(page)).toBeNull();
});
