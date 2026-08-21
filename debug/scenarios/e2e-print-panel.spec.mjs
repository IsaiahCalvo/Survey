import { test, expect } from '@playwright/test';

// UL-40–43 leftover: live custom print panel. Requires PRINT_PANEL_ENABLED
// flipped true for this DEV pass, then restored.

async function openPrintPanel(page) {
  const printLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PrintPanel]')) printLogs.push(text);
  });

  await page.goto('/?testPdf=clickable-link-test.pdf');
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

  await page.keyboard.press('Meta+P');
  const dialog = page.getByRole('dialog', { name: 'Print' });
  try {
    await expect(dialog).toBeVisible({ timeout: 8_000 });
  } catch {
    await page.keyboard.press('Control+P');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
  }
  return { dialog, printLogs };
}

test('UL-40–43 custom print panel intended + break + edge', async ({ page }) => {
  test.setTimeout(90_000);
  const { dialog, printLogs } = await openPrintPanel(page);
  const rail = page.locator('[aria-label="Print options"]');
  await expect(rail).toBeVisible();

  // Intended — paper / copies / rotate / markups / dest catalog.
  const paperSelect = rail.locator('select').first();
  await expect(paperSelect).toBeVisible();
  const paperLabels = await paperSelect.locator('option').allTextContents();
  expect(paperLabels).toEqual(expect.arrayContaining([
    'Auto (native size)',
    'Letter · 8.5 × 11 in',
    'Custom W × H…',
  ]));
  expect(paperLabels.length).toBe(10);
  await expect(page.getByRole('button', { name: 'More copies' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rotate clockwise' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Markups' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Color' })).toBeVisible();
  const destSelect = dialog.locator('select').last();
  await expect(destSelect.locator('option[value="pdf"]')).toHaveText('Save as PDF…');
  await expect(page.getByLabel('Close print panel')).toBeVisible();

  // Break — copies floor; garbage custom inches fall back; Clear disables Print.
  const copiesInput = rail.locator('.pp-stepper input');
  await expect(copiesInput).toHaveValue('1');
  await page.getByRole('button', { name: 'Fewer copies' }).click();
  await expect(copiesInput).toHaveValue('1');
  await copiesInput.fill('0');
  await expect(copiesInput).toHaveValue('1');

  await paperSelect.selectOption('custom');
  const width = page.getByLabel('Custom sheet width in inches');
  const height = page.getByLabel('Custom sheet height in inches');
  await expect(width).toBeVisible();
  await width.fill('');
  await width.blur();
  await expect(width).toHaveValue('8.5');
  await height.fill('999');
  await height.blur();
  await expect(height).toHaveValue('200');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('button', { name: /Print 0/ })).toBeDisabled();

  // Edge — increment copies; rotate keeps panel; All restores Print; close.
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('button', { name: /Print \d+ page/ })).toBeEnabled();
  await page.getByRole('button', { name: 'More copies' }).click();
  await expect(copiesInput).toHaveValue('2');
  await copiesInput.fill('1000');
  await expect(copiesInput).toHaveValue('999');
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole('switch', { name: 'Markups' }).click();
  await expect(page.getByRole('switch', { name: 'Markups' })).toHaveAttribute('aria-checked', 'false');

  await page.getByLabel('Close print panel').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  expect(printLogs.some((line) => line.includes('OPEN requested') && line.includes('panel enabled=true'))).toBe(true);
});
