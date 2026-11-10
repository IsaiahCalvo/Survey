// Back while New still says "Creating…" (follow-up to R4-C B2): the dialog
// closes at once, Home stays usable, and the new file is made and listed but
// does not open over Home a moment later. Cancel does the same.
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

test.use({ viewport: { width: 1400, height: 900 } });

test('Back or Cancel while New is making the file closes it and leaves Home in front', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.new-document', '1');
    localStorage.setItem('survey.flag.back-button', '1');
  });
  // The new row is written slowly, so "Creating…" stays up for a while.
  await page.route('**/rest/v1/documents*', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 3000));
    await route.fallback();
  });
  const prefix = `E2E new-while-creating ${crypto.randomUUID().slice(0, 6)}`;
  const viewerPage = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    for (const how of ['back', 'cancel']) {
      const newButton = page.locator('[data-home-new="desktop"]').filter({ visible: true }).first();
      await newButton.click();
      const dialog = page.locator('[data-new-document-dialog]');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Name').fill(`${prefix} ${how}`);
      await dialog.getByRole('button', { name: /^Create/ }).first().click();
      await expect(dialog.getByRole('button', { name: /Creating/ })).toBeVisible();
      if (how === 'back') await page.goBack({ timeout: 5000 }).catch(() => {});
      else await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toHaveCount(0, { timeout: 3000 });
      expect(page.url().startsWith('http://127.0.0.1')).toBe(true);
      // Made and listed, never opened over Home.
      await expect(page.getByText(`${prefix} ${how}`, { exact: false }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      await expect(viewerPage).toHaveCount(0);
      await expect(newButton).toBeVisible();
    }
  } finally {
    await removeByPrefix(prefix);
  }
});
