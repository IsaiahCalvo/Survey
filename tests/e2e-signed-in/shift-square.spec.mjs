// Shift while drawing a rectangle makes a square (beta flag 'shift-square',
// Drawboard PDF Pro trial audit 2026-11-09).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

for (const on of [true, false]) {
  test(`Shift-drag a rectangle: ${on ? 'square' : 'flag off, free'}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.shift-square', '1'));
    const sheet = await seedSheet('Shift square');
    try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
    const before = await marks.count();
    const box = await pageDiv.boundingBox();
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 120, box.y + 600);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 180, box.y + 620, { steps: 4 });
    await page.mouse.move(box.x + 260, box.y + 640, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(marks).toHaveCount(before + 1);
    const r = await marks.nth(before).boundingBox();
    const ratio = r.width / r.height;
    if (on) expect(Math.abs(ratio - 1), JSON.stringify(r)).toBeLessThan(0.08);
    else expect(ratio, JSON.stringify(r)).toBeGreaterThan(2);
    } finally {
      await sheet.remove();
    }
  });
}
