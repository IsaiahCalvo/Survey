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

test('isAgentSession reads client_id from the token', async () => {
  const src = read('supabase/functions/_shared/agentSession.ts')
    .replace(/export /g, '').replace(/\(authHeader: string \| null\): boolean/, '(authHeader)');
  const isAgentSession = new Function(`${src}; return isAgentSession;`)();
  const tok = (claims) => `Bearer h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  assert.equal(isAgentSession(tok({ sub: 'u', client_id: 'c1' })), true);
  assert.equal(isAgentSession(tok({ sub: 'u' })), false);
  assert.equal(isAgentSession(tok({ sub: 'u', client_id: '' })), false);
  assert.equal(isAgentSession(null), false);
  assert.equal(isAgentSession('Bearer garbage'), false);
});
