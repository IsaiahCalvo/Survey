// KAL-649: what a first outside tester meets.
//  - A signed-out invite link offers Create free account first.
//  - A person who joined from an invite email sets a name, a password and the
//    Terms tick on the invite page, and can then sign in with that password.
//  - An email on the 'tester-pro' list at /flags is on Pro from sign-up, and
//    back on Free once taken off; a plan that was not given by the list stays.
import { DESKTOP, PHONE } from '../../debug/scenarios/test-plan/tp-local-doc.mjs';
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const PASSWORD = 'E2e-local-only-123!';
const EMAIL_PATTERN = /^e2e-testerready-[a-z]+-\d+@example\.com$/;

async function usersByEmail(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users;
}

async function cleanUp() {
  const admin = adminClient();
  await admin.from('feature_flags').update({ mode: 'off', tester_emails: [] }).eq('key', 'tester-pro');
  await admin.from('document_invites').delete().like('token', 'testerready%');
  const ids = (await usersByEmail(admin)).filter((user) => EMAIL_PATTERN.test(user.email || '')).map((user) => user.id);
  if (!ids.length) return;
  await admin.from('document_collaborators').delete().in('user_id', ids);
  await admin.from('user_subscriptions').delete().in('user_id', ids);
  await admin.from('users').delete().in('id', ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
}

test.describe.configure({ timeout: 120_000 });
test.beforeAll(cleanUp);
test.afterAll(cleanUp);

for (const [size, device] of [['desktop', DESKTOP], ['phone', PHONE]]) test.describe(size, () => {
  test.use(device);

  test('signed out: an invite link offers a free account first', async ({ page }) => {
    await page.goto('/invite/testerready-no-such-invite', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Create free account' }).click({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 60_000 });
  });

  test('joined from an invite email: finishes the account, then signs in with the password', async ({ browser, baseURL }) => {
    const admin = adminClient();
    const email = `e2e-testerready-${size}-${Date.now()}@example.com`;
    const token = `testerready${size}${Date.now()}`;
    const { data: doc } = await admin.from('documents').select('user_id').eq('id', E2E_DOCUMENT.id).single();
    const { error: inviteError } = await admin.from('document_invites').insert({
      document_id: E2E_DOCUMENT.id, token, role: 'viewer', intended_role: 'viewer', target_email: email,
      created_by: doc.user_id, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(inviteError).toBeNull();
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: `${baseURL}/invite/${token}` } });
    expect(error).toBeNull();

    const context = await browser.newContext(device);
    const page = await context.newPage();
    await page.goto(link.properties.action_link);
    await expect(page.getByText('Finish your account')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Open document' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter your first and last name.');
    await page.getByLabel('First name').fill('Ivy');
    await page.getByLabel('Last name').fill('Invited');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('button', { name: 'Open document' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Finish your account')).toHaveCount(0);
    await context.close();

    const created = (await usersByEmail(admin)).find((user) => user.email === email);
    expect(created.user_metadata.full_name).toBe('Ivy Invited');
    expect(created.user_metadata.terms_accepted.terms).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const again = await browser.newContext(device);
    const second = await again.newPage();
    await second.goto('/', { waitUntil: 'domcontentloaded' });
    const dialog = second.getByRole('dialog', { name: 'Welcome back' });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Password').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await again.close();
  });
});

test('tester-pro: a listed email is on Pro from sign-up and back on Free when taken off', async () => {
  const admin = adminClient();
  const email = `e2e-testerready-list-${Date.now()}@example.com`;
  const users = await usersByEmail(admin);
  const idOf = (address) => users.find((user) => user.email === address).id;
  const plan = async (userId) => (await admin.from('user_subscriptions').select('tier, status, tester_grant').eq('user_id', userId).single()).data;

  // Mixed case and an existing Free account, an existing Pro account, and one who has not signed up yet.
  const { error } = await admin.from('feature_flags')
    .update({ mode: 'testers', tester_emails: [email.toUpperCase(), E2E_ACCOUNTS.free.email, E2E_ACCOUNTS.pro.email] })
    .eq('key', 'tester-pro');
  expect(error).toBeNull();
  expect(await plan(idOf(E2E_ACCOUNTS.free.email))).toEqual({ tier: 'pro', status: 'trialing', tester_grant: true });
  expect(await plan(idOf(E2E_ACCOUNTS.pro.email))).toEqual({ tier: 'pro', status: 'active', tester_grant: false });
  expect(await plan(idOf(E2E_ACCOUNTS.editor.email))).toEqual({ tier: 'free', status: 'active', tester_grant: false });

  const { data: made, error: makeError } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  expect(makeError).toBeNull();
  expect(await plan(made.user.id)).toEqual({ tier: 'pro', status: 'trialing', tester_grant: true });

  await admin.from('feature_flags').update({ tester_emails: [E2E_ACCOUNTS.pro.email] }).eq('key', 'tester-pro');
  expect(await plan(idOf(E2E_ACCOUNTS.free.email))).toEqual({ tier: 'free', status: 'active', tester_grant: false });
  expect(await plan(made.user.id)).toEqual({ tier: 'free', status: 'active', tester_grant: false });
  expect(await plan(idOf(E2E_ACCOUNTS.pro.email))).toEqual({ tier: 'pro', status: 'active', tester_grant: false });
});
