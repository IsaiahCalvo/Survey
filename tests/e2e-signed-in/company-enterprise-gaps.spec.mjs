// Enterprise gaps after #1269 (company workspace, beta 'company-admin'):
//   - require company sign-in for a proved domain (the app signs out a
//     password session and steers the sign-in form to company SSO; the local
//     stack runs the custom access token hook too, so the server refuses the
//     password sign-in);
//   - the shared 1 TB pool is one limit for the whole paid company;
//   - invites send an email and the email's link opens Settings, Company;
//   - Settings, Subscription says "Enterprise through <company>";
//   - "Continue with Microsoft" on the sign-in form (beta 'microsoft-sign-in');
//   - the outside AI connector's export_survey tool (summary and CSV).
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, apiClientFor, expect, functionUrl, profileChip, signIn, test } from './helpers.mjs';

const flagsOn = (page, ...keys) => page.addInitScript((names) => {
  for (const name of names) localStorage.setItem(`survey.flag.${name}`, '1');
}, keys);

async function clearCompanies(admin) {
  const emails = Object.values(E2E_ACCOUNTS).map((a) => a.email);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ids = (users?.users || []).filter((u) => emails.includes(u.email)).map((u) => u.id);
  const { data: rows } = await admin.from('organization_members').select('organization_id').in('user_id', ids);
  const orgs = [...new Set((rows || []).map((r) => r.organization_id))];
  if (orgs.length) await admin.from('organizations').delete().in('id', orgs);
  // A company with no members (made by the require-SSO test) holds example.com.
  await admin.from('organization_domains').delete().eq('domain', 'example.com');
  await admin.from('organization_invites').delete().in('email', [...emails, 'newhire@acme-e2e.com']);
}

test.beforeEach(async () => { await clearCompanies(adminClient()); });
test.afterEach(async () => { await clearCompanies(adminClient()); });

async function openSettings(page, account, tab) {
  await profileChip(page, account).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: tab }).click();
}

test('require company sign-in: password sessions at the domain are signed out and steered to SSO', async ({ page }) => {
  test.setTimeout(150_000);
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const ownerApi = await apiClientFor(owner);
  const made = await ownerApi.rpc('create_organization', { p_name: 'Require Co' });
  expect(made.error).toBeNull();
  const org = made.data;
  // Stand-in for a proved domain with SSO connected (company-sso does this
  // against Supabase's SAML admin API, which the local stack lacks).
  await admin.from('organizations').update({ sso_provider_id: crypto.randomUUID(), sso_connected_at: new Date().toISOString() }).eq('id', org);
  await admin.from('organization_domains').insert({ organization_id: org, domain: 'example.com', verified_at: new Date().toISOString() });

  await flagsOn(page, 'company-admin');
  await signIn(page, owner);
  await openSettings(page, owner, 'Company');
  const box = page.getByRole('checkbox', { name: /must use company sign-in/ });
  await expect(box).toBeVisible();
  // From a password session at the same domain it refuses, so the admin can
  // never lock themselves out with an SSO setup that does not work.
  await box.click();
  await expect(page.getByRole('alert').filter({ hasText: 'sign back in with "Sign in with company SSO"' })).toBeVisible();
  await expect(box).not.toBeChecked();

  // An admin who signed in with SSO turns it on (set directly here).
  await admin.from('organizations').update({ require_sso: true }).eq('id', org);

  // The open password session is signed out on the next start, and the
  // sign-in form opens on company sign-in saying why.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const sso = page.getByRole('dialog', { name: 'Company sign-in' });
  await expect(sso).toBeVisible({ timeout: 60_000 });
  await expect(sso.getByText('example.com asks you to sign in with your work account')).toBeVisible();

  // A password sign-in for someone else at the domain is steered too.
  await sso.getByRole('button', { name: /Back to sign in/ }).click();
  const login = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(login).toBeVisible();
  await login.getByLabel('Email').fill(E2E_ACCOUNTS.free.email);
  await login.getByLabel('Password').fill(E2E_ACCOUNTS.free.password);
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  const steered = page.getByRole('dialog', { name: 'Company sign-in' });
  await expect(steered).toBeVisible();
  await expect(steered.getByText('example.com asks you to sign in with your work account')).toBeVisible();

  // And the server says no to the password token itself (sign-in hook).
  // (apiClientFor signs in through the auth API and throws GoTrue's answer.)
  await expect(apiClientFor(E2E_ACCOUNTS.free)).rejects.toThrow(/sign in with your work account/);

  // Disconnecting SSO drops the requirement, so nobody is stuck.
  await admin.from('organizations').update({ sso_provider_id: null }).eq('id', org);
  await expect(apiClientFor(E2E_ACCOUNTS.free)).resolves.toBeTruthy();
});

