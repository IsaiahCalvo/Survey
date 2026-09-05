import { expect, test } from '@playwright/test';

async function waitForFixture(page, fixture) {
  await page.goto(`/?testPdf=${fixture}`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
  await page.waitForTimeout(1200);
}

async function annotationCount(page) {
  return page.locator(
    '.survey-pdfjs-page-div[data-page-number="1"] [data-annotation-index]',
  ).count();
}

async function drawPenStroke(page, y) {
  await page.mouse.move(470, y);
  await page.mouse.down();
  for (let index = 1; index <= 12; index += 1) {
    await page.mouse.move(470 + index * 14, y + Math.sin(index / 2) * 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
}

test('Text Select does not leave the annotation layer pointer-dead', async ({ page }) => {
  await waitForFixture(page, 'e2e/prog-10-all-subtypes.pdf');

  await page.keyboard.press('p');
  const before = await annotationCount(page);
  await drawPenStroke(page, 700);
  await expect.poll(() => annotationCount(page)).toBeGreaterThan(before);

  await page.keyboard.press('Shift+v');
  await page.keyboard.press('p');
  const beforeSecondStroke = await annotationCount(page);
  await drawPenStroke(page, 740);

  await expect.poll(() => annotationCount(page)).toBeGreaterThan(beforeSecondStroke);
  await expect.poll(() => page.locator('[data-svg-annotation-layer]').first().evaluate(
    (node) => getComputedStyle(node).pointerEvents,
  )).toBe('auto');
});

test('Text Select drag can start on an imported text mark', async ({ page }) => {
  await waitForFixture(page, 'e2e/prog-02-text-markup.pdf');
  await page.keyboard.press('Shift+v');

  const mark = page.locator('[data-pdf-annotation-id="9R"]').first();
  const box = await mark.boundingBox();
  expect(box).not.toBeNull();
  const startX = box.x + box.width * 0.25;
  const y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 180, y, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.getSelection?.().toString() || '')).not.toBe('');
  await expect(page.locator('[data-resize-handle]')).toHaveCount(0);
});
