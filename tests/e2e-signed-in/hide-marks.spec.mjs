// Hide all marks (beta flag 'hide-marks', Drawboard PDF Pro trial audit
// 2026-11-09): the rail eye hides every mark, a chip says so and brings them
// back, and a reload always shows them.
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

test('the rail eye hides every mark and the chip brings them back', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.hide-marks', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(E2E_DOCUMENT.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const layer = page.locator('.survey-pdfjs-page-div[data-page-number="1"] [data-svg-annotation-layer="1"]').first();
  await expect(layer.locator('[data-annotation-index]').first()).toBeVisible({ timeout: 60_000 });

  const eye = page.locator('[data-hide-marks-toggle]').filter({ visible: true }).first();
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  await expect(layer).toBeHidden();
  const chip = page.locator('[data-marks-hidden-chip]');
  await expect(chip).toContainText('Marks hidden');

  await chip.getByRole('button', { name: 'Show' }).click();
  await expect(chip).toHaveCount(0);
  await expect(layer.locator('[data-annotation-index]').first()).toBeVisible();
  await expect(eye).toHaveAttribute('aria-pressed', 'false');

  await eye.click();
  await expect(layer).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).not.toHaveAttribute('data-marks-hidden', '');
});
