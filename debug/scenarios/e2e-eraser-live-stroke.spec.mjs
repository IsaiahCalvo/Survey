import { test, expect } from '@playwright/test';

// D-03 / D-04 leftover: live Partial / Full eraser stroke then commit.
// Prior D-03/D-04 dedicated type chrome (Partial vs Full / caret / E vs
// Shift+E) and every Size. This pass asserts the in-drag mask-clone /
// live-preview canvas, pointerup commit, zoomGeneration mid-stroke flush
// (commit, not discard), and pointercancel commit (user already saw it).
// Distinct from leftover-18, Size catalog, type dropdown, D-01/D-02
// freehand preview. Line single-click mtr is 0 (p1/p2/midpoint only —
// already receipted; skipped). No create-poly tool — poly transform
// skipped. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('eraserMode');
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

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  const hubCopy = page.getByText('No documents yet');
  if (await hubCopy.isVisible().catch(() => false) || await pageCoveredByHub(page)) {
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
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  return raw || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

function toolButtons(page, name) {
  return page.locator(
    `button.btn-icon[aria-label="${name}"], button.mobile-pdf-tools__button[aria-label="${name}"]`,
  );
}

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    return button;
  }
  if (name === 'Select') {
    const mode = page.getByRole('button', { name: 'Selection mode', exact: true }).first();
    if (await mode.isVisible().catch(() => false)) {
      await mode.click();
      return mode;
    }
    await page.keyboard.press('v');
    return mode;
  }
  await expect(buttons.first(), `visible ${name}`).toBeVisible();
  await buttons.first().click({ force: true });
  return buttons.first();
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.getByRole('button', { name: toolName, exact: true });
  const visibleSub = async () => {
    const count = await sub.count();
    for (let i = 0; i < count; i += 1) {
      if (await sub.nth(i).isVisible().catch(() => false)) return sub.nth(i);
    }
    return null;
  };
  if (!(await visibleSub())) {
    await clickVisible(page, categoryName);
  }
  const target = (await visibleSub()) || sub.first();
  await expect(target).toBeVisible();
  const pressed = await target.getAttribute('aria-pressed');
  const active = String(await target.getAttribute('class') || '').includes('is-active')
    || String(await target.getAttribute('class') || '').includes('btn-active');
  if (pressed !== 'true' && !active) await target.click();
}

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle';
}

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen';
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        tool: String(object.data?.tool || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userOrder(page) {
  return (await userAnnotationSnapshot(page)).map((row) => row.id);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function dragOnPage(page, { pageNumber = 1, x0, y0, x1, y1 }) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function createRect(page, coords) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
}

async function createPenStroke(page, { yFraction = 0.62, x0 = 0.18, x1 = 0.78 } = {}) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Draw', 'Pen');
  const width = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  if (await width.isVisible().catch(() => false)) {
    await width.fill('8');
    await width.press('Enter');
  }
  await dragOnPage(page, { x0, y0: yFraction, x1, y1: yFraction });
  return waitForNewUserAnnotation(page, before, isInk);
}

async function userInkMetric(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => {
        const id = group.getAttribute('data-anno-id');
        const object = window.__phase35GetAnnotationById?.(id) || {};
        if (!id || object.isPdfImported === true) return null;
        const type = String(object.type || '').toLowerCase();
        const tool = String(object.data?.tool || object.tool || '').toLowerCase();
        if (type !== 'path' && tool !== 'pen') return null;
        const d = group.querySelector('path')?.getAttribute('d') || '';
        return { id, dLen: d.length };
      })
      .filter(Boolean);
    return {
      ids: rows.map((row) => row.id),
      dLen: rows.reduce((sum, row) => sum + row.dLen, 0),
      count: rows.length,
    };
  });
}

async function liveErasePreviewInfo(page) {
  return page.evaluate(() => {
    const clone = document.querySelector('[data-eraser-mask-clone="1"]');
    const carve = document.querySelector('[data-eraser-carve-chunk]');
    const canvas = document.querySelector('[data-eraser-live-preview="1"]');
    const canvasOn = Boolean(canvas && canvas.style.display !== 'none' && canvas.width > 0);
    return {
      clone: Boolean(clone),
      carve: Boolean(carve),
      canvasOn,
      visible: Boolean(clone || carve || canvasOn),
    };
  });
}

async function setEraserType(page, label) {
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  await expect(typeBtn).toBeVisible({ timeout: 8_000 });
  const current = (await typeBtn.innerText()).replace(/\s+/g, ' ').trim();
  if (current.includes(label)) return;
  await typeBtn.click();
  const pop = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(pop).toBeVisible({ timeout: 5_000 });
  await pop.getByRole('option', { name: label, exact: true }).click();
  await expect(pop).toHaveCount(0);
  await expect.poll(async () => (
    (await typeBtn.innerText()).replace(/\s+/g, ' ').trim()
  ), { message: `Eraser type must read ${label}` }).toContain(label);
}

