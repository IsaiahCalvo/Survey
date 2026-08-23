import { test, expect } from '@playwright/test';

// Rotate page 2 only on a multi-page fixture. Page 1 objects must not
// remap. Bookmark-jump already proved sibling rotate stays on page 1
// without annotations — this leftover is objects on both pages.
// Distinct from leftover-18 / X-01 / CW/CCW/180 remapper persist /
// handle catalogs. Do not stamp file.id. Do not invent pages.

const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
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

async function openEditor(page, { width = 1440, height = 900, url = MULTI_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
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

async function pageCoveredByHub(page, pageNumber = 1) {
  const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
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

async function dismissChrome(page, pageNumber = 1) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  await closeDocumentPanel(page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page, pageNumber))) break;
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
    }
    await expect(hubCopy).toHaveCount(0, { timeout: 8_000 });
  }
  await expect.poll(async () => pageCoveredByHub(page, pageNumber), {
    timeout: 8_000,
    message: 'hub Documents must not cover the page',
  }).toBe(false);
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const host = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  await expect(host).toBeVisible({ timeout: 20_000 });
  const box = await host.boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
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
      pageNumber: Number(data.pageNumber ?? object.pageNumber ?? 0),
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

async function userOwned(page, pageNumber = 1) {
  return (await userAnnotationSnapshot(page, pageNumber)).filter((row) => row.imported !== true);
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

async function rotatePage(page, pageNumber, direction = 'cw') {
  const items = await openPageMenu(page, pageNumber);
  await items.rotateCw.click();
  await expect(pagesMenu(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await closeDocumentPanel(page);
  await assertNoErrorBoundary(page);
}

test('desktop rotate page 2 only — page 1 objects do not remap', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page, 1);
  await assertNoErrorBoundary(page);
  expect((await userOwned(page, 1)).length, 'fresh page 1 invents 0').toBe(0);
  expect(await pageViewBox(page, 1)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();

  const page1 = await createRect(page, 1, RECT_BOX);
  await dismissChrome(page, 1);
  expect(page1?.id).toBeTruthy();
  const beforeP1 = await cacheGeom(page, page1.id);
  expect(beforeP1.cx).toBeGreaterThan(0);

  await goToPage(page, 2);
  await dismissChrome(page, 2);
  expect(await pageViewBox(page, 2), 'page 2 starts leftover portrait').toBe('0 0 612 792');
  expect((await userOwned(page, 2)).length, 'fresh page 2 invents 0').toBe(0);

  const page2 = await createRect(page, 2, RECT_BOX);
  await dismissChrome(page, 2);
  expect(page2?.id).toBeTruthy();
  expect(page2.id, 'page 2 must not reuse page 1 id').not.toBe(page1.id);
  const beforeP2 = await cacheGeom(page, page2.id);

  const heldP1 = await cacheGeom(page, page1.id);
  expect(heldP1, 'page 1 object must stay in cache before rotate').toBeTruthy();
  expect(heldP1.cx).toBeCloseTo(beforeP1.cx, 1);
  expect(heldP1.cy).toBeCloseTo(beforeP1.cy, 1);
  expect(heldP1.angle).toBeCloseTo(beforeP1.angle, 1);

  await rotatePage(page, 2, 'cw');
  await goToPage(page, 2);
  await dismissChrome(page, 2);

  await expect.poll(async () => cacheGeom(page, page2.id), {
    timeout: 20_000,
    message: 'page 2 CW must keep the live rect',
  }).not.toBeNull();
  const afterP2 = await cacheGeom(page, page2.id);
  await expect.poll(async () => pageViewBox(page, 2), {
    timeout: 20_000,
    message: 'page 2 viewBox must swap after CW',
  }).toBe('0 0 792 612');
  await expect.poll(async () => {
    const box = await page.locator('.survey-pdfjs-page-div[data-page-number="2"]').boundingBox();
    return !!(box && box.width > box.height + 8);
  }, { timeout: 20_000, message: 'page 2 host must be landscape' }).toBeTruthy();

  const expected = rotateDisplayedPoint(beforeP2.cx, beforeP2.cy, 612, 792, 90);
  expect(Math.abs(afterP2.cx - expected.x), 'page 2 center follows 90').toBeLessThan(18);
  expect(Math.abs(afterP2.cy - expected.y)).toBeLessThan(18);
  expect(onPage(afterP2, 792, 612)).toBe(true);
  expect(afterP2.cx, 'page 2 must not stay leftover portrait').not.toBeCloseTo(beforeP2.cx, 0);

  const afterP1 = await cacheGeom(page, page1.id);
  expect(afterP1, 'page 1 object must survive sibling rotate').toBeTruthy();
  expect(afterP1.id).toBe(page1.id);
  expect(Math.abs(afterP1.cx - beforeP1.cx), 'page 1 center must not remap').toBeLessThan(2);
  expect(Math.abs(afterP1.cy - beforeP1.cy)).toBeLessThan(2);
  expect(Math.abs(afterP1.angle - beforeP1.angle)).toBeLessThan(1);
  expect(afterP1.left).toBeCloseTo(beforeP1.left, 1);
  expect(afterP1.top).toBeCloseTo(beforeP1.top, 1);

  await goToPage(page, 1);
  await dismissChrome(page, 1);
  expect(await pageViewBox(page, 1), 'page 1 viewBox stays leftover portrait').toBe('0 0 612 792');
  const liveP1 = (await userOwned(page, 1)).find((row) => row.id === page1.id);
  expect(liveP1, 'page 1 layer still owns the original id').toBeTruthy();
  expect(Math.abs(liveP1.cx - beforeP1.cx)).toBeLessThan(2);
  expect(Math.abs(liveP1.cy - beforeP1.cy)).toBeLessThan(2);

  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_ROTATE_PAGE2', JSON.stringify({
    page1: { id: page1.id, before: beforeP1, after: afterP1 },
    page2: { id: page2.id, before: beforeP2, after: afterP2 },
    fileId: null,
  }));
});

test('empty page-2 CW invents 0 on both pages; 390 edge; hubPreview Draw 0', async ({ page }) => {
  test.setTimeout(150_000);
  await openEditor(page);
  await dismissChrome(page, 1);
  expect((await userOwned(page, 1)).length).toBe(0);
  const page1 = await createRect(page, 1, RECT_BOX);
  const beforeP1 = await cacheGeom(page, page1.id);

  await rotatePage(page, 2, 'cw');
  const held = await cacheGeom(page, page1.id);
  expect(held, 'page-2 CW must not drop the page 1 object').toBeTruthy();
  expect(Math.abs(held.cx - beforeP1.cx), 'page-2 CW must not remap page 1').toBeLessThan(2);
  expect(Math.abs(held.cy - beforeP1.cy)).toBeLessThan(2);
  expect(Math.abs(held.angle - beforeP1.angle)).toBeLessThan(1);

  await goToPage(page, 1);
  await dismissChrome(page, 1);
  expect((await userOwned(page, 1)).length, 'page-2 CW must not invent on page 1').toBe(1);
  expect(await pageViewBox(page, 1)).toBe('0 0 612 792');

  await goToPage(page, 2);
  await dismissChrome(page, 2);
  expect((await userOwned(page, 2)).length, 'empty page-2 CW invents 0').toBe(0);
  expect(await pageViewBox(page, 2)).toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page, 1);
  expect((await userOwned(page, 1)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page, 1)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
});
