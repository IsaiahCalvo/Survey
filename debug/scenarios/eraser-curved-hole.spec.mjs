import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

for (const shape of ['wave', 'signature']) {
  test(`partial erase cuts an ordinary ${shape} without filling holes or losing outside ink`, async ({ page }) => {
    await page.goto('/?testPdf=spike-120-pages.pdf&eraserLifecycleE2E=1');
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    await surface.waitFor();
    await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
    await page.waitForTimeout(1200);
    const box = await surface.boundingBox();
    const pristine = PNG.sync.read(await surface.screenshot());
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    const width = page.getByRole('textbox', { name: /^(Width|Size)$/ });
    await width.fill('14');
    await width.press('Tab');
    async function gesture(points) {
      await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
      await page.mouse.down();
      for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 2 });
      await page.mouse.up();
    }
    const points = Array.from({ length: 61 }, (_, i) => shape === 'wave'
      ? [60 + i * 7.5, 400 + 40 * Math.sin(i / 3)]
      : [60 + i * 7.5, 400 + 35 * Math.sin(i / 2) + 15 * Math.sin(i / 0.7)]);
    await gesture(points);
    const stored = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]'), g => window.__phase35GetAnnotationById(g.getAttribute('data-anno-id'))));
    await expect.poll(async () => (await stored()).length).toBe(1);
    const original = await stored();
    expect(original[0].polygons.some(polygon => polygon.length > 1)).toBe(true);
    await page.mouse.move(10, 10);
    const before = PNG.sync.read(await surface.screenshot());
    await page.getByRole('button', { name: 'Partial erase', exact: true }).click();
    await page.locator('[data-diag-eraser-wrapper="1"]').waitFor();
    await width.fill('24');
    await width.press('Tab');
    await gesture([[230, 320], [230, 480]]);
    await expect.poll(async () => JSON.stringify(await stored())).not.toBe(JSON.stringify(original));
    await page.mouse.move(10, 10);
    await page.waitForTimeout(250);
    const after = PNG.sync.read(await surface.screenshot());
    const hasInk = (image, x, y) => {
      const i = (image.width * y + x) * 4;
      return [0, 1, 2].reduce((sum, c) => sum + Math.abs(image.data[i + c] - pristine.data[i + c]), 0) > 40;
    };
    let removed = 0;
    let survivingInside = 0;
    let lostOutside = 0;
    let addedOutside = 0;
    for (let y = 300; y < 500; y += 1) for (let x = 30; x < 550; x += 1) {
      const wasInk = hasInk(before, x, y);
      const isInk = hasInk(after, x, y);
      const distance = Math.hypot(x + 0.5 - 230, y + 0.5 - Math.max(320, Math.min(480, y + 0.5)));
      if (wasInk && !isInk) removed += 1;
      // Exclude only the antialiased boundary pixel from contact comparisons.
      if (distance < 10.5 && isInk) survivingInside += 1;
      if (distance > 13.5 && wasInk && !isInk) lostOutside += 1;
      if (distance > 13.5 && !wasInk && isInk) addedOutside += 1;
    }
    expect(removed).toBeGreaterThan(100);
    expect(survivingInside).toBe(0);
    expect(lostOutside).toBe(0);
    expect(addedOutside).toBe(0);
  });
}
