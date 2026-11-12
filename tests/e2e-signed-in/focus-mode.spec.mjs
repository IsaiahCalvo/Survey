// Full screen (flag 'focus-mode'). Owner 2026-11-10: full screen keeps the
// tab strip, both rails and the tool bar, and Survey mode still works; only
// the browser and system bars go. The rail button and Ctrl+Shift+F toggle
// it; Ctrl+Shift+F must not also open search (the viewer's Ctrl+F).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test('full screen keeps the tabs, rails and Survey mode', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.focus-mode', '1'));
  const sheet = await seedSheet('Full screen');
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
  const toggle = page.locator('[data-focus-mode-toggle]');
  const isFull = () => page.evaluate(() => Boolean(document.fullscreenElement));

  await toggle.click();
  await expect.poll(isFull, { timeout: 5_000 }).toBe(true);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAccessibleName('Exit full screen');
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expect(tabHome).toBeVisible();
  await expect(page.locator('[data-focus-mode-exit]')).toHaveCount(0);
  // Survey mode opens in full screen.
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.locator('.survey-rail-strip').first()).toBeVisible();
  await expect.poll(isFull).toBe(true);
  await page.getByRole('button', { name: 'Survey', exact: true }).click();

  await toggle.click();
  await expect.poll(isFull, { timeout: 5_000 }).toBe(false);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(left).toBeVisible();

  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+Shift+F');
  await expect.poll(isFull, { timeout: 5_000 }).toBe(true);
  await expect(page.getByLabel('Search text in PDF')).toHaveCount(0);
  await expect(right).toBeVisible();
  await page.keyboard.press('Control+Shift+F');
  await expect.poll(isFull, { timeout: 5_000 }).toBe(false);
  } finally {
    await sheet.remove();
  }
});
