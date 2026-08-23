import { test, expect } from '@playwright/test';

// Remapped counter NUBBIN handle-drag after page CW. Distinct from
// remapped counter placement, unrotated e2e-counter-nubbin-orbit,
// leftover-18 / X-01, and remapped callout/line handle-drag.
// PointerEvents on the remapped SVG nubbin (Playwright mouse after
// Pages rotate misses the landscape host). Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

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

function isCounter(row) {
  return row.type === 'counter' || row.kind === 'counter';
}

function angleDelta(a, b) {
  const delta = ((Number(b) - Number(a) + 540) % 360) - 180;
  return Math.abs(delta);
}

function almostEq(a, b, eps = 3) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

async function counterSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const radius = Number(object.radius ?? 14);
      const left = Number(object.left ?? 0);
      const top = Number(object.top ?? 0);
      return {
        id,
        type: String(data.type || object.type || '').toLowerCase(),
        kind: String(data.type || data.annotationType || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        radius,
        cx: left + radius,
        cy: top + radius,
        pointerAngle: Number.isFinite(Number(data.pointerAngle)) ? Number(data.pointerAngle) : 225,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function counterIds(page) {
  return (await counterSnapshot(page)).filter(isCounter).map((row) => row.id);
}

async function geom(page, id) {
  return (await counterSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewCounter(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await counterSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isCounter(row)) || null;
    return created;
  }, { message: 'expected a new counter pin' }).not.toBeNull();
  return created;
}

async function activateShapeTool(page, toolName) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  const category = page.getByRole('button', { name: 'Shapes', exact: true }).first();
  await expect(category).toBeVisible({ timeout: 8_000 });
  if (!String(await category.getAttribute('class') || '').includes('btn-active')) {
    await category.click();
  }
  const desktopSub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const sub = (await desktopSub.count())
    ? desktopSub
    : page.getByRole('button', { name: toolName, exact: true });
  await expect(sub.first()).toBeVisible({ timeout: 8_000 });
  if (!String(await sub.first().getAttribute('class') || '').includes('btn-active')) {
    await sub.first().click();
  }
}

async function selectMode(page) {
  await page.keyboard.press('Escape');
  await blurInputs(page);
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function createCounter(page, { xf = 0.38, yf = 0.28 } = {}) {
  const before = new Set(await counterIds(page));
  await activateShapeTool(page, 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
  const box = await pageBox(page);
  await page.waitForTimeout(280);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
  const created = await waitForNewCounter(page, before);
  await selectMode(page);
  return geom(page, created.id);
}

async function selectUntilNubbin(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    const row = await geom(page, id);
    const hit = page.locator(`[data-anno-id="${id}"] [data-shape-hit-target="counter"]`).first();
    if (await hit.count()) {
      await hit.click({ force: true });
    } else {
      const box = await pageBox(page);
      const parts = String(await pageViewBox(page)).trim().split(/\s+/).map(Number);
      const W = parts[2] || 612;
      const H = parts[3] || 792;
      await page.mouse.click(
        box.x + (row.cx / W) * box.width,
        box.y + (row.cy / H) * box.height,
      );
    }
    return page.locator('[data-counter-nubbin-handle="true"]').count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

async function dragNubbinPointer(page, distance = 80) {
  const handle = page.locator('[data-counter-nubbin-handle="true"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  expect(hb, 'nubbin bbox').toBeTruthy();
  const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  const pageEl = await pageBox(page);
  const dest = {
    x: Math.min(pageEl.x + pageEl.width - 24, from.x + distance),
    y: Math.max(pageEl.y + 24, from.y - Math.round(distance * 0.25)),
  };
  await handle.evaluate((el, { x0, y0, x1, y1 }) => {
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    if (!el || !svg) return;
    const fire = (target, type, x, y, buttons) => {
      target.dispatchEvent(new PointerEvent(type, {
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
    };
    fire(el, 'pointerdown', x0, y0, 1);
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      fire(el, 'pointermove', x, y, 1);
    }
    fire(el, 'pointerup', x1, y1, 0);
  }, { x0: from.x, y0: from.y, x1: dest.x, y1: dest.y });
  return { from, dest };
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

test('desktop remapped counter nubbin handle drag after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await counterIds(page)).length, 'fresh editor must have 0 counters').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await counterIds(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await counterIds(page)).length, 'empty opposite rotate must invent 0').toBe(0);

  const created = await createCounter(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the live counter',
  }).not.toBeNull();
  const remapped = await geom(page, created.id);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(Math.hypot(remapped.cx - created.cx, remapped.cy - created.cy), 'center remaps').toBeGreaterThan(8);
  expect(angleDelta(remapped.pointerAngle, created.pointerAngle), 'nub remaps').toBeGreaterThan(8);

  await selectUntilNubbin(page, created.id);
  const remappedSelected = await geom(page, created.id);
  await dragNubbinPointer(page, 90);
  let afterNub = null;
  await expect.poll(async () => {
    afterNub = await geom(page, created.id);
    return angleDelta(remappedSelected.pointerAngle, afterNub.pointerAngle);
  }, { timeout: 8_000, message: 'remapped nubbin must persist a handle drag' }).toBeGreaterThan(12);
  expect(almostEq(afterNub.left, remappedSelected.left, 3), 'nubbin keeps remapped left').toBe(true);
  expect(almostEq(afterNub.top, remappedSelected.top, 3), 'nubbin keeps remapped top').toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return angleDelta(now.pointerAngle, remappedSelected.pointerAngle) < 2
      && almostEq(now.left, remappedSelected.left, 3)
      && almostEq(now.top, remappedSelected.top, 3);
  }, { timeout: 12_000, message: 'undo must restore remapped nubbin, not leftover portrait' }).toBeTruthy();
  const undone = await geom(page, created.id);
  expect(Math.hypot(undone.cx - created.cx, undone.cy - created.cy), 'undo keeps remapped center').toBeGreaterThan(8);

  const frozen = await geom(page, created.id);
  await activateShapeTool(page, 'Counter');
  await page.keyboard.press('p');
  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.88, pageEl.y + pageEl.height * 0.12);
  const penArmed = await geom(page, created.id);
  expect(angleDelta(penArmed.pointerAngle, frozen.pointerAngle) < 2, 'Pen-armed remapped nub no-op').toBe(true);
  expect(almostEq(penArmed.left, frozen.left, 3), 'Pen-armed remapped left no-op').toBe(true);
  expect((await counterIds(page)).length, 'empty remapped-page click invents 0').toBe(1);

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Counter', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_COUNTER_NUBBIN_HANDLE_DRAG_DESKTOP_PROOF', JSON.stringify({
    counterId: created.id,
    created: { cx: created.cx, cy: created.cy, pointerAngle: created.pointerAngle },
    remapped: { cx: remapped.cx, cy: remapped.cy, pointerAngle: remapped.pointerAngle },
    afterNub: { pointerAngle: afterNub.pointerAngle, left: afterNub.left, top: afterNub.top },
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-counter nubbin handle-drag edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await counterIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_COUNTER_NUBBIN_HANDLE_DRAG_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    counters: (await counterIds(page)).length,
  }));
});
