import { test, expect } from '@playwright/test';

// Fit page / Fit width AFTER page CW (viewBox 0 0 792 612).
// Unrotated V-04 is e2e-fit-page / e2e-zoom-keyboard-fit-width
// (portrait 0 0 612 792) — do not replay Ctrl+0 / Ctrl+1 / Zoom %.
// After CW the page host is landscape. Fit must use the swapped
// 792×612 page, not leftover 612×792.
// Intended: Fit page uses swapped landscape page; Fit page ≠ Fit width.
// Break: leftover 612×792 Fit page % must not survive CW.
// Edge: file.id null; viewBox held.
// Named Save version / Restore stay leftover-18 X-01 (lease + file.id).
// Do not stamp file.id. Do not replay remappers / Select-text / Search /
// thumbnails / form widgets / links / bookmarks.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page))) break;
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
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
      landscape: pageDiv.offsetWidth > pageDiv.offsetHeight + 8,
    };
  }, pageNumber);
}

async function selectDesktopFit(page, name) {
  await blurInputs(page);
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('desktop Fit page / Fit width after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  expect(await userAnnotationIds(page), 'fresh editor invents 0 user annotations').toEqual([]);

  await selectDesktopFit(page, 'Fit page');
  let leftoverFitPagePct = null;
  await expect.poll(async () => {
    leftoverFitPagePct = await zoomPercent(page);
    return Number.isFinite(leftoverFitPagePct) ? leftoverFitPagePct : null;
  }, { timeout: 20_000, message: 'leftover portrait Fit page %' }).toBeTruthy();
  const leftoverFitPage = await pageMetrics(page);
  expect(leftoverFitPage.landscape, 'before CW host is portrait').toBe(false);

  await selectDesktopFit(page, 'Fit width');
  let leftoverFitWidthPct = null;
  await expect.poll(async () => {
    leftoverFitWidthPct = await zoomPercent(page);
    return Number.isFinite(leftoverFitWidthPct) && leftoverFitWidthPct !== leftoverFitPagePct
      ? leftoverFitWidthPct
      : null;
  }, { timeout: 20_000, message: 'leftover portrait Fit width must leave Fit page' }).toBeTruthy();

  await rotatePage(page, 1, 'cw');
  await dismissChrome(page);
  await expect.poll(async () => pageViewBox(page), {
    timeout: 20_000,
    message: 'page rotate must keep swapped viewBox',
  }).toBe('0 0 792 612');
  expect(await userAnnotationIds(page), 'empty CW invents 0 annotations').toEqual([]);

  await selectDesktopFit(page, 'Fit page');
  let afterFitPage = null;
  let afterFitPagePct = null;
  await expect.poll(async () => {
    afterFitPage = await pageMetrics(page);
    afterFitPagePct = await zoomPercent(page);
    return !!(
      afterFitPage?.landscape
      && Number.isFinite(afterFitPagePct)
      && Math.abs(afterFitPagePct - leftoverFitPagePct) > 4
    );
  }, {
    timeout: 30_000,
    message: 'Fit page after CW must use the swapped 792×612 page, not leftover 612×792',
  }).toBeTruthy();

  expect(afterFitPage.landscape, 'Fit page host must be landscape, not leftover portrait').toBe(true);
  expect(afterFitPagePct, 'Fit page must leave leftover 612×792 %').not.toBe(leftoverFitPagePct);
  expect(Math.abs(afterFitPagePct - leftoverFitPagePct), 'Fit page must leave leftover portrait scale').toBeGreaterThan(4);
  expect(afterFitPage.pageW, 'Fit page width stays inside the wrapper').toBeLessThanOrEqual(afterFitPage.wrapW + 48);
  expect(afterFitPage.pageH, 'Fit page height stays inside the wrapper').toBeLessThanOrEqual(afterFitPage.wrapH + 48);

  await selectDesktopFit(page, 'Fit width');
  let afterFitWidth = null;
  let afterFitWidthPct = null;
  await expect.poll(async () => {
    afterFitWidth = await pageMetrics(page);
    afterFitWidthPct = await zoomPercent(page);
    return !!(
      afterFitWidth?.landscape
      && Number.isFinite(afterFitWidthPct)
      && Math.abs(afterFitWidthPct - afterFitPagePct) > 4
    );
  }, {
    timeout: 30_000,
    message: 'Fit page ≠ Fit width on landscape host',
  }).toBeTruthy();

  expect(afterFitWidth.landscape, 'Fit width host must stay landscape, not leftover portrait').toBe(true);
  expect(afterFitWidthPct, 'Fit width must leave leftover 612×792 %').not.toBe(leftoverFitWidthPct);
  expect(afterFitWidthPct, 'Fit page ≠ Fit width on landscape host').not.toBe(afterFitPagePct);
  expect(Math.abs(afterFitWidthPct - afterFitPagePct), 'Fit page ≠ Fit width on landscape host').toBeGreaterThan(4);
  expect(Math.abs(afterFitWidth.pageW - afterFitWidth.wrapW), 'Fit width must fill the landscape host width').toBeLessThan(48);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'viewBox held after Fit page / Fit width').toBe('0 0 792 612');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  expect(await userAnnotationIds(page), 'Fit after CW invents 0 annotations').toEqual([]);
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Fit page', exact: true }).count(), 'hubPreview Fit page must be 0').toBe(0);

  console.log('PAGE_ROTATE_FIT_DESKTOP_PROOF', JSON.stringify({
    viewBox,
    fileId: null,
    leftover: { fitPagePct: leftoverFitPagePct, fitWidthPct: leftoverFitWidthPct },
    after: {
      fitPagePct: afterFitPagePct,
      fitWidthPct: afterFitWidthPct,
      fitPage: { w: afterFitPage.pageW, h: afterFitPage.pageH },
      fitWidth: { w: afterFitWidth.pageW, h: afterFitWidth.pageH },
    },
  }));
});

test('390 Fit page after page CW edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userAnnotationIds(page), '390 fresh editor invents 0').toEqual([]);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_FIT_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
  }));
});
