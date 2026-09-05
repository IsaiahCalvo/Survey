import { expect, test } from '@playwright/test';

async function measureInk(icon) {
  const png = await icon.screenshot();
  return icon.page().evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const histogram = new Map();
    const luminance = [];
    for (let index = 0; index < pixels.length; index += 4) {
      const value = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
      luminance.push(value);
      const bucket = Math.round(value / 4);
      histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
    }
    let background = 0;
    let backgroundCount = -1;
    for (const [bucket, count] of histogram) {
      if (count <= backgroundCount) continue;
      background = bucket * 4;
      backgroundCount = count;
    }
    let inkPixels = 0;
    let weightedY = 0;
    let weight = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const contrast = Math.abs(luminance[y * canvas.width + x] - background);
        if (contrast <= 40) continue;
        inkPixels += 1;
        weightedY += y * contrast;
        weight += contrast;
      }
    }
    return { inkPixels, centerY: weightedY / weight };
  }, png.toString('base64'));
}

test('selection menu icons have matched ink and the text glyph sits lower', async ({ page }) => {
  await page.goto('/?testPdf=e2e/prog-10-all-subtypes.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
  await page.locator('[data-select-mode-trigger]').click();

  const menu = page.locator('[data-select-mode-menu]');
  await expect(menu).toBeVisible();
  const rows = menu.getByRole('menuitemradio');
  const metrics = await Promise.all([
    measureInk(rows.nth(0).locator('span[aria-hidden="true"]')),
    measureInk(rows.nth(1).locator('span[aria-hidden="true"]')),
    measureInk(rows.nth(2).locator('span[aria-hidden="true"]')),
  ]);
  const [rectangle, lasso, textSelect] = metrics;
  const iconOffsets = await rows.evaluateAll((items) => items.map((item) => {
    const rowRect = item.getBoundingClientRect();
    const iconRect = item.querySelector('span[aria-hidden="true"]').getBoundingClientRect();
    return iconRect.top - rowRect.top;
  }));

  expect(rectangle.inkPixels / lasso.inkPixels).toBeGreaterThanOrEqual(0.85);
  expect(rectangle.inkPixels / textSelect.inkPixels).toBeGreaterThanOrEqual(0.85);
  expect(iconOffsets[2] - iconOffsets[1]).toBeGreaterThanOrEqual(1.5);
});
