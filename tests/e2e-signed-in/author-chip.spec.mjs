// Nightly 'author-chip' (Drawboard Projects parity SS-03 / SS-04): the picked
// marks' bar names who made them, and the chip opens a table by author.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function drawRect(page, box, x, y) {
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 80, box.y + y + 40, { steps: 6 });
  await page.mouse.up();
}

test('one mark shows "You · date"; two show "You" and a table with both', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.author-chip', '1'));
  const sheet = await seedSheet('Author chip');
  await signIn(page, E2E_ACCOUNTS.owner);
  try {
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    const box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 150, 200);
    const chip = page.locator('[data-selection-quick-bar][data-visible="true"] [data-selection-author-chip]');
    await expect(chip).toHaveText(/^You · \w{3} \d{1,2}, \d{4}$/);

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 300, 280);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().click();
    await page.mouse.move(box.x + 120, box.y + 170);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 260, { steps: 6 });
    await page.mouse.move(box.x + 420, box.y + 360, { steps: 6 });
    await page.mouse.up();
    await expect(chip).toHaveText('You');
    await chip.click();
    const table = page.locator('[data-selection-authors]');
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.locator('[data-author-group="You"] td').first()).toHaveText('You (2)');
    await chip.click();
    await expect(table).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});
