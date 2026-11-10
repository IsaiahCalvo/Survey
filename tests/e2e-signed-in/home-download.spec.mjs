// Download from Home (beta flag 'home-download', Drawboard PDF Pro trial audit
// 2026-11-09: Survey could not download from its file list). The row menu's
// Download opens the document and saves it with its marks.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

for (const on of [true, false]) {
  test(`Home row menu ${on ? 'downloads' : 'has no Download'}`, async ({ page }) => {
    test.setTimeout(150_000);
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.home-download', '1'));
    const sheet = await seedSheet('Home download');
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
      await row.click({ button: 'right' });
      const item = page.getByRole('menuitem', { name: 'Download', exact: true });
      if (!on) {
        await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
        await expect(item).toHaveCount(0);
        return;
      }
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        item.click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/Home download.*\.pdf$/);
      const path = await download.path();
      const { readFileSync } = await import('node:fs');
      expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
      // A second download of the same, now open, document still runs.
      await page.getByRole('button', { name: 'Home', exact: true }).first().click();
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click({ button: 'right' });
      const [again] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.getByRole('menuitem', { name: 'Download', exact: true }).click(),
      ]);
      expect(again.suggestedFilename()).toMatch(/\.pdf$/);
    } finally {
      await sheet.remove();
    }
  });
}
