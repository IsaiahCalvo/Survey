import { expect, test } from '@playwright/test';

test('imported unapplied redaction keeps the fixed red warning outline', async ({ page }) => {
  await page.goto('/?testPdf=unapplied-redaction-leak.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();

  const redaction = page.locator('[data-shape-kind="text-markup-redact"]').first();
  await expect(redaction).toBeVisible();
  await expect(redaction).toHaveAttribute('fill', 'none');
  await expect(redaction).toHaveAttribute('stroke', '#d0021b');
});
