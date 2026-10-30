// Custom builds library: an export kit assigned to one account in the
// database (kits + account_kits, RLS) reaches only that account's template editor.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { clientFromPageSession, expect, signIn, test } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const KIT = { id: 'e2e-acme-doors', version: '1.1.0' };
const columns = [
  { field: 'row_id', header: 'Row ID' }, { field: 'changed_by', header: 'Changed By' },
  { field: 'changed_date', header: 'Changed Date' }, { field: 'name', header: 'Door' },
  { field: 'entity_name', header: 'Gateway' }, { field: 'checklist' }, { field: 'notes', header: 'Notes' },
];

const PASS_FAIL = [{ value: 'Pass', tone: 'good' }, { value: 'Fail', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }];
const GOOD = { ...KIT, kind: 'exportKit', minEngine: 1, label: 'Acme doors (E2E)', columns, answerSet: PASS_FAIL };

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
  expect(kits('publish', kitFile({ ...GOOD, version: '9.9.9', answerSet: [{ value: 'a,b', tone: 'good' }] })).out).toMatch(/not valid/);
  expect(kits('publish', kitFile({ ...GOOD, id: 'default-survey' })).out).toMatch(/built into the app/);
  expect(kits('publish', kitFile(GOOD)).out).toMatch(/duplicate key/);
  expect(kits('assign', 'nobody@example.com', KIT.id, KIT.version).out).toMatch(/no account/);
  const list = kits('list');
  expect(list.ok).toBe(true);
  expect(list.out).toContain(`${E2E_ACCOUNTS.pro.email}\t${KIT.id}@${KIT.version}`);
});

test('fork copies a kit to start the next customer\'s, which then publishes', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'fork-')), 'next.json');
  expect(kits('fork', 'wireless-lock-schedule', 'e2e-next-customer', out).ok).toBe(true);
  expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ id: 'e2e-next-customer', version: '1.0.0', extends: 'wireless-lock-schedule@0.1.0' });
  const fromDb = kits('fork', `${KIT.id}@${KIT.version}`, 'e2e-next-customer', out);
  expect(fromDb.ok, fromDb.out).toBe(true);
  const copy = JSON.parse(readFileSync(out, 'utf8'));
  expect(copy).toMatchObject({ extends: `${KIT.id}@${KIT.version}`, answerSet: PASS_FAIL, label: 'Acme doors (E2E) (copy)' });
  copy.version = `1.0.${Date.now() % 100000}`;
  writeFileSync(out, JSON.stringify(copy));
  const pub = kits('publish', out);
  expect(pub.ok, pub.out).toBe(true);
  expect(kits('fork', 'no-such-kit@1.0.0', 'x', out).out).toMatch(/no kit/);
});

async function openTemplateEditor(page) {
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  const layout = page.getByRole('button', { name: 'Excel layout', exact: true }).filter({ visible: true }).first();
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
  await layout.click();
  const list = page.getByRole('listbox', { name: 'Excel layout' });
  await expect(list.getByRole('option', { name: /Acme doors \(E2E\)/ })).toHaveCount(1);
  // Picking the kit brings its Pass / Fail / N/A answers with it.
  await list.getByRole('option', { name: /Acme doors \(E2E\)/ }).click();
  await expect(layout).toHaveAttribute('data-value', KIT.id);
  await expect(page.getByRole('button', { name: 'Checklist answers', exact: true }).filter({ visible: true }).first()).toHaveAttribute('data-value', 'pass-fail-na');
});

test('an account without the kit does not get it', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.free);
  const rows = await (await clientFromPageSession(page)).from('kits').select('id');
  expect(rows.data).toEqual([]);
  const layout = await openTemplateEditor(page);
  await layout.click();
  const list = page.getByRole('listbox', { name: 'Excel layout' });
  await expect(list.getByRole('option', { name: /Wireless lock schedule/ })).toHaveCount(1);
  await expect(list.getByRole('option', { name: /Acme doors/ })).toHaveCount(0);
});
