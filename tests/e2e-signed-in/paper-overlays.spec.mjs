// Nightly 'paper-overlays' (Drawboard Projects VT-46): the rail's Paper card
// lays a pattern over every page, under the marks; Blank page takes it off,
// and a reload brings the plain page back.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const host = (pageDiv) => pageDiv.locator('.survey-pdfjs-page-canvas + div').first();
const beforeImage = (loc) => loc.evaluate((el) => getComputedStyle(el, '::before').backgroundImage);

test('Paper card picks a pattern for the page, Blank page and reload clear it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.paper-overlays', '1'));
  const sheet = await seedSheet('Paper overlays');
  await signIn(page, E2E_ACCOUNTS.owner);
  try {
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    expect(await beforeImage(host(pageDiv))).toBe('none');

    const toggle = page.locator('[data-paper-overlay-toggle]').filter({ visible: true }).first();
    await toggle.click();
    const card = page.locator('[data-paper-overlay-menu]');
    await expect(card.locator('[data-paper-kind]')).toHaveCount(23);
    await expect(card.locator(`[data-paper-kind="none"]`)).toHaveAttribute('aria-checked', 'true');
    await card.locator('[data-paper-kind="graph-quarter-in"]').click();
    await expect(card.locator('[data-paper-kind="graph-quarter-in"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-paper-overlay', 'graph-quarter-in');
    expect(await beforeImage(host(pageDiv))).toMatch(/^url\("data:image\/svg\+xml/);

    // The pattern sits under the marks layer.
    const order = await pageDiv.evaluate((div) => {
      const tiles = div.querySelector('.survey-pdfjs-page-canvas + div');
      const marks = div.querySelector('[data-svg-annotation-layer]');
      return marks ? Boolean(tiles.compareDocumentPosition(marks) & Node.DOCUMENT_POSITION_FOLLOWING) : true;
    });
    expect(order).toBe(true);

    await card.locator('[data-paper-kind="none"]').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-paper-overlay', /.+/);
    expect(await beforeImage(host(pageDiv))).toBe('none');

    await card.locator('[data-paper-kind="hex-1in"]').click();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.survey-pdfjs-page-div canvas').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('html')).not.toHaveAttribute('data-paper-overlay', /.+/);
  } finally {
    await sheet.remove();
  }
});