async function setMobileEraserMode(page, label) {
  const modeBtn = page.getByRole('button', { name: /Eraser mode:/ });
  await expect(modeBtn).toBeVisible({ timeout: 8_000 });
  const current = await modeBtn.getAttribute('aria-label') || '';
  if (current.includes(label)) return;
  await modeBtn.click();
  const list = page.getByRole('listbox', { name: 'Eraser mode' });
  await expect(list).toBeVisible({ timeout: 5_000 });
  await list.getByRole('option', { name: label, exact: true }).click();
  await expect(list).toHaveCount(0);
}

async function activateEraser(page, { mode = 'partial' } = {}) {
  const wrapper = page.locator('[data-diag-eraser-wrapper="1"]');
  if (!(await wrapper.isVisible().catch(() => false))) {
    const named = [
      page.getByRole('button', { name: 'Eraser', exact: true }),
      page.getByRole('button', { name: 'Partial erase', exact: true }),
      page.getByRole('button', { name: 'Full stroke erase', exact: true }),
    ];
    let armed = false;
    for (const buttons of named) {
      const count = await buttons.count();
      for (let i = 0; i < count; i += 1) {
        if (await buttons.nth(i).isVisible().catch(() => false)) {
          await buttons.nth(i).click();
          armed = true;
          break;
        }
      }
      if (armed) break;
    }
    if (!armed) await activateTool(page, 'Draw', 'Eraser');
  }
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  if (await typeBtn.isVisible().catch(() => false)) {
    await setEraserType(page, mode === 'entire' ? 'Full stroke erase' : 'Partial erase');
  } else {
    await setMobileEraserMode(page, mode === 'entire' ? 'Full Stroke' : 'Partial Erase');
  }
  await expect(wrapper).toBeVisible({ timeout: 8_000 });
}

async function setEraserSize(page, raw) {
  const size = page.getByRole('textbox', { name: 'Size', exact: true });
  if (!(await size.isVisible().catch(() => false))) return;
  await size.fill(String(raw));
  await size.press('Tab');
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
}

async function sampleInkClientPoints(page, id) {
  return page.evaluate((annotationId) => {
    const object = window.__phase35GetAnnotationById?.(annotationId);
    const wrapper = document.querySelector('[data-diag-eraser-wrapper="1"]');
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    const rect = wrapper?.getBoundingClientRect();
    const viewBox = svg?.viewBox?.baseVal;
    if (!object || !rect || !viewBox?.width || !viewBox?.height) return [];
    const toClient = (x, y) => ({
      x: rect.left + (x / viewBox.width) * rect.width,
      y: rect.top + (y / viewBox.height) * rect.height,
    });
    const samples = [];
    for (const cmd of object.path || []) {
      const x = Number(cmd[cmd.length - 2]);
      const y = Number(cmd[cmd.length - 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) samples.push(toClient(x, y));
    }
    if (samples.length < 2) return [];
    const i0 = Math.floor((samples.length - 1) * 0.30);
    const i1 = Math.max(i0 + 1, Math.floor((samples.length - 1) * 0.70));
    return samples.slice(i0, i1 + 1);
  }, id);
}

async function startEraseAcrossId(page, id) {
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible({ timeout: 8_000 });
  const points = await sampleInkClientPoints(page, id);
  expect(points.length, `ink samples for ${id}`).toBeGreaterThanOrEqual(2);
  const mid = Math.max(1, Math.floor(points.length / 2));
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1, mid + 1)) {
    await page.mouse.move(point.x, point.y, { steps: 3 });
  }
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'live eraser preview must paint before pointerup',
    timeout: 5_000,
  }).toBe(true);
  return { points, mid };
}

async function finishEraseAcrossId(page, started) {
  for (const point of started.points.slice(started.mid + 1)) {
    await page.mouse.move(point.x, point.y, { steps: 3 });
  }
  await page.mouse.up();
}

async function annotationBox(page, id) {
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  return box;
}

async function startEraseInside(page, box) {
  const x = box.x + box.width / 2;
  const inset = Math.max(6, Math.min(12, box.height / 4));
  await page.mouse.move(x, box.y + inset);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2, { steps: 6 });
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'live full-stroke preview must paint before pointerup',
    timeout: 5_000,
  }).toBe(true);
  return { x, endY: box.y + box.height - inset };
}

function mobileEraserMode(page) {
  return page.getByRole('button', { name: /Eraser mode:/ });
}

