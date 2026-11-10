// Keys on the mark right-click menu (beta flag 'menu-keys', Drawboard PDF Pro
// trial audit 2026-11-09): Arrange rows print their key; the icon row's hints
// name theirs. Off: no keys.
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

for (const on of [true, false]) {
  test(`mark menu ${on ? 'shows' : 'has no'} keys`, async ({ page }) => {
    test.setTimeout(120_000);
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.menu-keys', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(E2E_DOCUMENT.name, { exact: true }).filter({ visible: true }).first().click();
    const open = page.getByRole('button', { name: 'Open file' });
    if (await open.isVisible().catch(() => false)) await open.click();
    const mark = page.locator('.survey-pdfjs-page-div[data-page-number="1"] [data-svg-annotation-layer="1"] [data-annotation-index="5"]').filter({ visible: true }).first();
    await expect(mark).toBeVisible({ timeout: 60_000 });
    const box = await mark.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    const menu = page.locator('[data-annotation-context-menu]');
    await expect(menu).toBeVisible();
    await menu.locator('[data-menu-key="arrange"]').hover();
    const front = menu.locator('[data-submenu-key="bringToFront"]');
    await expect(front).toBeVisible();
    if (!on) {
      await expect(menu.locator('.annotation-menu-key')).toHaveCount(0);
      return;
    }
    await expect(front.locator('.annotation-menu-key')).toHaveText(new RegExp(`(Ctrl|⌘)\\+Shift\\+\\]`));
    await expect(menu.locator('[data-submenu-key="sendBackward"] .annotation-menu-key')).toHaveText(/\+\[$/);
    await page.screenshot({ path: test.info().outputPath('menu-keys.png') });
    await menu.locator('[data-menu-key="copy"]').hover();
    await expect(page.getByText(/^Copy \((Ctrl|⌘)\+C\)$/)).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
  });
}
