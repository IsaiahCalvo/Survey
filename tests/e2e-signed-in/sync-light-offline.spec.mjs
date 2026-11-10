// The sync light turns to "Offline" the moment the device loses its signal
// (deep test 2026-11-10: it stayed green "Up to date" for about 17 s, until a
// save failed), with a notice that stays until the signal is back. Checked on desktop, phone web and the phone app layouts.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';

async function seedDocument() {
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const bytes = fs.readFileSync(path.resolve('debug/fixtures/clickable-link-test.pdf'));
  const id = randomUUID();
  const filePath = `${ownerId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const name = `E2E sync light ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  return {
    name,
    async remove() {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([filePath]);
    },
  };
}

const LAYOUTS = [
  { label: 'desktop', viewport: { width: 1400, height: 900 } },
  { label: 'phone web', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { label: 'iOS app', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, native: 'ios' },
  { label: 'Android app', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, native: 'android' },
];

for (const layout of LAYOUTS) {
  test.describe(layout.label, () => {
    test.use({ viewport: layout.viewport, hasTouch: !!layout.hasTouch, isMobile: !!layout.isMobile });

    test(`the sync light says Offline as soon as the signal drops (${layout.label})`, async ({ page, context }) => {
      test.setTimeout(150_000);
      if (layout.native) {
        await context.addInitScript((platform) => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: () => false, Plugins: {} };
        }, layout.native);
      }
      const doc = await seedDocument();
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        const phone = layout.viewport.width < 700;
        const title = page.getByText(doc.name, { exact: true }).filter({ visible: true }).first();
        if (phone) await title.tap(); else await title.click();
        const openFile = page.getByRole('button', { name: 'Open file' });
        if (await openFile.isVisible().catch(() => false)) await (phone ? openFile.tap() : openFile.click());
        await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });

        const light = (name) => page.getByRole('button', { name }).filter({ visible: true }).first();
        await expect(light(/^Up to date/)).toBeVisible({ timeout: 30_000 });

        await context.setOffline(true);
        const dropped = Date.now();
        await expect(light(/^Offline\b/)).toBeVisible({ timeout: 3_000 });
        expect(Date.now() - dropped).toBeLessThan(3_000);
        // A notice says so too, and stays while the signal is gone.
        const notice = page.getByText(/^You are offline\. Keep working/).filter({ visible: true }).first();
        await expect(notice).toBeVisible({ timeout: 3_000 });
        await page.waitForTimeout(8_000);
        await expect(notice).toBeVisible();

        await context.setOffline(false);
        await expect(light(/^Up to date/)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(/^You are back online/).filter({ visible: true }).first()).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText(/^You are offline\. Keep working/).filter({ visible: true })).toHaveCount(0, { timeout: 5_000 });
      } finally {
        await context.setOffline(false).catch(() => {});
        await doc.remove();
      }
    });
  });
}
