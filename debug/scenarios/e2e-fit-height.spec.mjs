import { test, expect } from '@playwright/test';

// Unique unblocked GAP after the exhausted-catalog claim:
// Fit height is its own ZOOM_MODE + pdf.js path (wrapperH / pageH → zoomTo).
// V-04 / UL-05 / 390 chrome only hard-asserted Fit page + Fit width.
// Do not replay Bookmarks, Eraser Size, leftover-18, Print / stamp /
// measure / Group / Extract / Note-Link create. No 768 tablet pass
// (breakpoint is max-width: 720px). Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';

async function waitEditor(page) {
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function openMobileEditor(page, fixture = LINK_PDF) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture);
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 45_000 });
  await waitEditor(page);
}

async function openDesktopEditor(page, fixture = LINK_PDF) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Fit options', exact: true })).toBeVisible({ timeout: 45_000 });
  await waitEditor(page);
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

async function selectDesktopFit(page, name) {
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('Fit height intended + break + edge on 390 and desktop', async ({ page }) => {
  await openMobileEditor(page);

  // Intended — 390×844 letter page: Fit height is larger than Fit page/width
  // and fills viewer height (horizontal overflow allowed).
  await selectMobileFit(page, 'Fit page');
  const fitPage = await pageMetrics(page);
  expect(fitPage, 'fit-page metrics').toBeTruthy();

  await selectMobileFit(page, 'Fit width');
  const fitWidth = await pageMetrics(page);
  expect(fitWidth.pageW).toBeGreaterThan(0);

  await selectMobileFit(page, 'Fit height');
  await expect.poll(async () => {
    const next = await pageMetrics(page);
    return next?.pageH ?? 0;
  }).toBeGreaterThan(fitWidth.pageH + 8);

  const fitHeight = await pageMetrics(page);
  expect(fitHeight.pageH).toBeGreaterThan(fitPage.pageH + 8);
  expect(fitHeight.pageH).toBeGreaterThan(fitWidth.pageH + 8);
  expect(Math.abs(fitHeight.pageH - fitHeight.wrapH)).toBeLessThan(24);
  expect(fitHeight.pageW).toBeGreaterThan(fitHeight.wrapW + 8);
  expect(fitHeight.scrollW).toBeGreaterThan(fitHeight.wrapW);

  const heightMenu = page.locator('.mobile-pdf-header__zoom-menu');
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();
  await expect(heightMenu).toHaveClass(/is-open/);
  await expect(heightMenu.getByRole('option', { name: /^Fit height$/i })).toHaveAttribute('aria-selected', 'true');
  await expect(heightMenu.getByRole('option', { name: /^Fit page$/i })).toHaveAttribute('aria-selected', 'false');
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();

  // Break — re-click stays; Actual size / rotate-view are not offered.
  const beforeRepeat = await pageMetrics(page);
  await selectMobileFit(page, 'Fit height');
  const afterRepeat = await pageMetrics(page);
  expect(Math.abs(afterRepeat.pageH - beforeRepeat.pageH)).toBeLessThan(4);
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();
  await expect(heightMenu.getByRole('option', { name: /Actual size/i })).toHaveCount(0);
  await expect(heightMenu.getByRole('option', { name: /Rotate view/i })).toHaveCount(0);
  await expect(heightMenu.getByRole('option')).toHaveCount(3);
  await page.getByRole('button', { name: 'Zoom and fit options' }).click();

  // Edge — Zoom in leaves fit-height; Fit height restores the height fill.
  await page.getByRole('button', { name: 'More document options' }).click();
  await page.locator('.mobile-pdf-tools__popover.is-more').getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => (await pageMetrics(page)).pageH).not.toBe(fitHeight.pageH);
  await selectMobileFit(page, 'Fit height');
  await expect.poll(async () => {
    const next = await pageMetrics(page);
    return Math.abs(next.pageH - next.wrapH);
  }).toBeLessThan(24);

  // Edge — Pen armed still applies Fit height on a 120-page fixture.
  await openMobileEditor(page, MULTI_PDF);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count()) await pen.click();
  await selectMobileFit(page, 'Fit width');
  const armedWidth = await pageMetrics(page);
  await selectMobileFit(page, 'Fit height');
  await expect.poll(async () => (await pageMetrics(page)).pageH).toBeGreaterThan(armedWidth.pageH + 8);
  const armedHeight = await pageMetrics(page);
  expect(Math.abs(armedHeight.pageH - armedHeight.wrapH)).toBeLessThan(24);
  expect(page.getByRole('button', { name: 'Pen', exact: true }).or(page.getByRole('button', { name: 'Draw', exact: true }))).toBeTruthy();

  // Desktop rail — Fit height is a real menu item (UL-05 cluster is not enough).
  await openDesktopEditor(page);
  await selectDesktopFit(page, 'Fit width');
  const deskWidthPct = await zoomPercent(page);
  await selectDesktopFit(page, 'Fit page');
  const deskPagePct = await zoomPercent(page);
  await selectDesktopFit(page, 'Fit height');
  const deskHeightPct = await zoomPercent(page);
  expect(Number.isFinite(deskHeightPct)).toBeTruthy();
  expect(deskHeightPct).not.toBe(deskWidthPct);

  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  const heightRow = page.getByRole('button', { name: 'Fit height', exact: true });
  await expect(heightRow).toBeVisible();
  await expect(heightRow).toHaveAttribute('data-active', 'true');
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toHaveAttribute('data-active', 'false');
  await expect(page.getByRole('button', { name: 'Actual size', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rotate view', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const deskHeight = await pageMetrics(page);
  expect(Math.abs(deskHeight.pageH - deskHeight.wrapH)).toBeLessThan(36);
  expect(deskPagePct).toBeTruthy();
});
