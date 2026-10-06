import { expect, test } from '@playwright/test';

if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

// Owner 2026-10-06: a disabled control's tooltip says why it is off, never
// what it would do ("Nothing to undo", not "Undo").
test('disabled history and page controls show the shared tooltip with the reason', async ({ page }) => {
  await page.goto('/?testPdf=e2e/prog-02-text-markup.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();

  const reasons = { Undo: 'Nothing to undo', Redo: 'Nothing to redo', 'Previous page': 'Already on the first page', 'Next page': 'Already on the last page' };
  for (const [label, reason] of Object.entries(reasons)) {
    const button = page.getByRole('button', { name: label, exact: true });
    await expect(button).toBeDisabled();
    await button.hover({ force: true });
    const tooltip = page.locator('body > div[aria-hidden="true"]').filter({ hasText: reason });
    await expect(tooltip).toBeVisible();
    await page.mouse.move(700, 500);
    await expect(tooltip).toHaveCount(0);
  }
});
