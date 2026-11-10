// Try a sample drawing, signed out (beta flag 'guest-sample', Drawboard PDF
// Pro trial audit 2026-11-10: Drawboard lets you mark up before signing up;
// Survey's sample only reopened sign-in). The sample opens as a try-out.
import { expect, test } from './helpers.mjs';

for (const on of [true, false]) {
  test(`signed out, the sample ${on ? 'opens as a try-out' : 'asks to sign in'}`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.guest-sample', '1'));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const skip = page.getByRole('button', { name: 'Continue without an account' });
    await skip.click({ timeout: 30_000 });
    await expect(page.locator('.auth-modal')).toHaveCount(0);
    const sample = page.getByRole('button', { name: 'Try a sample drawing' }).filter({ visible: true }).first();
    await expect(sample).toBeVisible({ timeout: 30_000 });
    await sample.click();
    if (!on) {
      await expect(page.getByRole('dialog').filter({ hasText: /Sign in|Welcome/ }).first()).toBeVisible({ timeout: 10_000 });
      return;
    }
    await expect(page.getByText('This is a try-out. Sign in to save your marks.')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible({ timeout: 60_000 });
    // A mark can be drawn on the try-out.
    const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    await page.keyboard.press('r');
    await page.mouse.move(pageBox.x + pageBox.width * 0.3, pageBox.y + pageBox.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + pageBox.width * 0.45, pageBox.y + pageBox.height * 0.45, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('[data-svg-annotation-layer="1"] [data-annotation-index]').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: test.info().outputPath('guest-sample.png') });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
