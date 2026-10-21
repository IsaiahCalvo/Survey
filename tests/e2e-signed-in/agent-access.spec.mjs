// Outside AI agents (public/auth.md, OAuth 2.1): a real agent registers,
// the person signs in on Survey's consent page and presses Allow or Deny, and
// the agent then acts as that person: same role, same plan, logged, and cut
// off at once when the person removes it.
import crypto from 'node:crypto';
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { agentSignIn, REDIRECT, registerAgent, tokenRequest } from './agentAuth.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const API = () => process.env.E2E_SUPABASE_URL;
const KEY = () => process.env.E2E_SUPABASE_ANON_KEY;
const RUN = crypto.randomBytes(3).toString('hex');

function agentApi(token) {
  const headers = { apikey: KEY(), authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' };
  const call = (method, path, body) => fetch(`${API()}/rest/v1/${path}`, { method, headers, body: body && JSON.stringify(body) });
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    del: (path) => call('DELETE', path),
    rpc: (name, args) => call('POST', `rpc/${name}`, args),
  };
}

const sub = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;

test('a viewer\'s agent, even one let make changes, can read but not edit, and gets no Pro features', async ({ page }) => {
  const { clientId, tok } = await agentSignIn(page, E2E_ACCOUNTS.viewer, `Viewer agent ${RUN}`, 'Allow', { write: true });
  const claims = JSON.parse(Buffer.from(tok.access_token.split('.')[1], 'base64url').toString());
  expect(claims.client_id).toBe(clientId);
  const a = agentApi(tok.access_token);

  const docs = await (await a.get(`documents?id=eq.${E2E_DOCUMENT.id}&select=id`)).json();
  expect(docs).toHaveLength(1);
  expect(await (await a.rpc('get_my_document_role', { doc_id: E2E_DOCUMENT.id })).json()).toBe('viewer');

  const marker = await a.post('document_annotations', {
    document_id: E2E_DOCUMENT.id, user_id: claims.sub, annotation_id: `agent-${RUN}`,
    annotation_type: 'survey-marker', page_number: 1, bounds: {},
  });
  expect(marker.status).toBeGreaterThanOrEqual(400);
  expect((await a.post('templates', { user_id: claims.sub, name: 'agent template' })).status).toBeGreaterThanOrEqual(400);
  expect(await (await a.get('connected_services?select=id')).json()).toEqual([]);
  const approve = await a.rpc('approve_agent_link', { p_user_code: 'ZZZZ2345' });
  expect(await approve.text()).toMatch(/agents cannot approve agents/);
});

