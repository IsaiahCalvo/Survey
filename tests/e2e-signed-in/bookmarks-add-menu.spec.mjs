// The Bookmarks "Add bookmark" menu spans the rail's title row (Drawboard PDF
// Pro trial audit 2026-11-09: it drew 42px wide, the fields were slivers).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

test('the Add bookmark menu is full width and its fields take typing', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Add bookmark' }).filter({ visible: true }).first().click();
  const name = page.getByPlaceholder('Bookmark name');
  await expect(name).toBeVisible();
  const menuWidth = await name.evaluate((el) => el.closest('[style*="absolute"]').getBoundingClientRect().width);
  expect(menuWidth).toBeGreaterThan(200);
  // A press inside the menu keeps it open.
  await name.click();
  await page.keyboard.type('Door schedule');
  await expect(name).toHaveValue('Door schedule');
  await expect(page.getByText('New folder', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});
