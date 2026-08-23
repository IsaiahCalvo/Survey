import { test, expect } from '@playwright/test';

// V-04 leftover: Ctrl+wheel cursor-anchored zoom (engine onWheel).
// Fit page / Fit width / Fit height / Ctrl++/− / UL-06 Zoom % / W4-02 pinch
// already have dedicated intended+break+edge. Wave2 only sampled
// "Fit width → ctrl-wheel → Fit page". Distinct from leftover-18.
// PDFViewer.performPdfjsCursorWheelZoom is intentionally dead
// (`if (true) return false`) — PdfjsViewerContainer owns the gesture.
// Do not stamp file.id. Theme / tab reorder / text-markup highlight skipped.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';
const WHEEL_SETTLE_MS = 400;

async function openEditor(page, { width = 1400, height = 900, url = LINK_PDF } = {}) {
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

async function zoomPercent(page) {
  const label = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (await label.count()) {
    return Number.parseInt((await label.innerText()).trim(), 10);
  }
  const input = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  if (await input.count()) {
    return Number.parseInt(await input.inputValue(), 10);
  }
  return null;
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function currentPageNumber(page) {
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) return Number.parseInt((await btn.innerText()).trim(), 10);
  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count()) {
    const raw = (await jump.innerText()).trim();
    return Number.parseInt(raw, 10);
  }
  const mobileInput = page.getByRole('textbox', { name: 'Page number', exact: true });
  if (await mobileInput.count()) return Number.parseInt(await mobileInput.inputValue(), 10);
  return null;
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }, pageNumber);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
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
  await page.getByRole('button', { name: categoryName, exact: true }).first().click();
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function createRectOnPage(page, pageNumber = 1) {
  const before = new Set(await userAnnotationIds(page, pageNumber));
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.46, { steps: 8 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page, pageNumber);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected a new rect on page ${pageNumber}` }).not.toBeNull();
  return created;
}

async function selectDesktopFit(page, name) {
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function selectMobileFit(page, name) {
  const chevron = page.getByRole('button', { name: 'Zoom and fit options' });
  const menu = page.locator('.mobile-pdf-header__zoom-menu');
  if (!(await menu.evaluate((el) => el.classList.contains('is-open')).catch(() => false))) {
    await chevron.click();
  }
  await expect(menu).toHaveClass(/is-open/);
  await menu.getByRole('option', { name: new RegExp(`^${name}$`, 'i') }).click();
  await expect(menu).not.toHaveClass(/is-open/);
}

async function focusZoomInput(page) {
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (!(await zoomBtn.count())) return null;
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  return zoomInput;
}

async function setZoomPercent(page, value) {
  const zoomInput = await focusZoomInput(page);
  expect(zoomInput, 'zoom % field').toBeTruthy();
  await zoomInput.fill(String(value));
  await zoomInput.press('Enter');
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: `zoom % must become ${value}`,
  }).toBe(value);
}

async function dispatchScrollerWheel(page, { deltaY, ctrlKey = true, notches = 1, target = 'scroller' } = {}) {
  await page.evaluate(({ dy, ctrl, n, where }) => {
    const el = where === 'input'
      ? document.querySelector('input[aria-label="Zoom percentage"]')
      : document.querySelector('.survey-pdfjs-viewer');
    if (!el) throw new Error(`${where} wheel target missing`);
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    for (let i = 0; i < n; i += 1) {
      el.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: ctrl,
        metaKey: false,
        deltaY: dy,
        deltaMode: 0,
        clientX,
        clientY,
      }));
    }
  }, { dy: deltaY, ctrl: ctrlKey, n: notches, where: target });
  await page.waitForTimeout(WHEEL_SETTLE_MS);
}

function livePreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] polyline.freehand-creation-preview');
}

test('desktop Ctrl+wheel zoom intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists keyboard zoom, not Ctrl+wheel').toMatch(/Zoom in/);
  expect(overlayText).toMatch(/Ctrl/);
  expect(overlayText, 'overlay omits wheel / pinch').not.toMatch(/wheel|pinch|trackpad/i);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  await setZoomPercent(page, 200);
  const startPct = await zoomPercent(page);
  expect(startPct).toBe(200);

  // Intended — Ctrl+wheel in is a ~1.1 notch, not the Ctrl+= 1.25 step.
  await dispatchScrollerWheel(page, { deltaY: -100, notches: 1 });
  const afterIn = await zoomPercent(page);
  expect(afterIn, 'Ctrl+wheel in must raise zoom').toBeGreaterThan(startPct);
  expect(afterIn, 'one notch must stay below the Ctrl+= 250 step').toBeLessThan(250);
  expect(afterIn, 'one notch is ~220 not a 25-point keyboard step').toBeGreaterThanOrEqual(210);
  expect(afterIn).toBeLessThanOrEqual(230);

  // Intended — Ctrl+wheel out reverses toward the start.
  await dispatchScrollerWheel(page, { deltaY: 100, notches: 1 });
  await expect.poll(() => zoomPercent(page), {
    timeout: 10_000,
    message: 'Ctrl+wheel out must reverse the notch',
  }).toBe(startPct);

  // Intended — leaves Fit page / Fit width (manual cursor zoom).
  await selectDesktopFit(page, 'Fit page');
  const fitPagePct = await zoomPercent(page);
  await dispatchScrollerWheel(page, { deltaY: -100, notches: 3 });
  const afterFitPage = await zoomPercent(page);
  expect(afterFitPage, 'Ctrl+wheel must leave Fit page').toBeGreaterThan(fitPagePct);
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toHaveAttribute('data-active', 'false');
  await expect(page.getByRole('button', { name: 'Actual size', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rotate view', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Break — bare wheel (no Ctrl) does not zoom.
  await setZoomPercent(page, 200);
  await dispatchScrollerWheel(page, { deltaY: -100, ctrlKey: false, notches: 2 });
  expect(await zoomPercent(page), 'bare wheel must not zoom').toBe(200);

  // Break — Ctrl+wheel on the Zoom % INPUT (not the scroller) does not steal.
  const zoomInput = await focusZoomInput(page);
  await dispatchScrollerWheel(page, { deltaY: -100, target: 'input' });
  expect(await zoomInput.inputValue(), 'zoom INPUT Ctrl+wheel must not steal').toMatch(/^200$/);
  await page.keyboard.press('Escape');
  await blurInputs(page);
  expect(await zoomPercent(page), 'zoom INPUT Ctrl+wheel must not steal').toBe(200);

  // Edge — isolation: page-1 rect survives; wheel invents 0.
  // Ceiling clamp is Node-proved (getWheelZoomScale(40) === 40); typing 4000
  // via fill is a UL-06 field leftover, not this gesture.
  const rectId = await createRectOnPage(page, 1);
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  expect(page1Before).toContain(rectId);
  await dispatchScrollerWheel(page, { deltaY: -100, notches: 1 });
  expect(await zoomPercent(page), 'isolation wheel must still zoom').toBeGreaterThan(200);
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Ctrl+wheel').toEqual(page1Before);

  // Edge — Pen-armed Ctrl+wheel still zooms and invents 0 new marks.
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  const beforePenZoom = await zoomPercent(page);
  await dispatchScrollerWheel(page, { deltaY: 100, notches: 1 });
  expect(await zoomPercent(page), 'Pen-armed Ctrl+wheel must still zoom').toBeLessThan(beforePenZoom);
  expect(await userAnnotationIds(page, 1)).toEqual(marksBeforePen);

  // Edge — mid-stroke Ctrl+wheel flushes via zoomGeneration (commit, not drop).
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  const beforeFlush = new Set(await userAnnotationIds(page, 1));
  const box = await pageBox(page, 1);
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.48, { steps: 8 });
  await expect(livePreview(page), 'live freehand preview must paint before wheel').toBeVisible({ timeout: 5_000 });
  expect(await userAnnotationIds(page, 1), 'wheel mid-stroke starts uncommitted').toEqual([...beforeFlush]);
  await dispatchScrollerWheel(page, { deltaY: -100, notches: 1 });
  await expect(livePreview(page), 'wheel mid-stroke must drop the preview').toHaveCount(0);
  let flushed = null;
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page, 1);
    flushed = ids.find((id) => !beforeFlush.has(id)) || null;
    return flushed;
  }, { message: 'zoomGeneration wheel must flush the in-flight ink' }).not.toBeNull();
  await page.mouse.up();
  const afterFlushUp = await userAnnotationIds(page, 1);
  expect(afterFlushUp.filter((id) => !beforeFlush.has(id)).length, 'wheel flush + pointerup must not double-commit').toBe(1);
  expect(afterFlushUp, 'flushed ink must survive pointerup').toContain(flushed);
  expect(afterFlushUp, 'flush must isolate the earlier rect').toContain(rectId);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('.survey-pdfjs-viewer').count()).toBe(0);

  // Edge — 120-page: Ctrl+wheel does not change the page number.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  await setZoomPercent(page, 200);
  await dispatchScrollerWheel(page, { deltaY: -100, notches: 2 });
  expect(await zoomPercent(page), '120-page Ctrl+wheel must still zoom').toBeGreaterThan(200);
  expect(await currentPageNumber(page), 'Ctrl+wheel must not change page').toBe(1);
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('CTRL_WHEEL_DESKTOP_PROOF', JSON.stringify({
    startPct,
    afterIn,
    fitPagePct,
    afterFitPage,
    rectId,
    flushed,
    viewBox,
    fileId,
  }));
});

test('390 Ctrl+wheel zoom intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await selectMobileFit(page, 'Fit page');
  const fitPage = await pageBox(page, 1);
  await dispatchScrollerWheel(page, { deltaY: -100, notches: 3 });
  const afterIn = await pageBox(page, 1);
  expect(afterIn.width, '390 Ctrl+wheel in must grow the page').toBeGreaterThan(fitPage.width + 8);

  // Break — bare wheel does not zoom.
  const beforeBare = await pageBox(page, 1);
  await dispatchScrollerWheel(page, { deltaY: -100, ctrlKey: false, notches: 2 });
  const afterBare = await pageBox(page, 1);
  expect(Math.abs(afterBare.width - beforeBare.width), '390 bare wheel must not zoom').toBeLessThan(8);

  // Break — re-Fit page after wheel restores the width-fill.
  await selectMobileFit(page, 'Fit page');
  const restored = await pageBox(page, 1);
  expect(Math.abs(restored.width - fitPage.width), '390 Fit page after wheel restores').toBeLessThan(8);

  const pageMenu = page.locator('.mobile-pdf-header__zoom-menu');
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();
  await expect(pageMenu).toHaveClass(/is-open/);
  await expect(pageMenu.getByRole('option', { name: /Actual size/i })).toHaveCount(0);
  await expect(pageMenu.getByRole('option', { name: /Rotate view/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('CTRL_WHEEL_390_PROOF', JSON.stringify({
    fitPageW: fitPage.width,
    afterInW: afterIn.width,
    restoredW: restored.width,
    viewBox,
    fileId,
  }));
});
