// Bookmarks "+" keeps the reader on the page they are on, and "use current
// page" fills that page (Drawboard PDF Pro trial audit 2026-11-09: Survey
// jumped to page 1 and filled in page 1).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test('Add bookmark stays on the current page', async ({ page }) => {
  test.setTimeout(120_000);
  const sheet = await seedSheet('Bookmark add', { pages: 4 });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Bookmark add sheet page 1').filter({ visible: true })).toBeVisible({ timeout: 60_000 });
    await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first().click({ position: { x: 300, y: 400 } });
    await page.keyboard.press('End');
    await expect(page.getByText('Bookmark add sheet page 4').filter({ visible: true })).toBeInViewport({ timeout: 10_000 });
    await page.waitForTimeout(600);
    const pageInView = (n) => page.getByText(`Bookmark add sheet page ${n}`).filter({ visible: true });
    await page.getByRole('button', { name: 'Bookmarks' }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Add bookmark' }).filter({ visible: true }).first().click();
    const pageField = page.getByPlaceholder('Page number').filter({ visible: true }).first();
    await expect(pageField).toBeVisible();
    await page.waitForTimeout(600);
    await expect(pageInView(4)).toBeInViewport();
    await expect(pageInView(1)).not.toBeInViewport();
    await page.getByRole('button', { name: /current page/i }).filter({ visible: true }).first().click();
    await expect(pageField).toHaveValue('4');
  } finally {
    await sheet.remove();
  }
});
