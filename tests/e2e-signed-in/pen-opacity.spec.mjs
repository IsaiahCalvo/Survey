// New pen ink keeps the opacity picked for the pen (Drawboard PDF Pro trial
// audit 2026-11-09: Survey drew new ink at 100% whatever opacity was set).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test('pen ink drawn at 40% opacity saves at 40%', async ({ page }) => {
  test.setTimeout(120_000);
  const sheet = await seedSheet('Pen opacity');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('p');
    await page.getByRole('button', { name: 'Custom color' }).filter({ visible: true }).first().click();
    const pct = page.getByRole('textbox', { name: 'Opacity percentage' }).filter({ visible: true }).first();
    await expect(pct).toBeVisible();
    await pct.fill('40');
    await pct.press('Enter');
    // Close the picker with its own button, so the first press on the page draws.
    await page.getByRole('button', { name: 'Custom color' }).filter({ visible: true }).first().click();
    await expect(page.locator('[data-color-picker-opacity]').filter({ visible: true })).toHaveCount(0);
    const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
    const before = await marks.count();
    const box = await pageDiv.boundingBox();
    await page.mouse.move(box.x + 120, box.y + 480);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 500, { steps: 6 });
    await page.mouse.move(box.x + 300, box.y + 480, { steps: 6 });
    await page.mouse.up();
    await expect(marks).toHaveCount(before + 1);
    const fills = await marks.nth(before).evaluate((el) => [el, ...el.querySelectorAll('*')]
      .map((n) => n.getAttribute('fill')).filter(Boolean));
    expect(fills.some((f) => /rgba\([^)]*,\s*0\.4\)/.test(f)), JSON.stringify(fills)).toBe(true);
  } finally {
    await sheet.remove();
  }
});
