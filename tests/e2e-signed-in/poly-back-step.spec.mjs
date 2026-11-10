// Backspace or Undo while placing a polyline takes the last point off
// (beta flag 'poly-back-step', Drawboard PDF Pro trial audit 2026-11-09).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

for (const [on, key] of [[true, 'Backspace'], [true, 'Control+z'], [true, 'Undo button'], [true, 'Undo button, nothing before'], [false, 'Backspace']]) {
  test(`${key} while placing a polyline (${on ? 'flag on' : 'flag off'})`, async ({ page }) => {
    test.setTimeout(120_000);
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.poly-back-step', '1'));
    const sheet = await seedSheet('Poly back step');
    try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
    const box = await pageDiv.boundingBox();
    if (key === 'Undo button') {
      // An earlier mark, so the button is live and must not undo it.
      await page.keyboard.press('r');
      await page.mouse.move(box.x + 100, box.y + 120);
      await page.mouse.down();
      await page.mouse.move(box.x + 220, box.y + 220, { steps: 6 });
      await page.mouse.up();
      await expect(marks.first()).toBeVisible();
    }
    const before = await marks.count();
    await page.keyboard.press('k');
    for (const [x, y] of [[120, 480], [260, 480], [260, 620]]) {
      await page.mouse.click(box.x + x, box.y + y);
      await page.waitForTimeout(120);
    }
    if (key.startsWith('Undo button')) await page.getByRole('button', { name: 'Undo', exact: true }).filter({ visible: true }).first().click();
    else await page.keyboard.press(key);
    await page.keyboard.press('Enter');
    await expect(marks).toHaveCount(before + 1);
    const r = await marks.nth(before).boundingBox();
    if (on) expect(r.height, JSON.stringify(r)).toBeLessThan(30);
    else expect(r.height, JSON.stringify(r)).toBeGreaterThan(100);
    } finally {
      await sheet.remove();
    }
  });
}
