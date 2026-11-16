// Nightly 'mark-bar-by-kind' (KAL-651, Drawboard's bar as recorded on Windows
// 2026-11-16): the bar over a picked mark goes by its kind. A rectangle gets
// Fill and no Start and end; with the flag off the bar is as before.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function open(page, label, flagOn) {
  await page.addInitScript((on) => {
    if (on) localStorage.setItem('survey.flag.mark-bar-by-kind', '1');
    else localStorage.setItem('survey.flag.mark-bar-by-kind', '0');
    localStorage.removeItem('survey.propertiesPanel.open');
  }, flagOn);
  const sheet = await seedSheet(label);
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return { sheet, pageDiv, marks: pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

async function drawAndPickRect(page, pageDiv, marks) {
  const box = await pageDiv.boundingBox();
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
  await page.mouse.move(box.x + 150, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 210, box.y + 290, { steps: 4 });
  await page.mouse.move(box.x + 270, box.y + 320, { steps: 4 });
  await page.mouse.up();
  await expect(marks).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().click();
  await page.mouse.move(box.x + 120, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 300, { steps: 6 });
  await page.mouse.move(box.x + 320, box.y + 360, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-selection-quick-bar][data-visible="true"]')).toBeVisible();
}

test('a picked rectangle gets Fill on its bar, and a fill colour picked there fills it', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv, marks } = await open(page, 'Bar by kind', true);
  try {
    await drawAndPickRect(page, pageDiv, marks);
    const bar = page.locator('[data-selection-quick-bar]');
    const fill = bar.locator('[data-selection-quick-kind="fill"] button');
    await expect(fill).toBeVisible();
    await expect(bar.locator('[data-selection-quick-kind="ends"]')).toHaveCount(0);
    await expect(bar.locator('[data-selection-quick-kind="text"]')).toHaveCount(0);

    await fill.click();
    const popover = bar.locator('[data-selection-quick-kind-popover="fill"]');
    await expect(popover).toBeVisible();
    const paintOf = () => marks.first().evaluate((g) => (g.querySelector('rect, path, polygon')?.getAttribute('fill') || '').toLowerCase());
    await popover.locator('[data-quick-colour-preset="#0000FF"]').click();
    await expect.poll(paintOf).toMatch(/#0000ff|rgba?\(0, 0, 255(, 1)?\)/);

    await popover.locator('[data-selection-quick-fill-none]').click();
    await expect(popover.locator('[data-selection-quick-fill-none]')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await sheet.remove();
  }
});

test('with the flag off the bar has no Fill button', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv, marks } = await open(page, 'Bar by kind off', false);
  try {
    await drawAndPickRect(page, pageDiv, marks);
    await expect(page.locator('[data-selection-quick-kind]')).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});
