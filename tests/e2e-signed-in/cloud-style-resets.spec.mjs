// The Cloud border stays with the tool it was armed on: Polygon (or an Area
// measure, Text...) picked after the Cloud tool draws a plain line again
// (deep test 2026-11-10).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test('Polygon after Cloud is not clouded', async ({ page }) => {
  test.setTimeout(120_000);
  const sheet = await seedSheet('Cloud reset');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    const tool = (name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
    await tool('Shapes').click();
    await tool('Cloud').click();
    await expect(page.getByText('Cloud', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await tool('Polygon').click();
    const bar = page.locator('body');
    await expect(bar.getByText('Solid', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    // Draw it and check the saved mark has no cloud.
    const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
    const box = await pageDiv.boundingBox();
    for (const [x, y] of [[150, 200], [320, 200], [320, 330]]) await page.mouse.click(box.x + x, box.y + y);
    await page.mouse.click(box.x + 150, box.y + 200);
    await expect(marks).toHaveCount(1);
    const clouded = await marks.first().evaluate((el) => el.outerHTML.includes('cloud') || (el.querySelector('path')?.getAttribute('d') || '').split(/[Aa]/).length > 4);
    expect(clouded).toBe(false);
    // Cloud again still clouds.
    await page.keyboard.press('Escape');
    await tool('Cloud').click();
    await expect(page.getByText('Cloud', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  } finally {
    await sheet.remove();
  }
});
