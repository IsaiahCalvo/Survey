// Company sign-in setup (Enterprise, beta 'company-admin'): an owner adds a
// domain, gets the DNS line to prove it, and connects their company login
// themselves through the company-sso function. The DNS lookup is real here,
// so the made-up domain is never found; the proof is then recorded by hand
// and the connection goes to Supabase Auth. Where the stack has SAML off (as
// production does until it is switched on), Connect says so in plain words.
import { readFileSync } from 'node:fs';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, apiClientFor, expect, functionUrl, profileChip, signIn, test } from './helpers.mjs';

const METADATA = readFileSync(new URL('./fixtures/company-idp-metadata.xml', import.meta.url), 'utf8');
const DOMAIN = 'e2e-company-sign-in.test';

async function cleanup(admin) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const owner = users.users.find((u) => u.email === E2E_ACCOUNTS.owner.email);
  const { data: rows } = await admin.from('organization_members').select('organization_id').eq('user_id', owner.id);
  const orgs = (rows || []).map((r) => r.organization_id);
  if (!orgs.length) return;
  const { data: list } = await admin.from('organizations').select('sso_provider_id').in('id', orgs);
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  for (const o of list || []) {
    if (o.sso_provider_id) {
      await fetch(`${process.env.E2E_SUPABASE_URL}/auth/v1/admin/sso/providers/${o.sso_provider_id}`, {
        method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
    }
  }
  await admin.from('organizations').delete().in('id', orgs);
}

test.beforeEach(async () => { await cleanup(adminClient()); });
test.afterEach(async () => { await cleanup(adminClient()); });

test('prove a domain and connect company sign-in from Settings', async ({ page }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const owner = E2E_ACCOUNTS.owner;
  if (process.env.E2E_FUNCTIONS_URL) {
    await page.route('**/functions/v1/company-sso', (route) => route.fallback({ url: functionUrl('company-sso') }));
  }
  await page.addInitScript(() => localStorage.setItem('survey.flag.company-admin', '1'));
  await signIn(page, owner);
  await profileChip(page, owner).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Company' }).click();
  await page.getByLabel('Company name').fill('Sign-in Co');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Company sign-in' })).toBeVisible();

  // Free mail services can't be claimed; a pasted address or link is tidied.
  await page.getByLabel('Email domain').fill('gmail.com');
  await page.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByText('gmail.com is a public mail service')).toBeVisible();
  await page.getByLabel('Email domain').fill(`https://www.${DOMAIN.toUpperCase()}/login`);
  await page.getByRole('button', { name: 'Add domain' }).click();
  const domains = page.getByRole('list', { name: 'Domains' });
  await expect(domains.locator('.company-row-title').filter({ hasText: DOMAIN })).toContainText('Not proved yet');
  await expect(page.getByText(`_survey-verify.${DOMAIN}`)).toBeVisible();
  await expect(page.getByText(/^survey-verify=[0-9a-f]{32}$/)).toBeVisible();

  // Step 3 waits for a proved domain.
  await expect(page.getByText('Prove a domain first (step 1).')).toBeVisible();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('Survey did not find the record yet')).toBeVisible();

  // The person's own token cannot mark a domain proved.
  const client = await apiClientFor(owner);
  const cheat = await client.from('organization_domains').update({ verified_at: new Date().toISOString() }).eq('domain', DOMAIN).select();
  expect(cheat.error?.code === '42501' || (cheat.data || []).length === 0).toBe(true);
  await admin.from('organization_domains').update({ verified_at: new Date().toISOString() }).eq('domain', DOMAIN);

  await page.reload();
  await profileChip(page, owner).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Company' }).click();
  await expect(domains.getByText('Proved')).toBeVisible();
  await expect(page.getByText(/\/auth\/v1\/sso\/saml\/acs$/)).toBeVisible();

  await page.getByRole('button', { name: 'Paste the XML instead' }).click();
  await page.getByLabel('Sign-on XML (metadata file)').fill('<html>not sign-on details</html>');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('That XML is not SAML sign-on details')).toBeVisible();

  await page.getByLabel('Sign-on XML (metadata file)').fill(METADATA);
  await page.getByRole('button', { name: 'Connect' }).click();
  const outcome = page.getByText(/Company sign-in is connected for|not switched on for Survey yet/).first();
  await expect(outcome).toBeVisible();
  if (/connected for/.test(await outcome.innerText())) {
    await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
    const log = page.getByRole('list', { name: 'Activity' });
    await expect(log.getByText(`${owner.email} connected company sign-in`, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('Company sign-in disconnected.')).toBeVisible();
  }
});
