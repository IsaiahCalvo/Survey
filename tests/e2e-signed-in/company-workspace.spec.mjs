// Company workspace (Enterprise, beta 'company-admin'): an owner creates the
// company in Settings, invites a person, that person joins from their own
// Settings, the owner makes them admin, and the activity log the database
// wrote shows every step. Also: the log is closed to plain members and to
// people outside the company, and direct table writes are refused.
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import { adminClient, apiClientFor, expect, profileChip, signIn, test } from './helpers.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const flagOn = (page) => page.addInitScript(() => localStorage.setItem('survey.flag.company-admin', '1'));

async function openCompanyTab(page, account) {
  await profileChip(page, account).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Company' }).click();
}

async function clearCompanies(admin) {
  const emails = Object.values(E2E_ACCOUNTS).map((a) => a.email);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ids = (users?.users || []).filter((u) => emails.includes(u.email)).map((u) => u.id);
  const { data: rows } = await admin.from('organization_members').select('organization_id').in('user_id', ids);
  const orgs = [...new Set((rows || []).map((r) => r.organization_id))];
  if (orgs.length) await admin.from('organizations').delete().in('id', orgs);
  await admin.from('organization_invites').delete().in('email', emails);
}

test.beforeEach(async () => { await clearCompanies(adminClient()); });
test.afterEach(async () => { await clearCompanies(adminClient()); });

test('flag off: no Company tab', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.company-admin', '0'));
  const account = E2E_ACCOUNTS.owner;
  await signIn(page, account);
  await profileChip(page, account).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('tab', { name: 'Subscription' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Company' })).toHaveCount(0);
});

test('create a company, invite, join, change role, and read the log', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = E2E_ACCOUNTS.owner;
  const editor = E2E_ACCOUNTS.editor;
  await flagOn(page);
  await signIn(page, owner);
  await openCompanyTab(page, owner);

  await page.getByLabel('Company name').fill('Acme Builders');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Acme Builders' })).toBeVisible();
  await expect(page.getByText('1 of 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Not paid yet')).toBeVisible();

  await page.getByLabel('Invite by email').fill(editor.email);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `Invited ${editor.email}` })).toBeVisible();
  await expect(page.getByText('2 of 3', { exact: true })).toBeVisible();

  // The invited person joins from their own Settings.
  const other = await browser.newContext();
  await other.route((url) => !['data:', 'blob:'].includes(url.protocol) && !LOCAL_HOSTS.has(url.hostname), (r) => r.abort('blockedbyclient'));
  const page2 = await other.newPage();
  await flagOn(page2);
  await signIn(page2, editor);
  await openCompanyTab(page2, editor);
  await expect(page2.getByText(`${owner.email} invited you as member`)).toBeVisible();
  await page2.getByRole('button', { name: 'Join' }).click();
  await expect(page2.getByRole('heading', { name: 'Acme Builders' })).toBeVisible();
  // A member sees the people list but not the activity log or invite box.
  await expect(page2.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(page2.getByRole('heading', { name: 'Activity log' })).toHaveCount(0);
  await expect(page2.getByLabel('Invite by email')).toHaveCount(0);
  const memberClient = await apiClientFor(editor);
  const peek = await memberClient.from('organization_activity').select('id');
  expect(peek.data).toEqual([]);
  await other.close();

  // Owner makes them admin.
  await page.reload();
  await openCompanyTab(page, owner);
  await expect(page.getByText(editor.label, { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: `Role for ${editor.email}` }).click();
  await page.getByRole('option', { name: 'Admin' }).click();
  await expect(page.getByText(`${owner.email} changed the role of ${editor.email} Member to Admin`)).toBeVisible();

  const log = page.getByRole('list', { name: 'Activity' });
  await expect(log.getByText(`${owner.email} created the company`)).toBeVisible();
  await expect(log.getByText(`${owner.email} invited ${editor.email} as member`)).toBeVisible();
  await expect(log.getByText(`${editor.email} joined the company`)).toBeVisible();

  await page.getByRole('button', { name: 'People', exact: true }).click();
  await expect(log.getByText(`${owner.email} created the company`)).toHaveCount(0);
  await expect(log.getByText(`${editor.email} joined the company`)).toBeVisible();

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^acme-builders-activity-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('the database refuses direct writes and outsiders', async () => {
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const outsider = await apiClientFor(E2E_ACCOUNTS.free);
  const made = await owner.rpc('create_organization', { p_name: 'Probe Co' });
  expect(made.error).toBeNull();
  const org = made.data;

  const bump = await owner.from('organizations').update({ seat_limit: 999, billing_status: 'active' }).eq('id', org).select();
  expect(bump.error?.code === '42501' || (bump.data || []).length === 0).toBe(true);
  const sneak = await outsider.from('organization_members').insert({ organization_id: org, user_id: (await outsider.auth.getUser()).data.user.id, role: 'owner' });
  expect(sneak.error).not.toBeNull();
  const look = await outsider.from('organizations').select('id').eq('id', org);
  expect(look.data).toEqual([]);
  const invite = await outsider.rpc('invite_organization_member', { p_org: org, p_email: 'x@example.com', p_role: 'member' });
  expect(invite.error?.message).toMatch(/owner or admin/);

  const row = await adminClient().from('organizations').select('seat_limit, billing_status').eq('id', org).single();
  expect(row.data).toEqual({ seat_limit: 3, billing_status: 'none' });
});

// Manage team (Pro, stable): a person's "View activity" lists the files of
// the project they edited, from the app's own history rows.
test('Manage team: View activity shows the files a person edited', async ({ page }) => {
  const admin = adminClient();
  const editor = E2E_ACCOUNTS.editor;
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const editorId = users.users.find((u) => u.email === editor.email).id;
  const eventId = `e2e-team-activity-${Date.now()}`;
  await admin.from('document_history_events').insert({
    document_id: E2E_DOCUMENT.id, user_id: editorId, client_event_id: eventId, event_type: 'create', summary: 'Added a pen mark',
  });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByRole('button', { name: 'Projects', exact: true }).filter({ visible: true }).first().click();
    await page.getByText(E2E_PROJECT.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Manage team' }).filter({ visible: true }).first().click();
    const team = page.getByRole('dialog', { name: 'Manage team' });
    const row = team.locator('div').filter({ hasText: editor.email }).filter({ has: page.getByRole('button', { name: 'More' }) }).last();
    await row.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'View activity' }).click();
    await expect(page.getByText(E2E_DOCUMENT.name, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/^1 file$/)).toBeVisible();
  } finally {
    await admin.from('document_history_events').delete().eq('client_event_id', eventId);
  }
});
