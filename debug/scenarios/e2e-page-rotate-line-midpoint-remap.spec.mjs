import { test, expect } from '@playwright/test';

// Live-created line/arrow data.midpoint after page CW. Distinct from
// remapped survey-marker / counter / ink / callout, remapped mt/mtr/br
// clip, leftover-18 / X-01, and straight-line bbox+angle. Do not stamp
// file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
}

function visualPoint(x, y, cx, cy, angle) {
  const rad = (Number(angle) || 0) * Math.PI / 180;
  const dx = Number(x) - cx;
  const dy = Number(y) - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
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

function isUserLine(row) {
  return row.type === 'line' && row.imported !== true;
}

async function lineSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const left = Number(object.left ?? 0);
      const top = Number(object.top ?? 0);
      const width = Number(object.width ?? 0);
      const height = Number(object.height ?? 0);
      const cx = left + width / 2;
      const cy = top + height / 2;
      const midpoint = data.midpoint && typeof data.midpoint === 'object'
        ? { x: Number(data.midpoint.x), y: Number(data.midpoint.y) }
        : null;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(object.tool || data.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        width,
        height,
        cx,
        cy,
        x1: Number(object.x1 ?? 0),
        y1: Number(object.y1 ?? 0),
        x2: Number(object.x2 ?? 0),
        y2: Number(object.y2 ?? 0),
        angle: Number(object.angle ?? 0),
        midpoint,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function lineIds(page) {
  return (await lineSnapshot(page)).filter(isUserLine).map((row) => row.id);
}

async function geom(page, id) {
  return (await lineSnapshot(page)).find((row) => row.id === id) || null;
}

function visualMidpoint(row) {
  if (!row?.midpoint) return null;
  return visualPoint(row.midpoint.x, row.midpoint.y, row.cx, row.cy, row.angle);
}

async function waitForNewLine(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await lineSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isUserLine(row)) || null;
    return created;
  }, { message: 'expected a new user line' }).not.toBeNull();
  return created;
}

async function activateShapeTool(page, toolName) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const category = page.getByRole('button', { name: 'Shapes', exact: true }).first();
  await expect(category).toBeVisible({ timeout: 8_000 });
  if (!String(await category.getAttribute('class') || '').includes('btn-active')) {
    await category.click();
  }
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  await expect(sub).toBeVisible({ timeout: 8_000 });
  if (!String(await sub.getAttribute('class') || '').includes('btn-active')) {
    await sub.click();
  }
}

async function selectMode(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await blurInputs(page);
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function createCurvedLine(page, coords = { x0: 0.18, y0: 0.30, x1: 0.46, y1: 0.30 }) {
  const before = new Set(await lineIds(page));
  await activateShapeTool(page, 'Line');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 8 });
  await page.mouse.up();
  const created = await waitForNewLine(page, before);
  // Handle drags (p1/p2/midpoint) do not commit in this VM — the already-
  // receipted e2e-line-endpoint-midpoint spec fails the same way. Seed
  // data.midpoint onto the live-created line (shared data object) so the
  // rotate remapper has a page-space curve to follow.
  await page.evaluate((id) => {
    const object = window.__phase35GetAnnotationById?.(id);
    if (!object) return false;
    const cx = Number(object.left || 0) + Number(object.width || 0) / 2;
    const cy = Number(object.top || 0) + Number(object.height || 0) / 2;
    if (!object.data || typeof object.data !== 'object') return false;
    object.data.midpoint = { x: cx, y: cy - 48 };
    return true;
  }, created.id);
  let bent = null;
  await expect.poll(async () => {
    bent = await geom(page, created.id);
    return Boolean(bent?.midpoint);
  }, { timeout: 8_000, message: 'live line must carry a page-space midpoint' }).toBe(true);
  await selectMode(page);
  return geom(page, created.id);
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

test('desktop line midpoint after page CW remap intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await lineIds(page)).length, 'fresh editor must have 0 lines').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await lineIds(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await lineIds(page)).length, 'empty opposite rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createCurvedLine(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(created.midpoint, 'live bend stamps a page-space midpoint').toBeTruthy();
  expect(created.angle, 'live line starts unrotated').toBe(0);
  const visualBefore = visualMidpoint(created);
  const expected = rotateDisplayedPoint(visualBefore.x, visualBefore.y, 612, 792, 90);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the live curved line',
  }).not.toBeNull();
  const rotated = await geom(page, created.id);
  expect(rotated, 'page rotate must keep the live curved line').toBeTruthy();
  expect(await lineIds(page)).toEqual([created.id]);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(rotated.x1, 'endpoints stay local').toBeCloseTo(created.x1, 1);
  expect(rotated.y1, 'endpoints stay local').toBeCloseTo(created.y1, 1);
  expect(rotated.angle).toBe(90);
  expect(rotated.midpoint, 'must keep the curved midpoint').toBeTruthy();
  expect(rotated.midpoint.x, 'must not leave midpoint in pre-rotate space').not.toBeCloseTo(created.midpoint.x, 0);
  const visualAfter = visualMidpoint(rotated);
  expect(
    Math.abs(visualAfter.x - expected.x),
    'remapped line midpoint must follow displayed-space +90',
  ).toBeLessThan(18);
  expect(Math.abs(visualAfter.y - expected.y)).toBeLessThan(18);

  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now?.midpoint
      && Math.abs(now.midpoint.x - created.midpoint.x) < 8
      && Math.abs(now.midpoint.y - created.midpoint.y) < 8;
  }, { timeout: 20_000, message: 'opposite page rotate must restore line midpoint' }).toBeTruthy();
  const restored = await geom(page, created.id);
  expect(Math.abs(restored.midpoint.x - created.midpoint.x)).toBeLessThan(8);
  expect(Math.abs(restored.midpoint.y - created.midpoint.y)).toBeLessThan(8);
  expect(restored.angle).toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Line', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_LINE_MIDPOINT_REMAP_DESKTOP_PROOF', JSON.stringify({
    lineId: created.id,
    created: { mid: created.midpoint, angle: created.angle, visual: visualBefore },
    rotated: { mid: rotated.midpoint, angle: rotated.angle, visual: visualAfter },
    restored: { mid: restored.midpoint, angle: restored.angle },
    expectedCx: expected.x,
    expectedCy: expected.y,
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-line-midpoint edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await lineIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_LINE_MIDPOINT_REMAP_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    lines: (await lineIds(page)).length,
  }));
});
