import { expect, test } from '@playwright/test';

test('disabled history and page controls still show the shared tooltip', async ({ page }) => {
  await page.goto('/?testPdf=e2e/prog-02-text-markup.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();

  for (const label of ['Undo', 'Redo', 'Previous page', 'Next page']) {
    const button = page.getByRole('button', { name: label, exact: true });
    await expect(button).toBeDisabled();
    await button.hover({ force: true });
    const tooltip = page.locator('body > div[aria-hidden="true"]').filter({ hasText: label });
    await expect(tooltip).toBeVisible();
    await page.mouse.move(700, 500);
    await expect(tooltip).toHaveCount(0);
  }
});