test('desktop eraser live stroke intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const rectA = await createRect(page, { x0: 0.18, y0: 0.20, x1: 0.36, y1: 0.34 });
  const rectB = await createRect(page, { x0: 0.60, y0: 0.20, x1: 0.78, y1: 0.34 });
  const inkA = await createPenStroke(page, { yFraction: 0.56, x0: 0.16, x1: 0.82 });
  const inkB = await createPenStroke(page, { yFraction: 0.68, x0: 0.16, x1: 0.82 });
  expect(rectA.id).toBeTruthy();
  expect(rectB.id).toBeTruthy();
  expect(inkA.id).toBeTruthy();
  expect(inkB.id).toBeTruthy();

  await activateEraser(page, { mode: 'partial' });
  await setEraserSize(page, 24);
  await dismissChrome(page);

  const emptyBefore = await userOrder(page);
  expect((await liveErasePreviewInfo(page)).visible, 'empty page live eraser preview 0').toBe(false);
  const empty = await pageBox(page);
  await page.mouse.move(empty.x + empty.width * 0.08, empty.y + empty.height * 0.88);
  await page.mouse.down();
  await page.mouse.move(empty.x + empty.width * 0.14, empty.y + empty.height * 0.92, { steps: 4 });
  expect((await liveErasePreviewInfo(page)).visible, 'empty swipe must not paint eraser preview').toBe(false);
  await page.mouse.up();
  expect(await userOrder(page), 'empty swipe invents 0').toEqual(emptyBefore);

  // Intended — Partial: mask-clone / live-preview during drag, bite on pointerup.
  const inkBefore = await userInkMetric(page);
  const beforePartial = await userOrder(page);
  const partialDrag = await startEraseAcrossId(page, inkA.id);
  expect(await userOrder(page), 'Partial live drag must not commit yet').toEqual(beforePartial);
  const partialLive = await liveErasePreviewInfo(page);
  expect(partialLive.visible, 'Partial live preview must paint before pointerup').toBe(true);
  expect(partialLive.clone || partialLive.carve || partialLive.canvasOn, 'Partial preview uses mask-clone or canvas').toBe(true);
  await finishEraseAcrossId(page, partialDrag);
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'Partial pointerup must drop the preview',
  }).toBe(false);
  await expect.poll(async () => {
    const after = await userInkMetric(page);
    return after.dLen !== inkBefore.dLen || after.count !== inkBefore.count || after.ids.join('|') !== inkBefore.ids.join('|');
  }, { message: 'Partial pointerup must bite ink' }).toBe(true);
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === rectA.id), 'Partial bite must leave rect A').toBe(true);
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === rectB.id), 'Partial bite must isolate rect B').toBe(true);
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === inkB.id), 'Partial bite must isolate ink B').toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const after = await userInkMetric(page);
    return after.dLen === inkBefore.dLen && after.ids.join('|') === inkBefore.ids.join('|');
  }, { message: 'undo must restore Partial ink bite' }).toBe(true);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => {
    const after = await userInkMetric(page);
    return after.dLen !== inkBefore.dLen || after.ids.join('|') !== inkBefore.ids.join('|');
  }, { message: 'redo must restore Partial ink bite' }).toBe(true);

  // Break — pointercancel mid-stroke COMMITS (user already saw the live carve).
  const cancelBefore = await userInkMetric(page);
  await startEraseAcrossId(page, inkB.id);
  await page.locator('[data-diag-eraser-wrapper="1"]').dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
    cancelable: true,
  });
  await page.mouse.up().catch(() => {});
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'pointercancel must drop the preview',
    timeout: 5_000,
  }).toBe(false);
  await expect.poll(async () => {
    const after = await userInkMetric(page);
    return after.dLen !== cancelBefore.dLen || after.count !== cancelBefore.count || after.ids.join('|') !== cancelBefore.ids.join('|');
  }, { message: 'pointercancel must commit the live erase (not discard)' }).toBe(true);

  // Break — zoom mid-stroke flushes via zoomGeneration (commit, not drop).
  const zoomInk = await createPenStroke(page, { yFraction: 0.80, x0: 0.16, x1: 0.82 });
  await activateEraser(page, { mode: 'partial' });
  await setEraserSize(page, 24);
  await dismissChrome(page);
  const zoomBefore = await userInkMetric(page);
  await startEraseAcrossId(page, zoomInk.id);
  expect((await liveErasePreviewInfo(page)).visible, 'zoom mid-stroke starts with live preview').toBe(true);
  await blurInputs(page);
  await page.keyboard.press('Control+=');
  await expect.poll(async () => {
    const after = await userInkMetric(page);
    return after.dLen !== zoomBefore.dLen || after.count !== zoomBefore.count || after.ids.join('|') !== zoomBefore.ids.join('|');
  }, { message: 'zoom mid-stroke must flush the erase commit' }).toBe(true);
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'zoom mid-stroke must drop the preview',
  }).toBe(false);
  await page.mouse.up().catch(() => {});
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === rectA.id), 'zoom flush must isolate rect A').toBe(true);

  // Intended — Full stroke: live preview then delete A, isolate B.
  await activateEraser(page, { mode: 'entire' });
  await setEraserSize(page, 40);
  await dismissChrome(page);
  const beforeEntire = await userOrder(page);
  const aBox = await annotationBox(page, rectA.id);
  const entireDrag = await startEraseInside(page, aBox);
  expect(await userOrder(page), 'Full-stroke live drag must not commit yet').toEqual(beforeEntire);
  expect((await liveErasePreviewInfo(page)).visible, 'Full-stroke live preview must paint before pointerup').toBe(true);
  await page.mouse.move(entireDrag.x, entireDrag.endY, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'Full-stroke pointerup must drop the preview',
  }).toBe(false);
  await expect.poll(async () => (
    (await userAnnotationSnapshot(page)).some((row) => row.id === rectA.id)
  ), { message: 'Full-stroke pointerup must delete rect A' }).toBe(false);
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === rectB.id), 'Full stroke isolates rect B').toBe(true);

  // Break — Pen / Select hide the eraser wrapper so no live preview.
  await activateTool(page, 'Draw', 'Pen');
  await expect(page.locator('[data-diag-eraser-wrapper="1"]'), 'Pen hides eraser wrapper').toHaveCount(0);
  expect((await liveErasePreviewInfo(page)).visible, 'Pen must not paint eraser preview').toBe(false);
  await clickVisible(page, 'Select');
  await expect(page.locator('[data-diag-eraser-wrapper="1"]'), 'Select hides eraser wrapper').toHaveCount(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-diag-eraser-wrapper="1"]').count()).toBe(0);
  expect((await liveErasePreviewInfo(page)).visible).toBe(false);

  console.log('ERASER_LIVE_STROKE_DESKTOP_PROOF', JSON.stringify({
    rectA: rectA.id,
    rectB: rectB.id,
    inkA: inkA.id,
    inkB: inkB.id,
    zoomInk: zoomInk.id,
    viewBox,
    fileId: null,
  }));
});

