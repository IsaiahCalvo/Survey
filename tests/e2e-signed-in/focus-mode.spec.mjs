// Focus mode (beta flag 'focus-mode', Drawboard PDF Pro trial audit
// 2026-11-09): the tab strip and both rails go, the page gets the room, and
// the Exit chip or Ctrl+Shift+F brings them back. Ctrl+Shift+F must not
// also open search (the viewer's Ctrl+F).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test('focus mode hides the strip and rails and comes back', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.focus-mode', '1'));
  const sheet = await seedSheet('Focus mode');
  try {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first();
  const pageWidth = async () => (await pageDiv.boundingBox()).width;
  // Fit page: the page follows the room it has (the strip's height comes back).
  await page.getByRole('button', { name: 'Fit options' }).click();
  await page.getByText('Fit page', { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);
  const fitted = await pageWidth();
  // Ctrl+0 is the same Fit page as the menu.
  await pageDiv.click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(800);
  expect(Math.abs(await pageWidth() - fitted)).toBeLessThan(2);
  const left = page.locator('#chrome-left-host');
  const right = page.locator('#chrome-right-host');
  const tabHome = page.getByRole('button', { name: 'Home', exact: true });
  const exit = page.locator('[data-focus-mode-exit]');

  await page.locator('[data-focus-mode-toggle]').click();
  await expect(left).toBeHidden();
  await expect(right).toBeHidden();
  await expect(tabHome).toHaveCount(0);
  await expect(exit).toBeVisible();
  // The page re-fits to the freed width.
  await expect.poll(pageWidth, { timeout: 5_000 }).toBeGreaterThan(fitted + 10);
  await exit.click();
  await expect(left).toBeVisible();
  await expect(tabHome).toBeVisible();
  await expect.poll(pageWidth, { timeout: 5_000 }).toBeLessThan(fitted + 3);

  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+Shift+F');
  await expect(right).toBeHidden();
  await expect(page.getByLabel('Search text in PDF')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+F');
  await expect(right).toBeVisible();
  } finally {
    await sheet.remove();
  }
});
