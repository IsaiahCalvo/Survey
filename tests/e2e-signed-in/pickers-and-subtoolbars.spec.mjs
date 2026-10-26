// Owner issue note 2026-10-26, batch B (pickers and sub-toolbars), in the real
// app: the text settings swap into row 2 in place of the regular ones, the
// Width pill is the number alone, the arrow has ONE ends pill whose card holds
// the ends and the heads, and Set page scale is a chip dialog.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const ROW = '[data-chrome-format-row]';

test('row 2 swaps between regular and text settings; the arrow and scale pickers are cards', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  const row = page.locator(ROW);

  // #4: the armed text box shows its regular settings first.
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const aa = row.getByRole('button', { name: 'Edit text' });
  await expect(aa).toBeVisible();
  await expect(row.locator('button[aria-label^="Width"]')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Font', exact: true })).toHaveCount(0);
  // Aa swaps the text settings in, in the same row, and back out.
  await aa.click();
  await expect(row.getByRole('button', { name: 'Font', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Bold' })).toBeVisible();
  await expect(row.locator('button[aria-label^="Width"]')).toHaveCount(0);
  await expect(aa).toHaveAttribute('aria-pressed', 'true');
  await aa.click();
  await expect(row.locator('button[aria-label^="Width"]')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Font', exact: true })).toHaveCount(0);

  // #33 + #11: the arrow's settings.
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Arrow', exact: true }).first().click();
  const width = row.locator('button[aria-label^="Width"]');
  await expect(width).toBeVisible();
  await expect(width.locator('.chrome-pill__preview')).toHaveCount(0);
  await expect(row.locator('[data-toolbar-slot="ends"]')).toHaveCount(0);
  const ends = row.getByRole('button', { name: 'Arrow ends' });
  await expect(ends).toContainText('Filled');
  await ends.click();
  const card = page.locator('[data-arrow-ends-card]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-stroke-card-sample] svg')).toHaveCount(1);
  await card.locator('[data-arrow-ends-option="both"]').click();
  await expect(card.locator('[data-arrow-ends-option="both"]')).toHaveAttribute('aria-checked', 'true');
  await card.locator('[data-stroke-tile="openCircle"]').click();
  await expect(card).toBeHidden();
  await expect(ends).toContainText('Circle');
  await ends.click();
  await expect(card.locator('[data-arrow-ends-option="both"]')).toHaveAttribute('aria-checked', 'true');
  await expect(card.locator('[data-stroke-tile="openCircle"]')).toHaveAttribute('aria-checked', 'true');
  // No head is one tile, and it leaves no end chosen.
  await card.locator('[data-stroke-tile="none"]').click();
  await expect(ends).toContainText('None');
  await ends.click();
  await expect(card.locator('[aria-checked="true"]')).toHaveCount(1);
  // Picking an end again brings back a head.
  await card.locator('[data-arrow-ends-option="end"]').click();
  await page.keyboard.press('Escape');
  await expect(ends).toContainText('Filled');

  // The Style card draws the styles as tiles.
  await row.getByRole('button', { name: 'Style', exact: true }).click();
  const style = page.locator('[data-line-style-card]');
  await expect(style.locator('[data-stroke-tile]')).toHaveCount(3);
  await style.locator('[data-stroke-tile="dashed"]').click();
  await expect(row.getByRole('button', { name: 'Style', exact: true })).toContainText('Dashed');
  await row.getByRole('button', { name: 'Style', exact: true }).click();
  await page.locator('[data-line-style-card] [data-stroke-tile="solid"]').click();

  // #13: Set page scale.
  await page.locator('[data-measure-tool="menu"]').click();
  await page.getByText('Page scale…').click();
  const dialog = page.getByRole('dialog', { name: 'Set page scale' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('select')).toHaveCount(0);
  await dialog.locator('[data-measure-preset-option="1/8"]').click();
  await dialog.locator('[data-measure-apply]').click();
  await expect(dialog).toBeHidden();
  await page.locator('[data-measure-tool="menu"]').click();
  await page.getByText('Page scale…').click();
  await expect(dialog).toContainText('now 1/8" = 1\'');
  await expect(dialog.locator('[data-measure-preset-option="1/8"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
