import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agentLinkResumeUrl, clearPendingConsent, isConsentId, readPendingConsent, savePendingConsent } from '../src/home/agentLinkPending.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('consent request is kept 10 minutes while the person signs up', () => {
  const s = memory();
  savePendingConsent(s, 'auth_abc123XYZ', 0);
  assert.equal(readPendingConsent(s, 9 * 60 * 1000), 'auth_abc123XYZ');
  assert.equal(readPendingConsent(s, 11 * 60 * 1000), '');
  clearPendingConsent(s);
  assert.equal(readPendingConsent(s, 0), '');
  assert.equal(isConsentId('<script>'), false);
  savePendingConsent(s, '../../evil', 0);
  assert.equal(readPendingConsent(s, 0), '');
});

test('back at the front page from sign-in, a waiting consent request resumes the consent screen', () => {
  const s = memory();
  savePendingConsent(s, 'auth_abc123XYZ', 0);
  const loc = { pathname: '/', search: '?code=supabase-pkce', hash: '' };
  assert.equal(agentLinkResumeUrl(loc, s, 1000), '/oauth/consent?code=supabase-pkce');
  assert.equal(agentLinkResumeUrl({ ...loc, search: '' }, s, 1000), null);
});

test('consent route and rules are wired', () => {
  assert.match(read('src/main.jsx'), /agent-link\|oauth\\\/consent/);
  const page = read('src/home/AgentLinkPage.jsx');
  assert.match(page, /approveAuthorization\(authorizationId, \{ skipBrowserRedirect: true \}\)/);
  assert.match(page, /where you can only view, it can only view/);
  assert.match(page, /revokeGrant\(\{ clientId \}\)/);
  // Only one flow is kept, nothing shows until sign-in is known, and an
  // already-allowed redirect drops the saved request.
  assert.match(page, /savePendingConsent\(window\.localStorage, consentId\);\s+clearPendingAgentCode/);
  assert.match(page, /savePendingAgentCode\(window\.localStorage, code\);\s+clearPendingConsent/);
  assert.match(page, /if \(auth\.loading\) return/);
  assert.match(page, /clearPendingConsent\(window\.localStorage\); \} catch \{ \/\* storage blocked \*\/ \}\s+window\.location\.assign\(data\.redirect_url\);\s+return;/);
  // An agent-code link starts that flow, never an older saved consent.
  assert.match(page, /if \(params\.get\('user_code'\) \|\| \/\^\\\/agent-link/);
});

