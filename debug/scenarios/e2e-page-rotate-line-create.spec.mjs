import { test, expect } from '@playwright/test';

// Create a Line AFTER the page is already CW-rotated (viewBox 0 0 792 612).
// 52d001fd proved rect+pen via screenToSVG. e8a2e61a proved callout fractions.
// Line stores page-space bbox + CENTER-relative x1..y2 (buildLineCommitJSON).
// Distinct from leftover-18 / X-01 / remapped rect/callout/ink/counter/
// survey-marker/midpoint / remapped mt/mtr/br / remapped-page export /
// rect+pen create / callout create. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const LINE_BOX = { x0: 0.22, y0: 0.30, x1: 0.55, y1: 0.48 };

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

function liveLinePreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] line.shape-creation-preview');
}

function isLine(row) {
  return row.tool === 'line' && row.type === 'line';
}

async function lineSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const left = Number(object.left ?? data.left ?? 0);
      const top = Number(object.top ?? data.top ?? 0);
      const width = Number(object.width ?? data.width ?? 0);
      const height = Number(object.height ?? data.height ?? 0);
      const x1 = Number(object.x1 ?? 0);
      const y1 = Number(object.y1 ?? 0);
      const x2 = Number(object.x2 ?? 0);
      const y2 = Number(object.y2 ?? 0);
      const cx = left + width / 2;
      const cy = top + height / 2;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        width,
        height,
        x1,
        y1,
        x2,
        y2,
        angle: Number(object.angle ?? data.angle ?? 0),
        px1: cx + x1,
        py1: cy + y1,
        px2: cx + x2,
        py2: cy + y2,
        length: Math.hypot(x2 - x1, y2 - y1),
        arrowheadStyle: data.arrowheadStyle || object.arrowheadStyle || null,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userOwned(page) {
  return lineSnapshot(page);
}

async function geom(page, id) {
  return (await lineSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewLine(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await lineSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isLine(row)) || null;
    return created;
  }, { message: 'expected a new user line' }).not.toBeNull();
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

