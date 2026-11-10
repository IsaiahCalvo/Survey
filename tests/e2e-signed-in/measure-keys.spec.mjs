// Alt+Shift+L / P / A pick a measure tool (beta flag 'measure-keys',
// Drawboard PDF Pro trial audit 2026-11-10), and the Measure menu shows them.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

for (const on of [true, false]) {
  test(`Alt+Shift+L ${on ? 'picks' : 'does not pick'} Length`, async ({ page }) => {
    test.setTimeout(120_000);
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.measure-keys', '1'));
    const sheet = await seedSheet('Measure keys');
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).click();
      const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
      await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
      const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
      const before = await marks.count();
      await pageDiv.click({ position: { x: 20, y: 20 } });
      await page.keyboard.press('Alt+Shift+L');
      const menuButton = page.locator('[data-measure-tool="menu"]').filter({ visible: true }).first();
      if (!on) {
        await page.waitForTimeout(500);
        await expect(page.locator('[data-measure-tool="menu"][aria-pressed="true"]')).toHaveCount(0);
        return;
      }
      await expect(menuButton).toHaveAttribute('aria-pressed', 'true');
      const box = await pageDiv.boundingBox();
      await page.mouse.move(box.x + 100, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(box.x + 300, box.y + 300, { steps: 8 });
      await page.mouse.up();
      await expect(marks).toHaveCount(before + 1);
      // Area by key, then the menu lists the keys.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Alt+Shift+A');
      await expect(menuButton).toHaveAttribute('aria-pressed', 'true');
      await menuButton.click();
      const menu = page.locator('[data-measure-menu]');
      await expect(menu.locator('[data-measure-tool="area"]')).toHaveClass(/btn-active/);
      await expect(menu.locator('[data-measure-tool="length"] [data-measure-key]')).toHaveText('Alt+Shift+L');
    } finally {
      await sheet.remove();
    }
  });
}
