import { test, expect } from '@playwright/test';

for (const delta of [8, 48, 100, 200]) {
  test(`${delta}px wheel event uses its calibrated rate and reverses`, async ({ page }) => {
    await page.goto('/?testPdf=spike-120-pages.pdf');
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    await surface.waitFor();
    await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
    await page.waitForTimeout(1200);
    const before = (await surface.boundingBox()).width;
    const scroller = page.locator('.survey-pdfjs-viewer[id^="pdfjs-pdf-viewer"]');
    const wheel = async (deltaY) => {
      await scroller.evaluate((node, deltaY) => node.dispatchEvent(new WheelEvent('wheel', {
        deltaY, deltaMode: 0, ctrlKey: true,
        clientX: 700, clientY: 400, bubbles: true, cancelable: true,
      })), deltaY);
      await page.waitForTimeout(900);
    };
    await wheel(-delta);
    const ratio = (await surface.boundingBox()).width / before;
    const expected = delta < 50 ? Math.exp(0.0029 * delta) : Math.pow(1.1, delta / 100);
    console.log(JSON.stringify({ delta, before, ratio, equivalentScaleFrom074: 0.74 * ratio }));
    expect(ratio).toBeCloseTo(expected, 3);
    if (delta === 8) {
      expect(0.74 * ratio).toBeGreaterThan(0.756);
      expect(0.74 * ratio).toBeLessThan(0.759);
    }
    await wheel(delta);
    expect((await surface.boundingBox()).width / before).toBeCloseTo(1, 3);
  });
}
