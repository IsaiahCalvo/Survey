import { test, expect } from '@playwright/test';

// V-04 leftover: Fit page (min of both axes) + Ctrl+0.
// Fit height and Fit width already have dedicated intended+break+edge.
// Fit page was only a baseline contrast / UL-04 "50% then Ctrl+0 left 50%"
// sample. Distinct from leftover-18, UL-06 zoom %, W4-02 pinch,
// V-05 page-nav. Text-markup highlight is compile-hidden
// (showTextMarkupHighlightMenu = false). Tab reorder needs two PDF tabs
// (not invented on ?testPdf=). Theme chrome is absent. Do not stamp file.id.

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

async function expectPageFit(page, message) {
  await expect.poll(async () => {
    const next = await pageMetrics(page);
    if (!next) return 999;
    const widthSlack = next.pageW - next.wrapW;
    const heightSlack = next.pageH - next.wrapH;
    return Math.max(widthSlack, heightSlack);
  }, { timeout: 20_000, message: message || 'Fit page must fit both axes' }).toBeLessThan(48);
}

test('desktop Fit page intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists Fit page').toMatch(/Fit page/);
  expect(overlayText).toMatch(/Ctrl/);
  expect(overlayText, 'overlay lists Ctrl+0 Fit page, not Ctrl+1').not.toMatch(/Fit width/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — Fit width overflows height; Fit page is the min of both axes.
  await selectDesktopFit(page, 'Fit width');
  const fitWidthPct = await zoomPercent(page);
  const fitWidth = await pageMetrics(page);
  expect(Number.isFinite(fitWidthPct), 'Fit width %').toBeTruthy();
  expect(fitWidth.scrollH, 'Fit width overflows vertically').toBeGreaterThan(fitWidth.wrapH - 1);

  await selectDesktopFit(page, 'Fit page');
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Fit page must leave Fit width',
  }).toBeLessThan(fitWidthPct);
  await expectPageFit(page, 'Fit page must fit both axes');
  const fitPagePct = await zoomPercent(page);
  const fitPage = await pageMetrics(page);
  expect(fitPagePct, 'Fit page % must be below Fit width on a wide desktop').toBeLessThan(fitWidthPct);
  expect(fitPage.pageW, 'Fit page width stays inside the wrapper').toBeLessThanOrEqual(fitPage.wrapW + 48);
  expect(fitPage.pageH, 'Fit page height stays inside the wrapper').toBeLessThanOrEqual(fitPage.wrapH + 48);

  await selectDesktopFit(page, 'Fit height');
  const fitHeightPct = await zoomPercent(page);
  await selectDesktopFit(page, 'Fit page');
  await expect.poll(() => zoomPercent(page)).toBe(fitPagePct);

  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toHaveAttribute('data-active', 'true');
  await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toHaveAttribute('data-active', 'false');
  await expect(page.getByRole('button', { name: 'Actual size', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rotate view', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Intended — Ctrl+0 is the listed Fit page chord.
  await selectDesktopFit(page, 'Fit width');
  await expect.poll(() => zoomPercent(page)).toBe(fitWidthPct);
  await pressZoom(page, 'Control+0');
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Ctrl+0 must restore Fit page %',
  }).toBe(fitPagePct);
  await expectPageFit(page, 'Ctrl+0 must fit both axes');
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('Escape');

  // Break — re-click Fit page stays.
  const beforeRepeat = await pageMetrics(page);
  await selectDesktopFit(page, 'Fit page');
  const afterRepeat = await pageMetrics(page);
  expect(Math.abs(afterRepeat.pageW - beforeRepeat.pageW), 're-click Fit page stays').toBeLessThan(4);
  expect(await zoomPercent(page)).toBe(fitPagePct);

  // Break — focused zoom % INPUT does not steal Ctrl+0.
  await selectDesktopFit(page, 'Fit width');
  await expect.poll(() => zoomPercent(page)).toBe(fitWidthPct);
  const zoomInput = await focusZoomInput(page);
  await page.keyboard.press('Control+0');
  expect(await zoomInput.inputValue(), 'zoom INPUT Ctrl+0 must not steal').toMatch(new RegExp(`^${fitWidthPct}$`));
  await page.keyboard.press('Escape');
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 10_000,
    message: 'zoom INPUT Ctrl+0 must not steal',
  }).toBe(fitWidthPct);

  // Break — bare 0 without Ctrl does not change zoom.
  const beforeBare = await zoomPercent(page);
  await pressZoom(page, '0');
  expect(await zoomPercent(page), 'bare 0 must not change zoom').toBe(beforeBare);

  // Edge — typed 200% then Ctrl+0 restores Fit page.
  await setZoomPercent(page, 200);
  await pressZoom(page, 'Control+0');
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'typed 200% then Ctrl+0 must restore Fit page',
  }).toBe(fitPagePct);
  await expectPageFit(page, 'typed 200% then Ctrl+0 must fit both axes');

  // Edge — isolation: page-1 rect survives Ctrl+0; zoom invents 0.
  await selectDesktopFit(page, 'Fit width');
  const rectId = await createRectOnPage(page, 1);
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  expect(page1Before).toContain(rectId);
  await pressZoom(page, 'Control+0');
  await expect.poll(() => zoomPercent(page)).toBe(fitPagePct);
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Ctrl+0').toEqual(page1Before);

  // Edge — Pen-armed Ctrl+0 still fits the page and invents 0 new marks.
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await selectDesktopFit(page, 'Fit width');
  await pressZoom(page, 'Control+0');
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Pen-armed Ctrl+0 must still fit page',
  }).toBe(fitPagePct);
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

  // Edge — 120-page: Ctrl+0 does not change the page number.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  await selectDesktopFit(page, 'Fit width');
  const multiWidth = await zoomPercent(page);
  await pressZoom(page, 'Control+0');
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: '120-page Ctrl+0 must leave Fit width',
  }).toBeLessThan(multiWidth);
  expect(await currentPageNumber(page), 'Ctrl+0 must not change page').toBe(1);
  await expectPageFit(page, '120-page Ctrl+0 must fit both axes');
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('FIT_PAGE_DESKTOP_PROOF', JSON.stringify({
    fitPagePct,
    fitWidthPct,
    fitHeightPct,
    overlayListsFitPage: /Fit page/.test(overlayText),
    overlayOmitsFitWidth: !/Fit width/.test(overlayText),
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 Fit page intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await selectMobileFit(page, 'Fit height');
  const fitHeight = await pageMetrics(page);
  await selectMobileFit(page, 'Fit width');
  const fitWidth = await pageMetrics(page);
  await selectMobileFit(page, 'Fit page');
  const fitPage = await pageMetrics(page);
  expect(fitPage.pageW, '390 Fit page collapses to Fit width').toBeGreaterThan(0);
  expect(Math.abs(fitPage.pageW - fitWidth.pageW), '390 Fit page collapses to Fit width').toBeLessThan(8);
  expect(fitHeight.pageH, '390 Fit height must exceed Fit page').toBeGreaterThan(fitPage.pageH + 8);

  const pageMenu = page.locator('.mobile-pdf-header__zoom-menu');
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();
  await expect(pageMenu).toHaveClass(/is-open/);
  await expect(pageMenu.getByRole('option', { name: /^Fit page$/i })).toHaveAttribute('aria-selected', 'true');
  await expect(pageMenu.getByRole('option', { name: /^Fit height$/i })).toHaveAttribute('aria-selected', 'false');
  await expect(pageMenu.getByRole('option', { name: /Actual size/i })).toHaveCount(0);
  await expect(pageMenu.getByRole('option', { name: /Rotate view/i })).toHaveCount(0);
  await expect(pageMenu.getByRole('option')).toHaveCount(3);
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();

  // Intended — Ctrl+0 restores Fit page after Fit height (the larger axis).
  await selectMobileFit(page, 'Fit height');
  await expect.poll(async () => (await pageMetrics(page)).pageH, {
    timeout: 20_000,
    message: '390 Fit height setup',
  }).toBeGreaterThan(fitPage.pageH + 8);
  await pressZoom(page, 'Control+0');
  await expect.poll(async () => (await pageMetrics(page)).pageW, {
    timeout: 20_000,
    message: '390 Ctrl+0 must restore Fit page width',
  }).toBeLessThan(fitHeight.pageW - 8);
  const afterCtrl0 = await pageMetrics(page);
  expect(Math.abs(afterCtrl0.pageW - fitPage.pageW), '390 Ctrl+0 matches Fit page').toBeLessThan(8);

  // Break — re-click Fit page stays.
  const beforeRepeat = await pageMetrics(page);
  await selectMobileFit(page, 'Fit page');
  const afterRepeat = await pageMetrics(page);
  expect(Math.abs(afterRepeat.pageW - beforeRepeat.pageW), '390 re-click Fit page stays').toBeLessThan(4);

  // Break — focused page INPUT does not steal Ctrl+0.
  await selectMobileFit(page, 'Fit height');
  const pageInput = await focusPageInput(page);
  const stealBefore = await pageMetrics(page);
  await page.keyboard.press('Control+0');
  expect(await pageInput.inputValue(), '390 page INPUT value must stay 1').toMatch(/^1$/);
  expect(await currentPageNumber(page)).toBe(1);
  await page.keyboard.press('Escape');
  await blurInputs(page);
  const stealAfter = await pageMetrics(page);
  expect(Math.abs(stealAfter.pageW - stealBefore.pageW), '390 page INPUT Ctrl+0 must not steal zoom').toBeLessThan(8);

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('FIT_PAGE_390_PROOF', JSON.stringify({
    fitPageW: fitPage.pageW,
    fitWidthW: fitWidth.pageW,
    fitHeightH: fitHeight.pageH,
    afterCtrl0W: afterCtrl0.pageW,
    viewBox,
    fileId,
  }));
});
