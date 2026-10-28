// Enterprise seats on one bill (company workspace, beta 'company-admin'): the
// owner picks seats and goes to checkout for the company; once the payments
// listener marks the company paid, the people in its seats get Enterprise on
// the server, and lose it when the plan ends. Stripe itself is not reached:
// the checkout call is answered here and the paid state is set directly.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, apiClientFor, expect, profileChip, signIn, test } from './helpers.mjs';

const flagOn = (page) => page.addInitScript(() => localStorage.setItem('survey.flag.company-admin', '1'));

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

test('the owner pays for seats; paid seats lift people to Enterprise', async ({ page }) => {
  test.setTimeout(150_000);
  const owner = E2E_ACCOUNTS.owner;
  const editor = E2E_ACCOUNTS.editor;
  const admin = adminClient();
  const ownerApi = await apiClientFor(owner);
  const editorApi = await apiClientFor(editor);

  const made = await ownerApi.rpc('create_organization', { p_name: 'Seat Co' });
  expect(made.error).toBeNull();
  const org = made.data;
  const invite = await ownerApi.rpc('invite_organization_member', { p_org: org, p_email: editor.email, p_role: 'member' });
  expect(invite.error).toBeNull();
  const joined = await editorApi.rpc('accept_organization_invite', { p_invite: invite.data });
  expect(joined.error).toBeNull();

  const before = await editorApi.rpc('my_effective_tier');
  expect(before.error).toBeNull();
  expect(before.data).not.toBe('enterprise');

  // Unpaid: the owner sees the price and pays for the company.
  let checkoutBody = null;
  await page.route('**/functions/v1/create-checkout-session', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    checkoutBody = route.request().postDataJSON();
    return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'Checkout answered by the test.' }) });
  });
  await flagOn(page);
  await signIn(page, owner);
  await profileChip(page, owner).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Company' }).click();
  await expect(page.getByText('Not paid yet')).toBeVisible();
  await expect(page.getByText('$60 a month, $20 per person.', { exact: false })).toBeVisible();
  await page.getByLabel('Seats', { exact: true }).fill('5');
  await expect(page.getByText('$100 a month', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Pay for 5 seats' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Checkout answered by the test.' })).toBeVisible();
  expect(checkoutBody).toMatchObject({ tier: 'enterprise', orgId: org, seats: 5 });
  // Fewer seats than people holding one is refused before checkout.
  await page.getByLabel('Seats', { exact: true }).fill('1');
  await expect(page.getByRole('button', { name: 'Pay for seats' })).toBeDisabled();

  // The listener marks the company paid for 2 seats: owner and editor are in.
  await admin.from('organizations').update({ billing_status: 'active', seat_limit: 2 }).eq('id', org);
  expect((await editorApi.rpc('my_effective_tier')).data).toBe('enterprise');
  const serverTier = await admin.rpc('get_user_tier', { p_user_id: (await editorApi.auth.getUser()).data.user.id });
  expect(serverTier.data).toBe('enterprise');
  // Nobody can ask the seat check about someone else.
  const probe = await editorApi.rpc('_company_seated', { p_user: (await ownerApi.auth.getUser()).data.user.id });
  expect(probe.error).not.toBeNull();

  await page.reload();
  await profileChip(page, owner).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Company' }).click();
  await expect(page.getByText('Enterprise', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage billing' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay for/ })).toHaveCount(0);

  // The plan ends: back to their own plan.
  await admin.from('organizations').update({ billing_status: 'canceled', seat_limit: 3 }).eq('id', org);
  expect((await editorApi.rpc('my_effective_tier')).data).toBe(before.data);
});