test('a paid company shares one storage pool', async () => {
  const owner = E2E_ACCOUNTS.owner;
  const editor = E2E_ACCOUNTS.editor;
  const admin = adminClient();
  const ownerApi = await apiClientFor(owner);
  const editorApi = await apiClientFor(editor);
  const org = (await ownerApi.rpc('create_organization', { p_name: 'Pool Co' })).data;
  const invite = await ownerApi.rpc('invite_organization_member', { p_org: org, p_email: editor.email, p_role: 'member' });
  expect((await editorApi.rpc('accept_organization_invite', { p_invite: invite.data })).error).toBeNull();
  const editorId = (await editorApi.auth.getUser()).data.user.id;

  const used = (await ownerApi.rpc('get_my_organization')).data.storage_used_bytes;
  // Paid, with room for 3000 more bytes across the whole company.
  await admin.from('organizations').update({ billing_status: 'active', seat_limit: 3, storage_limit_bytes: used + 3000 }).eq('id', org);

  const path = (n) => `${editorId}/pool-e2e-${n}.pdf`;
  const bytes = (n) => new Blob([new Uint8Array(n)], { type: 'application/pdf' });
  try {
    const first = await admin.storage.from('documents').upload(path(1), bytes(2000), { contentType: 'application/pdf', upsert: true });
    expect(first.error).toBeNull();
    const second = await admin.storage.from('documents').upload(path(2), bytes(2000), { contentType: 'application/pdf', upsert: true });
    expect(second.error?.message || '').toMatch(/Company storage is full|quota|exceeded|42501|row-level/i);
    expect((await ownerApi.rpc('get_my_organization')).data.storage_used_bytes).toBe(used + 2000);

    // Unpaid: each person's own plan limit again.
    await admin.from('organizations').update({ billing_status: 'none' }).eq('id', org);
    const third = await admin.storage.from('documents').upload(path(2), bytes(2000), { contentType: 'application/pdf', upsert: true });
    expect(third.error).toBeNull();
  } finally {
    await admin.storage.from('documents').remove([path(1), path(2)]);
  }
});

