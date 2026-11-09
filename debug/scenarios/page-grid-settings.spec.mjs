// Page grid spacing (Nightly flag 'grid-settings', owner 2026-10-26; redesign
// 2026-11-09): the rail's grid button opens a card - Show grid, Fine / Normal
// / Wide in a row (the grid glides to its new size), a spacing slider that
// redraws the grid live while it drags, and the value with its unit.
import { test, expect } from '@playwright/test';

const cellPx = (page) => page.evaluate(() => {
  const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] > .survey-pdfjs-page-canvas + div');
  const size = host ? getComputedStyle(host, '::after').backgroundSize : '';
  const scale = Number(getComputedStyle(document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]')).getPropertyValue('--survey-page-scale')) || 1;
  return { px: parseFloat(size), scale };
});

test('Page grid card: show, density presets and a custom spacing', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Cannot update a component/.test(m.text())) errors.push(m.text()); });
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
  // The grid glides: part-way through, it is between the two sizes.
  await page.waitForTimeout(120);
  ({ px, scale } = await cellPx(page));
  expect(px / scale).toBeGreaterThan(37);
  expect(px / scale).toBeLessThan(71);
  await page.waitForTimeout(500);
  ({ px, scale } = await cellPx(page));
  expect(px / scale).toBeCloseTo(72, 0);
  await expect(card.getByRole('textbox', { name: 'Grid spacing value' })).toHaveValue('1');

  await card.getByRole('radio', { name: /^Fine/ }).click();
  await page.waitForTimeout(500);
  ({ px, scale } = await cellPx(page));
  expect(px / scale).toBeCloseTo(18, 0);
  await expect(card.getByRole('textbox', { name: 'Grid spacing value' })).toHaveValue('0.25');

  // The slider redraws the grid while it drags, and saves on release.
  const slider = card.getByRole('slider', { name: 'Grid spacing' });
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 });
  ({ px, scale } = await cellPx(page));
  const live = px / scale;
  expect(live).toBeGreaterThan(72);
  await page.mouse.up();
  await expect(card.getByRole('radio', { name: /^Fine/ })).toHaveAttribute('aria-checked', 'false');
  ({ px, scale } = await cellPx(page));
  expect(px / scale).toBeCloseTo(live, 0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('survey.pageGrid.settings.v1')).density)).toBe('custom');

  // Typing a value: 2 in.
  await card.getByRole('textbox', { name: 'Grid spacing value' }).fill('2');
  await card.getByRole('textbox', { name: 'Grid spacing value' }).press('Enter');
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
  await expect(page.getByRole('dialog', { name: 'Page grid' }).getByRole('textbox', { name: 'Grid spacing value' })).toHaveValue('2');
  await expect(page.getByRole('dialog', { name: 'Page grid' }).getByRole('button', { name: 'Grid unit', exact: true })).toContainText('ft');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Page grid' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
