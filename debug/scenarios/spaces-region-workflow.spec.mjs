import { test, expect } from '@playwright/test';

// Local mock PDF only; bundled headless Chromium, no owner browser or real auth.
test.use({ viewport: { width: 1440, height: 900 }, video: 'off' });
const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
async function setup(page, context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await page.goto('/?testPdf=order-pages.pdf');
  await page.waitForFunction(() => window.__fix19SurveyRegionHarness && window.__fix20CollabHarness && window.__pdfjsViewerPerf);
  await page.evaluate(() => window.__fix19SurveyRegionHarness.setup());
  await button(page, 'Spaces').click();
  await button(page, 'Open Fix19 Space A').click();
}

test('Spaces edit mode, visibility animation, copy, move and scoped Undo', async ({ page, context }) => {
  await setup(page, context);
  await expect(page.locator('.spaces-panel .space-card__delete')).toHaveCount(0);
  await expect(button(page, 'Edit Spaces')).toBeVisible();
  await page.getByRole('switch', { name: 'Turn on space', exact: true }).first().click();
  await expect(button(page, 'Exit Fix19 Space A')).toHaveCount(0);
  await expect(page.locator('.spaces-region__marks').first()).toHaveCSS('color', 'rgb(216, 168, 78)');
  const toggle = page.locator('.space-region-card .spaces-switch').first();
  await page.waitForTimeout(250);
  const frames = await toggle.evaluate(async (element) => {
    const knob = element.querySelector('.spaces-switch__knob');
    const values = []; element.click();
    for (let index = 0; index < 20; index += 1) {
      await new Promise(requestAnimationFrame);
      values.push(new DOMMatrixReadOnly(getComputedStyle(knob).transform).m41);
      if (!knob.isConnected) throw new Error('Region switch remounted during animation');
    }
    return values;
  });
  expect(new Set(frames.map((value) => value.toFixed(2))).size).toBeGreaterThan(3);
  await toggle.click();
  await button(page, 'Edit Spaces').click();
  await expect(page.locator('.spaces-panel .space-card__delete')).toHaveCount(3);
  await button(page, 'Edit the regions on page 1').click();
  await expect(page.locator('[data-area-actions]')).toContainText('Regions');
  await button(page, 'Cancel').click();
  await page.evaluate(() => window.__fix19SurveyRegionHarness.createAnnotation({ id: 'spaces-owned', scope: 'region' }));
  await expect.poll(() => page.evaluate(() => window.__fix20CollabHarness.getState().annotations.filter((mark) => mark.id === 'spaces-owned').length)).toBe(1);
  await button(page, 'Copy region on page 1').click();
  await page.getByRole('spinbutton', { name: 'Destination page' }).fill('2');
  await button(page, 'Copy region').click();
  await expect(page.getByRole('dialog', { name: 'Copy region' })).toHaveCount(0);
  await expect(button(page, 'Go to page 2')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fix20CollabHarness.getState().annotations.filter((mark) => mark.id === 'spaces-owned').length)).toBe(1);
  await button(page, 'Undo').click();
  await expect(button(page, 'Go to page 2')).toHaveCount(0);
  await button(page, 'Move region on page 1').click();
  await page.getByRole('combobox', { name: 'Destination space' }).selectOption('fix19-space-b');
  await page.getByRole('spinbutton', { name: 'Destination page' }).fill('3');
  await button(page, 'Move region').click();
  await expect(page.getByRole('dialog', { name: 'Move region' })).toHaveCount(0);
  await button(page, 'Open Fix19 Space B').click();
  await button(page, 'Go to page 3').click();
  const markPage = () => page.locator('[data-annotation-id="spaces-owned"]').evaluateAll((elements) => elements.map((element) => element.closest('[data-page-number]')?.dataset.pageNumber));
  await expect.poll(markPage).toContain('3');
  await button(page, 'Undo').click();
  await expect(button(page, 'Go to page 3')).toHaveCount(0);
  await expect(button(page, 'Go to page 1')).toHaveCount(1);
  await page.getByRole('switch', { name: 'Turn on space', exact: true }).first().click();
  await button(page, 'Go to page 1').click();
  await expect.poll(markPage).toContain('1');
  await button(page, 'Redo').click();
  await expect.poll(() => page.evaluate(() => window.__fix20CollabHarness.getState().annotations.filter((mark) => mark.id === 'spaces-owned').length)).toBe(1);
});

test('nonadjacent Spaces pages keep correct fractional-zoom layout and stable spring-back', async ({ page, context }) => {
  await setup(page, context);
  await button(page, 'Edit Spaces').click();
  await page.getByRole('textbox', { name: 'Add pages (e.g. 3, 6-9, 12)' }).first().fill('3');
  await button(page, 'Add pages').click();
  await page.getByRole('switch', { name: 'Turn on space', exact: true }).first().click();
  await page.evaluate(() => window.__pdfjsViewerPerf.zoomTo(1.35));
  await page.waitForTimeout(350);
  const layout = await page.locator('.survey-pdfjs-page-div').evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).display !== 'none').map((element) => ({ page: Number(element.dataset.pageNumber), top: element.offsetTop, height: element.offsetHeight })));
  expect(layout.map((entry) => entry.page)).toEqual([1, 3]);
  expect(layout[1].top - layout[0].top - layout[0].height).toBeLessThan(25);
  await button(page, 'Go to page 3').click();
  const scroller = page.locator('.survey-pdfjs-viewer');
  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const tops = await scroller.evaluate(async (element) => {
    const values = [];
    for (let index = 0; index < 40; index += 1) { await new Promise(requestAnimationFrame); values.push(element.scrollTop); }
    return values;
  });
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
  const box = await scroller.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let index = 0; index < 6; index += 1) { await page.mouse.wheel(0, 120); await page.waitForTimeout(15); }
  await page.waitForTimeout(900);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const pageThree = page.locator('.survey-pdfjs-page-div[data-page-number="3"]');
  const pageThreeTop = (await pageThree.boundingBox()).y;
  await page.getByRole('switch', { name: 'Turn off space', exact: true }).click();
  await expect.poll(() => page.locator('.survey-pdfjs-page-div').evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).display !== 'none').length)).toBe(8);
  expect(Math.abs((await pageThree.boundingBox()).y - pageThreeTop)).toBeLessThan(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('switch', { name: 'Turn on space', exact: true }).first().click();
  await expect.poll(() => page.locator('.survey-pdfjs-page-div').evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).display !== 'none').map((element) => Number(element.dataset.pageNumber)))).toEqual([1, 3]);
});
