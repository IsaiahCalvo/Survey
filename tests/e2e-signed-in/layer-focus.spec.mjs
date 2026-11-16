// Nightly 'layer-focus' (Drawboard Projects Layers focus mode): with Focus
// on, the marks on other layers fade to the picked strength and the selected
// layer's marks stay full; picking another layer swaps them; off restores all.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function drawRect(page, box, x, y) {
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 80, box.y + y + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

const opacityOf = (loc) => loc.evaluate((el) => Number(getComputedStyle(el).opacity));

test('Focus fades the other layer, follows the selected layer, and turns off', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.layers', '1');
    localStorage.setItem('survey.flag.layer-focus', '1');
  });
  const sheet = await seedSheet('Layer focus');
  await signIn(page, E2E_ACCOUNTS.owner);
  try {
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    const box = await pageDiv.boundingBox();
    const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');

    // One rectangle on the default layer.
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 150, 200);
    await expect(marks).toHaveCount(1);

    // Add Layer 1 (it becomes the selected layer) and draw on it.
    const layersButton = page.getByRole('button', { name: 'Layers', exact: true }).first();
    if ((await layersButton.getAttribute('aria-expanded')) !== 'true') await layersButton.click();
    const panel = page.getByTestId('layers-panel');
    await expect(panel).toBeVisible();
    await page.locator('[data-layer-add]').filter({ visible: true }).first().click();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 300, 300);
    await expect(marks).toHaveCount(2);
    const onDefault = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index][data-mark-layer="default"]');
    const onLayer1 = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]:not([data-mark-layer="default"])');
    await expect(onDefault).toHaveCount(1);
    await expect(onLayer1).toHaveCount(1);

    // Focus on: the default layer's mark fades to 20%, Layer 1's stays full.
    const sw = panel.locator('[data-layer-focus-switch]');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => opacityOf(onDefault)).toBeCloseTo(0.2, 2);
    expect(await opacityOf(onLayer1)).toBe(1);

    // 60%, then pick the default layer: the fade swaps sides.
    await panel.getByRole('radio', { name: 'Other layers at 60%' }).click();
    await expect.poll(() => opacityOf(onDefault)).toBeCloseTo(0.6, 2);
    await panel.locator('[data-layer-id="default"]').click();
    await expect.poll(() => opacityOf(onLayer1)).toBeCloseTo(0.6, 2);
    expect(await opacityOf(onDefault)).toBe(1);

    // Off: everything back to full.
    await sw.click();
    await expect.poll(() => opacityOf(onLayer1)).toBe(1);
    await expect(page.locator('#survey-layer-focus')).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});