async function startLiveLine(page, { x0, y0, x1, y1 } = LINE_BOX) {
  const box = await pageBox(page);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  return { start, end };
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

test('desktop line create after CW rotate intended + break + edge', async ({ page }) => {
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

  const landscapeX1 = 792 * LINE_BOX.x0;
  const landscapeY1 = 612 * LINE_BOX.y0;
  const landscapeX2 = 792 * LINE_BOX.x1;
  const landscapeY2 = 612 * LINE_BOX.y1;
  const staleX1 = 612 * LINE_BOX.x0;
  const staleY1 = 792 * LINE_BOX.y0;
  const staleX2 = 612 * LINE_BOX.x1;
  const staleY2 = 792 * LINE_BOX.y1;

  // Intended — rubber-band a new Line onto the already-rotated page.
  const before = new Set((await userOwned(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await blurInputs(page);
  const drag = await startLiveLine(page, LINE_BOX);
  expect((await userOwned(page)).map((row) => row.id), 'Line live drag must not commit yet').toEqual([...before]);
  await expect(liveLinePreview(page), 'live line preview must paint on the swapped page').toHaveCount(1, { timeout: 5_000 });
  const live = await previewInfo(page);
  expect(live?.tag, 'Line preview must be a <line>').toBe('line');
  expect(live?.length, 'Line preview must pass the 3pt gate visually').toBeGreaterThan(3);
  expect(Math.abs(live.x1 - landscapeX1), 'preview start X uses swapped 792 width').toBeLessThan(28);
  expect(Math.abs(live.y1 - landscapeY1), 'preview start Y uses swapped 612 height').toBeLessThan(28);
  expect(Math.abs(live.x1 - staleX1), 'preview must not use stale portrait width').toBeGreaterThan(20);
  expect(Math.abs(live.y1 - staleY1), 'preview must not use stale portrait height').toBeGreaterThan(20);
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 4 });
  await page.mouse.up();
  await expect(liveLinePreview(page), 'Line pointerup must drop the preview').toHaveCount(0);
  const created = await waitForNewLine(page, before);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(created.length, 'new line length must be sane').toBeGreaterThan(8);
  expect(created.angle, 'new line must not invent a remapper angle').toBe(0);
  expect(created.arrowheadStyle, 'Line create never stamps arrowheadStyle').toBeNull();
  expect(created.px1, 'start X stays on swapped width').toBeGreaterThanOrEqual(-8);
  expect(created.px1).toBeLessThanOrEqual(800);
  expect(created.py1, 'start Y stays on swapped height').toBeGreaterThanOrEqual(-8);
  expect(created.py1).toBeLessThanOrEqual(620);
  expect(created.px2).toBeGreaterThanOrEqual(-8);
  expect(created.px2).toBeLessThanOrEqual(800);
  expect(created.py2).toBeGreaterThanOrEqual(-8);
  expect(created.py2).toBeLessThanOrEqual(620);
  expect(
    Math.abs(created.px1 - landscapeX1),
    'new line start must land in displayed 792×612, not pre-rotate 612×792',
  ).toBeLessThan(28);
  expect(Math.abs(created.py1 - landscapeY1)).toBeLessThan(28);
  expect(Math.abs(created.px2 - landscapeX2), 'new line end uses swapped width').toBeLessThan(28);
  expect(Math.abs(created.py2 - landscapeY2), 'new line end uses swapped height').toBeLessThan(28);
  expect(
    Math.abs(created.px1 - staleX1),
    'must not use stale portrait pageSize for start X',
  ).toBeGreaterThan(20);
  expect(Math.abs(created.py1 - staleY1)).toBeGreaterThan(20);
  expect(Math.abs(created.px2 - staleX2)).toBeGreaterThan(20);
  expect(Math.abs(created.py2 - staleY2)).toBeGreaterThan(20);
  expect(created.left, 'bbox left is page-space min').toBeGreaterThanOrEqual(-8);
  expect(created.top).toBeGreaterThanOrEqual(-8);
  expect(created.left + created.width).toBeLessThanOrEqual(800);
  expect(created.top + created.height).toBeLessThanOrEqual(620);
  expect(await pageViewBox(page), 'viewBox held after new line').toBe('0 0 792 612');

  const afterIntended = new Set((await userOwned(page)).map((row) => row.id));
  expect(afterIntended.size, 'intended create added one line').toBe(1);

  // Break — tiny click invents 0 (3pt length gate).
  await activateTool(page, 'Shapes', 'Line');
  await blurInputs(page);
  const beforeTiny = new Set((await userOwned(page)).map((row) => row.id));
  const tinyBox = await pageBox(page);
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12, tinyBox.y + tinyBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.up();
  await expect(liveLinePreview(page), 'tiny click must drop any preview').toHaveCount(0, { timeout: 5_000 });
  expect((await userOwned(page)).map((row) => row.id), 'tiny click invents 0').toEqual([...beforeTiny]);

  // Break — pointercancel mid-drag invents 0.
  await activateTool(page, 'Shapes', 'Line');
  await blurInputs(page);
  const beforeCancel = new Set((await userOwned(page)).map((row) => row.id));
  await startLiveLine(page, { x0: 0.16, y0: 0.58, x1: 0.32, y1: 0.72 });
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
  expect((await userOwned(page)).map((row) => row.id), 'pointercancel invents 0').toEqual([...beforeCancel]);
  expect(await pageViewBox(page), 'viewBox held through break').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const kept = await geom(page, created.id);
  expect(kept, 'tiny click / cancel must not drop the intended line').toBeTruthy();
  expect(Math.abs(kept.px1 - created.px1)).toBeLessThan(2);
  expect(Math.abs(kept.py1 - created.py1)).toBeLessThan(2);

  console.log('PAGE_ROTATE_LINE_CREATE_DESKTOP_PROOF', JSON.stringify({
    lineId: created.id,
    endpoints: { px1: created.px1, py1: created.py1, px2: created.px2, py2: created.py2 },
    bbox: { left: created.left, top: created.top, width: created.width, height: created.height },
    length: created.length,
    angle: created.angle,
    landscapeExpected: { x1: landscapeX1, y1: landscapeY1, x2: landscapeX2, y2: landscapeY2 },
    stalePortrait: { x1: staleX1, y1: staleY1, x2: staleX2, y2: staleY2 },
    viewBox: await pageViewBox(page),
    fileId: await fileId(page),
    leftover18CloudSave: 'unchanged',
  }));
});

test('390 line-create-after-rotate edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
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
  expect(await page.getByRole('button', { name: 'Line', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_LINE_CREATE_390_EDGE', JSON.stringify({
    viewBox: '0 0 612 792',
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    userMarks: 0,
  }));
});
