// KAL-618 (Nightly flag 'suite'): a template Category carries Category Types.
// Add two Types to Camera, save, and they are on the template with library
// links; a repeat name is refused in words; a Type can be removed.
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } } },
  { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
];

async function ownerId(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
}

for (const layout of LAYOUTS) {
  test.describe(`category types, ${layout.name}`, () => {
    test.use(layout.use);

    test('add, refuse a repeat, remove and save', async ({ page }) => {
      test.setTimeout(150_000);
      const admin = adminClient();
      const uid = await ownerId(admin);
      const templateId = randomUUID();
      const templateName = `Types Kit ${Date.now() % 100000}`;
      const made = await admin.from('templates').insert({
        id: templateId, user_id: uid, name: templateName,
        config: { modules: [{ id: 'mod-1', name: 'Installation', categories: [{ id: 'cat-cam', name: 'Camera', checklist: [{ id: 'cl-1', text: 'Mounted' }] }] }], entities: [] },
      });
      if (made.error) throw made.error;
      const press = (locator) => (layout.use.hasTouch ? locator.tap() : locator.click());
      try {
        await page.addInitScript(() => localStorage.setItem('survey.flag.suite', '1'));
        await signIn(page, E2E_ACCOUNTS.owner);
        if (layout.use.isMobile) {
          const title = page.locator('.hub-title-switch').filter({ visible: true }).first();
          await title.tap();
          await expect(title).toHaveAttribute('aria-expanded', 'true');
          await page.getByRole('menuitem', { name: 'Templates' }).filter({ visible: true }).first().tap();
        } else {
          await press(page.getByRole('button', { name: 'Templates', exact: true }).filter({ visible: true }).first());
        }
        await press(page.getByText(templateName, { exact: true }).filter({ visible: true }).first());
        const row = page.locator('[data-category-types="cat-cam"]').filter({ visible: true }).first();
        await press(page.locator('.tpl-cat-row, .templates-mobile-category-row').filter({ visible: true }).first());
        await expect(row).toBeVisible();
        const field = row.getByRole('textbox', { name: 'Add a Type to Camera' });
        for (const name of ['PTZ', 'Fisheye', 'Dome']) {
          await field.fill(name);
          await field.press('Enter');
        }
        await expect(row.locator('[data-category-type-id]')).toHaveCount(3);
        await field.fill('ptz');
        await field.press('Enter');
        await expect(row.getByRole('alert')).toHaveText('"ptz" is already a Type of this Category.');
        await field.fill('');
        await press(row.getByRole('button', { name: 'Remove Type Dome' }));
        await expect(row.locator('[data-category-type-id]')).toHaveCount(2);
        const box = await row.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(layout.use.viewport.width);
        await page.screenshot({ path: test.info().outputPath(`types-${layout.name}.png`) });

        await press(page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first());
        await expect.poll(async () => {
          const { data } = await admin.from('templates').select('config').eq('id', templateId).single();
          const category = data?.config?.modules?.[0]?.categories?.[0];
          return (category?.types || []).map((t) => `${t.name}:${t.libraryEntryId ? 'linked' : 'unlinked'}`).join(',');
        }, { timeout: 30_000 }).toBe('PTZ:linked,Fisheye:linked');
        // The library syncs one entry at a time, so the Types land in turn.
        await expect.poll(async () => {
          const { data } = await admin.from('library_entries').select('name,parent_id').eq('created_by', uid).eq('kind', 'categoryType');
          return (data || []).filter((e) => e.parent_id).map((e) => e.name).sort().join(',');
        }, { timeout: 30_000 }).toBe('Fisheye,PTZ');
      } finally {
        await admin.from('templates').delete().eq('id', templateId);
        await admin.from('library_entries').delete().eq('created_by', uid);
      }
    });
  });
}
