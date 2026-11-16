// Nightly 'thin-lines' (Drawboard Projects: Enhance thin PDF lines): the
// rail card's levels darken the drawing on screen, are saved on this device,
// and Off puts the page back.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

// Mean ink (0 white .. 255 black) of a screenshot, measured in the page.
async function ink(page, pageDiv) {
  const png = (await pageDiv.screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 255 - (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  }, png);
}

test('Thin PDF lines: Thick darkens the drawing, is remembered, Off restores it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.thin-lines', '1'));
  const sheet = await seedSheet('Thin lines');
  await signIn(page, E2E_ACCOUNTS.owner);
  try {
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    const canvas = pageDiv.locator('canvas.survey-pdfjs-page-canvas');
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect(pageDiv).toHaveAttribute('data-raster-shown', /.*/, { timeout: 30_000 });
    const plain = await ink(page, pageDiv);

    await page.locator('[data-thin-lines-toggle]').filter({ visible: true }).first().click();
    const card = page.locator('[data-thin-lines-menu]');
    await expect(card.locator('[data-thin-lines-level="off"]')).toHaveAttribute('aria-checked', 'true');
    await card.locator('[data-thin-lines-level="thick"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-thin-lines', 'thick');
    await expect(canvas).toHaveCSS('filter', /survey-thin-lines-thick/);
    await expect(page.locator('#survey-thin-lines-defs filter#survey-thin-lines-thick')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    const thick = await ink(page, pageDiv);
    expect(thick).toBeGreaterThan(plain * 1.2);

    await page.reload();
    await expect(page.locator('.survey-pdfjs-page-canvas').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('html')).toHaveAttribute('data-thin-lines', 'thick');

    await page.locator('[data-thin-lines-toggle]').filter({ visible: true }).first().click();
    await page.locator('[data-thin-lines-menu] [data-thin-lines-level="off"]').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-thin-lines', /.+/);
    await expect(page.locator('.survey-pdfjs-page-canvas').filter({ visible: true }).first()).toHaveCSS('filter', 'none');
  } finally {
    await sheet.remove();
  }
});