test('invites are emailed, the email opens Settings, Company, and Subscription names the company', async ({ page }) => {
  test.setTimeout(150_000);
  const owner = E2E_ACCOUNTS.owner;
  const editor = E2E_ACCOUNTS.editor;
  const admin = adminClient();
  const ownerApi = await apiClientFor(owner);
  const org = (await ownerApi.rpc('create_organization', { p_name: 'Mail Co' })).data;
  await admin.from('organizations').update({ billing_status: 'active', seat_limit: 5 }).eq('id', org);

  // The email itself goes out through Brevo; answer the function here and
  // check what the app asked it to send.
  const sends = [];
  await page.route('**/functions/v1/send-invite-email', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    sends.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ sent: true }) });
  });
  await flagsOn(page, 'company-admin');
  await signIn(page, owner);
  await openSettings(page, owner, 'Company');
  await page.getByLabel('Invite by email').fill(`${editor.email}, newhire@acme-e2e.com`);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByText(`Invited ${editor.email}, newhire@acme-e2e.com. We emailed them`)).toBeVisible();
  expect(sends).toHaveLength(2);
  expect(sends[0]).toMatchObject({ appOrigin: new URL(page.url()).origin });
  expect(sends[0].companyInviteId).toMatch(/^[0-9a-f-]{36}$/);
  // Email again from the list.
  await page.getByRole('button', { name: 'Email again' }).first().click();
  await expect(page.getByText(/^Emailed .+ again\.$/)).toBeVisible();

  // The invitee follows the email's link: Settings opens on Company.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await flagsOn(page, 'company-admin');
  await signIn(page, editor);
  await page.goto('/?settings=company', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Company' })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
  await expect(page.getByText('Mail Co').first()).toBeVisible();
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByText('You joined Mail Co.')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('settings')).toBeNull();

  // Subscription: Enterprise through the company, own plan left alone.
  await page.getByRole('tab', { name: 'Subscription' }).click();
  await expect(page.getByTestId('company-plan-line')).toHaveText(/^Enterprise through Mail Co\. Your company pays for your seat\./);
  await expect(page.getByRole('button', { name: 'Through Mail Co' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Included with your company' })).toBeVisible();
});

test('Continue with Microsoft starts Supabase\'s Microsoft (azure) sign-in', async ({ page }) => {
  let authorize = null;
  await page.route('**/auth/v1/authorize**', async (route) => {
    authorize = route.request().url();
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Microsoft sign-in answered by the test.</p>' });
  });
  await flagsOn(page, 'microsoft-sign-in');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const login = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(login).toBeVisible({ timeout: 60_000 });
  await login.getByRole('button', { name: 'Continue with Microsoft' }).click();
  await expect(page.getByText('Microsoft sign-in answered by the test.')).toBeVisible();
  const url = new URL(authorize);
  expect(url.searchParams.get('provider')).toBe('azure');
  expect(url.searchParams.get('scopes')).toContain('email');
});

test('the outside AI connector exports a document\'s survey as a summary or CSV', async () => {
  const admin = adminClient();
  const ownerApi = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { session } } = await ownerApi.auth.getSession();
  const { data: seeded } = await admin.from('documents').select('user_id').eq('id', E2E_SURVEY.documentId).single();
  const annotationId = `surveyMarker-export-e2e-${Date.now()}`;
  // The connector reads the items' mirror; an open app writes it, so put one row there.
  const row = {
    document_id: E2E_SURVEY.documentId, user_id: seeded.user_id, annotation_id: annotationId,
    annotation_type: 'survey-marker', page_number: 1, bounds: { x: 10, y: 10, width: 20, height: 20 },
    category_id: E2E_SURVEY.categoryId, name: 'D-9-99', notes: JSON.stringify({ text: '=bad, "quoted"' }),
    checklist_responses: { [E2E_SURVEY.checklist[0].id]: { selection: 'Y' }, [E2E_SURVEY.checklist[1].id]: { selection: 'N' } },
  };
  const ins = await admin.from('document_annotations').insert(row);
  expect(ins.error).toBeNull();
  const call = async (args) => {
    const res = await fetch(functionUrl('survey-mcp'), {
      method: 'POST',
      headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'export_survey', arguments: args } }),
    });
    const body = await res.json();
    expect(body?.result?.isError, JSON.stringify(body)).toBeFalsy();
    return String(body.result.content[0].text);
  };
  try {
    const listed = await fetch(functionUrl('survey-mcp'), {
      method: 'POST',
      headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }).then((r) => r.json());
    expect((listed.result.tools || []).map((t) => t.name)).toContain('export_survey');

    const summary = await call({ document_id: E2E_SURVEY.documentId });
    expect(summary).toMatch(/E2E Survey Agent Drawing\.pdf: \d+ items?/);
    expect(summary).toMatch(/- Door: \d+/);
    expect(summary).toMatch(/answered No/);

    const csv = JSON.parse(await call({ document_id: E2E_SURVEY.documentId, format: 'csv', category: 'door' }));
    expect(csv.truncated).toBe(false);
    const lines = csv.csv.trim().split('\r\n');
    expect(lines[0]).toBe('Item,Category,Status,Page,Answered,Of,Answers,Note,Photos and files');
    const mine = lines.find((l) => l.startsWith('D-9-99,'));
    expect(mine).toBe(`D-9-99,Door,,1,2,3,${E2E_SURVEY.checklist[0].text}: Y; ${E2E_SURVEY.checklist[1].text}: N,"'=bad, ""quoted""",0`);
  } finally {
    await admin.from('document_annotations').delete().eq('annotation_id', annotationId);
  }
});
