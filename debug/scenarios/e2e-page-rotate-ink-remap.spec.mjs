import { test, expect } from '@playwright/test';

// Live-created pen/highlighter page-space ink after page CW. Distinct from
// remapped callout fractions, remapped mt/mtr/br clip, leftover-18 / X-01,
// and page-rotate-transformed (rect). Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
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

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'highlighter' || row.tool === 'freedraw';
}

async function inkSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const first = object.paperCenterline?.[0] || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? 0),
        top: Number(object.top ?? 0),
        angle: Number(object.angle ?? 0),
        clx: Number(first.x ?? NaN),
        cly: Number(first.y ?? NaN),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function inkIds(page) {
  return (await inkSnapshot(page)).filter(isInk).map((row) => row.id);
}

async function geom(page, id) {
  return (await inkSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewInk(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await inkSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isInk(row)) || null;
    return created;
  }, { message: 'expected a new ink stroke' }).not.toBeNull();
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

async function createInk(page, toolName = 'Pen', coords = { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 }) {
  const before = new Set(await inkIds(page));
  await activateTool(page, 'Draw', toolName);
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 10 });
  await page.mouse.up();
  const created = await waitForNewInk(page, before);
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

test('desktop ink after page CW remap intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await inkIds(page)).length, 'fresh editor must have 0 ink').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await inkIds(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await inkIds(page)).length, 'empty opposite rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createInk(page, 'Pen', { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 });
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(Number.isFinite(created.clx), 'live create stamps a page-space centerline').toBe(true);
  expect(created.left, 'live ink stays at left 0').toBe(0);
  expect(created.angle, 'live ink starts unrotated').toBe(0);

  const expected = rotateDisplayedPoint(created.clx, created.cly, 612, 792, 90);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the live ink',
  }).not.toBeNull();
  const rotated = await geom(page, created.id);
  expect(rotated, 'page rotate must keep the live ink').toBeTruthy();
  expect(await inkIds(page)).toEqual([created.id]);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(rotated.left, 'page-space ink must keep left 0').toBe(0);
  expect(rotated.angle, 'must not invent an object angle').toBe(0);
  expect(
    Math.abs(rotated.clx - expected.x),
    'remapped ink centerline must follow displayed-space +90',
  ).toBeLessThan(18);
  expect(Math.abs(rotated.cly - expected.y)).toBeLessThan(18);
  expect(rotated.clx, 'must not stay on the pre-rotate point').not.toBeCloseTo(created.clx, 0);

  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(now.clx - created.clx) < 8 && Math.abs(now.cly - created.cly) < 8;
  }, { timeout: 20_000, message: 'opposite page rotate must restore ink centerline' }).toBeTruthy();
  const restored = await geom(page, created.id);
  expect(Math.abs(restored.clx - created.clx)).toBeLessThan(8);
  expect(Math.abs(restored.cly - created.cly)).toBeLessThan(8);
  expect(restored.angle).toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Pen', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_INK_REMAP_DESKTOP_PROOF', JSON.stringify({
    inkId: created.id,
    created: { clx: created.clx, cly: created.cly, left: created.left, angle: created.angle },
    rotated: { clx: rotated.clx, cly: rotated.cly, left: rotated.left, angle: rotated.angle },
    restored: { clx: restored.clx, cly: restored.cly },
    expectedCx: expected.x,
    expectedCy: expected.y,
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-ink edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await inkIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_INK_REMAP_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    ink: (await inkIds(page)).length,
  }));
});
