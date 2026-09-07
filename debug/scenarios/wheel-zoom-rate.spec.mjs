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

for (const regime of ['trackpad', 'notch']) {
  test(`${regime} gesture holds its rate across the seam and keeps the cursor anchor`, async ({ page }) => {
    await page.goto('/?testPdf=spike-120-pages.pdf');
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    await surface.waitFor();
    await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
    await page.waitForTimeout(1200);
    const scroller = page.locator('.survey-pdfjs-viewer[id^="pdfjs-pdf-viewer"]');
    const dispatch = async (deltas) => scroller.evaluate((node, deltas) => {
      for (const deltaY of deltas) node.dispatchEvent(new WheelEvent('wheel', {
        deltaY, ctrlKey: true, clientX: 800, clientY: 450, bubbles: true, cancelable: true,
      }));
    }, deltas);
    // Make both axes overflow so the off-center cursor can stay fixed without clamping.
    await dispatch([-1000]);
    await page.waitForTimeout(900);
    await scroller.evaluate(node => { node.scrollLeft = 150; node.scrollTop = 200; });
    const read = async () => scroller.evaluate(node => {
      const p = node.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
      const r = p.getBoundingClientRect();
      return { width: r.width, scaleWidth: p.style.width, left: node.scrollLeft, top: node.scrollTop,
        anchorX: (800 - r.x) / r.width, anchorY: (450 - r.y) / r.height };
    });
    const opener = regime === 'trackpad' ? 4 : 100;
    const rate = regime === 'trackpad' ? 0.0029 : Math.log(1.1) / 100;
    for (const delta of [8, 48, 49, 50, 51, 100, 192, 200]) {
      const before = await read();
      await dispatch([-opener, opener, -delta]);
      await page.waitForTimeout(40);
      const live = await read();
      const ratio = live.width / before.width;
      expect(ratio).toBeCloseTo(Math.exp(rate * delta), 5);
      expect(live.anchorX).toBeCloseTo(before.anchorX, 5);
      expect(live.anchorY).toBeCloseTo(before.anchorY, 5);
      console.log(JSON.stringify({ regime, delta, ratio, equivalentScaleFrom074: 0.74 * ratio }));
      await dispatch([delta]);
      await page.waitForTimeout(900);
      const after = await read();
      expect(after).toEqual(before);
    }
    // A separate gesture must classify again after the prior one settled.
    const before = await read();
    await dispatch([-100]);
    await page.waitForTimeout(900);
    const after = await read();
    expect(after.width / before.width).toBeCloseTo(1.1, 4);
    expect(after.anchorX).toBeCloseTo(before.anchorX, 3);
    expect(after.anchorY).toBeCloseTo(before.anchorY, 3);
  });
}

test('slow-in fast-out trackpad gesture restores exact scale and scroll offsets', async ({ page }) => {
  await page.goto('/?testPdf=spike-120-pages.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  const result = await page.locator('.survey-pdfjs-viewer[id^="pdfjs-pdf-viewer"]').evaluate(async node => {
    const wheel = deltaY => node.dispatchEvent(new WheelEvent('wheel', {
      deltaY, ctrlKey: true, clientX: 800, clientY: 450, bubbles: true, cancelable: true,
    }));
    wheel(-1000);
    await new Promise(resolve => setTimeout(resolve, 900));
    node.scrollLeft = 150; node.scrollTop = 200;
    const surface = node.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const read = () => ({ scaleWidth: surface.style.width, width: surface.getBoundingClientRect().width,
      left: node.scrollLeft, top: node.scrollTop });
    const before = read();
    for (let i = 0; i < 48; i++) {
      wheel(-4);
      await new Promise(resolve => setTimeout(resolve, 8));
    }
    const peak = read();
    wheel(192);
    await new Promise(resolve => setTimeout(resolve, 900));
    return { before, peak, after: read() };
  });
  console.log(JSON.stringify({ roundTrip: result }));
  expect(result.peak.width).toBeGreaterThan(result.before.width * 1.7);
  expect(result.after).toEqual(result.before);
});
