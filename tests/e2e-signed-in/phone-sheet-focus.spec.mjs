// KAL-460: on a phone, the tool settings sheet and the colour sheet are modal.
// Opening one moves focus into it, Tab stays inside, Escape closes it and focus
// goes back to the button that opened it.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const focusInside = (page, selector) => page.evaluate(
  (sel) => Boolean(document.activeElement?.closest(sel)),
  selector,
);

test('phone tool settings and colour sheets keep keyboard focus inside', async ({ page }) => {
  test.setTimeout(150_000);
  const sheet = await seedSheet('Phone sheet focus');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().tap();
    const openFile = page.getByRole('button', { name: 'Open file' });
    if (await openFile.isVisible().catch(() => false)) await openFile.tap();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: 'Draw', exact: true }).filter({ visible: true }).first().tap();
    await page.getByRole('button', { name: 'Pen', exact: true }).filter({ visible: true }).last().tap();

    // Tool settings sheet.
    const more = page.getByRole('button', { name: 'More Pen settings' }).filter({ visible: true }).first();
    await more.focus();
    await page.keyboard.press('Enter');
    const settings = page.getByRole('dialog', { name: 'Pen settings' });
    await expect(settings).toBeVisible();
    await expect(settings).toHaveAttribute('aria-modal', 'true');
    await expect.poll(() => focusInside(page, '.mobile-pdf-text-defaults')).toBe(true);
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
    expect(await focusInside(page, '.mobile-pdf-text-defaults')).toBe(true);
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Shift+Tab');
    expect(await focusInside(page, '.mobile-pdf-text-defaults')).toBe(true);
    await page.screenshot({ path: test.info().outputPath('settings-sheet.png') });
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await expect(more).toBeFocused();

    // Colour sheet from the strip's colour disc.
    const custom = page.getByRole('button', { name: 'Custom color' }).filter({ visible: true }).first();
    await custom.focus();
    await page.keyboard.press('Enter');
    const picker = page.locator('.mobile-pdf-colorpicker-surface');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('aria-modal', 'true');
    await expect.poll(() => focusInside(page, '.mobile-pdf-colorpicker-surface')).toBe(true);
    for (let i = 0; i < 30; i += 1) await page.keyboard.press('Tab');
    expect(await focusInside(page, '.mobile-pdf-colorpicker-surface')).toBe(true);
    await page.screenshot({ path: test.info().outputPath('colour-sheet.png') });
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(custom).toBeFocused();
  } finally {
    await sheet.remove();
  }
});
