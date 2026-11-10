// Phone Back (beta flag 'back-button'): with the zoom menu, the page-jump
// field or the History sheet open, Back closes that first and keeps the
// document open (Drawboard PDF Pro trial audit 2026-11-10, R3-Y: these closed
// the whole document).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('phone Back closes the zoom menu, page jump and History first', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.back-button', '1'));
  const sheet = await seedSheet('Phone back sheets');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().tap();
    await page.waitForTimeout(1200);
    const open = page.getByRole('button', { name: 'Open file' });
    if (await open.isVisible().catch(() => false)) await open.tap();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

    // Zoom menu.
    const zoom = page.getByRole('button', { name: 'Zoom and fit options', exact: true });
    await zoom.tap();
    await expect(zoom).toHaveAttribute('aria-expanded', 'true');
    await page.goBack();
    await expect(zoom).toHaveAttribute('aria-expanded', 'false');
    await expect(pageDiv).toBeVisible();

    // Page-jump field.
    await page.getByRole('button', { name: 'Jump to page', exact: true }).tap();
    const pill = page.locator('.mobile-pdf-header__page-pill');
    await expect(pill).toHaveClass(/is-open/);
    await page.goBack();
    await expect(pill).not.toHaveClass(/is-open/);
    await expect(pageDiv).toBeVisible();

    // History sheet.
    await page.getByRole('button', { name: 'History', exact: true }).filter({ visible: true }).first().tap();
    await page.waitForTimeout(900);
    await page.goBack();
    await page.waitForTimeout(900);
    await expect(pageDiv).toBeVisible();

    // Nothing open now: Back leaves the document.
    await page.goBack();
    await expect(pageDiv).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await sheet.remove();
  }
});
