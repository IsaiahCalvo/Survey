// Page grid spacing (Nightly flag 'grid-settings', owner 2026-10-26): the
// rail's grid button opens a card - show or hide, Fine / Normal / Wide, or a
// custom spacing - and the grid on every page follows it.
import { test, expect } from '@playwright/test';

const cellPx = (page) => page.evaluate(() => {
  const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] > .survey-pdfjs-page-canvas + div');
  const size = host ? getComputedStyle(host, '::after').backgroundSize : '';
  const scale = Number(getComputedStyle(document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]')).getPropertyValue('--survey-page-scale')) || 1;
  return { px: parseFloat(size), scale };
});

test('Page grid card: show, density presets and a custom spacing', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.grid-settings', '1'));
  await page.goto('/?testPdf=text-search-glyph-lab.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });

  await page.getByRole('button', { name: 'Page grid' }).click();
  const card = page.getByRole('dialog', { name: 'Page grid' });
  await expect(card).toBeVisible();
  await card.getByRole('switch', { name: 'Show grid' }).click();
  await expect(card.getByRole('switch', { name: 'Show grid' })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-page-grid'))).toBe('on');

  let { px, scale } = await cellPx(page);
  expect(px / scale).toBeCloseTo(36, 0);

  await card.getByRole('radio', { name: /^Wide/ }).click();
  ({ px, scale } = await cellPx(page));
  expect(px / scale).toBeCloseTo(72, 0);

  await card.getByRole('radio', { name: /^Fine/ }).click();
  ({ px, scale } = await cellPx(page));
  expect(px / scale).toBeCloseTo(18, 0);

  await card.getByRole('radio', { name: /^Custom/ }).click();
  await card.getByRole('button', { name: 'Grid unit', exact: true }).click();
  await page.getByRole('listbox', { name: 'Grid unit' }).getByRole('option', { name: 'in', exact: true }).click();
  await card.getByRole('spinbutton', { name: 'Grid spacing' }).fill('2');
  await card.getByRole('spinbutton', { name: 'Grid spacing' }).press('Enter');
  ({ px, scale } = await cellPx(page));
  expect(px / scale).toBeCloseTo(144, 0);
  await card.screenshot({ path: 'test-results/page-grid-card.png' });

  // Drawing units with no scale on the page keep the half inch, and say so.
  await card.getByRole('button', { name: 'Grid unit', exact: true }).click();
  await page.getByRole('listbox', { name: 'Grid unit' }).getByRole('option', { name: 'ft (drawing)', exact: true }).click();
  await expect(card).toBeVisible();
  await expect(card.getByText(/Follows each page's scale/)).toBeVisible();
  ({ px, scale } = await cellPx(page));
  expect(px / scale).toBeCloseTo(36, 0);

  // Remembered after a reload.
  await page.reload();
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Page grid' }).click();
  await expect(page.getByRole('dialog', { name: 'Page grid' }).getByRole('radio', { name: /^Custom/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Page grid' })).toHaveCount(0);
});