test('database keeps outside agents to their person, minus money, linked accounts and other agents', () => {
  const sql = read('supabase/migrations/20261020230000_outside_agent_limits.sql');
  assert.match(sql, /coalesce\(auth\.jwt\(\) ->> 'client_id', ''\) <> ''/);
  for (const table of ['connected_services', 'agent_links']) {
    assert.match(sql, new RegExp(`on public\\.${table}\\s+as restrictive\\s+for all\\s+to authenticated\\s+using \\(not public\\.is_agent_session\\(\\)\\)`));
  }
  assert.match(sql, /if public\.is_agent_session\(\) then\s+raise exception 'agents cannot approve agents'/);
  assert.match(sql, /function public\.revoke_agent_link[\s\S]*?and not public\.is_agent_session\(\)/, 'agents cannot remove other agents');
  for (const fn of ['handle_downgrade_to_free\\(uuid\\)', 'archive_excess_documents\\(uuid, integer\\)', 'archive_excess_projects\\(uuid, integer\\)', 'archive_excess_projects\\(uuid, uuid\\)']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn} from public, anon, authenticated`));
  }
});

test('removing an agent cuts it off at once, not when its token expires', () => {
  const sql = read('supabase/migrations/20261021040000_agent_removal_takes_effect.sql');
  // People's own sign-ins skip the lookup; agents need a live session and an unrevoked grant.
  assert.match(sql, /select coalesce\(auth\.jwt\(\) ->> 'client_id', ''\) = ''\s+or \(/);
  assert.match(sql, /from auth\.sessions s[\s\S]*?s\.id::text = auth\.jwt\(\) ->> 'session_id'/);
  assert.match(sql, /from auth\.oauth_consents c[\s\S]*?c\.revoked_at is not null/);
  assert.match(sql, /alter role authenticator set pgrst\.db_pre_request = 'public\.check_agent_request';/);
  assert.match(sql, /notify pgrst, 'reload config';/);
  assert.match(sql, /on storage\.objects as restrictive/);
});

test('agents cannot pay, open billing, or delete the account', () => {
  const helper = read('supabase/functions/_shared/agentSession.ts');
  assert.match(helper, /claims\?\.client_id/);
  for (const fn of ['create-checkout-session', 'create-portal-session', 'delete-account']) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    assert.match(src, /import \{ isAgentSession, AGENT_REFUSED_MESSAGE \} from '\.\.\/_shared\/agentSession\.ts'/, fn);
    const guard = src.indexOf('isAgentSession(authHeader)');
    assert.ok(guard > src.indexOf('getUser('), `${fn} checks after the token is verified`);
  }
});

async function loadAgentSession() {
  const { stripTypeScriptTypes } = await import('node:module');
  const js = stripTypeScriptTypes(read('supabase/functions/_shared/agentSession.ts'));
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const agentToken = (claims) => `Bearer h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

test('isAgentSession reads client_id from the token', async () => {
  const { isAgentSession, agentClientId } = await loadAgentSession();
  assert.equal(isAgentSession(agentToken({ sub: 'u', client_id: 'c1' })), true);
  assert.equal(agentClientId(agentToken({ sub: 'u', client_id: 'c1' })), 'c1');
  assert.equal(isAgentSession(agentToken({ sub: 'u' })), false);
  assert.equal(isAgentSession(agentToken({ sub: 'u', client_id: '' })), false);
  assert.equal(isAgentSession(null), false);
  assert.equal(isAgentSession('Bearer garbage'), false);
});

test('agent hourly limits: people pass untouched, agents are counted and fail closed', async () => {
  const { agentOverLimit, AGENT_HOURLY_LIMITS } = await loadAgentSession();
  const calls = [];
  const client = (result) => ({ rpc: async (name, args) => { calls.push([name, args]); return result; } });
  assert.equal(await agentOverLimit(agentToken({ sub: 'u' }), 'send-email', client({ data: false })), false);
  assert.equal(calls.length, 0, 'a person never touches the counter');
  const agent = agentToken({ sub: 'u', client_id: 'c1' });
  assert.equal(await agentOverLimit(agent, 'send-email', client({ data: true, error: null })), false);
  assert.deepEqual(calls.at(-1), ['agent_rate_hit', { p_fn: 'send-email', p_limit: AGENT_HOURLY_LIMITS['send-email'] }]);
  assert.equal(await agentOverLimit(agent, 'send-email', client({ data: false, error: null })), true);
  assert.equal(await agentOverLimit(agent, 'send-email', client({ data: null, error: { message: 'down' } })), true, 'fails closed');
  for (const fn of Object.keys(AGENT_HOURLY_LIMITS)) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    assert.match(src, new RegExp(`agentOverLimit\\([^)]*'${fn}'`), `${fn} checks its agent limit`);
    assert.match(src, /status: 429|, 429\)/, `${fn} answers 429`);
    assert.match(read('supabase/migrations/20261021060000_agent_rate_limits.sql'), new RegExp(`'${fn}'`));
  }
});

test('agent activity log: agents\' writes are recorded, people read their own log, agents read none', () => {
  const sql = read('supabase/migrations/20261021050000_agent_activity_log.sql');
  assert.match(sql, /using \(user_id = auth\.uid\(\) and not public\.is_agent_session\(\)\)/);
  assert.match(sql, /if v_uid is null or not public\.is_agent_session\(\) then\s+return null;/);
  for (const table of ['projects', 'documents', 'document_annotations', 'survey_items']) assert.match(sql, new RegExp(`'${table}'`));
  assert.match(sql, /interval '90 days'/);
  const page = read('src/home/AgentLinkPage.jsx');
  assert.match(page, /from\('agent_activity'\)/);
  assert.match(page, /rpc\('my_agent_last_active'\)/);
});
