// New blank document from Home (beta flag 'new-document', Drawboard PDF Pro
// trial audit 2026-11-09: Home could only upload). Desktop: New opens the
// form; phone: New opens a sheet with Upload PDF and Blank document. The
// made PDF is saved like an upload and opens with the asked-for pages.
import crypto from 'node:crypto';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

async function removeByName(name) {
  const admin = adminClient();
  const { data } = await admin.from('documents').select('id, file_path').ilike('name', `${name}%`);
  for (const row of data || []) {
    await admin.from('documents').delete().eq('id', row.id);
    if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
  }
  return (data || []).length;
}

for (const layout of ['desktop', 'phone']) {
  test.describe(layout, () => {
    if (layout === 'phone') test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('New makes a blank document and opens it', async ({ page }) => {
      test.setTimeout(150_000);
      await page.addInitScript(() => localStorage.setItem('survey.flag.new-document', '1'));
      const name = `E2E blank ${layout} ${crypto.randomUUID().slice(0, 6)}`;
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        const press = (locator) => (layout === 'phone' ? locator.tap() : locator.click());
        await press(page.locator(`[data-home-new="${layout}"]`).filter({ visible: true }).first());
        if (layout === 'phone') {
          const sheet = page.locator('[data-home-new-sheet]');
          await expect(sheet.getByRole('menuitem', { name: 'Upload PDF' })).toBeVisible();
          await press(sheet.getByRole('menuitem', { name: 'Blank document' }));
        }
        const dialog = page.locator('[data-new-document-dialog]');
        await expect(dialog).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
        await dialog.getByLabel('Name').fill(name);
        if (layout === 'phone') {
          await dialog.getByLabel('Page size').selectOption('tabloid');
        } else {
          await dialog.getByRole('button', { name: 'Page size' }).click();
          await page.getByRole('option', { name: /Tabloid/ }).or(page.getByRole('menuitemradio', { name: /Tabloid/ })).first().click();
        }
        await dialog.getByLabel('Pages').fill('3');
        await press(dialog.getByRole('radio', { name: 'Landscape' }));
        await press(dialog.getByRole('radio', { name: 'Grid' }));
        await expect(dialog.locator('[data-new-document-sketch="landscape grid"]')).toBeVisible();
        await page.screenshot({ path: test.info().outputPath(`new-document-${layout}.png`) });
        await press(dialog.getByRole('button', { name: 'Create' }));
        await expect(dialog).toHaveCount(0, { timeout: 60_000 });
        // It opens: three landscape pages.
        const pages = page.locator('.survey-pdfjs-page-div[data-page-number]');
        await expect(pages).toHaveCount(3, { timeout: 60_000 });
        const first = await pages.first().boundingBox();
        expect(first.width).toBeGreaterThan(first.height);
        // And it is saved under its name.
        await expect.poll(async () => {
          const { data } = await adminClient().from('documents').select('name, page_count').ilike('name', `${name}%`);
          return data?.length || 0;
        }, { timeout: 30_000 }).toBe(1);
      } finally {
        await removeByName(name);
      }
    });
  });
}

test('flag off: Home keeps a plain Upload', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, E2E_ACCOUNTS.owner);
  await expect(page.locator('button.documents-desktop-upload').filter({ visible: true })).toHaveCount(1);
  await expect(page.locator('[data-home-new]')).toHaveCount(0);
});
