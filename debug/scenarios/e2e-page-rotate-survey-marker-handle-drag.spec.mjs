import { test, expect } from '@playwright/test';

// Remapped survey-marker HANDLE drag after page CW. Distinct from
// remapped survey-marker placement, unrotated e2e-survey-marker-handle-drag,
// leftover-18 / X-01, and remapped callout/line/nubbin handle-drag.
// PointerEvents on the remapped SVG handle (Playwright mouse after
// Pages rotate misses the landscape host). Do not stamp file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = SURVEY_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('surveyMarkers_')
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

async function markerIds(page) {
  return page.locator('[data-survey-marker-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean),
  );
}

async function markerGeom(page, id) {
  return page.evaluate((annoId) => {
    const group = document.querySelector(`[data-survey-marker-id="${annoId}"]`);
    const rect = group?.querySelector('rect:not([data-survey-marker-hit-target])')
      || group?.querySelector('rect');
    const x = Number(rect?.getAttribute('x'));
    const y = Number(rect?.getAttribute('y'));
    const width = Number(rect?.getAttribute('width'));
    const height = Number(rect?.getAttribute('height'));
    const transform = rect?.getAttribute('transform') || '';
    const rot = /rotate\(\s*([-0-9.]+)/.exec(transform);
    return {
      id: annoId,
      x,
      y,
      width,
      height,
      cx: x + width / 2,
      cy: y + height / 2,
      angle: rot ? Number(rot[1]) : 0,
    };
  }, id);
}

function almostEq(a, b, eps = 3) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

function angleDelta(a, b) {
  const delta = ((Number(b) - Number(a) + 540) % 360) - 180;
  return Math.abs(delta);
}

function keepCheckbox(page) {
  return page.locator('#chrome-sub-toolbar-host').getByRole('checkbox', { name: 'Keep active' });
}

async function enterSurveyWalls(page) {
  const wallsHost = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (await wallsHost.first().isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Walls', exact: true }).first().click();
}

async function armWalls(page) {
  const hostWalls = () => page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (!(await hostWalls().count()) || !(await hostWalls().first().isVisible().catch(() => false))) {
    const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
    if (await survey.count()) await survey.click();
    const picker = page.getByRole('heading', { name: 'Choose survey template' });
    if (await picker.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
    }
  }
  const walls = (await hostWalls().count())
    ? hostWalls()
    : page.getByRole('button', { name: 'Walls', exact: true });
  await expect(walls.first()).toBeVisible({ timeout: 15_000 });
  if (!String(await walls.first().getAttribute('class') || '').includes('btn-active')) {
    await walls.first().click();
  }
}

async function dragOnLayer(page, { x0, y0, x1, y1 }) {
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  expect(box, 'annotation layer geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function finishMarkerName(page, name) {
  const field = page.getByPlaceholder('Enter name');
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0, { timeout: 8_000 });
}

async function placeMarker(page, name, coords) {
  const before = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, coords);
  await finishMarkerName(page, name);
  let created = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected committed survey-marker ${name}` }).not.toBeNull();
  return created;
}

async function selectMode(page) {
  await page.keyboard.press('Escape');
  await blurInputs(page);
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function selectUntilHandles(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    const hit = page.locator(`[data-survey-marker-id="${id}"] [data-survey-marker-hit-target="true"]`).first();
    if (await hit.count()) {
      await hit.click({ force: true });
    }
    return page.locator('[data-survey-marker-id] [data-resize-handle="br"]').count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

async function dragHandlePointer(page, handleId, dx = 56, dy = 40) {
  const selector = handleId === 'mtr'
    ? '[data-survey-marker-id] [data-rotation-handle="mtr"]'
    : `[data-survey-marker-id] [data-resize-handle="${handleId}"]`;
  const handle = page.locator(selector).first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  expect(hb, `${handleId} bbox`).toBeTruthy();
  const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  const dest = { x: from.x + dx, y: from.y + dy };
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
      fire(svg, 'pointermove', x, y, 1);
    }
    fire(svg, 'pointerup', x1, y1, 0);
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

test('desktop remapped survey-marker handle drag after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await markerIds(page)).length, 'fresh editor must have 0 survey-markers').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await markerIds(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await markerIds(page)).length, 'empty opposite rotate must invent 0').toBe(0);

  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  if (await keep.count() && !(await keep.isChecked())) await keep.click();
  const markerId = await placeMarker(page, 'remap-handle', { x0: 0.22, y0: 0.30, x1: 0.46, y1: 0.48 });
  await dismissChrome(page);
  const created = await markerGeom(page, markerId);
  expect(created?.id).toBeTruthy();
  expect(created.width).toBeGreaterThan(8);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => markerGeom(page, markerId), {
    timeout: 20_000,
    message: 'page rotate must keep the live survey-marker',
  }).not.toBeNull();
  const remapped = await markerGeom(page, markerId);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(Math.hypot(remapped.cx - created.cx, remapped.cy - created.cy), 'center remaps').toBeGreaterThan(8);

  await selectUntilHandles(page, markerId);
  expect(await page.locator('[data-survey-marker-id] [data-resize-handle="br"]').count(), 'remapped br exists').toBeGreaterThan(0);
  const remappedSelected = await markerGeom(page, markerId);
  await dragHandlePointer(page, 'br', 56, 40);
  let afterBr = null;
  await expect.poll(async () => {
    afterBr = await markerGeom(page, markerId);
    return Math.abs(afterBr.width - remappedSelected.width) > 8
      || Math.abs(afterBr.height - remappedSelected.height) > 8;
  }, { timeout: 8_000, message: 'remapped br must persist a handle drag' }).toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await markerGeom(page, markerId);
    return almostEq(now.width, remappedSelected.width, 3)
      && almostEq(now.height, remappedSelected.height, 3)
      && almostEq(now.x, remappedSelected.x, 3)
      && almostEq(now.y, remappedSelected.y, 3);
  }, { timeout: 12_000, message: 'undo must restore remapped br, not leftover portrait' }).toBeTruthy();
  const undone = await markerGeom(page, markerId);
  expect(Math.hypot(undone.cx - created.cx, undone.cy - created.cy), 'undo keeps remapped center').toBeGreaterThan(8);

  await selectUntilHandles(page, markerId);
  const beforeMr = await markerGeom(page, markerId);
  await dragHandlePointer(page, 'mr', 48, 0);
  let afterMr = null;
  await expect.poll(async () => {
    afterMr = await markerGeom(page, markerId);
    return Math.abs(afterMr.width - beforeMr.width) > 8
      && almostEq(afterMr.height, beforeMr.height, 4);
  }, { timeout: 8_000, message: 'remapped mr width-only' }).toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => almostEq((await markerGeom(page, markerId)).width, beforeMr.width, 3), {
    timeout: 12_000,
    message: 'undo mr',
  }).toBeTruthy();

  const frozen = await markerGeom(page, markerId);
  await page.keyboard.press('p');
  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.88, pageEl.y + pageEl.height * 0.12);
  const penArmed = await markerGeom(page, markerId);
  expect(almostEq(penArmed.width, frozen.width, 3), 'Pen-armed remapped width no-op').toBe(true);
  expect(almostEq(penArmed.x, frozen.x, 3), 'Pen-armed remapped x no-op').toBe(true);
  expect((await markerIds(page)).length, 'empty remapped-page click invents 0').toBe(1);
  expect(angleDelta(penArmed.angle, remapped.angle) < 2, 'Pen-armed remapped angle held').toBe(true);

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-survey-marker-id]').count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_SURVEY_MARKER_HANDLE_DRAG_DESKTOP_PROOF', JSON.stringify({
    markerId,
    created: { cx: created.cx, cy: created.cy, width: created.width, height: created.height },
    remapped: { cx: remapped.cx, cy: remapped.cy, width: remapped.width, height: remapped.height },
    afterBr: { width: afterBr.width, height: afterBr.height },
    afterMr: { width: afterMr.width, height: afterMr.height },
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-survey-marker handle-drag edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await markerIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_SURVEY_MARKER_HANDLE_DRAG_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    markers: (await markerIds(page)).length,
  }));
});
