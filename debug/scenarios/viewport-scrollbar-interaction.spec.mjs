import { expect, test } from '@playwright/test';

const SCROLLER = '.survey-pdfjs-viewer[id^="pdfjs-pdf-viewer"]';

async function scrollState(page) {
  return page.locator(SCROLLER).evaluate((node) => ({
    top: Math.round(node.scrollTop),
    left: Math.round(node.scrollLeft),
  }));
}

async function verticalRail(page) {
  return page.locator('[aria-label="Viewport vertical scroll bar"]').evaluate((rail) => {
    const thumb = rail.querySelector('[aria-label="Scrollbar shuttle"]');
    const railStyle = getComputedStyle(rail);
    const thumbStyle = getComputedStyle(thumb);
    const rect = thumb.getBoundingClientRect();
    return {
      opacity: railStyle.opacity,
      pointerEvents: railStyle.pointerEvents,
      width: rect.width,
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      bottom: rect.bottom,
      railBottom: rail.getBoundingClientRect().bottom,
      thumbPointerEvents: thumbStyle.pointerEvents,
    };
  });
}

test('custom scrollbar stays usable on hover, track click, wheel, and ctrl-wheel', async ({ page }) => {
  await page.goto('/?testPdf=spike-120-pages.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 400);

  let rail = await verticalRail(page);
  await page.mouse.move(rail.x, rail.y);
  await page.waitForTimeout(1000);
  rail = await verticalRail(page);
  expect(rail.width).toBeGreaterThanOrEqual(5.5);
  expect(Number(rail.opacity)).toBeGreaterThan(0.95);
  expect(rail.pointerEvents).toBe('auto');

  const beforeWheel = await scrollState(page);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => scrollState(page)).not.toEqual(beforeWheel);

  rail = await verticalRail(page);
  const beforeZoom = await page.getByLabel('Edit zoom percentage').textContent();
  await page.mouse.move(rail.x, rail.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(() => page.getByLabel('Edit zoom percentage').textContent()).not.toBe(beforeZoom);

  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 200);
  rail = await verticalRail(page);
  const trackY = Math.min(rail.railBottom - 30, rail.bottom + 180);
  const beforeTrack = await scrollState(page);
  await page.mouse.click(rail.x, trackY);
  await expect.poll(() => scrollState(page)).not.toEqual(beforeTrack);
});
