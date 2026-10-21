// Custom builds library: an export kit assigned to one account in the
// database (kits + account_kits, RLS) reaches only that account's template editor.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, clientFromPageSession, expect, signIn, test } from './helpers.mjs';

const KIT = { id: 'e2e-acme-doors', version: '1.0.0' };
const columns = [
  { field: 'row_id', header: 'Row ID' }, { field: 'changed_by', header: 'Changed By' },
  { field: 'changed_date', header: 'Changed Date' }, { field: 'name', header: 'Door' },
  { field: 'entity_name', header: 'Gateway' }, { field: 'checklist' }, { field: 'notes', header: 'Notes' },
];

async function userId(admin, email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email === email).id;
}

test.beforeAll(async () => {
  const admin = adminClient();
  await admin.from('kits').upsert({ ...KIT, kind: 'exportKit', label: 'Acme doors (E2E)', definition: { minEngine: 1, columns } }, { ignoreDuplicates: true });
  const pro = await userId(admin, E2E_ACCOUNTS.pro.email);
  const { error } = await admin.from('account_kits').upsert({ user_id: pro, kit_id: KIT.id, kit_version: KIT.version });
  if (error) throw error;
});

test.afterAll(async () => {
  const admin = adminClient();
  await admin.from('account_kits').delete().eq('kit_id', KIT.id);
});

async function openTemplateEditor(page) {
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  const layout = page.getByRole('combobox', { name: 'Excel layout' });
  if (!(await layout.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /New template|Create template|Add template/ }).filter({ visible: true }).first().click();
  }
  await expect(layout).toBeVisible({ timeout: 30_000 });
  return layout;
}

test('the account given a kit sees it in Excel layout; RLS hides it from others', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.pro);
  const rows = await (await clientFromPageSession(page)).from('kits').select('id');
  expect(rows.data.map((r) => r.id)).toEqual([KIT.id]);
  const layout = await openTemplateEditor(page);
  await expect(layout.locator('option', { hasText: 'Acme doors (E2E)' })).toHaveCount(1);
});

test('an account without the kit does not get it', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.free);
  const rows = await (await clientFromPageSession(page)).from('kits').select('id');
  expect(rows.data).toEqual([]);
  const layout = await openTemplateEditor(page);
  await expect(layout.locator('option', { hasText: 'Wireless lock schedule' })).toHaveCount(1);
  await expect(layout.locator('option', { hasText: 'Acme doors' })).toHaveCount(0);
});
