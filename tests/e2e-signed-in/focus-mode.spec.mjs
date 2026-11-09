// Focus mode (beta flag 'focus-mode', Drawboard PDF Pro trial audit
// 2026-11-09): the tab strip and both rails go, the page gets the room, and
// the Exit chip or Ctrl+Shift+F brings them back. Ctrl+Shift+F must not
// also open search (the viewer's Ctrl+F).
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

test('focus mode hides the strip and rails and comes back', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.focus-mode', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(E2E_DOCUMENT.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
  const left = page.locator('#chrome-left-host');
  const right = page.locator('#chrome-right-host');
  const tabHome = page.getByRole('button', { name: 'Home', exact: true });
  const exit = page.locator('[data-focus-mode-exit]');

  await page.locator('[data-focus-mode-toggle]').click();
  await expect(left).toBeHidden();
  await expect(right).toBeHidden();
  await expect(tabHome).toHaveCount(0);
  await expect(exit).toBeVisible();
  await exit.click();
  await expect(left).toBeVisible();
  await expect(tabHome).toBeVisible();

  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+Shift+F');
  await expect(right).toBeHidden();
  await expect(page.getByLabel('Search text in PDF')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+F');
  await expect(right).toBeVisible();
});
