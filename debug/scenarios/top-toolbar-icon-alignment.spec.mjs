import { expect, test } from '@playwright/test';

async function measureInk(page, label) {
  const button = page.getByRole('button', { name: label, exact: true });
  const png = await button.screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const luminance = [];
    const histogram = new Map();
    for (let index = 0; index < pixels.length; index += 4) {
      const value = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
      luminance.push(value);
      const bucket = Math.round(value / 4);
      histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
    }
    let background = 0;
    let backgroundCount = -1;
    for (const [bucket, count] of histogram) {
      if (count > backgroundCount) {
        background = bucket * 4;
        backgroundCount = count;
      }
    }
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let weightedY = 0;
    let weight = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const contrast = Math.abs(luminance[y * canvas.width + x] - background);
        if (contrast <= 40) continue;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        weightedY += y * contrast;
        weight += contrast;
      }
    }
    return { centerY: weightedY / weight, inkHeight: maxY - minY + 1 };
  }, png.toString('base64'));
}

test('top toolbar icon ink has matched height and optical center', async ({ page }) => {
  await page.goto('/?testPdf=e2e/prog-02-text-markup.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();

  const labels = ['Pan', 'Rectangle Select', 'Draw', 'Shapes', 'Text'];
  const metrics = await Promise.all(labels.map((label) => measureInk(page, label)));
  const centers = metrics.map(({ centerY }) => centerY);
  const heights = metrics.map(({ inkHeight }) => inkHeight);

  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1.6);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(3);
});
