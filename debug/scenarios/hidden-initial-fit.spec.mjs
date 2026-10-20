import { test, expect } from '@playwright/test';

// Synthetic local PDFs; bundled headless browsers only, no auth or cloud writes.
for (const delayedFirstPage of [false, true]) test(`hidden first load fits the first visible viewport${delayedFirstPage ? ' after delayed first-page metadata' : ''}`, async ({ page }) => {
  await page.route('**/*', route => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(route.request().url()) ? route.continue() : route.abort());
  if (delayedFirstPage) await page.route('**/src/components/PdfjsViewerContainer.jsx*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const firstPageRead = 'const firstPage = await pdf.getPage(1);';
    expect(source).toContain(firstPageRead);
    // Add latency only at the real first-page read, after the tab was opened.
    // The hidden document must finish its own load while its sibling stays active.
    await route.fulfill({ response, body: source.replace(firstPageRead, 'if (scrollerRef.current?.clientWidth === 0) await new Promise(resolve => { window.releaseHiddenPdfRead = resolve; }); ' + firstPageRead) });
  });
  await page.goto('/debug/scenarios/warm-tabs-harness.html?nativeWarmTabsQa=1');
  const viewer = page.locator('.survey-pdfjs-viewer:visible');
  const firstPage = page.locator('.survey-pdfjs-page-div:visible').first();
  await expect(firstPage).toBeVisible();
  const dismiss = page.getByRole('button', { name: 'Continue without an account', exact: true });
  if (await dismiss.count()) await dismiss.click();
  await expect(page.locator('[data-app-tab][data-tab-active="true"]')).toContainText('B.pdf');
  await expect.poll(() => page.evaluate(() => window.warmReads)).toEqual({ A: 1, B: 1 });
  if (delayedFirstPage) await page.evaluate(() => window.releaseHiddenPdfRead());
  await expect.poll(() => page.locator('.survey-pdfjs-viewer').first().locator('.survey-pdfjs-page-div').count()).toBe(8);
  expect(await page.locator('.survey-pdfjs-viewer').first().evaluate(el => [el.clientWidth, el.clientHeight])).toEqual([0, 0]);
  const visiblePageWidth = await firstPage.evaluate(el => el.offsetWidth);
  expect(visiblePageWidth).toBeGreaterThan(400);

  // No fit or manual zoom before this first activation of the hidden document.
  await page.getByRole('button', { name: 'A.pdf', exact: true }).click();
  await expect.poll(() => firstPage.evaluate(el => el.offsetWidth)).toBeGreaterThan(visiblePageWidth - 2);
  expect(Math.abs(await firstPage.evaluate(el => el.offsetWidth) - visiblePageWidth)).toBeLessThan(2);
  expect(await viewer.evaluate(el => el.clientWidth)).toBeGreaterThan(400);

  // A completed fit is not replayed over the user's later manual zoom or warm nodes.
  await page.getByRole('button', { name: 'Edit zoom percentage', exact: true }).click();
  await page.getByRole('textbox', { name: 'Zoom percentage', exact: true }).fill('150');
  await page.getByRole('textbox', { name: 'Zoom percentage', exact: true }).press('Enter');
  await expect.poll(() => firstPage.evaluate(el => el.offsetWidth)).toBe(900);
  const reads = await page.evaluate(() => ({ ...window.warmReads }));
  await viewer.evaluate(el => { window.hiddenFitWarmNode = el; window.hiddenFitWarmPage = el.querySelector('.survey-pdfjs-page-div'); });
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: 'B.pdf', exact: true }).click();
    await page.getByRole('button', { name: 'A.pdf', exact: true }).click();
    await expect.poll(() => firstPage.evaluate(el => el.offsetWidth)).toBe(900);
  }
  expect(await page.evaluate(() => ({ ...window.warmReads }))).toEqual(reads);
  expect(await viewer.evaluate(el => el === window.hiddenFitWarmNode && el.querySelector('.survey-pdfjs-page-div') === window.hiddenFitWarmPage)).toBe(true);
});
