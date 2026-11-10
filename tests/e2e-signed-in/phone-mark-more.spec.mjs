// Phone: More on the picked-mark bar opens the full mark menu (beta flag
// 'phone-mark-more', Drawboard PDF Pro trial audit 2026-11-09, slice 7).
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

for (const on of [true, false]) {
  test(`phone picked-mark bar ${on ? 'has' : 'has no'} More`, async ({ page }) => {
    test.setTimeout(120_000);
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.phone-mark-more', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(E2E_DOCUMENT.name, { exact: true }).filter({ visible: true }).first().tap();
    await page.waitForTimeout(1200);
    const open = page.getByRole('button', { name: 'Open file' });
    if (await open.isVisible().catch(() => false)) await open.tap();
    const mark = page.locator('.survey-pdfjs-page-div[data-page-number="1"] [data-svg-annotation-layer="1"] [data-annotation-index="5"]').filter({ visible: true }).first();
    await expect(mark).toBeVisible({ timeout: 60_000 });
    const box = await mark.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const bar = page.locator('[data-selection-quick-bar][data-visible="true"]');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    const more = bar.getByRole('button', { name: 'More' });
    if (!on) {
      await expect(more).toHaveCount(0);
      return;
    }
    await more.tap();
    const menu = page.locator('[data-annotation-context-menu]');
    await expect(menu).toBeVisible({ timeout: 5_000 });
    const r = await menu.boundingBox();
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(391);
    await page.screenshot({ path: test.info().outputPath('phone-more.png') });
    await page.keyboard.press('Escape');
  });
}
