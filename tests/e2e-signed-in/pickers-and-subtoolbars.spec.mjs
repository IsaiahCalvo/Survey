// Owner issue note 2026-10-26, batch B (pickers and sub-toolbars), in the real
// app: the text settings swap into row 2 in place of the regular ones, the
// Width pill is the number alone, the arrow has ONE ends pill (since
// 2026-10-28 a plain list of heads with a Both ends switch), and Set page
// scale is a chip dialog.
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
  // Owner 2026-10-28 ("a little simpler"): the heads are a plain list and
  // "Both ends" is one switch under it.
  await ends.click();
  const heads = page.getByRole('listbox', { name: 'Arrow ends' });
  await expect(heads).toBeVisible();
  await expect(page.locator('[data-arrow-ends-card], [data-stroke-card-sample]')).toHaveCount(0);
  const bothEnds = page.locator('[data-arrow-both-ends]');
  await bothEnds.click();
  await expect(bothEnds).toHaveAttribute('aria-checked', 'true');
  await heads.getByRole('option', { name: 'Circle' }).click();
  await expect(heads).toBeHidden();
  await expect(ends).toContainText('Circle');
  await ends.click();
  await expect(bothEnds).toHaveAttribute('aria-checked', 'true');
  await expect(heads.getByRole('option', { name: 'Circle' })).toHaveAttribute('aria-selected', 'true');
  // No head is one row, and it takes the second head off too.
  await heads.getByRole('option', { name: 'None' }).click();
  await expect(ends).toContainText('None');
  await ends.click();
  await expect(bothEnds).toHaveAttribute('aria-checked', 'false');
  // Both ends again brings back a head.
  await bothEnds.click();
  await page.keyboard.press('Escape');
  await expect(ends).toContainText('Filled');

  // The Style menu is a plain list: Solid, Dashed, Dotted - no Cloud on a line.
  const styleButton = row.getByRole('button', { name: 'Style', exact: true });
  await styleButton.click();
  const styles = page.getByRole('listbox', { name: 'Style' });
  await expect(styles.getByRole('option')).toHaveText(['Solid', 'Dashed', 'Dotted']);
  await styles.getByRole('option', { name: 'Dashed' }).click();
  await expect(styleButton).toContainText('Dashed');
  await styleButton.click();
  // Arrow keys move between the rows, as every list does.
  await styles.getByRole('option', { name: 'Dashed' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(styles.getByRole('option', { name: 'Dotted' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(styles.getByRole('option', { name: 'Solid' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(styleButton).toContainText('Solid');

  // The Width card is the typed number and the quick picks, nothing else.
  await width.click();
  const sizeCard = page.locator('[data-size-card="true"]');
  await expect(sizeCard.getByRole('textbox', { name: 'Width' })).toBeVisible();
  await expect(sizeCard.locator('input[type="range"], [data-size-card-sample]')).toHaveCount(0);
  await sizeCard.getByRole('option', { name: '4 pt', exact: true }).click();
  await expect(width).toHaveAttribute('aria-label', 'Width: 4 pt');
  await width.click();
  await sizeCard.getByRole('option', { name: '2 pt', exact: true }).click();

  // Owner 2026-10-28: a polyline is a line, and a line is never clouded.
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Polyline', exact: true }).first().click();
  await styleButton.click();
  await expect(styles.getByRole('option')).toHaveText(['Solid', 'Dashed', 'Dotted']);
  await page.keyboard.press('Escape');
  // A closed shape still takes Cloud.
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Polygon', exact: true }).first().click();
  await styleButton.click();
  await expect(styles.getByRole('option')).toHaveText(['Solid', 'Dashed', 'Dotted', 'Cloud']);
  await page.keyboard.press('Escape');

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