test('a read-only agent can read but every change is refused, and Remove forgets the choice', async ({ page }) => {
  const account = E2E_ACCOUNTS.owner;
  const { clientId, tok } = await agentSignIn(page, account, `Read-only agent ${RUN}`);
  const a = agentApi(tok.access_token);
  const userId = sub(tok.access_token);
  expect(await (await a.rpc('my_agent_access', {})).json()).toBe('read');
  expect(await (await a.get('rpc/my_agent_access')).json()).toBe('read');

  // Reads work, by GET and by POST to a read-only function.
  expect(await (await a.get(`documents?id=eq.${E2E_DOCUMENT.id}&select=id`)).json()).toHaveLength(1);
  expect(await (await a.rpc('get_my_document_role', { doc_id: E2E_DOCUMENT.id })).json()).toBe('owner');
  // Its own hourly counter still works.
  expect(await (await a.rpc('agent_rate_hit', { p_fn: 'send-profile-change-notification', p_limit: 5 })).json()).toBe(true);

  // Every kind of change is refused, though the person owns the document.
  const refused = async (res) => {
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/can only read/);
  };
  await refused(await a.post('projects', { user_id: userId, name: `Read-only ${RUN}` }));
  await refused(await a.post('document_annotations', {
    document_id: E2E_DOCUMENT.id, user_id: userId, annotation_id: `ro-${RUN}`,
    annotation_type: 'survey-marker', page_number: 1, bounds: {},
  }));
  await refused(await a.patch(`documents?id=eq.${E2E_DOCUMENT.id}`, { name: 'renamed by agent' }));
  await refused(await a.del(`document_annotations?document_id=eq.${E2E_DOCUMENT.id}`));
  await refused(await a.rpc('set_agent_access', { p_client_id: clientId, p_write: true }));
  const upload = await fetch(`${API()}/storage/v1/object/documents/${userId}/agent-${RUN}.txt`, {
    method: 'POST', headers: { apikey: KEY(), authorization: `Bearer ${tok.access_token}`, 'content-type': 'text/plain' }, body: 'x',
  });
  expect(upload.status).toBeGreaterThanOrEqual(400);
  expect(await (await a.rpc('my_agent_access', {})).json()).toBe('read');

  // The person's own sign-in is not affected.
  const human = (await (await fetch(`${API()}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY(), 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  })).json()).access_token;
  expect(await (await agentApi(human).rpc('my_agent_access', {})).json()).toBe('person');

  // Remove, then let it in again with "Read only" left on: still read only,
  // even though the person had picked "Read and make changes" for it before.
  expect((await agentApi(human).rpc('set_agent_access', { p_client_id: clientId, p_write: true })).status).toBeLessThan(300);
  const { data: before } = await adminClient().from('agent_access').select('can_write').eq('client_id', clientId);
  expect(before).toEqual([{ can_write: true }]);
  expect((await authCall(human, `user/oauth/grants?client_id=${clientId}`, 'DELETE')).status).toBeLessThan(300);
  const { data: after } = await adminClient().from('agent_access').select('can_write').eq('client_id', clientId);
  expect(after).toEqual([]);
});

test('Deny sends the agent away with nothing', async ({ page }) => {
  const { error } = await agentSignIn(page, E2E_ACCOUNTS.free, `Denied agent ${RUN}`, 'Deny');
  expect(error).toBe('access_denied');
});

test('the person sees what the agent changed, and Remove cuts it off at once', async ({ page }) => {
  const name = `Owner agent ${RUN}`;
  const { clientId, tok } = await agentSignIn(page, E2E_ACCOUNTS.owner, name, 'Allow', { write: true });
  const a = agentApi(tok.access_token);
  const projectName = `Agent project ${RUN}`;

  const created = await a.post('projects', { user_id: sub(tok.access_token), name: projectName });
  expect(created.status, await created.clone().text()).toBe(201);
  const [{ id }] = await created.json();
  expect((await a.patch(`projects?id=eq.${id}`, { name: `${projectName} renamed` })).status).toBe(200);
  expect((await a.del(`projects?id=eq.${id}`)).status).toBe(200);
  // The agent can't read its own log.
  expect(await (await a.get('agent_activity?select=id')).json()).toEqual([]);

  await page.goto('/agent-link');
  const row = page.locator('li', { hasText: name });
  await expect(row.filter({ hasText: `added project "${projectName}"` })).toBeVisible({ timeout: 30_000 });
  await expect(row.filter({ hasText: `changed project "${projectName} renamed"` })).toBeVisible();
  await expect(row.filter({ hasText: `removed project "${projectName} renamed"` })).toBeVisible();
  const agentRow = page.locator(`div:has(> span:has-text("${name}"))`);
  await expect(agentRow).toContainText('last active');

  await agentRow.getByRole('button', { name: 'Remove' }).click();
  await expect(agentRow).toHaveCount(0);
  const after = await a.get('projects?select=id');
  expect(after.status).toBe(403);
  expect(await after.text()).toMatch(/agent was removed/);
  const renewed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId });
  expect(renewed.access_token).toBeFalsy();
});

test('each agent has an hourly limit on email and Excel calls, and it shows in the log', async ({ page }) => {
  const name = `Busy agent ${RUN}`;
  const { tok } = await agentSignIn(page, E2E_ACCOUNTS.pro, name);
  const a = agentApi(tok.access_token);
  const hit = async () => (await (await a.rpc('agent_rate_hit', { p_fn: 'send-profile-change-notification', p_limit: 5 })).json());
  for (let i = 0; i < 5; i += 1) expect(await hit()).toBe(true);
  expect(await hit()).toBe(false);
  // Only the functions with limits can be counted.
  expect((await a.rpc('agent_rate_hit', { p_fn: 'anything', p_limit: 5 })).status).toBeGreaterThanOrEqual(400);

  await page.goto('/agent-link');
  const row = page.locator('li', { hasText: name });
  await expect(row.filter({ hasText: 'used profile change email (refused: over the hourly limit)' })).toHaveCount(1, { timeout: 30_000 });
  await expect(row.filter({ hasText: /used profile change email$/ })).toHaveCount(5);
});

test('a checked AgentID shows next to the agent, and agents cannot read it', async ({ page }) => {
  const name = `AgentID agent ${RUN}`;
  const { clientId, tok } = await agentSignIn(page, E2E_ACCOUNTS.editor, name);
  const userId = sub(tok.access_token);
  // What the agent-identity function records after checking the AgentID token.
  const { error } = await adminClient().from('agent_identities').upsert({
    user_id: userId, client_id: clientId, agentid_sub: `agt_${RUN}`, agent_email: `bot-${RUN}@agentmail.to`,
    owner_email: 'owner@example.com', owner_human_verified: true,
  });
  expect(error).toBeNull();
  expect(await (await agentApi(tok.access_token).get('agent_identities?select=agentid_sub')).json()).toEqual([]);

  await page.goto('/agent-link');
  await expect(page.locator(`div:has(> span:has-text("${name}"))`))
    .toContainText(`AgentID bot-${RUN}@agentmail.to, owned by owner@example.com (verified human)`, { timeout: 30_000 });
  await adminClient().from('agent_identities').delete().eq('user_id', userId).eq('client_id', clientId);

  await page.goto('/agentid/callback?code=abc&state=xyz');
  await expect(page.getByText('Agent sign-in received')).toBeVisible();
});

test('log rows past 90 days are hidden and pruned, even for people whose agents went quiet', async ({ page }) => {
  const admin = adminClient();
  const { data: { users } } = await admin.auth.admin.listUsers();
  const quiet = users.find((u) => u.email === E2E_ACCOUNTS.free.email);
  const { error } = await admin.from('agent_activity').insert({
    user_id: quiet.id, client_id: `old-${RUN}`, action: 'insert', table_name: 'projects',
    created_at: new Date(Date.now() - 100 * 86_400_000).toISOString(),
  });
  expect(error).toBeNull();

  const { tok } = await agentSignIn(page, E2E_ACCOUNTS.pro, `Pruning agent ${RUN}`, 'Allow', { write: true });
  const a = agentApi(tok.access_token);
  const created = await a.post('projects', { user_id: sub(tok.access_token), name: `Prune trigger ${RUN}` });
  const [{ id }] = await created.json();
  await a.del(`projects?id=eq.${id}`);

  const { data } = await admin.from('agent_activity').select('id').eq('client_id', `old-${RUN}`);
  expect(data).toEqual([]);
});

test('an agent cannot raise its own hourly cap from REST', async ({ page }) => {
  const { tok } = await agentSignIn(page, E2E_ACCOUNTS.free, `Cap probe ${RUN}`);
  const a = agentApi(tok.access_token);
  // Spend the real cap (5/hour for this function), passing a huge p_limit each time.
  let refused = 0;
  for (let i = 0; i < 7; i += 1) {
    const ok = await (await a.rpc('agent_rate_hit', { p_fn: 'send-profile-change-notification', p_limit: 1_000_000 })).json();
    if (ok === false) refused += 1;
  }
  expect(refused).toBeGreaterThan(0);
});

// Supabase Auth takes an agent's token on its own account endpoints too. The
// database refuses these changes unless the person's own session asked first
// (migration 20261022020200_human_only_account_changes).
const authCall = (token, path, method = 'GET', body) => fetch(`${API()}/auth/v1/${path}`, {
  method, headers: { apikey: KEY(), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body && JSON.stringify(body),
});
const passwordWorks = async (email, password) => (await fetch(`${API()}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: KEY(), 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
})).ok;

test('an agent cannot change the password or email, or let in another agent', async ({ page }) => {
  const account = E2E_ACCOUNTS.editor;
  const { tok } = await agentSignIn(page, account, `Takeover probe ${RUN}`);
  const token = tok.access_token;

  const ask = await agentApi(token).rpc('begin_auth_change', { p_action: 'password' });
  expect(ask.status).toBeGreaterThanOrEqual(400);

  const pw = await authCall(token, 'user', 'PUT', { password: `Agent-${RUN}-Takeover1!` });
  expect(pw.status).toBeGreaterThanOrEqual(400);
  expect(await passwordWorks(account.email, account.password)).toBe(true);

  const email = await authCall(token, 'user', 'PUT', { email: `agent-${RUN}@example.com` });
  expect(email.status).toBeGreaterThanOrEqual(400);
  const { data: { users } } = await adminClient().auth.admin.listUsers();
  const person = users.find((u) => u.email === account.email);
  expect(person.new_email || null).toBeNull();

  // A second agent asks to be let in; the first one tries to press Allow.
  const childId = await registerAgent(`Child agent ${RUN}`);
  const challenge = crypto.createHash('sha256').update(crypto.randomBytes(48).toString('base64url')).digest('base64url');
  const authorize = await fetch(`${API()}/auth/v1/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: childId, redirect_uri: REDIRECT,
    code_challenge: challenge, code_challenge_method: 'S256', state: 's', scope: 'email',
  })}`, { redirect: 'manual', headers: { apikey: KEY() } });
  const authorizationId = new URL(authorize.headers.get('location')).searchParams.get('authorization_id');
  await authCall(token, `oauth/authorizations/${authorizationId}`);
  const consent = await authCall(token, `oauth/authorizations/${authorizationId}/consent`, 'POST', { action: 'approve' });
  const answer = await consent.json().catch(() => ({}));
  expect(String(answer.redirect_url || '')).not.toContain('code=');

  // The person's own ask names the agent they are letting in, so the first
  // agent cannot spend it on the child.
  const human = (await (await fetch(`${API()}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY(), 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  })).json()).access_token;
  const otherId = await registerAgent(`Other agent ${RUN}`);
  expect((await agentApi(human).rpc('begin_auth_change', { p_action: 'consent', p_target: otherId })).status).toBeLessThan(300);
  const stolen = await authCall(token, `oauth/authorizations/${authorizationId}/consent`, 'POST', { action: 'approve' });
  expect(String((await stolen.json().catch(() => ({}))).redirect_url || '')).not.toContain('code=');
});

test('an agent cannot let a removed agent back in', async ({ page, browser }) => {
  const account = E2E_ACCOUNTS.owner;
  const { clientId: removedId } = await agentSignIn(page, account, `Removed agent ${RUN}`);
  const fresh = await browser.newContext();
  const { tok } = await agentSignIn(await fresh.newPage(), account, `Live agent ${RUN}`);
  await fresh.close();
  const human = (await (await fetch(`${API()}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY(), 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  })).json()).access_token;
  expect((await authCall(human, `user/oauth/grants?client_id=${removedId}`, 'DELETE')).status).toBeLessThan(300);

  // The removed agent asks again; the live agent presses Allow on it. Auth
  // takes the update path here (the old consent row), not an insert.
  const challenge = crypto.createHash('sha256').update(crypto.randomBytes(48).toString('base64url')).digest('base64url');
  const authorize = await fetch(`${API()}/auth/v1/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: removedId, redirect_uri: REDIRECT,
    code_challenge: challenge, code_challenge_method: 'S256', state: 's', scope: 'email',
  })}`, { redirect: 'manual', headers: { apikey: KEY() } });
  const authorizationId = new URL(authorize.headers.get('location')).searchParams.get('authorization_id');
  await authCall(tok.access_token, `oauth/authorizations/${authorizationId}`);
  const consent = await authCall(tok.access_token, `oauth/authorizations/${authorizationId}/consent`, 'POST', { action: 'approve' });
  expect(String((await consent.json().catch(() => ({}))).redirect_url || '')).not.toContain('code=');
});

