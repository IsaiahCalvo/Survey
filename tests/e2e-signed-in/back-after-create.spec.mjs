// Back right after Create (Nightly 'back-button' + 'new-document', R4-A/R4-B
// break test B2): pressing Back while the new document opens must close the
// document, never step past Survey's first history entry.
import crypto from 'node:crypto';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

async function removeByPrefix(prefix) {
  const admin = adminClient();
  const { data } = await admin.from('documents').select('id, file_path').ilike('name', `${prefix}%`);
  for (const row of data || []) {
    await admin.from('documents').delete().eq('id', row.id);
    if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
  }
}

for (const layout of ['desktop', 'phone']) {
  test.describe(layout, () => {
    if (layout === 'phone') test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test(`Back right after Create stays in Survey (${layout})`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.addInitScript(() => {
        localStorage.setItem('survey.flag.new-document', '1');
        localStorage.setItem('survey.flag.back-button', '1');
      });
      const prefix = `E2E back-create ${layout} ${crypto.randomUUID().slice(0, 6)}`;
      const press = (locator) => (layout === 'phone' ? locator.tap() : locator.click());
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        for (const delay of [0, 150, 300]) {
          await press(page.locator(`[data-home-new="${layout}"]`).filter({ visible: true }).first());
          if (layout === 'phone') await press(page.locator('[data-home-new-sheet]').getByRole('menuitem', { name: 'Blank document' }));
          const dialog = page.locator('[data-new-document-dialog]');
          await expect(dialog).toBeVisible();
          await dialog.getByLabel('Name').fill(`${prefix} ${delay}`);
          await press(dialog.getByRole('button', { name: /^Create/ }).first());
          if (delay) await page.waitForTimeout(delay);
          await page.goBack({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(2500);
          expect(page.url().startsWith('http://127.0.0.1'), `Back ${delay} ms after Create stayed in Survey`).toBe(true);
          // Back to Home for the next try (Back again if the document is still open).
          if (await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).count()) {
            await page.goBack({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(1500);
            expect(page.url().startsWith('http://127.0.0.1')).toBe(true);
          }
          await expect(page.locator(`[data-home-new="${layout}"]`).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
        }
      } finally {
        await removeByPrefix(prefix);
      }
    });
  });
}
