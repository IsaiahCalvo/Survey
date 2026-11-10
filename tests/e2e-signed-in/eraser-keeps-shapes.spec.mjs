// Partial eraser leaves shapes alone (Nightly flag 'eraser-keeps-shapes',
// Drawboard PDF Pro trial audit 2026-11-10), and pen ink stops at the page
// edge instead of keeping points past it.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function open(page, label, flags = []) {
  await page.addInitScript((keys) => keys.forEach((k) => localStorage.setItem(`survey.flag.${k}`, '1')), flags);
  const sheet = await seedSheet(label);
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return { sheet, pageDiv, marks: pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

for (const flagOn of [true, false]) {
  test(`partial eraser across ink and a rectangle (flag ${flagOn ? 'on' : 'off'})`, async ({ page }) => {
    test.setTimeout(150_000);
    const { sheet, pageDiv, marks } = await open(page, `Eraser ${flagOn ? 'on' : 'off'}`, flagOn ? ['eraser-keeps-shapes'] : []);
    try {
      const box = await pageDiv.boundingBox();
      const at = (x, y) => ({ x: box.x + x, y: box.y + y });
      await page.keyboard.press('r');
      await drag(page, at(100, 300), at(260, 380));
      await expect(marks).toHaveCount(1);
      await page.keyboard.press('Escape');
      await page.keyboard.press('p');
      await drag(page, at(100, 460), at(300, 470));
      await expect(marks).toHaveCount(2);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Shift+E');
      // Down through the rectangle's left side and across the ink.
      await drag(page, at(100, 260), at(100, 520));
      await page.waitForTimeout(1200);
      const rects = pageDiv.locator('[data-svg-annotation-layer="1"] rect[data-annotation-index], [data-svg-annotation-layer="1"] [data-annotation-index] rect');
      if (flagOn) {
        await expect(marks).toHaveCount(2); // rectangle kept, ink cut (one piece left of the cut is under 1 pt)
        expect(await rects.count()).toBeGreaterThan(0);
      } else {
        await expect.poll(() => marks.count()).toBeLessThan(2 + 1);
        await expect.poll(() => rects.count()).toBe(0);
      }
    } finally {
      await sheet.remove();
    }
  });
}

test('pen ink dragged past the page edge stops at the edge', async ({ page }) => {
  test.setTimeout(120_000);
  const { sheet, pageDiv, marks } = await open(page, 'Pen edge');
  try {
    const box = await pageDiv.boundingBox();
    await page.keyboard.press('p');
    await page.mouse.move(box.x + box.width - 120, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 80, box.y + 320, { steps: 10 });
    await page.mouse.move(box.x + box.width - 60, box.y + 340, { steps: 10 });
    await page.mouse.up();
    await expect(marks).toHaveCount(1);
    const right = await marks.first().evaluate((el) => el.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(box.x + box.width + 4);
  } finally {
    await sheet.remove();
  }
});
