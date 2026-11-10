// "No scale on this page" chip (Nightly flag 'measure-scale-chip', Drawboard
// PDF Pro trial audit 2026-11-10): arming a measure tool on a page with no
// scale shows the chip; Set scale opens the scale dialog; once a scale is set
// the chip goes away. Flag off: no chip.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';
import { seedSheet } from './seedSheet.mjs';

async function openSheet(page, flagOn) {
  await page.addInitScript((on) => {
    if (on) localStorage.setItem('survey.flag.measure-scale-chip', '1');
  }, flagOn);
  const sheet = await seedSheet(`Scale chip ${flagOn ? 'on' : 'off'}`, { size: [792, 612], pages: 1 });
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible({ timeout: 60_000 });
  return sheet;
}

async function armLength(page) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.locator('[data-measure-tool="menu"]').click();
  await page.locator('[data-measure-tool="length"]').click();
}

test('measuring with no scale shows the chip; Set scale clears it', async ({ page }) => {
  test.setTimeout(150_000);
  const sheet = await openSheet(page, true);
  try {
    const chip = page.locator('[data-measure-no-scale]');
    await expect(chip).toHaveCount(0);
    await armLength(page);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('No scale set');
    await chip.getByRole('button', { name: 'Set scale' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set page scale' });
    await expect(dialog).toBeVisible();
    await expect(chip).toHaveCount(0);
    await dialog.locator('[data-measure-preset-option="1/4"]').click();
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();
    await expect(chip).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});

test('flag off: no chip', async ({ page }) => {
  test.setTimeout(120_000);
  const sheet = await openSheet(page, false);
  try {
    await armLength(page);
    await expect(page.locator('.measure-scale-bar, [data-measure-tool="menu"]').first()).toBeVisible();
    await expect(page.locator('[data-measure-no-scale]')).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});

test('calibrating: the chip says what to do, and Cancel puts the tool down', async ({ page }) => {
  test.setTimeout(150_000);
  const sheet = await openSheet(page, true);
  try {
    await armLength(page);
    await page.locator('[data-measure-no-scale]').getByRole('button', { name: 'Set scale' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set page scale' });
    await dialog.getByText('Calibrate instead').click();
    await expect(dialog).toBeHidden();
    const chip = page.locator('[data-measure-calibrating]');
    await expect(chip).toContainText('Draw along a length you know');
    await expect(page.locator('[data-measure-no-scale]')).toHaveCount(0);
    await chip.getByRole('button', { name: 'Cancel' }).click();
    await expect(chip).toHaveCount(0);
    await expect(page.locator('[data-measure-no-scale]')).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});
