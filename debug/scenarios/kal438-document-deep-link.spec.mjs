import { test, expect } from '@playwright/test';

test('KAL-438: an existing-user share link opens the exact document', async ({ page }) => {
  await page.goto(
    '/?testPdf=clickable-link-test.pdf'
    + '&documentDeepLinkE2E=1'
    + '&docId=deep-link-test-document',
  );

  await expect(page.getByRole('button', {
    name: /clickable-link-test\.pdf/,
  })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).not.toHaveURL(/docId=/);
});
