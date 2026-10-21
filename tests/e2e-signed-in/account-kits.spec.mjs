// Custom builds library: an export kit assigned to one account in the
// database (kits + account_kits, RLS) reaches only that account's template editor.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { clientFromPageSession, expect, signIn, test } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run scripts/kits.mjs, the same tool used for real customers, on the local stack.
function kits(...args) {
  try {
    return { ok: true, out: execFileSync('node', ['scripts/kits.mjs', ...args], {
      encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, SUPABASE_URL: process.env.E2E_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY },
    }) };
  } catch (err) { return { ok: false, out: String(err.stderr) }; }
}
const kitFile = (kit) => { const f = join(mkdtempSync(join(tmpdir(), 'kit-')), 'kit.json'); writeFileSync(f, JSON.stringify(kit)); return f; };

const KIT = { id: 'e2e-acme-doors', version: '1.0.0' };
const columns = [
  { field: 'row_id', header: 'Row ID' }, { field: 'changed_by', header: 'Changed By' },
  { field: 'changed_date', header: 'Changed Date' }, { field: 'name', header: 'Door' },
  { field: 'entity_name', header: 'Gateway' }, { field: 'checklist' }, { field: 'notes', header: 'Notes' },
];

const GOOD = { ...KIT, kind: 'exportKit', minEngine: 1, label: 'Acme doors (E2E)', columns };

test.beforeAll(async () => {
  const pub = kits('publish', kitFile(GOOD));
  if (!pub.ok && !/duplicate key/.test(pub.out)) throw new Error(pub.out);
  const as = kits('assign', E2E_ACCOUNTS.pro.email, KIT.id, KIT.version);
  if (!as.ok) throw new Error(as.out);
});

test.afterAll(async () => {
  kits('unassign', E2E_ACCOUNTS.pro.email, KIT.id);
});

test('the kits tool refuses bad kits, built-in ids and changed versions', async () => {
  expect(kits('publish', kitFile({ ...GOOD, columns: columns.slice(1) })).out).toMatch(/not valid/);
  expect(kits('publish', kitFile({ ...GOOD, id: 'default-survey' })).out).toMatch(/built into the app/);
  expect(kits('publish', kitFile(GOOD)).out).toMatch(/duplicate key/);
  expect(kits('assign', 'nobody@example.com', KIT.id, KIT.version).out).toMatch(/no account/);
  const list = kits('list');
  expect(list.ok).toBe(true);
  expect(list.out).toContain(`${E2E_ACCOUNTS.pro.email}\t${KIT.id}@${KIT.version}`);
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
