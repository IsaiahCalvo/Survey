import { test, expect } from '@playwright/test';

// V-04 leftover: Zoom keyboard (Ctrl++ / Ctrl+-) + Fit width.
// Fit height is dedicated-proved. Fit width / Ctrl++ / Ctrl+- were
// sample-only (wave-remaining toolbar clicks + catalog-reconcile).
// Distinct from UL-06 zoom % field, W4-02 pinch, V-05 page-nav,
// leftover-18. Overlay lists Ctrl+ / Ctrl- / Ctrl+0; Ctrl+1 Fit width
// is live but unlisted. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';

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

async function pageMetrics(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const pageDiv = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${pageNum}"]`);
    const wrapper = document.querySelector('.survey-pdfjs-viewer');
    if (!pageDiv || !wrapper) return null;
    return {
      pageW: pageDiv.offsetWidth,
      pageH: pageDiv.offsetHeight,
      wrapW: wrapper.clientWidth,
      wrapH: wrapper.clientHeight,
      scrollW: wrapper.scrollWidth,
      scrollH: wrapper.scrollHeight,
    };
  }, pageNumber);
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

async function pressZoom(page, chord) {
  await blurInputs(page);
  await page.keyboard.press(chord);
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

async function focusPageInput(page) {
  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count() && await jump.isVisible().catch(() => false)) {
    await jump.click();
    const mobileInput = page.getByRole('textbox', { name: 'Page number', exact: true });
    await expect(mobileInput).toBeVisible();
    await mobileInput.click();
    return mobileInput;
  }
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  await expect(btn).toBeVisible();
  await btn.click();
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  await expect(input).toBeVisible();
  await input.click();
  return input;
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

async function expectWidthFill(page, message) {
  await expect.poll(async () => {
    const next = await pageMetrics(page);
    return next ? Math.abs(next.pageW - next.wrapW) : 999;
  }, { timeout: 20_000, message: message || 'Fit width must fill viewer width' }).toBeLessThan(48);
}

test('desktop zoom keyboard + Fit width intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  // Overlay lists Ctrl+ / Ctrl- / Ctrl+0. Ctrl+1 Fit width is live but unlisted.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists Zoom in').toMatch(/Zoom in/);
  expect(overlayText, 'overlay lists Zoom out').toMatch(/Zoom out/);
  expect(overlayText, 'overlay lists Fit page').toMatch(/Fit page/);
  expect(overlayText).toMatch(/Ctrl/);
  expect(overlayText, 'overlay lists Ctrl+0 Fit page, not Ctrl+1').not.toMatch(/Fit width/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  const startPct = await zoomPercent(page);
  expect(Number.isFinite(startPct), 'starting zoom %').toBeTruthy();

  // Intended — Ctrl+= zooms in (~1.25× step).
  await pressZoom(page, 'Control+=');
  let afterIn = null;
  await expect.poll(async () => {
    afterIn = await zoomPercent(page);
    return afterIn;
  }, { timeout: 20_000, message: 'Ctrl+= must raise zoom %' }).toBeGreaterThan(startPct);

  // Intended — Ctrl+- zooms out from that step.
  await pressZoom(page, 'Control+-');
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Ctrl+- must lower zoom % after Ctrl+=',
  }).toBeLessThan(afterIn);

  // Intended — Fit width menu fills viewer width and is not Fit page / Fit height.
  await selectDesktopFit(page, 'Fit page');
  const fitPagePct = await zoomPercent(page);
  const fitPage = await pageMetrics(page);
  await selectDesktopFit(page, 'Fit height');
  const fitHeightPct = await zoomPercent(page);
  await selectDesktopFit(page, 'Fit width');
  await expectWidthFill(page, 'Fit width menu must fill viewer width');
  const fitWidthPct = await zoomPercent(page);
  const fitWidth = await pageMetrics(page);
  expect(Number.isFinite(fitWidthPct), 'Fit width %').toBeTruthy();
  expect(fitWidthPct, 'Fit width % must exceed Fit page on a wide desktop').toBeGreaterThan(fitPagePct);
  expect(fitWidthPct, 'Fit width % must exceed Fit height on a wide desktop').toBeGreaterThan(fitHeightPct);
  expect(fitWidth.scrollH, 'Fit width may overflow vertically').toBeGreaterThan(fitWidth.wrapH - 1);
  expect(fitPage.pageW, 'Fit page baseline').toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toHaveAttribute('data-active', 'true');
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toHaveAttribute('data-active', 'false');
  await expect(page.getByRole('button', { name: 'Actual size', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Intended — Ctrl+1 is the unlisted Fit width chord (same % as the menu).
  await pressZoom(page, 'Control+=');
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Ctrl+= must leave Fit width',
  }).not.toBe(fitWidthPct);
  await pressZoom(page, 'Control+1');
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Ctrl+1 must restore Fit width %',
  }).toBe(fitWidthPct);
  await expectWidthFill(page, 'Ctrl+1 must fill viewer width');
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('Escape');

  // Break — re-click Fit width stays.
  const beforeRepeat = await pageMetrics(page);
  await selectDesktopFit(page, 'Fit width');
  const afterRepeat = await pageMetrics(page);
  expect(Math.abs(afterRepeat.pageW - beforeRepeat.pageW)).toBeLessThan(4);
  expect(await zoomPercent(page)).toBe(fitWidthPct);

  // Break — engine floor: extra Ctrl+- after the live min stays.
  await selectDesktopFit(page, 'Fit page');
  let floorPct = await zoomPercent(page);
  for (let i = 0; i < 8; i += 1) {
    await pressZoom(page, 'Control+-');
    const next = await zoomPercent(page);
    if (next === floorPct) break;
    floorPct = next;
  }
  await pressZoom(page, 'Control+-');
  await expect.poll(() => zoomPercent(page), {
    timeout: 10_000,
    message: 'Ctrl+- at the engine floor must no-op',
  }).toBe(floorPct);

  // Break — 4000% ceiling: Ctrl+= clamps.
  await setZoomPercent(page, 4000);
  await pressZoom(page, 'Control+=');
  await expect.poll(() => zoomPercent(page), {
    timeout: 10_000,
    message: 'Ctrl+= at 4000% must clamp',
  }).toBe(4000);

  // Break — focused zoom % INPUT does not steal Ctrl+= / Ctrl+1.
  await selectDesktopFit(page, 'Fit width');
  await expect.poll(() => zoomPercent(page)).toBe(fitWidthPct);
  const zoomInput = await focusZoomInput(page);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+1');
  expect(await zoomInput.inputValue(), 'zoom INPUT must stay at Fit width while focused').toMatch(new RegExp(`^${fitWidthPct}$`));
  await page.keyboard.press('Escape');
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 10_000,
    message: 'zoom INPUT chords must not steal',
  }).toBe(fitWidthPct);

  // Break — bare + / - without Ctrl do not zoom.
  const beforeBare = await zoomPercent(page);
  await pressZoom(page, '=');
  await pressZoom(page, '-');
  await pressZoom(page, '+');
  expect(await zoomPercent(page), 'bare +/- must not zoom').toBe(beforeBare);

  // Edge — isolation: page-1 rect survives Ctrl+=; zoom invents 0.
  await selectDesktopFit(page, 'Fit page');
  const rectId = await createRectOnPage(page, 1);
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  expect(page1Before).toContain(rectId);
  const beforeIso = await zoomPercent(page);
  await pressZoom(page, 'Control+=');
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(beforeIso);
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Ctrl+=').toEqual(page1Before);

  // Edge — Pen-armed Ctrl+= still zooms and invents 0 new marks.
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  const beforePenZoom = await zoomPercent(page);
  await pressZoom(page, 'Control+=');
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Pen-armed Ctrl+= must still zoom',
  }).toBeGreaterThan(beforePenZoom);
  expect(await userAnnotationIds(page, 1)).toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  // Edge — 120-page: Ctrl+= does not change the page number.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  const multiBefore = await zoomPercent(page);
  await pressZoom(page, 'Control+=');
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(multiBefore);
  expect(await currentPageNumber(page), 'Ctrl+= must not change page').toBe(1);
  await pressZoom(page, 'Control+1');
  await expectWidthFill(page, '120-page Ctrl+1 must fill width');
  expect(await currentPageNumber(page)).toBe(1);
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ZOOM_KEYBOARD_FIT_WIDTH_DESKTOP_PROOF', JSON.stringify({
    startPct,
    afterIn,
    fitPagePct,
    fitHeightPct,
    fitWidthPct,
    floorPct,
    overlayListsZoomIn: /Zoom in/.test(overlayText),
    overlayOmitsFitWidth: !/Fit width/.test(overlayText),
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 zoom keyboard + Fit width intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await selectMobileFit(page, 'Fit page');
  const fitPage = await pageMetrics(page);
  await selectMobileFit(page, 'Fit height');
  const fitHeight = await pageMetrics(page);
  await selectMobileFit(page, 'Fit width');
  await expectWidthFill(page, '390 Fit width menu must fill viewer width');
  const fitWidth = await pageMetrics(page);
  expect(fitWidth.pageW, '390 Fit width is the tight width fit').toBeLessThan(fitHeight.pageW);
  expect(Math.abs(fitWidth.pageW - fitPage.pageW), '390 Fit page collapses to Fit width').toBeLessThan(8);

  const widthMenu = page.locator('.mobile-pdf-header__zoom-menu');
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();
  await expect(widthMenu).toHaveClass(/is-open/);
  await expect(widthMenu.getByRole('option', { name: /^Fit width$/i })).toHaveAttribute('aria-selected', 'true');
  await expect(widthMenu.getByRole('option', { name: /^Fit height$/i })).toHaveAttribute('aria-selected', 'false');
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();

  // Intended — same window listener: Ctrl+= grows the page; Ctrl+- shrinks.
  const beforeIn = await pageMetrics(page);
  await pressZoom(page, 'Control+=');
  await expect.poll(async () => (await pageMetrics(page)).pageW, {
    timeout: 20_000,
    message: '390 Ctrl+= must grow page width',
  }).toBeGreaterThan(beforeIn.pageW + 8);
  const afterIn = await pageMetrics(page);
  await pressZoom(page, 'Control+-');
  await expect.poll(async () => (await pageMetrics(page)).pageW, {
    timeout: 20_000,
    message: '390 Ctrl+- must shrink page width',
  }).toBeLessThan(afterIn.pageW - 8);

  // Intended — Ctrl+1 restores Fit width fill.
  await pressZoom(page, 'Control+1');
  await expectWidthFill(page, '390 Ctrl+1 must fill viewer width');
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();
  await expect(widthMenu.getByRole('option', { name: /^Fit width$/i })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();

  // Break — first/floor Ctrl+- after Fit width stays near the width fill.
  const beforeFloor = await pageMetrics(page);
  await pressZoom(page, 'Control+-');
  const afterFloor = await pageMetrics(page);
  expect(Math.abs(afterFloor.pageW - beforeFloor.pageW), '390 Ctrl+- at Fit width / engine floor stays').toBeLessThan(8);

  // Break — focused page INPUT does not steal Ctrl+= / Ctrl+1.
  await selectMobileFit(page, 'Fit width');
  await expectWidthFill(page, '390 setup Fit width before INPUT steal');
  const pageInput = await focusPageInput(page);
  const stealBefore = await pageMetrics(page);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+1');
  expect(await pageInput.inputValue(), '390 page INPUT value must stay 1').toMatch(/^1$/);
  expect(await currentPageNumber(page)).toBe(1);
  await page.keyboard.press('Escape');
  await blurInputs(page);
  const stealAfter = await pageMetrics(page);
  expect(Math.abs(stealAfter.pageW - stealBefore.pageW), '390 page INPUT chords must not steal zoom').toBeLessThan(8);

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ZOOM_KEYBOARD_FIT_WIDTH_390_PROOF', JSON.stringify({
    fitPageW: fitPage.pageW,
    fitWidthW: fitWidth.pageW,
    fitHeightW: fitHeight.pageW,
    afterInW: afterIn.pageW,
    viewBox,
    fileId,
  }));
});