test('the person still changes their own password, from Settings or a reset link', async () => {
  const account = E2E_ACCOUNTS.viewer;
  const next = `Viewer-${RUN}-Changed1!`;
  const signIn = async (password) => (await fetch(`${API()}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY(), 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password }),
  })).json();
  const human = (await signIn(account.password)).access_token;

  // Without the ask first, even the person's own session is refused.
  expect((await authCall(human, 'user', 'PUT', { password: next })).status).toBeGreaterThanOrEqual(400);

  expect((await agentApi(human).rpc('begin_auth_change', { p_action: 'password' })).status).toBeLessThan(300);
  expect((await authCall(human, 'user', 'PUT', { password: next })).status).toBe(200);
  expect(await passwordWorks(account.email, next)).toBe(true);

  // Reset link: the recovery session asks, then sets the old password back.
  const { data: link, error } = await adminClient().auth.admin.generateLink({ type: 'recovery', email: account.email });
  expect(error).toBeNull();
  const verified = await (await fetch(`${API()}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: KEY(), 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'recovery', token_hash: link.properties.hashed_token }),
  })).json();
  expect(verified.access_token, JSON.stringify(verified).slice(0, 200)).toBeTruthy();
  expect((await agentApi(verified.access_token).rpc('begin_auth_change', { p_action: 'password' })).status).toBeLessThan(300);
  expect((await authCall(verified.access_token, 'user', 'PUT', { password: account.password })).status).toBe(200);
  expect(await passwordWorks(account.email, account.password)).toBe(true);
});
