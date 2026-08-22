import { test, expect } from '@playwright/test';

// Unique unblocked GAP after Fit height:
// Desktop thumbnail *left-click* vs rail page-number input.
// V-06 "jump page 3" and UL-07 used commitPageInput. Other specs
// right-click thumbs (Duplicate/Rotate) or click then scrollIntoView.
// Do not replay Fit height, Bookmarks, leftover-18, zoom 100% as Actual
// size, two-page (forced continuous), Survey notes, callout knee.
// No 768 tablet pass. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';

async function waitEditor(page) {
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible({ timeout: 45_000 });
}

async function openDesktopEditor(page, fixture) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await waitEditor(page);
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  await expect(pages).toBeVisible({ timeout: 15_000 });
  const thumbs = page.locator('#chrome-left-host [data-page-number]');
  if ((await thumbs.count()) === 0) {
    await pages.click();
  }
  await expect.poll(async () => thumbs.count(), { timeout: 15_000 }).toBeGreaterThan(0);
}

function pageThumb(page, pageNumber) {
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
}

async function currentPageNumber(page) {
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) return Number.parseInt((await btn.innerText()).trim(), 10);
  return null;
}

async function typePageNumber(page, n) {
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) await btn.click();
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  await expect(input).toBeVisible();
  await input.fill(String(n));
  await input.press('Enter');
}

async function clickThumb(page, pageNumber) {
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 30_000 });
  await thumb.scrollIntoViewIfNeeded();
  await thumb.click();
}

async function userMarkCount(page) {
  return page.evaluate(() => {
    const getter = window.__phase35GetAnnotationById || window.__getAnnotationSnapshot;
    if (typeof window.__phase35ListUserAnnotationIds === 'function') {
      return window.__phase35ListUserAnnotationIds().length;
    }
    const nodes = document.querySelectorAll('[data-anno-id], [data-callout-id]');
    return nodes.length;
  });
}

test('desktop thumbnail click navigates; page input is a different control', async ({ page }) => {
  await openDesktopEditor(page, MULTI_PDF);
  await openPagesPanel(page);
  await expect.poll(async () => pageThumb(page, 3).count(), { timeout: 45_000 }).toBeGreaterThan(0);
  expect(await currentPageNumber(page)).toBe(1);

  // Intended — left-click thumb 3 jumps the viewer. Do not
  // scrollIntoView the PDF page; goToPage from the click must do that.
  await clickThumb(page, 3);
  await expect.poll(() => currentPageNumber(page)).toBe(3);
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="3"]')).toBeVisible({ timeout: 20_000 });
  const thumb3Box = await pageThumb(page, 3).boundingBox();
  expect(thumb3Box, 'thumb 3 still mounted').toBeTruthy();
  const selectedBorder = await pageThumb(page, 3).evaluate((el) => getComputedStyle(el).borderColor);
  expect(selectedBorder).toMatch(/216,\s*168,\s*78|#d8a84e/i);

  // Break — re-click stays on 3. There is no thumb 121 (input can type it).
  await clickThumb(page, 3);
  await expect.poll(() => currentPageNumber(page)).toBe(3);
  await expect(pageThumb(page, 121)).toHaveCount(0);

  // Break — page input 121 reverts; thumb path never offered 121.
  await typePageNumber(page, 121);
  await expect.poll(() => currentPageNumber(page)).toBe(3);

  // Contrast — type 8 via the input (UL-07 path), then thumb 3 wins.
  await typePageNumber(page, 8);
  await expect.poll(() => currentPageNumber(page)).toBe(8);
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="8"]')).toBeVisible({ timeout: 20_000 });
  await clickThumb(page, 3);
  await expect.poll(() => currentPageNumber(page)).toBe(3);
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="3"]')).toBeVisible();

  // Edge — 1-page fixture: only thumb 1; click stays 1; no thumb 2.
  await openDesktopEditor(page, LINK_PDF);
  await openPagesPanel(page);
  await expect.poll(async () => pageThumb(page, 1).count(), { timeout: 45_000 }).toBeGreaterThan(0);
  await clickThumb(page, 1);
  await expect.poll(() => currentPageNumber(page)).toBe(1);
  await expect(pageThumb(page, 2)).toHaveCount(0);
  await typePageNumber(page, 0);
  await expect.poll(() => currentPageNumber(page)).toBe(1);

  // Edge — Pen armed: thumb jump adds no mark.
  await openDesktopEditor(page, MULTI_PDF);
  await openPagesPanel(page);
  await expect.poll(async () => pageThumb(page, 5).count(), { timeout: 45_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count()) await pen.click();
  const beforeMarks = await userMarkCount(page);
  await clickThumb(page, 5);
  await expect.poll(() => currentPageNumber(page)).toBe(5);
  expect(await userMarkCount(page)).toBe(beforeMarks);
  expect(page.getByRole('button', { name: 'Pen', exact: true }).or(page.getByRole('button', { name: 'Draw', exact: true }))).toBeTruthy();
});
