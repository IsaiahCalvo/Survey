import { expect, test } from '@playwright/test';

test('right rail ignores live zoom events from a background viewer', async ({ page }) => {
  await page.goto('/?testPdf=e2e/prog-02-text-markup.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();

  const rail = page.getByRole('button', { name: 'Edit zoom percentage' });
  const activeViewerId = await page.locator('.survey-pdfjs-viewer').getAttribute('id');
  const initialText = await rail.textContent();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('survey-pdfjs-live-zoom', {
      detail: { viewerId: 'pdfjs-pdf-viewer-background-tab', percentage: 317 },
    }));
  });
  await expect(rail).toHaveText(initialText);

  await page.evaluate((viewerId) => {
    window.dispatchEvent(new CustomEvent('survey-pdfjs-live-zoom', {
      detail: { viewerId, percentage: 143 },
    }));
  }, activeViewerId);
  await expect(rail).toHaveText('143%');
});