test('390 eraser live stroke intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const pagesToggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await pagesToggle.isVisible().catch(() => false)) {
    await pagesToggle.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }

  const rect = await createRect(page, { x0: 0.22, y0: 0.22, x1: 0.52, y1: 0.38 });
  const ink = await createPenStroke(page, { yFraction: 0.58, x0: 0.16, x1: 0.82 });
  await activateEraser(page, { mode: 'partial' });
  await setEraserSize(page, 24);

  const inkBefore = await userInkMetric(page);
  const beforePartial = await userOrder(page);
  const partialDrag = await startEraseAcrossId(page, ink.id);
  expect(await userOrder(page), '390 Partial live drag must not commit yet').toEqual(beforePartial);
  expect((await liveErasePreviewInfo(page)).visible, '390 Partial live preview must paint before pointerup').toBe(true);
  await finishEraseAcrossId(page, partialDrag);
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: '390 Partial pointerup must drop the preview',
  }).toBe(false);
  await expect.poll(async () => {
    const after = await userInkMetric(page);
    return after.dLen !== inkBefore.dLen || after.count !== inkBefore.count || after.ids.join('|') !== inkBefore.ids.join('|');
  }, { message: '390 Partial pointerup must bite ink' }).toBe(true);
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === rect.id), '390 Partial must leave the rect').toBe(true);

  const mode = mobileEraserMode(page);
  await expect(mode).toBeVisible({ timeout: 8_000 });
  await mode.click();
  const list = page.getByRole('listbox', { name: 'Eraser mode' });
  await expect(list).toBeVisible({ timeout: 5_000 });
  await list.getByRole('option', { name: 'Full Stroke', exact: true }).click();
  await expect(list).toHaveCount(0);
  await setEraserSize(page, 40);

  const beforeEntire = await userOrder(page);
  const rBox = await annotationBox(page, rect.id);
  const entireDrag = await startEraseInside(page, rBox);
  expect(await userOrder(page), '390 Full-stroke live drag must not commit yet').toEqual(beforeEntire);
  expect((await liveErasePreviewInfo(page)).visible, '390 Full-stroke live preview must paint before pointerup').toBe(true);
  await page.mouse.move(entireDrag.x, entireDrag.endY, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: '390 Full-stroke pointerup must drop the preview',
  }).toBe(false);
  await expect.poll(async () => (
    (await userAnnotationSnapshot(page)).some((row) => row.id === rect.id)
  ), { message: '390 Full-stroke pointerup must delete the rect' }).toBe(false);

  await activateTool(page, 'Draw', 'Pen');
  await expect(page.locator('[data-diag-eraser-wrapper="1"]'), '390 Pen hides eraser wrapper').toHaveCount(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ERASER_LIVE_STROKE_390_PROOF', JSON.stringify({
    rect: rect.id,
    ink: ink.id,
    viewBox,
    fileId: null,
  }));
});
